import { useState, useRef, useCallback } from "react";
import { useAuth, SignInButton, UserButton, SignedIn, SignedOut } from "@clerk/react";

// ─── Sample Code ──────────────────────────────────────────────────────
const SAMPLE_CODE = `import sqlite3
import os

def get_user(username):
    conn = sqlite3.connect("users.db")
    cursor = conn.cursor()
    query = f"SELECT * FROM users WHERE username = '{username}'"
    cursor.execute(query)
    result = cursor.fetchone()
    conn.close()
    return result

def process_payment(amount, card_number):
    print(f"Processing payment of \${amount} with card {card_number}")
    log_file = open("/var/log/payments.log", "a")
    log_file.write(f"Payment: {card_number} - \${amount}\\n")
    # Forgot to close the file handle

    if amount > 0:
        return True
    return False

def load_config():
    password = "admin123"
    api_key = "sk-1234567890abcdef"
    config = eval(open("config.txt").read())
    return config

class UserCache:
    _cache = {}

    def get(self, key):
        return self._cache.get(key)

    def set(self, key, value):
        self._cache[key] = value  # No size limit - memory leak potential

    def get_all_users(self):
        conn = sqlite3.connect("users.db")
        users = conn.cursor().execute("SELECT * FROM users").fetchall()
        return users  # Connection never closed

def calculate_risk_score(transactions):
    total = 0
    for t in transactions:
        for t2 in transactions:
            if t["id"] != t2["id"]:
                total += abs(t["amount"] - t2["amount"])
    return total / len(transactions)
`;

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

// ─── Config ───────────────────────────────────────────────────────────
const SEV = {
  critical: { color: "#FF3B5C", bg: "rgba(255,59,92,0.11)",  border: "rgba(255,59,92,0.3)",  label: "CRITICAL", glow: "0 0 24px rgba(255,59,92,0.35)" },
  warning:  { color: "#FFB224", bg: "rgba(255,178,36,0.11)", border: "rgba(255,178,36,0.3)", label: "WARNING",  glow: "0 0 24px rgba(255,178,36,0.35)" },
  info:     { color: "#38BDF8", bg: "rgba(56,189,248,0.11)", border: "rgba(56,189,248,0.3)", label: "INFO",     glow: "0 0 24px rgba(56,189,248,0.35)" },
};

const CAT = {
  bug:           { icon: "🐛", label: "Bug" },
  security:      { icon: "🔐", label: "Security" },
  performance:   { icon: "⚡", label: "Performance" },
  code_smell:    { icon: "💨", label: "Code Smell" },
  best_practice: { icon: "✅", label: "Best Practice" },
};

// ─── Mock Data ────────────────────────────────────────────────────────
const MOCK_ANALYSIS = {
  summary: "This code contains several critical security vulnerabilities, resource leaks, and performance issues that need immediate attention.",
  health_score: 28,
  language: "python",
  total_issues: 9,
  issues: [
    { id: 1, severity: "critical", category: "security",      title: "SQL Injection Vulnerability",        description: "Using f-string interpolation to build SQL queries allows attackers to inject malicious SQL. An attacker could pass a username like \"' OR '1'='1\" to dump the entire database.", line_start: 7,  line_end: 7,  suggestion: "Use parameterized queries: cursor.execute(\"SELECT * FROM users WHERE username = ?\", (username,))", predicted_impact: "Full database compromise, data exfiltration, unauthorized access to all user records" },
    { id: 2, severity: "critical", category: "security",      title: "Hardcoded Credentials",              description: "Password and API key are hardcoded directly in the source code. These will be exposed in version control.", line_start: 27, line_end: 28, suggestion: "Use environment variables: password = os.environ.get('DB_PASSWORD'); api_key = os.environ.get('API_KEY')", predicted_impact: "Credential leakage via source code repositories, unauthorized API access" },
    { id: 3, severity: "critical", category: "security",      title: "Unsafe eval() Usage",                description: "eval() executes arbitrary Python code from a file. If config.txt is modified by an attacker, they gain full code execution.", line_start: 29, line_end: 29, suggestion: "Use json.load() or configparser for configuration files instead of eval()", predicted_impact: "Remote code execution, complete system compromise" },
    { id: 4, severity: "critical", category: "security",      title: "Sensitive Data Logged in Plaintext", description: "Credit card numbers are printed to stdout and written to a log file in plaintext.", line_start: 15, line_end: 17, suggestion: "Mask card numbers (show only last 4 digits) and use structured, encrypted logging", predicted_impact: "PCI-DSS compliance violations, credit card data breach" },
    { id: 5, severity: "warning",  category: "bug",           title: "Resource Leak — File Handle",        description: "File opened with open() is never closed. This can lead to file descriptor exhaustion.", line_start: 16, line_end: 17, suggestion: "Use a context manager: with open('/var/log/payments.log', 'a') as log_file:", predicted_impact: "File descriptor exhaustion under load, data loss from unflushed writes" },
    { id: 6, severity: "warning",  category: "bug",           title: "Resource Leak — Database Connection",description: "In get_all_users(), the SQLite connection is never closed after fetching results.", line_start: 42, line_end: 43, suggestion: "Use a context manager or explicitly close: conn.close() after fetching", predicted_impact: "Database connection pool exhaustion, locked database files" },
    { id: 7, severity: "warning",  category: "performance",   title: "O(n²) Algorithm Complexity",         description: "calculate_risk_score uses nested loops over the same list, creating O(n²) complexity.", line_start: 46, line_end: 49, suggestion: "Precompute statistics or use vectorized operations with numpy to reduce to O(n)", predicted_impact: "Exponential slowdown as transaction volume grows — 10K transactions = 100M operations" },
    { id: 8, severity: "warning",  category: "code_smell",    title: "Unbounded Cache — Memory Leak",      description: "UserCache.set() adds entries without any size limit or eviction policy.", line_start: 38, line_end: 38, suggestion: "Use functools.lru_cache or implement max-size with LRU eviction", predicted_impact: "Gradual memory consumption growth leading to OOM crashes in production" },
    { id: 9, severity: "info",     category: "best_practice", title: "Division Without Zero Check",        description: "calculate_risk_score divides by len(transactions) without checking for empty list.", line_start: 50, line_end: 50, suggestion: "Add guard: if not transactions: return 0", predicted_impact: "ZeroDivisionError crash when called with empty transaction list" },
  ],
  metrics: { bugs: 2, security: 4, performance: 1, code_smells: 1, best_practices: 1 },
  positive_notes: ["Functions are well-named and have clear single responsibilities", "Code structure uses classes appropriately for caching logic"],
};

// ─── HealthGauge ──────────────────────────────────────────────────────
function HealthGauge({ score, animate }) {
  const r = 56;
  const circ = 2 * Math.PI * r * 0.75;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#22C55E" : score >= 60 ? "#84CC16" : score >= 40 ? "#FFB224" : "#FF3B5C";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
      <svg width="140" height="108" viewBox="0 0 140 108">
        <path d="M 14 96 A 56 56 0 1 1 126 96" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="9" strokeLinecap="round" />
        <path d="M 14 96 A 56 56 0 1 1 126 96" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={animate ? offset : circ}
          style={{ transition: "stroke-dashoffset 1.8s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 10px ${color}99)` }} />
        <text x="70" y="78" textAnchor="middle" fill={color} fontSize="34" fontWeight="900"
          fontFamily="'JetBrains Mono', monospace"
          style={{ opacity: animate ? 1 : 0, transition: "opacity 0.8s ease 0.5s" }}>{score}</text>
        <text x="70" y="93" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="8"
          fontFamily="'JetBrains Mono', monospace" letterSpacing="2.5">HEALTH</text>
      </svg>
    </div>
  );
}

// ─── VulnSlide ────────────────────────────────────────────────────────
function VulnSlide({ issue, index, total }) {
  const s = SEV[issue.severity] || SEV.info;
  const c = CAT[issue.category] || { icon: "📋", label: "Issue" };
  return (
    <div style={{
      height: "100%", padding: "22px 18px",
      display: "flex", flexDirection: "column", gap: 14,
      background: `linear-gradient(170deg, ${s.bg} 0%, rgba(5,8,16,0.97) 55%)`,
      borderLeft: `2px solid ${s.border}`,
      position: "relative", overflow: "hidden",
    }}>
      {/* Ghost number */}
      <div style={{
        position: "absolute", top: -15, right: -8,
        fontSize: 110, fontWeight: 900, color: "rgba(255,255,255,0.025)",
        fontFamily: "'JetBrains Mono', monospace", lineHeight: 1,
        userSelect: "none", pointerEvents: "none",
      }}>{String(index + 1).padStart(2, "0")}</div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{
            fontSize: 9, fontWeight: 800, color: s.color,
            background: s.bg, border: `1px solid ${s.border}`,
            padding: "3px 9px", borderRadius: 4,
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2,
            boxShadow: s.glow, display: "inline-block",
          }}>{s.label}</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace" }}>
            {c.icon} {c.label}
          </span>
        </div>
        <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{index + 1}/{total}</div>
          {issue.line_start && (
            <div style={{ fontSize: 10, color: s.color, marginTop: 4 }}>
              L{issue.line_start}{issue.line_end && issue.line_end !== issue.line_start ? `–${issue.line_end}` : ""}
            </div>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 style={{ fontSize: 14, fontWeight: 800, color: "#fff", lineHeight: 1.4, margin: 0 }}>{issue.title}</h3>

      {/* Description */}
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, margin: 0, flex: 1 }}>{issue.description}</p>

      {/* Fix */}
      <div style={{ background: "rgba(0,0,0,0.45)", borderRadius: 10, padding: "11px 13px", border: "1px solid rgba(34,197,94,0.18)" }}>
        <div style={{ fontSize: 8, color: "#22C55E", fontWeight: 800, marginBottom: 5, letterSpacing: 2, fontFamily: "'JetBrains Mono', monospace" }}>✓ SUGGESTED FIX</div>
        <code style={{ fontSize: 10, color: "rgba(255,255,255,0.75)", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6, display: "block", wordBreak: "break-word" }}>
          {issue.suggestion}
        </code>
      </div>

      {/* Impact */}
      <div style={{ background: "rgba(255,178,36,0.06)", borderRadius: 8, padding: "9px 11px", border: "1px solid rgba(255,178,36,0.14)" }}>
        <div style={{ fontSize: 8, color: "#FFB224", fontWeight: 700, marginBottom: 3, letterSpacing: 2, fontFamily: "'JetBrains Mono', monospace" }}>⚠ IMPACT</div>
        <p style={{ fontSize: 10, color: "rgba(255,178,36,0.75)", margin: 0, lineHeight: 1.6 }}>{issue.predicted_impact}</p>
      </div>
    </div>
  );
}

// ─── IssueRow ─────────────────────────────────────────────────────────
function IssueRow({ issue, index, isExpanded, onToggle, onSlide }) {
  const s = SEV[issue.severity] || SEV.info;
  return (
    <div style={{
      background: isExpanded ? s.bg : "rgba(255,255,255,0.02)",
      border: `1px solid ${isExpanded ? s.border : "rgba(255,255,255,0.06)"}`,
      borderRadius: 10, padding: "11px 13px", marginBottom: 6,
      borderLeft: `3px solid ${s.color}`,
      transition: "all 0.2s ease",
      animation: `fadeUp 0.4s ease ${index * 0.05}s both`,
    }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <span style={{ fontSize: 13 }}>{CAT[issue.category]?.icon || "📋"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: s.color, background: `${s.color}18`, padding: "1px 6px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>{s.label}</span>
            {issue.line_start && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono', monospace" }}>L{issue.line_start}</span>}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", lineHeight: 1.3 }}>{issue.title}</div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
          <button onClick={(e) => { e.stopPropagation(); onSlide(); }}
            style={{
              padding: "2px 8px", borderRadius: 4, border: `1px solid ${s.border}`,
              background: "transparent", color: s.color, fontSize: 9, cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
            }}>SLIDE</button>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, transition: "transform 0.2s", display: "inline-block", transform: isExpanded ? "rotate(180deg)" : "none" }}>▼</span>
        </div>
      </div>
      {isExpanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${s.border}` }}>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.58)", lineHeight: 1.65, margin: "0 0 9px 0" }}>{issue.description}</p>
          <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: 8, padding: "9px 11px" }}>
            <div style={{ fontSize: 8, color: "#22C55E", fontWeight: 700, marginBottom: 5, letterSpacing: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>FIX</div>
            <code style={{ fontSize: 10, color: "rgba(255,255,255,0.72)", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.55, wordBreak: "break-all" }}>{issue.suggestion}</code>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────
export default function CodeLens() {
  const { isSignedIn, getToken } = useAuth();
  const [code, setCode] = useState(SAMPLE_CODE);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reworking, setReworking] = useState(false);
  const [reworkDone, setReworkDone] = useState(false);
  const [error, setError] = useState(null);
  const [expandedIssues, setExpandedIssues] = useState(new Set());
  const [animateGauge, setAnimateGauge] = useState(false);
  const [activeTab, setActiveTab] = useState("issues");
  const [useMock, setUseMock] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [activeSlide, setActiveSlide] = useState(0);
  const textareaRef = useRef(null);
  const lineNumberRef = useRef(null);
  const slidesRef = useRef(null);

  const lines = code.split("\n");

  const syncScroll = useCallback(() => {
    if (textareaRef.current && lineNumberRef.current) {
      lineNumberRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const handleAnalyze = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setAnimateGauge(false);
    setExpandedIssues(new Set());
    setReworkDone(false);
    setActiveSlide(0);

    if (useMock) {
      await new Promise((r) => setTimeout(r, 1500));
      setAnalysis(MOCK_ANALYSIS);
      setLoading(false);
      setTimeout(() => setAnimateGauge(true), 100);
      return;
    }

    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ code, language: "auto" }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error: ${resp.status}`);
      }
      const data = await resp.json();
      setAnalysis(data);
      setTimeout(() => setAnimateGauge(true), 100);
    } catch (e) {
      if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) {
        setUseMock(true);
        setAnalysis(MOCK_ANALYSIS);
        setTimeout(() => setAnimateGauge(true), 100);
        setError("Backend not reachable — showing demo results. Start the FastAPI server to use live analysis.");
      } else {
        setError(e.message);
      }
    }
    setLoading(false);
  };

  const handleRework = async () => {
    if (!analysis) return;
    setReworking(true);
    setError(null);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ code, language: analysis.language, issues: analysis.issues }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `Rework failed: ${resp.status}`);
      }
      const data = await resp.json();
      setCode(data.fixed_code);
      setReworkDone(true);
      setAnalysis(null);
      setAnimateGauge(false);
      setExpandedIssues(new Set());
    } catch (e) {
      setError(e.message);
    }
    setReworking(false);
  };

  const goToSlide = (idx) => {
    setActiveSlide(idx);
    if (slidesRef.current) {
      slidesRef.current.scrollTo({ top: idx * slidesRef.current.clientHeight, behavior: "smooth" });
    }
  };

  const toggleIssue = (id) => {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredIssues = analysis?.issues?.filter((i) => filterSeverity === "all" || i.severity === filterSeverity) || [];

  const issueLineSet = new Set();
  if (analysis) {
    analysis.issues.forEach((issue) => {
      if (issue.line_start) {
        for (let l = issue.line_start; l <= (issue.line_end || issue.line_start); l++) issueLineSet.add(l);
      }
    });
  }

  const scoreColor = analysis
    ? analysis.health_score >= 80 ? "#22C55E"
    : analysis.health_score >= 60 ? "#84CC16"
    : analysis.health_score >= 40 ? "#FFB224"
    : "#FF3B5C"
    : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeUp   { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn   { from { opacity:0; } to { opacity:1; } }
        @keyframes pulse    { 0%,100% { opacity:0.6; transform:scale(1); } 50% { opacity:1; transform:scale(1.08); } }
        @keyframes scanline { 0% { top:-2px; } 100% { top:100%; } }
        @keyframes orb1     { 0%,100% { transform:translate(0,0); } 50% { transform:translate(50px,-40px); } }
        @keyframes orb2     { 0%,100% { transform:translate(0,0); } 50% { transform:translate(-40px,50px); } }
        @keyframes glowBtn  { 0%,100% { box-shadow:0 4px 22px rgba(0,229,255,0.25); } 50% { box-shadow:0 4px 40px rgba(0,229,255,0.55),0 0 80px rgba(0,229,255,0.1); } }
        @keyframes shimmerText { 0% { background-position:0% center; } 100% { background-position:200% center; } }
        ::-webkit-scrollbar       { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); border-radius:3px; }
        ::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.16); }
        textarea::selection { background:rgba(0,229,255,0.2); }
        .dot-nav:hover    { transform:scale(1.5) !important; }
        .rework-btn:hover:not(:disabled) { background:linear-gradient(135deg,rgba(0,229,255,0.22) 0%,rgba(155,89,255,0.22) 100%) !important; border-color:rgba(0,229,255,0.55) !important; }
        .analyze-btn:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 8px 32px rgba(0,229,255,0.5) !important; }
        .issue-row:hover { background:rgba(255,255,255,0.035) !important; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#050810", color: "#fff", fontFamily: "'Space Grotesk', sans-serif", position: "relative", overflow: "hidden" }}>

        {/* ─── Ambient Background ───────────────────────────────────── */}
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
          <div style={{ position: "absolute", top: "8%", left: "3%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle,rgba(0,229,255,0.055) 0%,transparent 65%)", animation: "orb1 14s ease-in-out infinite" }} />
          <div style={{ position: "absolute", bottom: "8%", right: "4%", width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle,rgba(155,89,255,0.045) 0%,transparent 65%)", animation: "orb2 18s ease-in-out infinite" }} />
          <div style={{ position: "absolute", top: "45%", left: "35%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,59,92,0.02) 0%,transparent 65%)" }} />
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.018) 1px,transparent 1px)", backgroundSize: "64px 64px" }} />
        </div>

        {/* ─── Header ──────────────────────────────────────────────── */}
        <header style={{
          position: "sticky", top: 0, zIndex: 100,
          background: "rgba(5,8,16,0.88)", backdropFilter: "blur(28px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          padding: "0 28px", height: 66,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ position: "relative", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg viewBox="0 0 44 44" width="44" height="44" style={{ position: "absolute" }}>
                <defs>
                  <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00E5FF" />
                    <stop offset="100%" stopColor="#9B59FF" />
                  </linearGradient>
                </defs>
                <polygon points="22,2 40,12 40,32 22,42 4,32 4,12"
                  fill="none" stroke="url(#hg)" strokeWidth="1.5"
                  style={{ filter: "drop-shadow(0 0 10px rgba(0,229,255,0.5))" }} />
              </svg>
              <span style={{ fontSize: 16, fontWeight: 900, background: "linear-gradient(135deg,#00E5FF,#9B59FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>⟨/⟩</span>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <h1 style={{ fontSize: 21, fontWeight: 900, letterSpacing: "-0.5px", fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg,#00E5FF 0%,#B06FFF 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>CodeLens</h1>
                <span style={{ fontSize: 8, color: "rgba(0,229,255,0.6)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1.5, border: "1px solid rgba(0,229,255,0.2)", padding: "1px 5px", borderRadius: 3 }}>™</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", letterSpacing: 3.5, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>AXON LATTICE LABS</span>
                <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(0,229,255,0.35)", display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", fontFamily: "'JetBrains Mono', monospace" }}>Predictive Code Intelligence</span>
              </div>
            </div>
          </div>

          {/* Center trademark */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{
              fontSize: 10, letterSpacing: 4, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase",
              background: "linear-gradient(90deg,rgba(0,229,255,0.6),rgba(155,89,255,0.6),rgba(0,229,255,0.6))",
              backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              animation: "shimmerText 4s linear infinite",
            }}>AXON LATTICE LABS™</span>
            <span style={{ fontSize: 9, color: "rgba(0,229,255,0.4)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>Head · Steven K.</span>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {reworkDone && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.28)" }}>
                <span style={{ color: "#22C55E", fontSize: 12 }}>✓</span>
                <span style={{ fontSize: 10, color: "#22C55E", fontFamily: "'JetBrains Mono', monospace" }}>Rework applied</span>
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace" }}>
              <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} style={{ accentColor: "#00E5FF" }} />
              demo
            </label>

            <SignedOut>
              <SignInButton mode="modal">
                <button style={{
                  padding: "10px 22px", borderRadius: 10, border: "1px solid rgba(0,229,255,0.35)",
                  cursor: "pointer", background: "rgba(0,229,255,0.08)",
                  color: "#00E5FF", fontSize: 13, fontWeight: 700, fontFamily: "'Outfit', sans-serif",
                  transition: "all 0.25s ease",
                }}>Sign In →</button>
              </SignInButton>
            </SignedOut>

            <SignedIn>
              <button className="analyze-btn" onClick={handleAnalyze} disabled={loading || !code.trim()}
                style={{
                  padding: "10px 22px", borderRadius: 10, border: "none",
                  cursor: loading ? "wait" : "pointer",
                  background: loading ? "rgba(255,255,255,0.07)" : "linear-gradient(135deg,#00E5FF 0%,#7B2FFF 100%)",
                  color: loading ? "rgba(255,255,255,0.3)" : "#fff",
                  fontSize: 13, fontWeight: 700, fontFamily: "'Outfit', sans-serif",
                  animation: !loading ? "glowBtn 3s ease-in-out infinite" : "none",
                  transition: "all 0.25s ease",
                }}>
                {loading ? "Scanning..." : "Analyze Code →"}
              </button>
              <UserButton appearance={{ elements: { avatarBox: { width: 34, height: 34 } } }} />
            </SignedIn>
          </div>
        </header>

        {/* ─── Main 3-panel Layout ──────────────────────────────────── */}
        <div style={{ display: "flex", height: "calc(100vh - 66px)", position: "relative", zIndex: 1 }}>

          {/* ─── Panel 1: Code Editor ─────────────────────────────── */}
          <div style={{
            flex: analysis ? "0 0 42%" : "1",
            transition: "flex 0.5s cubic-bezier(0.4,0,0.2,1)",
            borderRight: "1px solid rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ padding: "9px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F57" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FEBC2E" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#28C840" }} />
              <span style={{ marginLeft: 10, fontSize: 11, color: "rgba(255,255,255,0.22)", fontFamily: "'JetBrains Mono', monospace" }}>
                {reworkDone ? "reworked.py" : "editor.py"}
              </span>
              {reworkDone ? (
                <span style={{ fontSize: 9, color: "#22C55E", fontFamily: "'JetBrains Mono', monospace", background: "rgba(34,197,94,0.08)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(34,197,94,0.2)" }}>✓ AI-reworked</span>
              ) : (
                <span style={{ fontSize: 9, color: "rgba(0,229,255,0.45)", fontFamily: "'JetBrains Mono', monospace", background: "rgba(0,229,255,0.05)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(0,229,255,0.12)" }}>paste code → analyze</span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,0.14)", fontFamily: "'JetBrains Mono', monospace" }}>{lines.length} lines</span>
            </div>
            <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
              <div ref={lineNumberRef} style={{ width: 50, padding: "12px 0", overflowY: "hidden", background: "rgba(0,0,0,0.12)", borderRight: "1px solid rgba(255,255,255,0.04)", userSelect: "none" }}>
                {lines.map((_, i) => (
                  <div key={i} style={{
                    height: 20, lineHeight: "20px", fontSize: 11, textAlign: "right", paddingRight: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: issueLineSet.has(i + 1) ? "#FF3B5C" : "rgba(255,255,255,0.14)",
                    fontWeight: issueLineSet.has(i + 1) ? 700 : 400,
                    background: issueLineSet.has(i + 1) ? "rgba(255,59,92,0.06)" : "transparent",
                  }}>{i + 1}</div>
                ))}
              </div>
              <textarea ref={textareaRef} value={code}
                onChange={(e) => { setCode(e.target.value); setReworkDone(false); }}
                onScroll={syncScroll} spellCheck={false}
                style={{
                  flex: 1, padding: "12px 16px", background: "transparent", border: "none", outline: "none",
                  color: "rgba(255,255,255,0.82)", fontSize: 12, lineHeight: "20px",
                  fontFamily: "'JetBrains Mono', monospace", resize: "none", whiteSpace: "pre",
                  overflowWrap: "normal", overflowX: "auto",
                }} />
              {loading && (
                <div style={{ position: "absolute", left: 50, right: 0, height: 2, background: "linear-gradient(90deg,transparent,#00E5FF,transparent)", animation: "scanline 1.8s linear infinite", opacity: 0.7, pointerEvents: "none" }} />
              )}
            </div>
          </div>

          {/* ─── Panel 2: Analysis Dashboard ─────────────────────── */}
          {(analysis || loading) && (
            <div style={{
              flex: "0 0 33%", display: "flex", flexDirection: "column",
              borderRight: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.006)",
              animation: "fadeUp 0.5s ease",
            }}>
              {loading && !analysis ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
                  <div style={{ width: 58, height: 58, borderRadius: 18, background: "linear-gradient(135deg,#00E5FF,#7B2FFF)", animation: "pulse 1.4s ease infinite", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>⟨/⟩</div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>Scanning vulnerabilities...</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>AXON LATTICE LABS™</p>
                  </div>
                </div>
              ) : analysis && (
                <>
                  {/* Health + Metrics */}
                  <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                      <HealthGauge score={analysis.health_score} animate={animateGauge} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.48)", lineHeight: 1.65, marginBottom: 10 }}>{analysis.summary}</p>
                        {[
                          { label: "Security",    count: analysis.metrics.security,       color: "#FF3B5C" },
                          { label: "Bugs",        count: analysis.metrics.bugs,           color: "#FFB224" },
                          { label: "Performance", count: analysis.metrics.performance,    color: "#A78BFA" },
                          { label: "Code Smells", count: analysis.metrics.code_smells,    color: "#38BDF8" },
                          { label: "Practices",   count: analysis.metrics.best_practices, color: "#22C55E" },
                        ].map(({ label, count, color }) => (
                          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", width: 72, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{label}</span>
                            <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{ width: `${analysis.total_issues > 0 ? (count / analysis.total_issues) * 100 : 0}%`, height: "100%", background: color, borderRadius: 2, transition: "width 1.2s cubic-bezier(0.4,0,0.2,1)" }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color, width: 16, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Rework Button */}
                    <button className="rework-btn" onClick={handleRework} disabled={reworking}
                      style={{
                        width: "100%", marginTop: 16, padding: "13px 0",
                        borderRadius: 12, cursor: reworking ? "wait" : "pointer",
                        background: reworking ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,rgba(0,229,255,0.13) 0%,rgba(155,89,255,0.13) 100%)",
                        border: `1px solid ${reworking ? "rgba(255,255,255,0.08)" : "rgba(0,229,255,0.28)"}`,
                        color: reworking ? "rgba(255,255,255,0.28)" : "#00E5FF",
                        fontSize: 13, fontWeight: 700, fontFamily: "'Outfit', sans-serif",
                        letterSpacing: 0.4, transition: "all 0.3s ease", backdropFilter: "blur(10px)",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      }}>
                      {reworking
                        ? <><span style={{ animation: "pulse 1s ease infinite", display: "inline-block" }}>⟨/⟩</span> Reworking with AI...</>
                        : <>✦ Rework Code with AI Fixes</>}
                    </button>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", textAlign: "center", marginTop: 6, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
                      resolves all {analysis.total_issues} issues · groq llm
                    </p>
                  </div>

                  {/* Tabs */}
                  <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.008)" }}>
                    {[{ key: "issues", label: `Issues (${analysis.total_issues})` }, { key: "strengths", label: "Strengths" }].map((t) => (
                      <button key={t.key} onClick={() => setActiveTab(t.key)}
                        style={{
                          padding: "10px 16px", border: "none", background: "transparent", cursor: "pointer",
                          fontSize: 11, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif",
                          color: activeTab === t.key ? "#00E5FF" : "rgba(255,255,255,0.28)",
                          borderBottom: activeTab === t.key ? "2px solid #00E5FF" : "2px solid transparent",
                          transition: "all 0.2s ease",
                        }}>{t.label}</button>
                    ))}
                  </div>

                  {/* Severity filters */}
                  {activeTab === "issues" && (
                    <div style={{ display: "flex", gap: 4, padding: "7px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", flexWrap: "wrap" }}>
                      {["all", "critical", "warning", "info"].map((sev) => {
                        const cfg = SEV[sev];
                        const active = filterSeverity === sev;
                        return (
                          <button key={sev} onClick={() => setFilterSeverity(sev)}
                            style={{
                              padding: "3px 9px", borderRadius: 5, border: "1px solid",
                              borderColor: active ? (cfg?.color || "#00E5FF") : "rgba(255,255,255,0.07)",
                              background: active ? `${cfg?.color || "#00E5FF"}15` : "transparent",
                              color: active ? (cfg?.color || "#00E5FF") : "rgba(255,255,255,0.28)",
                              fontSize: 9, fontWeight: 700, cursor: "pointer",
                              fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase",
                              letterSpacing: 0.5, transition: "all 0.2s ease",
                            }}>
                            {sev === "all" ? `ALL (${analysis.total_issues})` : `${sev} (${analysis.issues.filter(i => i.severity === sev).length})`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Issue list / Strengths */}
                  <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
                    {activeTab === "issues" && filteredIssues.map((issue, idx) => (
                      <IssueRow key={issue.id} issue={issue} index={idx}
                        isExpanded={expandedIssues.has(issue.id)}
                        onToggle={() => toggleIssue(issue.id)}
                        onSlide={() => goToSlide(Math.max(0, analysis.issues.findIndex(i => i.id === issue.id)))}
                      />
                    ))}
                    {activeTab === "strengths" && analysis.positive_notes?.map((note, idx) => (
                      <div key={idx} style={{
                        background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.18)",
                        borderRadius: 10, padding: "12px 14px", marginBottom: 6, borderLeft: "3px solid #22C55E",
                        animation: `fadeUp 0.4s ease ${idx * 0.08}s both`,
                      }}>
                        <span style={{ color: "#22C55E", marginRight: 8, fontWeight: 700 }}>+</span>
                        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.68)" }}>{note}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── Panel 3: Vulnerability Slides ───────────────────── */}
          {analysis && (
            <div style={{ flex: "0 0 25%", display: "flex", flexDirection: "column", animation: "fadeUp 0.6s ease 0.12s both" }}>
              <div style={{ padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.015)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: scoreColor || "#38BDF8", boxShadow: `0 0 8px ${scoreColor || "#38BDF8"}` }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2.5 }}>VULN SLIDES</span>
                </div>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", fontFamily: "'JetBrains Mono', monospace" }}>{activeSlide + 1} / {analysis.issues.length}</span>
              </div>

              <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                {/* Dot nav */}
                <div style={{ width: 22, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, padding: "16px 0", borderRight: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.1)" }}>
                  {analysis.issues.map((issue, idx) => {
                    const s = SEV[issue.severity] || SEV.info;
                    return (
                      <button key={idx} className="dot-nav" onClick={() => goToSlide(idx)}
                        style={{
                          width: idx === activeSlide ? 9 : 5, height: idx === activeSlide ? 9 : 5,
                          borderRadius: "50%", border: "none", cursor: "pointer", padding: 0,
                          background: idx === activeSlide ? s.color : "rgba(255,255,255,0.12)",
                          boxShadow: idx === activeSlide ? `0 0 10px ${s.color}` : "none",
                          transition: "all 0.25s ease", flexShrink: 0,
                        }} />
                    );
                  })}
                </div>

                {/* Scroll-snap slides */}
                <div ref={slidesRef}
                  onScroll={(e) => {
                    const idx = Math.round(e.target.scrollTop / e.target.clientHeight);
                    if (idx !== activeSlide) setActiveSlide(idx);
                  }}
                  style={{ flex: 1, overflowY: "scroll", scrollSnapType: "y mandatory" }}>
                  {analysis.issues.map((issue, idx) => (
                    <div key={issue.id} style={{ height: "100%", scrollSnapAlign: "start" }}>
                      <VulnSlide issue={issue} index={idx} total={analysis.issues.length} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── Empty / Sign-in state ────────────────────────────── */}
          {!analysis && !loading && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: 48, animation: "fadeIn 0.6s ease" }}>
              <div style={{ width: 80, height: 80, borderRadius: 24, background: "linear-gradient(135deg,rgba(0,229,255,0.15),rgba(155,89,255,0.15))", border: "1px solid rgba(0,229,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, boxShadow: "0 0 40px rgba(0,229,255,0.1)" }}>⟨/⟩</div>
              <SignedOut>
                <div style={{ textAlign: "center", maxWidth: 360 }}>
                  <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10, fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg,#00E5FF,#B06FFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    Sign In to Start Scanning
                  </h2>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.7, marginBottom: 24 }}>
                    Sign in with GitHub or Google to detect security vulnerabilities, bugs, and performance issues in any code.
                  </p>
                  <SignInButton mode="modal">
                    <button style={{
                      padding: "13px 36px", borderRadius: 12, border: "none", cursor: "pointer",
                      background: "linear-gradient(135deg,#00E5FF 0%,#7B2FFF 100%)",
                      color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "'Outfit', sans-serif",
                      animation: "glowBtn 3s ease-in-out infinite", boxShadow: "0 4px 22px rgba(0,229,255,0.25)",
                    }}>Sign In with GitHub →</button>
                  </SignInButton>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 24 }}>
                    {["SQL Injection", "Memory Leaks", "O(n²) Complexity", "Hardcoded Secrets", "eval() Misuse"].map((tag) => (
                      <span key={tag} style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", padding: "4px 10px", borderRadius: 6, fontFamily: "'JetBrains Mono', monospace" }}>{tag}</span>
                    ))}
                  </div>
                </div>
              </SignedOut>
              <SignedIn>
                <div style={{ textAlign: "center", maxWidth: 340 }}>
                  <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10, fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg,#00E5FF,#B06FFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    Ready to Scan
                  </h2>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.7, marginBottom: 20 }}>
                    Paste your code in the editor and click <strong style={{ color: "rgba(0,229,255,0.6)" }}>Analyze Code</strong> to detect security vulnerabilities, bugs, and performance issues.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {["SQL Injection", "Memory Leaks", "O(n²) Complexity", "Hardcoded Secrets", "eval() Misuse"].map((tag) => (
                      <span key={tag} style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", padding: "4px 10px", borderRadius: 6, fontFamily: "'JetBrains Mono', monospace" }}>{tag}</span>
                    ))}
                  </div>
                </div>
              </SignedIn>
              <div style={{ padding: "10px 20px", borderRadius: 10, background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.1)" }}>
                <span style={{ fontSize: 10, color: "rgba(0,229,255,0.4)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>AXON LATTICE LABS™ · CODELENS v2.0</span>
              </div>
            </div>
          )}
        </div>

        {/* ─── Error Toast ─────────────────────────────────────────── */}
        {error && (
          <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "rgba(255,178,36,0.12)", border: "1px solid rgba(255,178,36,0.28)", borderRadius: 12, padding: "11px 18px", maxWidth: 500, backdropFilter: "blur(24px)", animation: "fadeUp 0.3s ease", zIndex: 999, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#FFB224", fontSize: 15 }}>⚠</span>
            <p style={{ fontSize: 12, color: "#FFB224", margin: 0 }}>{error}</p>
            <button onClick={() => setError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,178,36,0.4)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
          </div>
        )}

        {/* ─── Footer Watermark ────────────────────────────────────── */}
        <div style={{ position: "fixed", bottom: 10, right: 14, zIndex: 50, fontSize: 8, color: "rgba(255,255,255,0.08)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2.5, textTransform: "uppercase" }}>
          AXON LATTICE LABS™ · CodeLens v2.0
        </div>

      </div>
    </>
  );
}
