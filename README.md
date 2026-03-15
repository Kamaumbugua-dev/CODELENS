# ⟨/⟩ CodeLens™ — Predictive Code Review Assistant

**AI-powered code analysis that detects security vulnerabilities, bugs, and performance bottlenecks — then rewrites your code to fix them.**

> A product of **AXON LATTICE LABS™** · Head: Steven K.

![FastAPI](https://img.shields.io/badge/Backend-FastAPI-green)
![React](https://img.shields.io/badge/Frontend-React_19-cyan)
![Groq](https://img.shields.io/badge/AI-Groq_LLM-orange)
![Vercel](https://img.shields.io/badge/Frontend-Vercel-black)
![Render](https://img.shields.io/badge/Backend-Render-blue)

---

## What It Does

CodeLens is a predictive code review tool. Paste any code, and CodeLens uses a Groq-powered LLM to perform multi-dimensional analysis across 5 categories:

- **Bug Detection** — Logic errors, resource leaks, unclosed handles, division by zero
- **Security Analysis** — SQL injection, hardcoded credentials, unsafe `eval()`, plaintext secrets
- **Performance** — O(n²) algorithms, memory leaks, unbounded caches
- **Code Smell Detection** — Anti-patterns and maintainability risks
- **Best Practices** — Industry-standard improvements with concrete suggestions

Every issue includes severity scoring, **accurate line-level annotations** (line numbers are injected into the prompt so the LLM cannot hallucinate them), a concrete fix suggestion, and a predicted production impact statement.

After analysis, click **✦ Rework Code with AI Fixes** to have the LLM rewrite the entire file with all issues resolved and inline `# FIX:` comments explaining each change.

---

## Architecture

```
┌──────────────────────────────────────┐
│   React 19 Frontend (Vercel)         │
│   - 3-panel layout                   │
│     · Code editor with line numbers  │
│     · Analysis dashboard             │
│     · Vulnerability scroll slides    │
│   - Health score gauge (SVG)         │
│   - Rework Code button → /fix        │
│   - AXON LATTICE LABS™ branding      │
└──────────────┬───────────────────────┘
               │ REST API (CORS open)
┌──────────────▼───────────────────────┐
│   FastAPI Backend (Render)           │
│   - POST /analyze                    │
│   - POST /fix                        │
│   - POST /github/fetch               │
│   - POST /github/analyze             │
│   - GET  /health                     │
│   - Line-numbered prompt injection   │
│   - Language auto-detection          │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│   Groq API — llama-3.3-70b           │
│   - Structured JSON analysis         │
│   - Full code rewrite with fixes     │
└──────────────────────────────────────┘
```

---

## Live Demo

| Service  | URL |
|----------|-----|
| Frontend | https://codelens-ten.vercel.app |
| Backend  | https://codelens-8i03.onrender.com |
| Health   | https://codelens-8i03.onrender.com/health |

> **Note:** Render's free tier sleeps after 15 min of inactivity. The first request after sleep takes ~30 seconds to wake up.

---

## Quick Start (Local)

### Backend

```bash
pip install -r requirements.txt
cp .env.example .env
# Add your GROQ_API_KEY to .env
python main.py
# API runs at http://localhost:8000
```

### Frontend

```bash
cd codelens
npm install
# Create codelens/.env.local with:
# VITE_API_BASE=http://localhost:8000
npm run dev
```

---

## API Reference

### `POST /analyze`

Analyze code for bugs, security issues, and performance problems.

```bash
curl -X POST https://codelens-8i03.onrender.com/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "def hello(): eval(input())", "language": "python"}'
```

**Request**
```json
{ "code": "string", "language": "auto | python | javascript | ...", "filename": "optional" }
```

**Response**
```json
{
  "summary": "...",
  "health_score": 28,
  "language": "python",
  "total_issues": 9,
  "issues": [
    {
      "id": 1,
      "severity": "critical",
      "category": "security",
      "title": "SQL Injection Vulnerability",
      "description": "...",
      "line_start": 7,
      "line_end": 7,
      "suggestion": "Use parameterized queries...",
      "predicted_impact": "..."
    }
  ],
  "metrics": { "bugs": 2, "security": 4, "performance": 1, "code_smells": 1, "best_practices": 1 },
  "positive_notes": ["..."]
}
```

### `POST /fix`

Rewrite code with all identified issues resolved.

```bash
curl -X POST https://codelens-8i03.onrender.com/fix \
  -H "Content-Type: application/json" \
  -d '{"code": "...", "language": "python", "issues": [...]}'
```

**Response**
```json
{ "fixed_code": "...", "language": "python", "issues_resolved": 9 }
```

### `POST /github/fetch` · `POST /github/analyze`

Fetch or analyze files from a public GitHub repository.

```json
{ "repo_url": "https://github.com/owner/repo", "file_path": "src/main.py" }
```

---

## How Line Accuracy Works

A common LLM failure mode is hallucinating line numbers. CodeLens prevents this by injecting line numbers directly into the prompt before sending to Groq:

```
 1 | import sqlite3
 2 | import os
 3 |
 4 | def get_user(username):
 5 |     conn = sqlite3.connect("users.db")
...
```

The model is also told the total line count and constrained to only reference lines that exist. This eliminates fabricated line references.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, Space Grotesk + JetBrains Mono fonts |
| Backend | FastAPI, Groq SDK, httpx, pydantic |
| AI Model | Groq — `llama-3.3-70b-versatile` |
| Frontend Hosting | Vercel (auto-deploy from `master`) |
| Backend Hosting | Render (auto-deploy from `master`) |

## Supported Languages

Python, JavaScript, TypeScript, Java, Go, Rust, Ruby, PHP, C#, C++, C, Swift — with automatic detection via regex pattern matching and file extension hints.

## Roadmap

- [ ] VS Code extension with inline annotations
- [ ] GitHub Actions integration for CI/CD pipelines
- [ ] Multi-file repository analysis
- [ ] Custom rule engine
- [ ] Team dashboards with trend tracking

---

**AXON LATTICE LABS™ · CodeLens v2.0**

*See your code's future before it ships.*
