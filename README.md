# ⟨/⟩ CodeLens — Predictive Code Review Assistant

**AI-powered code analysis that predicts bugs, security vulnerabilities, and performance bottlenecks before they reach production.**

![Theme: AI & Machine Learning](https://img.shields.io/badge/Theme-AI%20%26%20Machine%20Learning-blue)
![Built with Claude](https://img.shields.io/badge/Built%20with-Claude%20API-purple)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-green)
![React](https://img.shields.io/badge/Frontend-React-cyan)

---

## 🎯 What It Does

CodeLens is a predictive code review tool that goes beyond linting. Paste your code or connect a GitHub repository, and CodeLens uses AI to perform multi-dimensional analysis:

- **🐛 Bug Detection** — Identifies logic errors, resource leaks, and edge cases
- **🔒 Security Analysis** — Catches SQL injection, hardcoded secrets, unsafe eval(), and more
- **⚡ Performance Prediction** — Flags O(n²) algorithms, memory leaks, and scaling bottlenecks
- **👃 Code Smell Detection** — Spots anti-patterns and maintainability risks
- **✨ Best Practices** — Recommends industry-standard improvements

Every issue includes severity scoring, line-level annotations, a concrete fix suggestion, and a predicted impact statement explaining what could go wrong in production.

## 🏗️ Architecture

```
┌─────────────────────────────────┐
│   React Frontend (Tailwind)     │
│   - Custom code editor          │
│   - Health score gauge          │
│   - Issue cards with filters    │
└────────────┬────────────────────┘
             │ REST API
┌────────────▼────────────────────┐
│   FastAPI Backend (Python)      │
│   - /analyze endpoint           │
│   - Language auto-detection     │
│   - Prompt engineering layer    │
│   - Structured JSON parsing     │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│   Claude API (Sonnet)           │
│   - Multi-pass code review      │
│   - Structured analysis output  │
└─────────────────────────────────┘
```

## 🚀 Quick Start

### Backend

```bash
cd codelens-backend
pip install -r requirements.txt
cp .env.example .env
# Add your Anthropic API key to .env
python main.py
```

The API will be running at `http://localhost:8000`.

### Frontend

The frontend is a React component (`codelens-app.jsx`). You can:

1. **Use it directly in Claude.ai** — it renders as an interactive artifact
2. **Integrate into a React project** — import the component into any React app
3. **Demo mode** — toggle "Demo mode" in the header to see the analysis without a backend

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/analyze` | Analyze code for issues |
| `POST` | `/github/fetch` | Fetch file tree from a GitHub repo |
| `POST` | `/github/analyze` | Fetch and analyze a GitHub file |
| `GET` | `/health` | Health check |

### Example API Call

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "def hello(): eval(input())", "language": "python"}'
```

## 🧠 How It Works

1. **Language Detection** — Automatically detects the programming language using file extension hints and regex pattern matching
2. **Prompt Engineering** — Constructs a structured prompt that instructs the AI to analyze code across 5 dimensions (bugs, security, performance, code smells, best practices)
3. **Structured Output** — The AI returns a JSON analysis with severity scores, line numbers, fix suggestions, and predicted production impact
4. **Health Scoring** — Computes an overall health score (0-100) based on issue count and severity
5. **Visual Presentation** — Issues are displayed with color-coded severity, expandable details, and line-level annotations in the editor

## 🎨 Tech Stack

- **Frontend**: React, Tailwind CSS, custom code editor, JetBrains Mono + Outfit fonts
- **Backend**: FastAPI, Anthropic SDK, httpx
- **AI**: Claude Sonnet via Anthropic API
- **Deployment**: Vercel (frontend) + Railway/Render (backend)

## 📐 Supported Languages

Python, JavaScript, TypeScript, Java, Go, Rust, Ruby, PHP, C#, C++, C, Swift — with automatic detection.

## 🗺️ Roadmap

- [ ] VS Code extension
- [ ] GitHub Actions integration (CI/CD pipeline)
- [ ] Multi-file repository analysis
- [ ] Custom rule engine
- [ ] Team dashboards with trend tracking
- [ ] IDE-native inline annotations

## 🏆 Built For

Hackathon submission — Theme: **Artificial Intelligence & Machine Learning**

Built by **AxonLattice Labs** — Intelligent Data Infrastructure

---

*CodeLens: See your code's future before it ships.*
