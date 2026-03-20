"""
CodeLens — Predictive Code Review Assistant
Backend API powered by FastAPI + Groq (Cerebras fallback)
© AXON LATTICE LABS™
"""

import os
import json
import re
import time
import logging
import uuid
import smtplib
import httpx
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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
from openai import OpenAI
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

# ─── LLM Clients (Groq → Cerebras → OpenRouter fallback chain) ────────

_groq_client: Optional[Groq] = None
_cerebras_client: Optional[OpenAI] = None
_openrouter_client: Optional[OpenAI] = None

_CEREBRAS_MODEL_MAP = {
    "llama-3.3-70b-versatile": "llama-3.3-70b",
    "llama-3.1-8b-instant":    "llama-3.1-8b",
}
_OPENROUTER_MODEL_MAP = {
    "llama-3.3-70b-versatile": "meta-llama/llama-3.3-70b-instruct:free",
    "llama-3.1-8b-instant":    "meta-llama/llama-3.3-70b-instruct:free",  # 8B not available free; use 70B
}

def get_client() -> Groq:
    global _groq_client
    if _groq_client is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="GROQ_API_KEY is not configured")
        _groq_client = Groq(api_key=api_key)
    return _groq_client

def _get_cerebras_client() -> Optional[OpenAI]:
    global _cerebras_client
    if _cerebras_client is None:
        api_key = os.environ.get("CEREBRAS_API_KEY")
        if not api_key:
            return None
        _cerebras_client = OpenAI(
            api_key=api_key,
            base_url="https://api.cerebras.ai/v1",
        )
    return _cerebras_client

def _get_openrouter_client() -> Optional[OpenAI]:
    global _openrouter_client
    if _openrouter_client is None:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            return None
        _openrouter_client = OpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
        )
    return _openrouter_client

def _is_rate_limit(err: str) -> bool:
    return "429" in err or "rate_limit_exceeded" in err.lower()

# ─── Token Usage Tracking ──────────────────────────────────────────────
# Tracks tokens consumed per provider since last server restart.
# Resets automatically every 24 h (matches Groq's daily window).

_DAILY_LIMITS = {
    "groq":       100_000,
    "cerebras": 1_000_000,
    "openrouter":    None,   # upstream-dependent; no hard limit to track
}

_usage_counters: dict = {
    "groq":       {"tokens": 0, "reset_at": None},
    "cerebras":   {"tokens": 0, "reset_at": None},
    "openrouter": {"tokens": 0, "reset_at": None},
}

def _record_usage(provider: str, response) -> None:
    """Accumulate token counts from an API response object."""
    try:
        usage = getattr(response, "usage", None)
        if usage is None:
            return
        tokens = getattr(usage, "total_tokens", 0) or 0
        entry = _usage_counters[provider]
        now = datetime.utcnow()
        # Reset counter if 24 h have passed
        if entry["reset_at"] is None or now >= entry["reset_at"]:
            entry["tokens"] = 0
            entry["reset_at"] = now + timedelta(hours=24)
        entry["tokens"] += tokens
    except Exception:
        pass

def call_llm(model: str, messages: list, max_tokens: int = 8000, temperature: float = 0) -> str:
    """Call Cerebras (2000 TPS) → Groq → OpenRouter, falling back on any error."""
    # ── 1. Cerebras — fastest (2000 TPS, 1M tokens/day) ───────────────
    cb_client = _get_cerebras_client()
    if cb_client is not None:
        try:
            cb_model = _CEREBRAS_MODEL_MAP.get(model, "llama-3.3-70b")
            response = cb_client.chat.completions.create(
                model=cb_model, messages=messages,
                max_tokens=max_tokens, temperature=temperature,
            )
            _record_usage("cerebras", response)
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f'"event":"cerebras_error","error":"{str(e)[:120]}","action":"trying_groq"')

    # ── 2. Groq ────────────────────────────────────────────────────────
    try:
        response = get_client().chat.completions.create(
            model=model, messages=messages,
            max_tokens=max_tokens, temperature=temperature,
        )
        _record_usage("groq", response)
        return response.choices[0].message.content.strip()
    except Exception as e:
        if not _is_rate_limit(str(e)):
            raise
        logger.warning('"event":"groq_rate_limit","action":"trying_openrouter"')

    # ── 3. OpenRouter ──────────────────────────────────────────────────
    or_client = _get_openrouter_client()
    if or_client is not None:
        fb_model = _OPENROUTER_MODEL_MAP.get(model, "meta-llama/llama-3.3-70b-instruct:free")
        logger.info(f'"event":"openrouter_fallback","model":"{fb_model}"')
        response = or_client.chat.completions.create(
            model=fb_model, messages=messages,
            max_tokens=max_tokens, temperature=temperature,
        )
        _record_usage("openrouter", response)
        return response.choices[0].message.content.strip()

    raise HTTPException(
        status_code=429,
        detail="All AI providers have reached their rate limits. Please wait a few minutes and try again."
    )

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

class ContactRequest(BaseModel):
    name: str
    email: str
    message: str

# ─── Language Detection ───────────────────────────────────────────────

LANGUAGE_HINTS = {
    "python":     [r"def \w+\(", r"class \w+:", r"self\.", r"elif ", r"__init__", r"import \w+ as "],
    "kotlin":     [r"fun \w+\(", r"val \w+\s*=", r"var \w+\s*:", r"data class \w+", r"\?\.", r"object \w+"],
    "javascript": [r"const \w+\s*=", r"let \w+\s*=", r"function \w+\s*\(", r"=>\s*\{", r"console\.log"],
    "typescript": [r"interface \w+\s*\{", r":\s*string", r":\s*number", r":\s*boolean", r"as \w+", r"<\w+>"],
    "java":       [r"public class \w+", r"public static void main", r"System\.out\.", r"@Override", r"throws \w+"],
    "go":         [r"func \w+\(.*\)", r"^package \w+", r"fmt\.\w+\(", r":=", r"goroutine"],
    "rust":       [r"fn \w+\(", r"let mut \w+", r"impl \w+", r"use \w+::", r"pub fn \w+", r"match \w+"],
    "swift":      [r"func \w+\(.*\) ->", r"var \w+:\s*\w+", r"let \w+:\s*\w+", r"guard let", r"if let"],
    "csharp":     [r"namespace \w+", r"using System", r"static void Main", r"Console\.\w+\(", r"public \w+ \w+\("],
    "ruby":       [r"def \w+", r"end$", r"puts ", r"require ", r"attr_\w+"],
    "php":        [r"<\?php", r"\$\w+\s*=", r"echo ", r"function \w+\s*\(", r"->", r"namespace \w+"],
    "cpp":        [r"#include\s*<", r"std::", r"int main\s*\(", r"cout\s*<<", r"nullptr", r"::\w+"],
    "c":          [r"#include\s*<", r"int main\s*\(", r"printf\s*\(", r"malloc\s*\(", r"->"],
    "scala":      [r"object \w+", r"def \w+.*=", r"val \w+.*=", r"case class", r"extends \w+"],
    "bash":       [r"#!/bin/(bash|sh)", r"\$\w+", r"echo ", r"if \[", r"fi$", r"then$"],
    "sql":        [r"SELECT .* FROM", r"INSERT INTO", r"CREATE TABLE", r"WHERE \w+", r"JOIN \w+"],
    "r":          [r"<-\s*\w+", r"library\(", r"data\.frame\(", r"ggplot\(", r"function\s*\("],
}

def detect_language(code: str, filename: Optional[str] = None) -> str:
    if filename:
        ext_map = {
            ".py": "python", ".js": "javascript", ".ts": "typescript",
            ".jsx": "javascript", ".tsx": "typescript", ".java": "java",
            ".go": "go", ".rs": "rust", ".rb": "ruby", ".php": "php",
            ".cs": "csharp", ".cpp": "cpp", ".cc": "cpp", ".c": "c",
            ".swift": "swift", ".kt": "kotlin", ".kts": "kotlin",
            ".scala": "scala", ".sh": "bash", ".bash": "bash",
            ".sql": "sql", ".r": "r", ".R": "r",
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

ANALYSIS_SYSTEM_PROMPT = """You are CodeLens, an elite AI code auditor. Your job is to perform an EXHAUSTIVE, line-by-line inspection of the submitted code. You must check EVERY SINGLE LINE and report EVERY issue found — do not skip anything, do not summarise groups of issues into one.

You must inspect ALL of the following categories on every line:

1. SYNTAX & PARSING — syntax errors, indentation errors, mismatched brackets/quotes, unreachable statements
2. TYPE SAFETY — type mismatches, implicit unsafe coercions, untyped variables where types matter, nullable dereferences
3. SECURITY (check ALL OWASP Top 10 and beyond):
   - Injection: SQL injection, command injection, LDAP injection, XPath injection
   - Hardcoded secrets: passwords, API keys, tokens, private keys in source code
   - Unsafe deserialization: pickle, eval, exec, yaml.load without Loader, JSON.parse of untrusted input
   - Path traversal / directory traversal
   - XSS: unsanitised output to HTML/JS
   - CSRF: missing tokens on state-changing endpoints
   - Insecure cryptography: MD5/SHA1 for passwords, ECB mode, hardcoded IV/salt, weak key sizes
   - SSRF: unvalidated URLs passed to HTTP clients
   - XXE: XML parsing with external entities enabled
   - Authentication / authorisation bypasses
   - Information exposure in error messages, logs, or responses
   - Open redirects
4. RESOURCE MANAGEMENT — unclosed files, DB connections, sockets, streams; missing context managers; GC pressure; file descriptor leaks
5. ERROR HANDLING — bare except clauses, swallowed exceptions, missing error propagation, no logging of errors, assertions used for flow control
6. INPUT VALIDATION — missing validation of user/external input, no bounds checking, trusting external data without sanitisation
7. CONCURRENCY & THREAD SAFETY — race conditions, shared mutable global state, non-atomic read-modify-write, deadlock potential, missing locks
8. PERFORMANCE — O(n²) or worse algorithms where O(n log n) or better is possible, repeated recomputation inside loops, unnecessary object copies, inefficient data structure choices, N+1 query patterns, missing caching
9. MEMORY — unbounded data structure growth, memory leaks, large allocations inside loops, holding references longer than needed
10. CODE QUALITY & MAINTAINABILITY — magic numbers/strings, deeply nested logic (>3 levels), functions >30 lines doing too much, duplicate logic (DRY violations), dead/unreachable code, commented-out code left in
11. BEST PRACTICES — missing null/None checks before dereferencing, division without zero guard, array/list access without bounds check, use of deprecated APIs, missing logging for critical operations, naming convention violations

SCORING RULES — leave the health_score field as 0; the server will compute it from your issues list.

OUTPUT FORMAT — return ONLY this exact JSON, nothing else:
{
  "summary": "2-3 sentence technical summary of the overall code quality and the most critical findings",
  "health_score": 0,
  "language": "<detected language>",
  "total_issues": <integer — must equal the length of the issues array>,
  "issues": [
    {
      "id": <integer starting from 1>,
      "severity": "critical" | "warning" | "info",
      "category": "bug" | "security" | "performance" | "code_smell" | "best_practice",
      "title": "Short precise title (max 8 words)",
      "description": "Exact problem and why it is harmful (max 20 words)",
      "line_start": <integer — the exact line number from the numbered code>,
      "line_end": <integer — same as line_start if single line>,
      "suggestion": "Concrete fix in one line of code or one sentence (max 20 words)",
      "predicted_impact": "Consequence if unfixed (max 10 words)"
    }
  ],
  "metrics": {
    "bugs": <count of issues with category 'bug'>,
    "security": <count of issues with category 'security'>,
    "performance": <count of issues with category 'performance'>,
    "code_smells": <count of issues with category 'code_smell'>,
    "best_practices": <count of issues with category 'best_practice'>
  },
  "positive_notes": ["Specific positive observation about the code — only include if genuinely warranted"]
}

STRICT RULES:
- Every issue must reference the exact line number from the numbered input.
- total_issues MUST equal the actual count of objects in the issues array.
- Do NOT group multiple distinct problems into one issue — report each separately.
- Do NOT invent issues that are not present.
- Do NOT skip any line — inspect the entire file.
- Return ONLY valid JSON. No markdown, no code fences, no text outside the JSON object."""

FIX_SYSTEM_PROMPT = """You are an expert software security engineer and code optimizer. Your sole job is to return a COMPLETE, FULLY FIXED version of the code you receive.

ABSOLUTE RULES — violating any of these is a failure:
1. OUTPUT COMPLETENESS: Output the entire file from the first line to the last. Never use "..." or "[rest of code unchanged]" or any placeholder. Every single line must appear in your output.
2. FIX EVERY ISSUE: Every issue in the provided list must be fixed. Do not skip, defer, or partially fix anything.
3. ALSO SELF-REVIEW: After applying all listed fixes, scan your own output for any remaining issues not in the list and fix those too.
4. PRESERVE FUNCTIONALITY: Do not remove business logic, change function signatures arbitrarily, or alter correct behaviour.
5. ANNOTATION: On each line you change, add an inline comment — # FIX: <brief reason> (Python/Ruby) or // FIX: <brief reason> (JS/TS/Java/Go/C/C++/Kotlin) — immediately after the changed code.
6. COMPILABLE OUTPUT: The fixed code MUST compile and run without errors. Never introduce new compilation or runtime errors. Language-specific rules you MUST follow:
   • Python   — use correct indentation; f-strings over % formatting; close resources with 'with'
   • Kotlin   — val is immutable: use .copy() to modify data class fields, not direct assignment; never synchronize on Int/Long — use AtomicInteger or a ReentrantLock
   • Java     — always close resources in try-with-resources; use PreparedStatement for all SQL
   • JavaScript/TypeScript — use strict equality (===); handle Promise rejections; no var
   • Go       — check all error return values; close resources with defer
   • Rust     — handle Result/Option explicitly; no unwrap() on untrusted data
   • C/C++    — free every malloc; check array bounds; no gets(), use fgets()
   • Swift    — use guard let / if let for optionals; avoid force unwrap (!)
   • C#       — use using statements for IDisposable; async methods must return Task
   • PHP      — use PDO with prepared statements; never trust $_GET/$_POST directly
   • Ruby     — use strong parameters; sanitise user input before DB queries
   • SQL      — use parameterised queries; never concatenate user input into SQL strings

WHAT GOOD FIXES LOOK LIKE:
- SQL injection  → parameterised query:  cursor.execute("SELECT * FROM users WHERE id=?", (uid,))  # FIX: parameterised query prevents SQL injection
- Hardcoded cred → env var:             api_key = os.environ.get("API_KEY")  # FIX: removed hardcoded secret
- Unclosed file  → context manager:     with open(path) as f:  # FIX: context manager ensures file is closed
- O(n²) loop     → set lookup:          seen = set(items)  # FIX: O(1) lookup replaces O(n) list scan
- eval()         → safe alternative:    data = json.loads(text)  # FIX: replaced unsafe eval() with json.loads
- Division       → zero guard:          return total / count if count else 0  # FIX: guard against ZeroDivisionError

Return RAW CODE ONLY. No markdown fences, no triple backticks, no explanation, no preamble, no postscript."""

def add_line_numbers(code: str) -> str:
    lines = code.splitlines()
    width = len(str(len(lines)))
    return "\n".join(f"{str(i+1).rjust(width)} | {line}" for i, line in enumerate(lines))

def compute_health_score(issues: list) -> int:
    """
    Deterministic server-side health score using diminishing-returns formula.
    No matter how many issues exist, the score never bottoms out to 0 from
    issue count alone — it converges toward a floor gracefully.

    Calibration:
      0 issues            → 100
      1 critical          → ~69
      2 criticals         → ~53
      4 criticals         → ~36
      4 crit + 4 warn + 1 → ~28  (matches MOCK_ANALYSIS baseline)
      10+ criticals       → ~15–20
    """
    if not issues:
        return 100
    critical = sum(1 for i in issues if i.get("severity") == "critical")
    warning  = sum(1 for i in issues if i.get("severity") == "warning")
    info     = sum(1 for i in issues if i.get("severity") == "info")
    weight   = critical * 10 + warning * 4 + info * 1
    score    = round(100 / (1 + weight * 0.045))
    return max(0, min(100, score))

def build_analysis_prompt(code: str, language: str, filename: Optional[str] = None) -> str:
    file_context = f" (filename: {filename})" if filename else ""
    numbered = add_line_numbers(code)
    total_lines = len(code.splitlines())
    return f"""Perform an EXHAUSTIVE line-by-line audit of the following {language} code{file_context}.

IMPORTANT:
- The code has {total_lines} lines. Inspect EVERY line from line 1 to line {total_lines}.
- Only reference line numbers that exist (1 to {total_lines}).
- Report EVERY issue — do not skip or group problems.
- Check all 11 categories listed in your system instructions on every line.

CODE (each line is prefixed with its line number):
```
{numbered}
```

Return ONLY the JSON analysis object. No markdown, no explanation outside the JSON."""

def build_fix_prompt(code: str, language: str, issues: List[Any]) -> str:
    numbered = add_line_numbers(code)
    total_lines = len(code.splitlines())

    # Build a rich, detailed issue list — not just title+suggestion
    issue_blocks = []
    for i in issues:
        line_ref = str(i.get("line_start", "?"))
        if i.get("line_end") and i.get("line_end") != i.get("line_start"):
            line_ref += f"–{i['line_end']}"
        block = (
            f"── ISSUE {i.get('id', '?')} [{i.get('severity','').upper()}] "
            f"[{i.get('category','').upper()}] Line {line_ref} ──\n"
            f"  Title       : {i.get('title','')}\n"
            f"  Problem     : {i.get('description','')}\n"
            f"  Required fix: {i.get('suggestion','')}\n"
            f"  Risk        : {i.get('predicted_impact','')}"
        )
        issue_blocks.append(block)

    issues_detail = "\n\n".join(issue_blocks)

    return f"""You must produce a FULLY FIXED version of the following {language} code ({total_lines} lines).
There are {len(issues)} issues. Every single one MUST be fixed in your output.

═══════════════════════════ ISSUES TO FIX ═══════════════════════════

{issues_detail}

═══════════════════════════ ORIGINAL CODE ═══════════════════════════

{numbered}

═══════════════════════════ INSTRUCTIONS ════════════════════════════

STEP 1 — Fix each of the {len(issues)} issues listed above, in order:
  • Apply the required fix exactly as described.
  • On every changed line, add an inline comment: # FIX: <one-line explanation>
  • Do NOT skip any issue — fix every single one.

STEP 2 — After fixing all listed issues, read the entire output top-to-bottom:
  • If you spot any additional bugs, vulnerabilities, or problems NOT in the list above, fix those too.
  • If any fix from Step 1 introduced a new issue, correct it.

STEP 3 — Output the complete fixed file:
  • Include EVERY line of the file — do not truncate, do not summarise, do not use "..." placeholders.
  • Preserve all original business logic and functionality.
  • The output must be valid, runnable {language} code.

RETURN RAW {language.upper()} CODE ONLY. No markdown fences, no explanation, no preamble."""

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

@app.get("/usage")
async def get_usage():
    """Return token usage per provider with % of daily limit consumed."""
    result = {}
    for provider, entry in _usage_counters.items():
        limit = _DAILY_LIMITS[provider]
        used  = entry["tokens"]
        pct   = round(used / limit * 100, 1) if limit else None
        resets_in = None
        if entry["reset_at"]:
            secs = max(0, (entry["reset_at"] - datetime.utcnow()).total_seconds())
            resets_in = f"{int(secs // 3600)}h {int((secs % 3600) // 60)}m"
        result[provider] = {
            "used":       used,
            "limit":      limit,
            "pct_used":   pct,
            "resets_in":  resets_in,
            "warning":    pct is not None and pct >= 80,
        }
    return result

@app.post("/contact")
@limiter.limit("5/hour")
async def contact(request: Request, body: ContactRequest):
    """Send a contact form message to axonlattice@gmail.com via Gmail SMTP."""
    if not body.name.strip() or not body.email.strip() or not body.message.strip():
        raise HTTPException(status_code=400, detail="All fields are required.")

    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD")
    if not gmail_pass:
        raise HTTPException(status_code=503, detail="Email service not configured.")

    GMAIL_USER = "axonlattice@gmail.com"

    msg = MIMEMultipart("alternative")
    msg["From"]    = GMAIL_USER
    msg["To"]      = GMAIL_USER
    msg["Subject"] = f"CodeLens Contact: {body.name}"
    msg["Reply-To"] = body.email

    text = (
        f"Name:    {body.name}\n"
        f"Email:   {body.email}\n\n"
        f"Message:\n{body.message}"
    )
    msg.attach(MIMEText(text, "plain"))

    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.starttls()
            server.login(GMAIL_USER, gmail_pass)
            server.send_message(msg)
        logger.info(f'"event":"contact_sent","from":"{body.email}"')
        return {"success": True}
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=503, detail="Email authentication failed. Check GMAIL_APP_PASSWORD.")
    except Exception as e:
        logger.error(f'"event":"contact_error","error":"{str(e)}"')
        raise HTTPException(status_code=500, detail="Failed to send message. Please email us directly.")

@app.get("/providers")
async def check_providers():
    """Test each LLM provider with a minimal prompt and report status."""
    TEST_MESSAGES = [{"role": "user", "content": "Reply with the single word: ok"}]
    results = {}

    # Groq
    try:
        get_client().chat.completions.create(
            model="llama-3.1-8b-instant", messages=TEST_MESSAGES,
            max_tokens=5, temperature=0,
        )
        results["groq"] = "ok"
    except Exception as e:
        results["groq"] = str(e)[:200]

    # Cerebras
    cb = _get_cerebras_client()
    if cb is None:
        results["cerebras"] = "not configured (CEREBRAS_API_KEY missing)"
    else:
        try:
            cb.chat.completions.create(
                model="llama-3.1-8b", messages=TEST_MESSAGES,
                max_tokens=5, temperature=0,
            )
            results["cerebras"] = "ok"
        except Exception as e:
            results["cerebras"] = str(e)[:200]

    # OpenRouter
    or_c = _get_openrouter_client()
    if or_c is None:
        results["openrouter"] = "not configured (OPENROUTER_API_KEY missing)"
    else:
        try:
            or_c.chat.completions.create(
                model="meta-llama/llama-3.3-70b-instruct:free", messages=TEST_MESSAGES,
                max_tokens=5, temperature=0,
            )
            results["openrouter"] = "ok"
        except Exception as e:
            results["openrouter"] = str(e)[:200]

    return results

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
        raw_text = call_llm(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=8000,
            temperature=0,
        )
        # Strip markdown fences if LLM wraps JSON in ```json ... ```
        raw_text = re.sub(r"^```[^\n]*\n", "", raw_text)
        raw_text = re.sub(r"\n```\s*$", "", raw_text)
        raw_text = re.sub(r"^```\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)
        raw_text = raw_text.strip()

        analysis = json.loads(raw_text)
        # Prefer LLM's language detection; fall back to our regex result
        analysis["language"] = analysis.get("language") or language

        # ── Server-side overrides for consistency ──────────────
        issues = analysis.get("issues", [])

        # Recalculate total_issues from actual array length
        analysis["total_issues"] = len(issues)

        # Recalculate metrics from actual issue categories
        analysis["metrics"] = {
            "bugs":           sum(1 for i in issues if i.get("category") == "bug"),
            "security":       sum(1 for i in issues if i.get("category") == "security"),
            "performance":    sum(1 for i in issues if i.get("category") == "performance"),
            "code_smells":    sum(1 for i in issues if i.get("category") == "code_smell"),
            "best_practices": sum(1 for i in issues if i.get("category") == "best_practice"),
        }

        # Override health score with deterministic server-side calculation
        analysis["health_score"] = compute_health_score(issues)

        logger.info(
            f'"event":"analyze_complete","ip":"{ip}","language":"{language}",'
            f'"health_score":{analysis.get("health_score")},"issues":{analysis.get("total_issues")}'
        )
        return analysis

    except json.JSONDecodeError as e:
        logger.error(f'"event":"parse_error","ip":"{ip}","error":"{str(e)}"')
        raise HTTPException(status_code=500, detail=f"Failed to parse analysis response: {str(e)}")
    except Exception as e:
        err = str(e)
        logger.error(f'"event":"analyze_error","ip":"{ip}","error":"{err}"')
        if "429" in err or "rate_limit_exceeded" in err:
            raise HTTPException(
                status_code=429,
                detail="All AI providers have reached their rate limits. Please wait a few minutes and try again."
            )
        raise HTTPException(status_code=500, detail=f"Analysis failed: {err}")

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

    def _strip_fences(text: str) -> str:
        """Remove markdown code fences in all their variants."""
        text = re.sub(r"^```[^\n]*\n", "", text)
        text = re.sub(r"\n```\s*$", "", text)
        text = re.sub(r"^```\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        return text.strip()

    FIX_MODEL     = "llama-3.1-8b-instant"
    ANALYZE_MODEL = "llama-3.3-70b-versatile"

    def _llm_fix(source: str, issue_list: List[Any]) -> str:
        """Single LLM fix pass."""
        p = build_fix_prompt(source, body.language, issue_list)
        raw = call_llm(
            model=FIX_MODEL,
            messages=[
                {"role": "system", "content": FIX_SYSTEM_PROMPT},
                {"role": "user",   "content": p},
            ],
            max_tokens=8000,
            temperature=0,
        )
        return _strip_fences(raw)

    def _llm_analyze(source: str) -> List[Any]:
        """Re-analysis after pass 1 — only used if critical/warning issues survive."""
        p = build_analysis_prompt(source, body.language)
        raw = call_llm(
            model=ANALYZE_MODEL,
            messages=[
                {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                {"role": "user",   "content": p},
            ],
            max_tokens=8000,
            temperature=0,
        )
        raw = _strip_fences(raw)
        try:
            return json.loads(raw).get("issues", [])
        except Exception:
            return []

    try:
        # ── Pass 1: fix all reported issues ───────────────────────────
        fixed = _llm_fix(body.code, body.issues)
        logger.info(f'"event":"fix_pass1_complete","ip":"{ip}"')

        # ── Pass 2 (only if critical/warning issues survive) ──────────
        # Info-only leftovers don't warrant another expensive LLM call.
        remaining = _llm_analyze(fixed)
        serious   = [i for i in remaining if i.get("severity") in ("critical", "warning")]
        if serious:
            logger.info(f'"event":"fix_pass2_start","ip":"{ip}","remaining_serious":{len(serious)}')
            fixed = _llm_fix(fixed, serious)
            logger.info(f'"event":"fix_pass2_complete","ip":"{ip}"')

        logger.info(f'"event":"fix_complete","ip":"{ip}","issues_resolved":{len(body.issues)}')
        return {"fixed_code": fixed, "language": body.language, "issues_resolved": len(body.issues)}

    except Exception as e:
        err = str(e)
        logger.error(f'"event":"fix_error","ip":"{ip}","error":"{err}"')
        if "429" in err or "rate_limit_exceeded" in err:
            raise HTTPException(
                status_code=429,
                detail="All AI providers have reached their rate limits. Please wait a few minutes and try again."
            )
        raise HTTPException(status_code=500, detail=f"Fix failed: {err}")

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
