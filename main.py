"""
CodeLens — Predictive Code Review Assistant
Backend API powered by FastAPI + Groq
© AXON LATTICE LABS™
"""

import os
import json
import re
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Any
from groq import Groq

app = FastAPI(title="CodeLens API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_client: Optional[Groq] = None

def get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="GROQ_API_KEY is not configured")
        _client = Groq(api_key=api_key)
    return _client

# ─── Models ───────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    code: str
    language: Optional[str] = "auto"
    filename: Optional[str] = None

class GitHubRequest(BaseModel):
    repo_url: str
    file_path: Optional[str] = None

class FixRequest(BaseModel):
    code: str
    language: str
    issues: List[Any]

# ─── Language Detection ───────────────────────────────────────────────

LANGUAGE_HINTS = {
    "python": [r"def \w+\(", r"import \w+", r"class \w+:", r"print\(", r"self\."],
    "javascript": [r"const \w+", r"let \w+", r"function \w+", r"=>", r"console\.log"],
    "typescript": [r"interface \w+", r"type \w+", r": string", r": number", r"<\w+>"],
    "java": [r"public class", r"public static void", r"System\.out", r"import java\."],
    "go": [r"func \w+\(", r"package \w+", r"fmt\.", r"import \("],
    "rust": [r"fn \w+\(", r"let mut", r"impl \w+", r"use \w+::", r"pub fn"],
}

def detect_language(code: str, filename: Optional[str] = None) -> str:
    if filename:
        ext_map = {
            ".py": "python", ".js": "javascript", ".ts": "typescript",
            ".jsx": "javascript", ".tsx": "typescript", ".java": "java",
            ".go": "go", ".rs": "rust", ".rb": "ruby", ".php": "php",
            ".cs": "csharp", ".cpp": "cpp", ".c": "c", ".swift": "swift",
        }
        for ext, lang in ext_map.items():
            if filename.endswith(ext):
                return lang

    scores = {}
    for lang, patterns in LANGUAGE_HINTS.items():
        score = sum(1 for p in patterns if re.search(p, code))
        if score > 0:
            scores[lang] = score

    if scores:
        return max(scores, key=scores.get)
    return "unknown"

# ─── Prompts ──────────────────────────────────────────────────────────

ANALYSIS_SYSTEM_PROMPT = """You are CodeLens, an elite AI code reviewer with deep expertise in software engineering, security, and performance optimization. You perform predictive code analysis — identifying not just current issues but patterns likely to cause future problems.

Your analysis MUST be returned as valid JSON with this exact structure:
{
  "summary": "Brief 1-2 sentence overview of the code quality",
  "health_score": <integer 0-100>,
  "language": "<detected language>",
  "total_issues": <integer>,
  "issues": [
    {
      "id": <integer starting from 1>,
      "severity": "critical" | "warning" | "info",
      "category": "bug" | "security" | "performance" | "code_smell" | "best_practice",
      "title": "Short descriptive title",
      "description": "Detailed explanation of the issue and WHY it matters",
      "line_start": <integer line number or null>,
      "line_end": <integer line number or null>,
      "suggestion": "Specific code fix or improvement",
      "predicted_impact": "What could go wrong if this isn't fixed"
    }
  ],
  "metrics": {
    "bugs": <count>,
    "security": <count>,
    "performance": <count>,
    "code_smells": <count>,
    "best_practices": <count>
  },
  "positive_notes": ["List of things done well in the code"]
}

Rules:
- Be thorough but precise. No false positives.
- Every issue must have a concrete, actionable suggestion.
- Line numbers must be accurate.
- The health_score should reflect: 90-100 = excellent, 70-89 = good, 50-69 = needs work, 30-49 = poor, 0-29 = critical.
- Include at least 1-2 positive_notes to acknowledge good practices.
- Focus on issues that MATTER: real bugs, actual security risks, genuine performance concerns.
- Return ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON."""

FIX_SYSTEM_PROMPT = """You are an expert code security engineer. You will receive code with a list of issues. Fix ALL of them and return ONLY the corrected code.

Rules:
- Add inline comments prefixed with # FIX: (or // FIX: for JS/TS/Java) briefly explaining each change made.
- Fix every single issue listed.
- Do not remove functionality, only make it safe and correct.
- Return RAW CODE ONLY. No markdown fences, no explanation, no preamble."""

def build_analysis_prompt(code: str, language: str, filename: Optional[str] = None) -> str:
    file_context = f" (filename: {filename})" if filename else ""
    return f"""Analyze the following {language} code{file_context} for bugs, security vulnerabilities, performance issues, and code quality problems.

```{language}
{code}
```

Return your analysis as the specified JSON structure. Be thorough and precise."""

def build_fix_prompt(code: str, language: str, issues: List[Any]) -> str:
    issues_list = "\n".join([
        f"  - [Line {i.get('line_start', '?')}] [{i.get('severity', '').upper()}] {i.get('title', '')}: {i.get('suggestion', '')}"
        for i in issues
    ])
    return f"""Fix ALL of the following issues in this {language} code:

ISSUES TO FIX:
{issues_list}

ORIGINAL CODE:
{code}

Return the complete fixed code with inline FIX comments."""

# ─── GitHub Integration ───────────────────────────────────────────────

async def fetch_github_file(repo_url: str, file_path: Optional[str] = None) -> dict:
    match = re.match(r"https?://github\.com/([^/]+)/([^/]+)(?:/blob/([^/]+)/(.+))?", repo_url)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid GitHub URL format")

    owner, repo = match.group(1), match.group(2).rstrip(".git")
    branch = match.group(3) or "main"
    path = match.group(4) or file_path

    if not path:
        api_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
        async with httpx.AsyncClient() as http_client:
            resp = await http_client.get(api_url, headers={"Accept": "application/vnd.github.v3+json"})
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Repository not found or not accessible")
            tree = resp.json()
            code_extensions = {".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rs", ".rb", ".php", ".cs", ".cpp", ".c"}
            files = [
                item["path"] for item in tree.get("tree", [])
                if item["type"] == "blob" and any(item["path"].endswith(ext) for ext in code_extensions)
            ]
            return {"type": "file_tree", "files": files[:50], "owner": owner, "repo": repo, "branch": branch}

    raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
    async with httpx.AsyncClient() as http_client:
        resp = await http_client.get(raw_url)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail=f"File not found: {path}")
        return {"type": "file_content", "content": resp.text, "path": path}

# ─── API Endpoints ────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "CodeLens API", "version": "2.0.0"}

@app.post("/analyze")
async def analyze_code(request: AnalyzeRequest):
    """Analyze code for bugs, security issues, and performance problems."""
    if not request.code.strip():
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    if len(request.code) > 50000:
        raise HTTPException(status_code=400, detail="Code exceeds maximum length (50,000 characters)")

    language = request.language
    if language == "auto":
        language = detect_language(request.code, request.filename)

    prompt = build_analysis_prompt(request.code, language, request.filename)

    try:
        response = get_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        )

        raw_text = response.choices[0].message.content.strip()
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)

        analysis = json.loads(raw_text)
        analysis["language"] = language
        return analysis

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse analysis response: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.post("/fix")
async def fix_code(request: FixRequest):
    """Generate fixed code that resolves all identified issues."""
    if not request.code.strip():
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    if not request.issues:
        raise HTTPException(status_code=400, detail="No issues provided to fix")

    prompt = build_fix_prompt(request.code, request.language, request.issues)

    try:
        response = get_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": FIX_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        )

        fixed = response.choices[0].message.content.strip()
        fixed = re.sub(r"^```(?:\w+)?\s*\n?", "", fixed)
        fixed = re.sub(r"\n?```\s*$", "", fixed)
        return {"fixed_code": fixed, "language": request.language, "issues_resolved": len(request.issues)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fix failed: {str(e)}")

@app.post("/github/fetch")
async def fetch_from_github(request: GitHubRequest):
    """Fetch files from a public GitHub repository."""
    return await fetch_github_file(request.repo_url, request.file_path)

@app.post("/github/analyze")
async def analyze_github_file(request: GitHubRequest):
    """Fetch and analyze a file from GitHub."""
    if not request.file_path:
        raise HTTPException(status_code=400, detail="file_path is required for analysis")

    result = await fetch_github_file(request.repo_url, request.file_path)
    if result["type"] != "file_content":
        raise HTTPException(status_code=400, detail="Expected file content")

    analyze_req = AnalyzeRequest(
        code=result["content"],
        language="auto",
        filename=result["path"],
    )
    analysis = await analyze_code(analyze_req)
    analysis["source"] = {"repo": request.repo_url, "file": result["path"]}
    return analysis


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
