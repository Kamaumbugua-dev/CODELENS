"""
CodeLens — Predictive Code Review Assistant
Backend API powered by FastAPI + Groq
© AXON LATTICE LABS™
"""

import os
import json
import re
import time
import logging
import uuid
import httpx
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Request, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pydantic import BaseModel
from typing import Optional, List, Any
from groq import Groq
from jose import jwt, JWTError

# ─── Logging ──────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","event":%(message)s}',
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("codelens")

# ─── Rate Limiter ─────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address, default_limits=["100/hour"])

app = FastAPI(title="CodeLens API", version="2.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Request Logging Middleware ───────────────────────────────────────

@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    start = time.time()
    ip = request.client.host if request.client else "unknown"

    logger.info(
        f'"request_id":"{request_id}","method":"{request.method}",'
        f'"path":"{request.url.path}","ip":"{ip}"'
    )

    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000)

    level = logging.WARNING if response.status_code >= 400 else logging.INFO
    logger.log(
        level,
        f'"request_id":"{request_id}","status":{response.status_code},'
        f'"duration_ms":{duration_ms},"ip":"{ip}","path":"{request.url.path}"'
    )

    response.headers["X-Request-ID"] = request_id
    return response

# ─── Groq Client ──────────────────────────────────────────────────────

_client: Optional[Groq] = None

def get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="GROQ_API_KEY is not configured")
        _client = Groq(api_key=api_key)
    return _client

# ─── Auth (OAuth 2.0 + JWT) ───────────────────────────────────────────

_http_bearer = HTTPBearer(auto_error=False)

def _issue_token(payload: dict) -> str:
    secret = os.environ.get("JWT_SECRET_KEY", "dev-secret-change-in-prod")
    data = {**payload, "exp": datetime.utcnow() + timedelta(hours=24)}
    return jwt.encode(data, secret, algorithm="HS256")

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_http_bearer),
) -> dict:
    secret = os.environ.get("JWT_SECRET_KEY")
    # If JWT_SECRET_KEY is not set, auth is disabled (local dev)
    if not secret:
        return {"sub": "anonymous"}
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(credentials.credentials, secret, algorithms=["HS256"])
        return payload
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

# ─── OAuth Endpoints ──────────────────────────────────────────────────

class GoogleAuthRequest(BaseModel):
    credential: str  # Google OAuth access token

class GitHubAuthRequest(BaseModel):
    code: str

@app.post("/auth/google")
async def auth_google(body: GoogleAuthRequest):
    """Exchange a Google OAuth access token for a CodeLens JWT."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {body.credential}"},
                timeout=10,
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid Google access token")
            info = resp.json()
        token = _issue_token({
            "sub": info.get("sub"),
            "email": info.get("email"),
            "name": info.get("name"),
            "picture": info.get("picture"),
            "provider": "google",
        })
        return {"token": token, "user": {"name": info.get("name"), "email": info.get("email"), "picture": info.get("picture")}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Google auth failed: {e}")

@app.post("/auth/github")
async def auth_github(body: GitHubAuthRequest):
    """Exchange a GitHub OAuth code for a CodeLens JWT."""
    client_id = os.environ.get("GITHUB_CLIENT_ID")
    client_secret = os.environ.get("GITHUB_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="GitHub OAuth not configured")
    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                "https://github.com/login/oauth/access_token",
                json={"client_id": client_id, "client_secret": client_secret, "code": body.code},
                headers={"Accept": "application/json"},
                timeout=10,
            )
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                raise HTTPException(status_code=401, detail="GitHub code exchange failed")
            user_resp = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github.v3+json"},
                timeout=10,
            )
            user_info = user_resp.json()
        token = _issue_token({
            "sub": str(user_info.get("id", "")),
            "email": user_info.get("email"),
            "name": user_info.get("name") or user_info.get("login"),
            "picture": user_info.get("avatar_url"),
            "provider": "github",
        })
        return {
            "token": token,
            "user": {
                "name": user_info.get("name") or user_info.get("login"),
                "email": user_info.get("email"),
                "picture": user_info.get("avatar_url"),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"GitHub auth failed: {e}")

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
    "python":     [r"def \w+\(", r"import \w+", r"class \w+:", r"print\(", r"self\."],
    "javascript": [r"const \w+", r"let \w+", r"function \w+", r"=>", r"console\.log"],
    "typescript": [r"interface \w+", r"type \w+", r": string", r": number", r"<\w+>"],
    "java":       [r"public class", r"public static void", r"System\.out", r"import java\."],
    "go":         [r"func \w+\(", r"package \w+", r"fmt\.", r"import \("],
    "rust":       [r"fn \w+\(", r"let mut", r"impl \w+", r"use \w+::", r"pub fn"],
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

def add_line_numbers(code: str) -> str:
    lines = code.splitlines()
    width = len(str(len(lines)))
    return "\n".join(f"{str(i+1).rjust(width)} | {line}" for i, line in enumerate(lines))

def build_analysis_prompt(code: str, language: str, filename: Optional[str] = None) -> str:
    file_context = f" (filename: {filename})" if filename else ""
    numbered = add_line_numbers(code)
    total_lines = len(code.splitlines())
    return f"""Analyze the following {language} code{file_context} for bugs, security vulnerabilities, performance issues, and code quality problems.

The code has {total_lines} lines total. Each line is prefixed with its exact line number. You MUST only reference line numbers that actually exist (1 to {total_lines}).

```{language}
{numbered}
```

Return your analysis as the specified JSON structure. Be thorough and precise. Line numbers in your response must exactly match the numbered lines above."""

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
@limiter.limit("10/minute;50/hour")
async def analyze_code(request: Request, body: AnalyzeRequest, user: dict = Depends(get_current_user)):
    """Analyze code for bugs, security issues, and performance problems."""
    ip = request.client.host if request.client else "unknown"

    if not body.code.strip():
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    if len(body.code) > 50000:
        logger.warning(f'"event":"oversized_request","ip":"{ip}","size":{len(body.code)}')
        raise HTTPException(status_code=400, detail="Code exceeds maximum length (50,000 characters)")

    language = body.language
    if language == "auto":
        language = detect_language(body.code, body.filename)

    lines = len(body.code.splitlines())
    logger.info(f'"event":"analyze_start","ip":"{ip}","language":"{language}","lines":{lines}')

    prompt = build_analysis_prompt(body.code, language, body.filename)

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

        logger.info(
            f'"event":"analyze_complete","ip":"{ip}","language":"{language}",'
            f'"health_score":{analysis.get("health_score")},"issues":{analysis.get("total_issues")}'
        )
        return analysis

    except json.JSONDecodeError as e:
        logger.error(f'"event":"parse_error","ip":"{ip}","error":"{str(e)}"')
        raise HTTPException(status_code=500, detail=f"Failed to parse analysis response: {str(e)}")
    except Exception as e:
        logger.error(f'"event":"analyze_error","ip":"{ip}","error":"{str(e)}"')
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.post("/fix")
@limiter.limit("5/minute;20/hour")
async def fix_code(request: Request, body: FixRequest, user: dict = Depends(get_current_user)):
    """Generate fixed code that resolves all identified issues."""
    ip = request.client.host if request.client else "unknown"

    if not body.code.strip():
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    if not body.issues:
        raise HTTPException(status_code=400, detail="No issues provided to fix")

    logger.info(f'"event":"fix_start","ip":"{ip}","language":"{body.language}","issue_count":{len(body.issues)}')

    prompt = build_fix_prompt(body.code, body.language, body.issues)

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

        logger.info(f'"event":"fix_complete","ip":"{ip}","issues_resolved":{len(body.issues)}')
        return {"fixed_code": fixed, "language": body.language, "issues_resolved": len(body.issues)}

    except Exception as e:
        logger.error(f'"event":"fix_error","ip":"{ip}","error":"{str(e)}"')
        raise HTTPException(status_code=500, detail=f"Fix failed: {str(e)}")

@app.post("/github/fetch")
@limiter.limit("20/minute")
async def fetch_from_github(request: Request, body: GitHubRequest, user: dict = Depends(get_current_user)):
    """Fetch files from a public GitHub repository."""
    return await fetch_github_file(body.repo_url, body.file_path)

@app.post("/github/analyze")
@limiter.limit("10/minute;30/hour")
async def analyze_github_file(request: Request, body: GitHubRequest, user: dict = Depends(get_current_user)):
    """Fetch and analyze a file from GitHub."""
    ip = request.client.host if request.client else "unknown"

    if not body.file_path:
        raise HTTPException(status_code=400, detail="file_path is required for analysis")

    result = await fetch_github_file(body.repo_url, body.file_path)
    if result["type"] != "file_content":
        raise HTTPException(status_code=400, detail="Expected file content")

    logger.info(f'"event":"github_analyze","ip":"{ip}","repo":"{body.repo_url}","file":"{body.file_path}"')

    analyze_req = AnalyzeRequest(
        code=result["content"],
        language="auto",
        filename=result["path"],
    )
    # Pass a mock request object for the rate-limited inner call
    analysis = await analyze_code(request, analyze_req)
    analysis["source"] = {"repo": body.repo_url, "file": result["path"]}
    return analysis


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
