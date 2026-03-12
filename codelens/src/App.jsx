import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants & Sample Code ─────────────────────────────────────────
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

const SEVERITY_CONFIG = {
  critical: { color: "#FF3B5C", bg: "rgba(255,59,92,0.08)", border: "rgba(255,59,92,0.25)", icon: "⛔", label: "CRITICAL" },
  warning: { color: "#FFB224", bg: "rgba(255,178,36,0.08)", border: "rgba(255,178,36,0.25)", icon: "⚠️", label: "WARNING" },
  info: { color: "#38BDF8", bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.25)", icon: "💡", label: "INFO" },
};

const CATEGORY_ICONS = {
  bug: "🐛", security: "🔒", performance: "⚡", code_smell: "👃", best_practice: "✨",
};

// ─── Mock Analysis (for demo without backend) ───────────────────────
const MOCK_ANALYSIS = {
  summary: "This code contains several critical security vulnerabilities, resource leaks, and performance issues that need immediate attention.",
  health_score: 28,
  language: "python",
  total_issues: 9,
  issues: [
    { id: 1, severity: "critical", category: "security", title: "SQL Injection Vulnerability", description: "Using f-string interpolation to build SQL queries allows attackers to inject malicious SQL. An attacker could pass a username like \"' OR '1'='1\" to dump the entire database.", line_start: 7, line_end: 7, suggestion: "Use parameterized queries: cursor.execute(\"SELECT * FROM users WHERE username = ?\", (username,))", predicted_impact: "Full database compromise, data exfiltration, unauthorized access to all user records" },
    { id: 2, severity: "critical", category: "security", title: "Hardcoded Credentials", description: "Password and API key are hardcoded directly in the source code. These will be exposed in version control.", line_start: 27, line_end: 28, suggestion: "Use environment variables: password = os.environ.get('DB_PASSWORD'); api_key = os.environ.get('API_KEY')", predicted_impact: "Credential leakage via source code repositories, unauthorized API access" },
    { id: 3, severity: "critical", category: "security", title: "Unsafe eval() Usage", description: "eval() executes arbitrary Python code from a file. If config.txt is modified by an attacker, they gain full code execution.", line_start: 29, line_end: 29, suggestion: "Use json.load() or configparser for configuration files instead of eval()", predicted_impact: "Remote code execution, complete system compromise" },
    { id: 4, severity: "critical", category: "security", title: "Sensitive Data Logged in Plaintext", description: "Credit card numbers are printed to stdout and written to a log file in plaintext.", line_start: 15, line_end: 17, suggestion: "Mask card numbers (show only last 4 digits) and use structured, encrypted logging", predicted_impact: "PCI-DSS compliance violations, credit card data breach" },
    { id: 5, severity: "warning", category: "bug", title: "Resource Leak — File Handle", description: "File opened with open() is never closed. This can lead to file descriptor exhaustion.", line_start: 16, line_end: 17, suggestion: "Use a context manager: with open('/var/log/payments.log', 'a') as log_file:", predicted_impact: "File descriptor exhaustion under load, data loss from unflushed writes" },
    { id: 6, severity: "warning", category: "bug", title: "Resource Leak — Database Connection", description: "In get_all_users(), the SQLite connection is never closed after fetching results.", line_start: 42, line_end: 43, suggestion: "Use a context manager or explicitly close: conn.close() after fetching", predicted_impact: "Database connection pool exhaustion, locked database files" },
    { id: 7, severity: "warning", category: "performance", title: "O(n²) Algorithm Complexity", description: "calculate_risk_score uses nested loops over the same list, creating O(n²) complexity.", line_start: 46, line_end: 49, suggestion: "Precompute statistics or use vectorized operations with numpy to reduce to O(n)", predicted_impact: "Exponential slowdown as transaction volume grows — 10K transactions = 100M operations" },
    { id: 8, severity: "warning", category: "code_smell", title: "Unbounded Cache — Memory Leak", description: "UserCache.set() adds entries without any size limit or eviction policy.", line_start: 38, line_end: 38, suggestion: "Use functools.lru_cache or implement max-size with LRU eviction", predicted_impact: "Gradual memory consumption growth leading to OOM crashes in production" },
    { id: 9, severity: "info", category: "best_practice", title: "Division Without Zero Check", description: "calculate_risk_score divides by len(transactions) without checking for empty list.", line_start: 50, line_end: 50, suggestion: "Add guard: if not transactions: return 0", predicted_impact: "ZeroDivisionError crash when called with empty transaction list" },
  ],
  metrics: { bugs: 2, security: 4, performance: 1, code_smells: 1, best_practices: 1 },
  positive_notes: ["Functions are well-named and have clear single responsibilities", "Code structure uses classes appropriately for caching logic"],
};

// ─── Subcomponents ───────────────────────────────────────────────────

function HealthGauge({ score, animate }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius * 0.75;
  const offset = circumference - (score / 100) * circumference;
  const getColor = (s) => s >= 80 ? "#22C55E" : s >= 60 ? "#84CC16" : s >= 40 ? "#FFB224" : "#FF3B5C";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width="180" height="140" viewBox="0 0 180 140">
        <path d="M 20 120 A 70 70 0 1 1 160 120" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" strokeLinecap="round" />
        <path d="M 20 120 A 70 70 0 1 1 160 120" fill="none" stroke={getColor(score)} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={animate ? offset : circumference}
          style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 8px ${getColor(score)}55)` }} />
        <text x="90" y="95" textAnchor="middle" fill={getColor(score)} fontSize="42" fontWeight="800"
          fontFamily="'JetBrains Mono', monospace" style={{ opacity: animate ? 1 : 0, transition: "opacity 0.8s ease 0.5s" }}>
          {score}
        </text>
        <text x="90" y="118" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="11"
          fontFamily="'JetBrains Mono', monospace" letterSpacing="2">
          HEALTH SCORE
        </text>
      </svg>
    </div>
  );
}

function MetricBar({ label, icon, count, total, color }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <span style={{ fontSize: 14, width: 22, textAlign: "center" }}>{icon}</span>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", width: 90, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 1s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color, width: 20, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{count}</span>
    </div>
  );
}

function IssueCard({ issue, index, isExpanded, onToggle }) {
  const sev = SEVERITY_CONFIG[issue.severity];
  const catIcon = CATEGORY_ICONS[issue.category] || "📋";

  return (
    <div onClick={onToggle}
      style={{
        background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 10, padding: "14px 16px",
        cursor: "pointer", transition: "all 0.25s ease", marginBottom: 8,
        borderLeft: `3px solid ${sev.color}`,
        animation: `slideIn 0.4s ease ${index * 0.06}s both`,
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 16, marginTop: 1 }}>{catIcon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: sev.color, background: `${sev.color}18`,
              padding: "2px 7px", borderRadius: 4, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
            }}>{sev.label}</span>
            {issue.line_start && (
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace" }}>
                L{issue.line_start}{issue.line_end && issue.line_end !== issue.line_start ? `-${issue.line_end}` : ""}
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.9)", lineHeight: 1.4 }}>{issue.title}</div>
        </div>
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 14, transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
      </div>

      {isExpanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${sev.border}` }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.6, margin: "0 0 12px 0" }}>{issue.description}</p>
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#22C55E", fontWeight: 700, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>FIX</div>
            <code style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, wordBreak: "break-all" }}>
              {issue.suggestion}
            </code>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,178,36,0.8)", fontStyle: "italic" }}>
            ⚡ Impact: {issue.predicted_impact}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────
export default function CodeLens() {
  const [code, setCode] = useState(SAMPLE_CODE);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedIssues, setExpandedIssues] = useState(new Set());
  const [animateGauge, setAnimateGauge] = useState(false);
  const [activeTab, setActiveTab] = useState("issues");
  const [useMock, setUseMock] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState("all");
  const textareaRef = useRef(null);
  const lineNumberRef = useRef(null);

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

    if (useMock) {
      await new Promise((r) => setTimeout(r, 1500));
      setAnalysis(MOCK_ANALYSIS);
      setLoading(false);
      setTimeout(() => setAnimateGauge(true), 100);
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        for (let l = issue.line_start; l <= (issue.line_end || issue.line_start); l++) {
          issueLineSet.add(l);
        }
      }
    });
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800;900&display=swap');
        @keyframes slideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:0.4; } 50% { opacity:1; } }
        @keyframes scanline { 0% { top:-2px; } 100% { top:100%; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:3px; }
        ::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.2); }
        textarea::selection { background: rgba(0, 224, 255, 0.25); }
      `}</style>

      <div style={{
        minHeight: "100vh", background: "#0A0E17",
        backgroundImage: "radial-gradient(ellipse at 20% 0%, rgba(0,224,255,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(120,0,255,0.03) 0%, transparent 50%)",
        color: "#fff", fontFamily: "'Outfit', sans-serif",
      }}>
        {/* ─── Header ──────────────────────────────── */}
        <header style={{
          padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10,14,23,0.8)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 100,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "linear-gradient(135deg, #00E0FF 0%, #7B2FFF 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 900, color: "#0A0E17",
              boxShadow: "0 0 20px rgba(0,224,255,0.3)",
            }}>⟨/⟩</div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px",
                background: "linear-gradient(135deg, #00E0FF, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                CodeLens
              </h1>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 2, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>
                Predictive Code Review
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)}
                style={{ accentColor: "#00E0FF" }} />
              Demo mode
            </label>
            <button onClick={handleAnalyze} disabled={loading || !code.trim()}
              style={{
                padding: "10px 24px", borderRadius: 10, border: "none", cursor: loading ? "wait" : "pointer",
                background: loading ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #00E0FF 0%, #7B2FFF 100%)",
                color: loading ? "rgba(255,255,255,0.4)" : "#fff", fontSize: 13, fontWeight: 700,
                fontFamily: "'Outfit', sans-serif", letterSpacing: 0.3,
                boxShadow: loading ? "none" : "0 4px 20px rgba(0,224,255,0.25)",
                transition: "all 0.3s ease",
              }}>
              {loading ? "Analyzing..." : "Analyze Code ⟩"}
            </button>
          </div>
        </header>

        {/* ─── Main Content ────────────────────────── */}
        <div style={{ display: "flex", minHeight: "calc(100vh - 77px)" }}>
          {/* ─── Code Editor Panel ──────────────────── */}
          <div style={{ flex: analysis ? "0 0 50%" : "1", transition: "flex 0.5s ease", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F57" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FEBC2E" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#28C840" }} />
              <span style={{ marginLeft: 12, fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace" }}>
                editor — paste your code below
              </span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono', monospace" }}>
                {lines.length} lines
              </span>
            </div>
            <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
              {/* Line numbers */}
              <div ref={lineNumberRef}
                style={{
                  width: 52, padding: "12px 0", overflowY: "hidden", background: "rgba(0,0,0,0.2)",
                  borderRight: "1px solid rgba(255,255,255,0.04)", userSelect: "none",
                }}>
                {lines.map((_, i) => (
                  <div key={i} style={{
                    height: 20, lineHeight: "20px", fontSize: 12, textAlign: "right", paddingRight: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: issueLineSet.has(i + 1) ? "#FF3B5C" : "rgba(255,255,255,0.18)",
                    fontWeight: issueLineSet.has(i + 1) ? 700 : 400,
                    background: issueLineSet.has(i + 1) ? "rgba(255,59,92,0.06)" : "transparent",
                  }}>
                    {i + 1}
                  </div>
                ))}
              </div>
              {/* Textarea */}
              <textarea ref={textareaRef} value={code} onChange={(e) => setCode(e.target.value)}
                onScroll={syncScroll} spellCheck={false}
                style={{
                  flex: 1, padding: "12px 16px", background: "transparent", border: "none", outline: "none",
                  color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: "20px",
                  fontFamily: "'JetBrains Mono', monospace", resize: "none", whiteSpace: "pre", overflowWrap: "normal",
                  overflowX: "auto",
                }} />
              {/* Scanline effect while loading */}
              {loading && (
                <div style={{
                  position: "absolute", left: 52, right: 0, height: 2,
                  background: "linear-gradient(90deg, transparent, #00E0FF, transparent)",
                  animation: "scanline 2s linear infinite", opacity: 0.6, pointerEvents: "none",
                }} />
              )}
            </div>
          </div>

          {/* ─── Results Panel ──────────────────────── */}
          {(analysis || loading) && (
            <div style={{
              flex: "0 0 50%", display: "flex", flexDirection: "column", overflow: "hidden",
              animation: "slideIn 0.5s ease",
            }}>
              {loading && !analysis ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: "linear-gradient(135deg, #00E0FF 0%, #7B2FFF 100%)",
                    animation: "pulse 1.5s ease infinite",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
                  }}>⟨/⟩</div>
                  <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono', monospace" }}>Scanning code for issues...</p>
                </div>
              ) : analysis && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {/* Dashboard Top */}
                  <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.01)" }}>
                    <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
                      <HealthGauge score={analysis.health_score} animate={animateGauge} />
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, marginBottom: 12 }}>{analysis.summary}</p>
                        <MetricBar label="Security" icon="🔒" count={analysis.metrics.security} total={analysis.total_issues} color="#FF3B5C" />
                        <MetricBar label="Bugs" icon="🐛" count={analysis.metrics.bugs} total={analysis.total_issues} color="#FFB224" />
                        <MetricBar label="Perf" icon="⚡" count={analysis.metrics.performance} total={analysis.total_issues} color="#A78BFA" />
                        <MetricBar label="Smells" icon="👃" count={analysis.metrics.code_smells} total={analysis.total_issues} color="#38BDF8" />
                        <MetricBar label="Practices" icon="✨" count={analysis.metrics.best_practices} total={analysis.total_issues} color="#22C55E" />
                      </div>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.01)" }}>
                    {[
                      { key: "issues", label: `Issues (${analysis.total_issues})` },
                      { key: "positive", label: "Strengths" },
                    ].map((tab) => (
                      <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                        style={{
                          padding: "10px 20px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                          fontFamily: "'Outfit', sans-serif", background: "transparent",
                          color: activeTab === tab.key ? "#00E0FF" : "rgba(255,255,255,0.35)",
                          borderBottom: activeTab === tab.key ? "2px solid #00E0FF" : "2px solid transparent",
                          transition: "all 0.2s ease",
                        }}>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Filter bar for issues */}
                  {activeTab === "issues" && (
                    <div style={{ display: "flex", gap: 6, padding: "10px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      {["all", "critical", "warning", "info"].map((sev) => (
                        <button key={sev} onClick={() => setFilterSeverity(sev)}
                          style={{
                            padding: "4px 12px", borderRadius: 6, border: "1px solid",
                            borderColor: filterSeverity === sev ? (SEVERITY_CONFIG[sev]?.color || "#00E0FF") : "rgba(255,255,255,0.08)",
                            background: filterSeverity === sev ? `${SEVERITY_CONFIG[sev]?.color || "#00E0FF"}15` : "transparent",
                            color: filterSeverity === sev ? (SEVERITY_CONFIG[sev]?.color || "#00E0FF") : "rgba(255,255,255,0.35)",
                            fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
                            textTransform: "uppercase", letterSpacing: 0.5, transition: "all 0.2s ease",
                          }}>
                          {sev === "all" ? `All (${analysis.total_issues})` : `${SEVERITY_CONFIG[sev].icon} ${analysis.issues.filter((i) => i.severity === sev).length}`}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Content */}
                  <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
                    {activeTab === "issues" && filteredIssues.map((issue, idx) => (
                      <IssueCard key={issue.id} issue={issue} index={idx}
                        isExpanded={expandedIssues.has(issue.id)} onToggle={() => toggleIssue(issue.id)} />
                    ))}
                    {activeTab === "positive" && analysis.positive_notes?.map((note, idx) => (
                      <div key={idx} style={{
                        background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 10,
                        padding: "12px 16px", marginBottom: 8, borderLeft: "3px solid #22C55E",
                        animation: `slideIn 0.4s ease ${idx * 0.08}s both`,
                      }}>
                        <span style={{ fontSize: 14, marginRight: 8 }}>✅</span>
                        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>{note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Error Toast ─────────────────────────── */}
        {error && (
          <div style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            background: "rgba(255,178,36,0.15)", border: "1px solid rgba(255,178,36,0.3)",
            borderRadius: 12, padding: "12px 20px", maxWidth: 500, backdropFilter: "blur(20px)",
            animation: "slideIn 0.3s ease",
          }}>
            <p style={{ fontSize: 13, color: "#FFB224" }}>⚠️ {error}</p>
          </div>
        )}
      </div>
    </>
  );
}
