import { useState, useRef, useCallback, useEffect } from "react";
import { useGoogleLogin } from "@react-oauth/google";

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

// ─── Design Tokens ────────────────────────────────────────────────────
const T = {
  cyan:    "#00D4FF",
  violet:  "#8B5CF6",
  pink:    "#FF2D78",
  amber:   "#F59E0B",
  emerald: "#10B981",
  bg:      "#030812",
};

const SEV = {
  critical: { color: "#FF2D78", bg: "rgba(255,45,120,0.1)",   border: "rgba(255,45,120,0.28)",   label: "CRITICAL", glow: "0 0 22px rgba(255,45,120,0.45)" },
  warning:  { color: "#F59E0B", bg: "rgba(245,158,11,0.1)",   border: "rgba(245,158,11,0.28)",   label: "WARNING",  glow: "0 0 22px rgba(245,158,11,0.45)" },
  info:     { color: "#00D4FF", bg: "rgba(0,212,255,0.1)",    border: "rgba(0,212,255,0.28)",    label: "INFO",     glow: "0 0 22px rgba(0,212,255,0.45)" },
};
const CAT = {
  bug:           { icon: "🐛", label: "Bug" },
  security:      { icon: "🔐", label: "Security" },
  performance:   { icon: "⚡", label: "Performance" },
  code_smell:    { icon: "💨", label: "Code Smell" },
  best_practice: { icon: "✅", label: "Best Practice" },
};

const MOCK_ANALYSIS = {
  summary: "This code contains several critical security vulnerabilities, resource leaks, and performance issues that need immediate attention.",
  health_score: 28, language: "python", total_issues: 9,
  issues: [
    { id:1, severity:"critical", category:"security",      title:"SQL Injection Vulnerability",   description:"Using f-string interpolation to build SQL queries allows attackers to inject malicious SQL.", line_start:7,  line_end:7,  suggestion:'cursor.execute("SELECT * FROM users WHERE username = ?", (username,))', predicted_impact:"Full database compromise, data exfiltration, unauthorized access to all user records" },
    { id:2, severity:"critical", category:"security",      title:"Hardcoded Credentials",         description:"Password and API key are hardcoded in source code and will be exposed in version control.", line_start:27, line_end:28, suggestion:"password = os.environ.get('DB_PASSWORD')", predicted_impact:"Credential leakage via source code repositories, unauthorized API access" },
    { id:3, severity:"critical", category:"security",      title:"Unsafe eval() Usage",           description:"eval() executes arbitrary Python code from a file. If config.txt is compromised, attacker gains code execution.", line_start:29, line_end:29, suggestion:"Use json.load() or configparser instead of eval()", predicted_impact:"Remote code execution, complete system compromise" },
    { id:4, severity:"critical", category:"security",      title:"Sensitive Data in Plaintext",   description:"Credit card numbers printed to stdout and written to log file in plaintext.", line_start:15, line_end:17, suggestion:"Mask card numbers — show only last 4 digits, use structured encrypted logging", predicted_impact:"PCI-DSS violations, credit card data breach" },
    { id:5, severity:"warning",  category:"bug",           title:"Resource Leak — File Handle",   description:"File opened with open() is never closed, leading to file descriptor exhaustion.", line_start:16, line_end:17, suggestion:"with open('/var/log/payments.log', 'a') as log_file:", predicted_impact:"File descriptor exhaustion under load, data loss from unflushed writes" },
    { id:6, severity:"warning",  category:"bug",           title:"Resource Leak — DB Connection", description:"In get_all_users(), the SQLite connection is never closed after fetching results.", line_start:42, line_end:43, suggestion:"Use context manager: with sqlite3.connect('users.db') as conn:", predicted_impact:"Database connection pool exhaustion, locked database files" },
    { id:7, severity:"warning",  category:"performance",   title:"O(n²) Algorithm Complexity",    description:"calculate_risk_score uses nested loops over the same list.", line_start:46, line_end:49, suggestion:"Use vectorized operations with numpy or itertools.combinations", predicted_impact:"Exponential slowdown — 10K transactions = 100M operations" },
    { id:8, severity:"warning",  category:"code_smell",    title:"Unbounded Cache — Memory Leak", description:"UserCache.set() adds entries without any size limit or eviction policy.", line_start:38, line_end:38, suggestion:"Use functools.lru_cache or implement max-size with LRU eviction", predicted_impact:"Gradual memory growth leading to OOM crashes in production" },
    { id:9, severity:"info",     category:"best_practice", title:"Division Without Zero Check",   description:"calculate_risk_score divides by len(transactions) without checking for empty list.", line_start:50, line_end:50, suggestion:"Add guard: if not transactions: return 0", predicted_impact:"ZeroDivisionError crash when called with empty transaction list" },
  ],
  metrics: { bugs:2, security:4, performance:1, code_smells:1, best_practices:1 },
  positive_notes: ["Functions are well-named with clear single responsibilities","Class-based caching structure is appropriate for the use case"],
};

// ─── Responsive Hook ──────────────────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

// ─── 3D Tilt Hook ─────────────────────────────────────────────────────
function useTilt(strength = 8) {
  const ref = useRef(null);
  const onMove = useCallback((e) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;
    ref.current.style.transform = `perspective(700px) rotateX(${-y * strength}deg) rotateY(${x * strength}deg) translateZ(6px)`;
  }, [strength]);
  const onLeave = useCallback(() => {
    if (ref.current) ref.current.style.transform = "perspective(700px) rotateX(0deg) rotateY(0deg) translateZ(0px)";
  }, []);
  return { ref, onMouseMove: onMove, onMouseLeave: onLeave };
}

// ─── HealthGauge ──────────────────────────────────────────────────────
function HealthGauge({ score, animate, size = 130 }) {
  const svgH  = Math.round(size * 0.77);
  const r     = Math.round(size * 0.38);
  const cx    = Math.round(size / 2);
  const cy    = Math.round(svgH * 0.92);
  const circ  = 2 * Math.PI * r * 0.75;
  const offset = circ - (score / 100) * circ;
  const color  = score >= 80 ? T.emerald : score >= 60 ? "#84CC16" : score >= 40 ? T.amber : T.pink;
  const fs     = Math.round(size * 0.24);
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
      <svg width={size} height={svgH} viewBox={`0 0 ${size} ${svgH}`}>
        <defs>
          <filter id="glow-gauge">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 1 1 ${cx+r} ${cy}`} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" strokeLinecap="round"/>
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 1 1 ${cx+r} ${cy}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={animate ? offset : circ} filter="url(#glow-gauge)"
          style={{ transition:"stroke-dashoffset 2s cubic-bezier(0.34,1.56,0.64,1)", filter:`drop-shadow(0 0 10px ${color}cc)` }}/>
        <text x={cx} y={cy - Math.round(size*0.12)} textAnchor="middle" fill={color} fontSize={fs} fontWeight="900"
          fontFamily="'JetBrains Mono',monospace"
          style={{ opacity: animate ? 1 : 0, transition:"opacity 0.6s ease 0.8s" }}>{score}</text>
        <text x={cx} y={cy - 1} textAnchor="middle" fill="rgba(255,255,255,0.18)" fontSize="8"
          fontFamily="'JetBrains Mono',monospace" letterSpacing="3">HEALTH</text>
      </svg>
    </div>
  );
}

// ─── VulnSlide ────────────────────────────────────────────────────────
function VulnSlide({ issue, index, total }) {
  const s = SEV[issue.severity] || SEV.info;
  const c = CAT[issue.category] || { icon:"📋", label:"Issue" };
  return (
    <div style={{
      height:"100%", padding:"24px 20px",
      display:"flex", flexDirection:"column", gap:14,
      background:`linear-gradient(145deg, ${s.bg} 0%, rgba(3,8,18,0.98) 60%)`,
      borderLeft:`3px solid ${s.color}`,
      position:"relative", overflow:"hidden",
    }}>
      {/* Big ghost number */}
      <div style={{ position:"absolute", top:-20, right:-10, fontSize:130, fontWeight:900,
        color:"rgba(255,255,255,0.018)", fontFamily:"'JetBrains Mono',monospace",
        lineHeight:1, userSelect:"none", pointerEvents:"none", letterSpacing:-4 }}>
        {String(index+1).padStart(2,"0")}
      </div>
      {/* Top row */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <span style={{ fontSize:9, fontWeight:800, color:s.color, background:s.bg,
            border:`1px solid ${s.border}`, padding:"4px 10px", borderRadius:8,
            fontFamily:"'JetBrains Mono',monospace", letterSpacing:2.5,
            boxShadow:s.glow, display:"inline-block" }}>{s.label}</span>
          <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:"'JetBrains Mono',monospace" }}>{c.icon} {c.label}</span>
        </div>
        <div style={{ textAlign:"right", fontFamily:"'JetBrains Mono',monospace" }}>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.15)" }}>{index+1}/{total}</div>
          {issue.line_start && <div style={{ fontSize:10, color:s.color, marginTop:4, fontWeight:700 }}>L{issue.line_start}{issue.line_end && issue.line_end!==issue.line_start ? `–${issue.line_end}` : ""}</div>}
        </div>
      </div>
      <h3 style={{ fontSize:15, fontWeight:800, color:"#fff", lineHeight:1.4, margin:0, letterSpacing:-0.3 }}>{issue.title}</h3>
      <p style={{ fontSize:11, color:"rgba(255,255,255,0.45)", lineHeight:1.75, margin:0, flex:1 }}>{issue.description}</p>
      {/* Fix */}
      <div style={{ background:"rgba(0,0,0,0.4)", borderRadius:14, padding:"13px 15px",
        border:"1px solid rgba(16,185,129,0.18)", backdropFilter:"blur(12px)" }}>
        <div style={{ fontSize:8, color:T.emerald, fontWeight:800, marginBottom:6,
          letterSpacing:2.5, fontFamily:"'JetBrains Mono',monospace" }}>✓ SUGGESTED FIX</div>
        <code style={{ fontSize:10, color:"rgba(255,255,255,0.75)", fontFamily:"'JetBrains Mono',monospace",
          lineHeight:1.65, display:"block", wordBreak:"break-word" }}>{issue.suggestion}</code>
      </div>
      {/* Impact */}
      <div style={{ background:`${s.color}08`, borderRadius:12, padding:"10px 13px",
        border:`1px solid ${s.color}18` }}>
        <div style={{ fontSize:8, color:s.color, fontWeight:700, marginBottom:4,
          letterSpacing:2.5, fontFamily:"'JetBrains Mono',monospace" }}>⚠ PREDICTED IMPACT</div>
        <p style={{ fontSize:10, color:`${s.color}bb`, margin:0, lineHeight:1.65 }}>{issue.predicted_impact}</p>
      </div>
    </div>
  );
}

// ─── IssueRow ─────────────────────────────────────────────────────────
function IssueRow({ issue, index, isExpanded, onToggle, onSlide }) {
  const s = SEV[issue.severity] || SEV.info;
  const tilt = useTilt(4);
  return (
    <div ref={tilt.ref} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}
      style={{
        background: isExpanded ? s.bg : "rgba(255,255,255,0.022)",
        border:`1px solid ${isExpanded ? s.border : "rgba(255,255,255,0.06)"}`,
        borderRadius:16, padding:"12px 14px", marginBottom:7,
        borderLeft:`3px solid ${s.color}`,
        transition:"all 0.25s cubic-bezier(0.34,1.56,0.64,1)",
        animation:`fadeUp 0.4s ease ${index*0.06}s both`,
        backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
        cursor:"pointer",
        boxShadow: isExpanded ? `0 8px 30px rgba(0,0,0,0.4), 0 0 0 1px ${s.border}` : "0 2px 8px rgba(0,0,0,0.3)",
        transformStyle:"preserve-3d",
        willChange:"transform",
      }}>
      <div onClick={onToggle} style={{ display:"flex", alignItems:"center", gap:11 }}>
        <div style={{ width:32, height:32, borderRadius:10, background:s.bg,
          border:`1px solid ${s.border}`, display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:14, flexShrink:0, boxShadow:`inset 0 1px 0 rgba(255,255,255,0.1)` }}>
          {CAT[issue.category]?.icon || "📋"}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
            <span style={{ fontSize:8, fontWeight:800, color:s.color, background:`${s.color}18`,
              padding:"2px 7px", borderRadius:5, fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5 }}>{s.label}</span>
            {issue.line_start && <span style={{ fontSize:8, color:"rgba(255,255,255,0.2)", fontFamily:"'JetBrains Mono',monospace" }}>L{issue.line_start}</span>}
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.88)", lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{issue.title}</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
          {onSlide && (
            <button onClick={(e)=>{e.stopPropagation();onSlide();}} style={{
              padding:"3px 9px", borderRadius:7, border:`1px solid ${s.border}`,
              background:`${s.color}10`, color:s.color, fontSize:9, cursor:"pointer",
              fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.2,
              transition:"all 0.2s", boxShadow:`0 0 10px ${s.color}20` }}>SLIDE</button>
          )}
          <span style={{ color:"rgba(255,255,255,0.18)", fontSize:10,
            transition:"transform 0.25s", display:"inline-block",
            transform: isExpanded ? "rotate(180deg)" : "none" }}>▼</span>
        </div>
      </div>
      {isExpanded && (
        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${s.border}40` }}>
          <p style={{ fontSize:11, color:"rgba(255,255,255,0.5)", lineHeight:1.7, margin:"0 0 10px 0" }}>{issue.description}</p>
          <div style={{ background:"rgba(0,0,0,0.3)", borderRadius:12, padding:"10px 13px",
            backdropFilter:"blur(12px)", border:"1px solid rgba(16,185,129,0.12)" }}>
            <div style={{ fontSize:8, color:T.emerald, fontWeight:700, marginBottom:5,
              letterSpacing:2, fontFamily:"'JetBrains Mono',monospace" }}>✓ FIX</div>
            <code style={{ fontSize:10, color:"rgba(255,255,255,0.72)", fontFamily:"'JetBrains Mono',monospace",
              lineHeight:1.6, wordBreak:"break-all" }}>{issue.suggestion}</code>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── UserAvatar ───────────────────────────────────────────────────────
function UserAvatar({ user, onSignOut, isMobile }) {
  const [open, setOpen] = useState(false);
  const size = isMobile ? 30 : 34;
  const initial = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?";
  return (
    <div style={{ position:"relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        width:size, height:size, borderRadius:10,
        border:`1.5px solid rgba(0,212,255,0.3)`,
        background: user?.picture ? "transparent" : `linear-gradient(135deg,rgba(0,212,255,0.25),rgba(139,92,246,0.25))`,
        cursor:"pointer", overflow:"hidden", padding:0,
        display:"flex", alignItems:"center", justifyContent:"center",
        color:T.cyan, fontSize:13, fontWeight:800, flexShrink:0,
        boxShadow:`0 0 0 2px rgba(0,212,255,0.08), 0 4px 14px rgba(0,0,0,0.4)`,
        transition:"box-shadow 0.2s",
      }}>
        {user?.picture
          ? <img src={user.picture} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
          : initial}
      </button>
      {open && (
        <div style={{
          position:"absolute", top:size+10, right:0,
          background:"rgba(5,10,25,0.97)", border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:16, padding:8, minWidth:180, zIndex:600,
          backdropFilter:"blur(60px) saturate(200%)",
          boxShadow:"0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.08)",
          animation:"fadeUp 0.2s cubic-bezier(0.34,1.56,0.64,1)",
        }}>
          {user?.name && (
            <div style={{ padding:"8px 12px", marginBottom:6,
              borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", fontWeight:600, fontFamily:"'Space Grotesk',sans-serif" }}>{user.name}</div>
              {user?.email && <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:2, fontFamily:"'JetBrains Mono',monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:160 }}>{user.email}</div>}
            </div>
          )}
          <button onClick={() => { setOpen(false); onSignOut(); }} style={{
            width:"100%", padding:"8px 12px", borderRadius:10, border:"none",
            background:"rgba(255,45,120,0.08)", color:"#FF2D78",
            cursor:"pointer", fontSize:12, textAlign:"left",
            fontFamily:"'Space Grotesk',sans-serif", fontWeight:700,
            transition:"background 0.2s",
          }}>← Sign Out</button>
        </div>
      )}
    </div>
  );
}

// ─── SignInModal ───────────────────────────────────────────────────────
function SignInModal({ onGoogle, onGitHub, onClose }) {
  const tilt = useTilt(5);
  return (
    <div style={{
      position:"fixed", inset:0, zIndex:600,
      background:"rgba(2,6,14,0.75)", backdropFilter:"blur(18px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      animation:"fadeIn 0.2s ease", padding:16,
    }} onClick={onClose}>
      <div ref={tilt.ref} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}
        onClick={(e) => e.stopPropagation()}
        style={{
          position:"relative",
          background:"linear-gradient(145deg,rgba(12,20,45,0.98) 0%,rgba(5,10,22,0.99) 100%)",
          border:"1px solid rgba(255,255,255,0.1)", borderRadius:28,
          padding:"44px 36px 36px", minWidth:320, maxWidth:400, width:"100%",
          boxShadow:"0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.1)",
          animation:"fadeUp 0.35s cubic-bezier(0.34,1.56,0.64,1)",
        }}>
        {/* Close */}
        <button onClick={onClose} style={{ position:"absolute", top:16, right:18,
          background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)",
          borderRadius:8, color:"rgba(255,255,255,0.4)", cursor:"pointer",
          fontSize:18, lineHeight:1, padding:"2px 8px", transition:"all 0.2s" }}>×</button>
        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ width:60, height:60, borderRadius:18, margin:"0 auto 16px",
            background:"linear-gradient(135deg,rgba(0,212,255,0.15),rgba(139,92,246,0.15))",
            border:"1px solid rgba(0,212,255,0.2)", display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:26,
            boxShadow:"0 8px 30px rgba(0,212,255,0.12), inset 0 1px 0 rgba(0,212,255,0.2)" }}>⟨/⟩</div>
          <h2 style={{ fontSize:24, fontWeight:900, fontFamily:"'Outfit',sans-serif",
            background:"linear-gradient(135deg,#00D4FF 0%,#8B5CF6 50%,#FF2D78 100%)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            marginBottom:10, letterSpacing:-0.5 }}>Sign in to CodeLens</h2>
          <p style={{ fontSize:13, color:"rgba(255,255,255,0.3)", lineHeight:1.7 }}>
            Detect vulnerabilities, bugs &amp; performance issues instantly.
          </p>
        </div>
        {/* Buttons */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {[
            { label:"Continue with GitHub", onClick:onGitHub, icon:(
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
            )},
            { label:"Continue with Google", onClick:onGoogle, icon:(
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            )},
          ].map(({ label, onClick, icon }) => (
            <button key={label} onClick={onClick} style={{
              padding:"14px 20px", borderRadius:16, cursor:"pointer",
              background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.1)",
              color:"rgba(255,255,255,0.88)", fontSize:14, fontWeight:600,
              fontFamily:"'Outfit',sans-serif",
              display:"flex", alignItems:"center", justifyContent:"center", gap:12,
              transition:"all 0.2s",
              boxShadow:"0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.07)",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.transform = "translateY(0)"; }}>
              {icon}{label}
            </button>
          ))}
        </div>
        <p style={{ textAlign:"center", marginTop:20, fontSize:10,
          color:"rgba(255,255,255,0.15)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5 }}>
          AXON LATTICE LABS™ · CODELENS v2.0
        </p>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────
export default function CodeLens() {
  const width    = useWindowWidth();
  const isMobile = width < 640;
  const isTablet = width >= 640 && width < 1024;

  const [code, setCode]                     = useState(SAMPLE_CODE);
  const [analysis, setAnalysis]             = useState(null);
  const [loading, setLoading]               = useState(false);
  const [reworking, setReworking]           = useState(false);
  const [reworkDone, setReworkDone]         = useState(false);
  const [error, setError]                   = useState(null);
  const [expandedIssues, setExpandedIssues] = useState(new Set());
  const [animateGauge, setAnimateGauge]     = useState(false);
  const [activeTab, setActiveTab]           = useState("issues");
  const [useMock, setUseMock]               = useState(false);
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [activeSlide, setActiveSlide]       = useState(0);
  const [mobilePanel, setMobilePanel]       = useState("editor");

  // ── Auth ──────────────────────────────────────────────────────────
  const [authToken, setAuthToken]         = useState(() => localStorage.getItem("cl_token") || null);
  const [authUser, setAuthUser]           = useState(() => { try { return JSON.parse(localStorage.getItem("cl_user") || "null"); } catch { return null; } });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const isSignedIn = !!authToken;

  // ── Navigation ────────────────────────────────────────────────────
  const [activePage, setActivePage]       = useState("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [faqOpenIdx, setFaqOpenIdx]         = useState(null);
  const [usageData, setUsageData]           = useState(null);

  // ── History ───────────────────────────────────────────────────────
  const [analysisHistory, setAnalysisHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cl_history") || "[]"); } catch { return []; }
  });

  const googleLogin = useGoogleLogin({
    onSuccess: async (tr) => {
      try {
        const resp = await fetch(`${API_BASE}/auth/google`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ credential: tr.access_token }) });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || "Google auth failed");
        localStorage.setItem("cl_token", data.token);
        localStorage.setItem("cl_user", JSON.stringify(data.user));
        setAuthToken(data.token); setAuthUser(data.user); setShowAuthModal(false);
      } catch (e) { setError(e.message); }
    },
    onError: () => setError("Google sign-in failed"),
  });

  const handleGitHubLogin = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
    if (!clientId) { setError("GitHub OAuth not configured"); return; }
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(window.location.origin + window.location.pathname)}&scope=read:user`;
  };

  const handleSignOut = () => {
    localStorage.removeItem("cl_token"); localStorage.removeItem("cl_user");
    setAuthToken(null); setAuthUser(null);
  };

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      window.history.replaceState({}, document.title, window.location.pathname);
      fetch(`${API_BASE}/auth/github`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ code }) })
        .then(r => r.json()).then(data => { if (data.token) { localStorage.setItem("cl_token", data.token); localStorage.setItem("cl_user", JSON.stringify(data.user)); setAuthToken(data.token); setAuthUser(data.user); } })
        .catch(() => setError("GitHub authentication failed"));
    }
  }, []);

  const textareaRef   = useRef(null);
  const lineNumberRef = useRef(null);
  const slidesRef     = useRef(null);
  const lines = code.split("\n");

  const syncScroll = useCallback(() => {
    if (textareaRef.current && lineNumberRef.current)
      lineNumberRef.current.scrollTop = textareaRef.current.scrollTop;
  }, []);

  useEffect(() => { if (analysis && isMobile) setMobilePanel("analysis"); }, [analysis]);

  // ── Keep Render awake + token usage polling ────────────────────────
  const [serverReady, setServerReady] = useState(false);
  useEffect(() => {
    // Warm up the server immediately on mount (prevents cold-start delays)
    const warmUp = () =>
      fetch(`${API_BASE}/health`, { cache: "no-store" })
        .then(() => setServerReady(true))
        .catch(() => setTimeout(warmUp, 5000)); // retry every 5s if still waking
    warmUp();

    // Poll usage every 9 min — keeps Render awake (sleeps after 15 min idle)
    const fetchUsage = () =>
      fetch(`${API_BASE}/usage`).then(r => r.json()).then(setUsageData).catch(() => {});
    fetchUsage();
    const id = setInterval(fetchUsage, 540_000); // 9 minutes
    return () => clearInterval(id);
  }, []);

  const handleAnalyze = async () => {
    if (!code.trim()) return;
    if (isMobile) setMobilePanel("analysis");
    setLoading(true); setError(null); setAnalysis(null);
    setAnimateGauge(false); setExpandedIssues(new Set()); setReworkDone(false); setActiveSlide(0);
    if (useMock) {
      await new Promise(r => setTimeout(r, 1500));
      setAnalysis(MOCK_ANALYSIS); setLoading(false);
      setTimeout(() => setAnimateGauge(true), 100); return;
    }
    try {
      const token = authToken;
      const resp = await fetch(`${API_BASE}/analyze`, {
        method:"POST", headers:{"Content-Type":"application/json", ...(token && { Authorization:`Bearer ${token}` })},
        body:JSON.stringify({ code, language:"auto" }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.detail || `Server error: ${resp.status}`); }
      const result = await resp.json();
      setAnalysis(result);
      setTimeout(() => setAnimateGauge(true), 100);
      const entry = { id: Date.now(), date: new Date().toISOString(), language: result.language || "unknown", health_score: result.health_score, total_issues: result.total_issues, code_snippet: code.slice(0, 120) };
      const next = [entry, ...analysisHistory].slice(0, 30);
      setAnalysisHistory(next);
      localStorage.setItem("cl_history", JSON.stringify(next));
    } catch (e) {
      if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) {
        setUseMock(true); setAnalysis(MOCK_ANALYSIS); setTimeout(() => setAnimateGauge(true), 100);
        setError("Backend not reachable — showing demo results.");
      } else { setError(e.message); }
    }
    setLoading(false);
  };

  const handleRework = async () => {
    if (!analysis) return;
    setReworking(true); setError(null);
    try {
      const token = authToken;
      const resp = await fetch(`${API_BASE}/fix`, {
        method:"POST", headers:{"Content-Type":"application/json", ...(token && { Authorization:`Bearer ${token}` })},
        body:JSON.stringify({ code, language:analysis.language, issues:analysis.issues }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.detail || `Rework failed: ${resp.status}`); }
      const data = await resp.json();
      setCode(data.fixed_code); setReworkDone(true); setAnalysis(null);
      setAnimateGauge(false); setExpandedIssues(new Set());
      if (isMobile) setMobilePanel("editor");
    } catch (e) { setError(e.message); }
    setReworking(false);
  };

  const goToSlide = (idx) => {
    setActiveSlide(idx); if (isMobile) setMobilePanel("slides");
    if (slidesRef.current) slidesRef.current.scrollTo({ top: idx * slidesRef.current.clientHeight, behavior:"smooth" });
  };
  const toggleIssue    = (id) => setExpandedIssues(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const filteredIssues = analysis?.issues?.filter(i => filterSeverity === "all" || i.severity === filterSeverity) || [];
  const issueLineSet   = new Set();
  if (analysis) analysis.issues.forEach(i => { if (i.line_start) for (let l = i.line_start; l <= (i.line_end || i.line_start); l++) issueLineSet.add(l); });

  const scoreColor = analysis ? (analysis.health_score >= 80 ? T.emerald : analysis.health_score >= 60 ? "#84CC16" : analysis.health_score >= 40 ? T.amber : T.pink) : null;
  const HEADER_H   = isMobile ? 56 : 66;
  const BOTTOM_BAR = isMobile ? 78 : 0;

  // ── Glass panel style ──────────────────────────────────────────────
  const GLASS = {
    background:"linear-gradient(160deg,rgba(255,255,255,0.055) 0%,rgba(255,255,255,0.018) 100%)",
    backdropFilter:"blur(60px) saturate(180%)", WebkitBackdropFilter:"blur(60px) saturate(180%)",
  };

  // ─────────────────────────────────────────────────────────────────────
  const renderEditor = () => (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Tab bar */}
      <div style={{ padding:"0 14px", height:40, display:"flex", alignItems:"center", gap:8,
        borderBottom:"1px solid rgba(255,255,255,0.06)", background:"rgba(0,0,0,0.15)", flexShrink:0 }}>
        <div style={{ display:"flex", gap:5, marginRight:8 }}>
          {["#FF5F57","#FEBC2E","#28C840"].map(c => (
            <div key={c} style={{ width:10, height:10, borderRadius:"50%", background:c, boxShadow:`0 0 6px ${c}80` }}/>
          ))}
        </div>
        <span style={{ fontSize:11, color:"rgba(255,255,255,0.22)", fontFamily:"'JetBrains Mono',monospace" }}>
          {reworkDone ? "reworked.py" : "editor.py"}
        </span>
        {reworkDone
          ? <span style={{ fontSize:9, color:T.emerald, background:"rgba(16,185,129,0.08)", padding:"2px 9px", borderRadius:7, border:"1px solid rgba(16,185,129,0.2)", fontFamily:"'JetBrains Mono',monospace" }}>✓ AI-reworked</span>
          : <span style={{ fontSize:9, color:"rgba(0,212,255,0.35)", background:"rgba(0,212,255,0.04)", padding:"2px 9px", borderRadius:7, border:"1px solid rgba(0,212,255,0.1)", fontFamily:"'JetBrains Mono',monospace" }}>paste → analyze</span>}
        <span style={{ marginLeft:"auto", fontSize:9, color:"rgba(255,255,255,0.1)", fontFamily:"'JetBrains Mono',monospace" }}>{lines.length} ln</span>
      </div>
      {/* Editor body */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", position:"relative" }}>
        <div ref={lineNumberRef} style={{ width:50, padding:"14px 0", overflowY:"hidden",
          background:"rgba(0,0,0,0.12)", borderRight:"1px solid rgba(255,255,255,0.04)",
          userSelect:"none", flexShrink:0 }}>
          {lines.map((_,i) => (
            <div key={i} style={{ height:20, lineHeight:"20px", fontSize:11, textAlign:"right", paddingRight:10,
              fontFamily:"'JetBrains Mono',monospace",
              color: issueLineSet.has(i+1) ? T.pink : "rgba(255,255,255,0.12)",
              fontWeight: issueLineSet.has(i+1) ? 700 : 400,
              background: issueLineSet.has(i+1) ? "rgba(255,45,120,0.06)" : "transparent",
              borderRight: issueLineSet.has(i+1) ? `2px solid ${T.pink}` : "2px solid transparent",
            }}>{i+1}</div>
          ))}
        </div>
        <textarea ref={textareaRef} value={code}
          onChange={e => { setCode(e.target.value); setReworkDone(false); }}
          onScroll={syncScroll} spellCheck={false}
          style={{ flex:1, padding:"14px 16px", background:"transparent", border:"none", outline:"none",
            color:"rgba(255,255,255,0.82)", fontSize:12, lineHeight:"20px",
            fontFamily:"'JetBrains Mono',monospace", resize:"none",
            whiteSpace:"pre", overflowWrap:"normal", overflowX:"auto" }}/>
        {/* Scan line */}
        {loading && <div style={{ position:"absolute", left:50, right:0, height:2,
          background:`linear-gradient(90deg,transparent,${T.cyan},transparent)`,
          animation:"scanline 1.6s linear infinite", opacity:0.8, pointerEvents:"none" }}/>}
      </div>
    </div>
  );

  const renderAnalysis = () => (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {loading && !analysis ? (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
          <div style={{ position:"relative" }}>
            <div style={{ width:60, height:60, borderRadius:18,
              background:`linear-gradient(135deg,${T.cyan},${T.violet})`,
              animation:"spin3d 2s linear infinite",
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:24,
              boxShadow:`0 0 40px rgba(0,212,255,0.4)` }}>⟨/⟩</div>
          </div>
          <div style={{ textAlign:"center" }}>
            <p style={{ fontSize:13, color:"rgba(255,255,255,0.35)", fontFamily:"'JetBrains Mono',monospace", marginBottom:6 }}>Scanning for vulnerabilities...</p>
            <p style={{ fontSize:9, color:"rgba(255,255,255,0.12)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>AXON LATTICE LABS™</p>
          </div>
          {/* Shimmer bars */}
          <div style={{ display:"flex", flexDirection:"column", gap:8, width:"80%", maxWidth:240 }}>
            {[0.8,0.6,0.9,0.5].map((w,i) => (
              <div key={i} style={{ height:8, borderRadius:6, background:"rgba(255,255,255,0.05)",
                overflow:"hidden", width:`${w*100}%` }}>
                <div style={{ height:"100%", background:`linear-gradient(90deg,transparent,rgba(0,212,255,0.3),transparent)`,
                  animation:`shimmer 1.8s ease ${i*0.2}s infinite` }}/>
              </div>
            ))}
          </div>
        </div>
      ) : analysis ? (
        <>
          {/* Score header */}
          <div style={{ padding:"16px 16px 12px", borderBottom:"1px solid rgba(255,255,255,0.06)",
            background:"rgba(0,0,0,0.1)", flexShrink:0 }}>
            <div style={{ display:"flex", gap:14, alignItems:"center" }}>
              <HealthGauge score={analysis.health_score} animate={animateGauge} size={isMobile ? 108 : 126}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:10, color:"rgba(255,255,255,0.38)", lineHeight:1.65, marginBottom:10 }}>{analysis.summary}</p>
                {[
                  { label:"Security",    count:analysis.metrics.security,       color:T.pink },
                  { label:"Bugs",        count:analysis.metrics.bugs,           color:T.amber },
                  { label:"Performance", count:analysis.metrics.performance,    color:T.violet },
                  { label:"Smells",      count:analysis.metrics.code_smells,    color:T.cyan },
                  { label:"Practices",   count:analysis.metrics.best_practices, color:T.emerald },
                ].map(({label,count,color}) => (
                  <div key={label} style={{ display:"flex", alignItems:"center", gap:8, padding:"2.5px 0" }}>
                    <span style={{ fontSize:9, color:"rgba(255,255,255,0.22)", width:64, fontFamily:"'JetBrains Mono',monospace", flexShrink:0 }}>{label}</span>
                    <div style={{ flex:1, height:4, background:"rgba(255,255,255,0.05)", borderRadius:4, overflow:"hidden" }}>
                      <div style={{ width:`${analysis.total_issues > 0 ? (count/analysis.total_issues)*100 : 0}%`,
                        height:"100%", borderRadius:4, transition:"width 1.4s cubic-bezier(0.34,1.56,0.64,1)",
                        background:`linear-gradient(90deg,${color},${color}aa)`,
                        boxShadow:`0 0 8px ${color}60` }}/>
                    </div>
                    <span style={{ fontSize:11, fontWeight:800, color, width:16, textAlign:"right", fontFamily:"'JetBrains Mono',monospace" }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Rework button */}
            <button className="rework-btn" onClick={handleRework} disabled={reworking} style={{
              width:"100%", marginTop:14, padding:"13px 0", borderRadius:16, cursor:reworking ? "wait" : "pointer",
              background: reworking ? "rgba(255,255,255,0.03)" : "linear-gradient(135deg,rgba(0,212,255,0.12),rgba(139,92,246,0.12))",
              border:`1px solid ${reworking ? "rgba(255,255,255,0.05)" : "rgba(0,212,255,0.25)"}`,
              color: reworking ? "rgba(255,255,255,0.2)" : T.cyan,
              fontSize:13, fontWeight:800, fontFamily:"'Outfit',sans-serif", letterSpacing:0.3,
              transition:"all 0.3s", backdropFilter:"blur(20px)",
              display:"flex", alignItems:"center", justifyContent:"center", gap:9,
              boxShadow: reworking ? "none" : `0 4px 24px rgba(0,212,255,0.1), inset 0 1px 0 rgba(0,212,255,0.15)`,
            }}>
              {reworking ? <><span style={{ animation:"spin 1s linear infinite", display:"inline-block" }}>⟨/⟩</span> Fixing all issues — 2-pass AI…</> : <>✦ Rework Code — Fix All Issues</>}
            </button>
            <p style={{ fontSize:9, color:"rgba(255,255,255,0.12)", textAlign:"center", marginTop:6,
              fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.2 }}>
              resolves all {analysis.total_issues} issues · groq llm
            </p>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.05)", background:"rgba(0,0,0,0.08)", flexShrink:0 }}>
            {[{key:"issues",label:`Issues (${analysis.total_issues})`},{key:"strengths",label:"Strengths"}].map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                padding:"11px 18px", border:"none", background:"transparent", cursor:"pointer",
                fontSize:11, fontWeight:700, fontFamily:"'Space Grotesk',sans-serif",
                color: activeTab === t.key ? T.cyan : "rgba(255,255,255,0.22)",
                borderBottom: activeTab === t.key ? `2px solid ${T.cyan}` : "2px solid transparent",
                transition:"all 0.2s", boxShadow: activeTab === t.key ? `inset 0 -2px 10px rgba(0,212,255,0.1)` : "none",
              }}>{t.label}</button>
            ))}
          </div>

          {/* Filter pills */}
          {activeTab === "issues" && (
            <div style={{ display:"flex", gap:5, padding:"8px 14px", borderBottom:"1px solid rgba(255,255,255,0.04)", flexWrap:"wrap", flexShrink:0 }}>
              {["all","critical","warning","info"].map(sev => {
                const cfg = SEV[sev]; const active = filterSeverity === sev;
                return (
                  <button key={sev} onClick={() => setFilterSeverity(sev)} style={{
                    padding:"4px 11px", borderRadius:20, border:"1px solid",
                    borderColor: active ? (cfg?.color || T.cyan) : "rgba(255,255,255,0.07)",
                    background: active ? `${cfg?.color || T.cyan}14` : "rgba(255,255,255,0.02)",
                    color: active ? (cfg?.color || T.cyan) : "rgba(255,255,255,0.22)",
                    fontSize:9, fontWeight:700, cursor:"pointer",
                    fontFamily:"'JetBrains Mono',monospace", textTransform:"uppercase", letterSpacing:0.8,
                    transition:"all 0.2s", backdropFilter:"blur(8px)",
                    boxShadow: active ? `0 0 12px ${cfg?.color || T.cyan}25` : "none",
                  }}>
                    {sev === "all" ? `ALL (${analysis.total_issues})` : `${sev} (${analysis.issues.filter(i => i.severity === sev).length})`}
                  </button>
                );
              })}
            </div>
          )}

          {/* Issues list */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 13px" }}>
            {activeTab === "issues" && filteredIssues.map((issue, idx) => (
              <IssueRow key={issue.id} issue={issue} index={idx}
                isExpanded={expandedIssues.has(issue.id)}
                onToggle={() => toggleIssue(issue.id)}
                onSlide={() => goToSlide(Math.max(0, analysis.issues.findIndex(i => i.id === issue.id)))}/>
            ))}
            {activeTab === "strengths" && analysis.positive_notes?.map((note, idx) => (
              <div key={idx} style={{
                background:"rgba(16,185,129,0.06)", border:"1px solid rgba(16,185,129,0.16)",
                borderRadius:16, padding:"13px 16px", marginBottom:8,
                borderLeft:`3px solid ${T.emerald}`, backdropFilter:"blur(16px)",
                animation:`fadeUp 0.4s ease ${idx*0.1}s both`,
                boxShadow:"0 4px 16px rgba(0,0,0,0.3)",
              }}>
                <span style={{ color:T.emerald, marginRight:10, fontWeight:700, fontSize:14 }}>+</span>
                <span style={{ fontSize:13, color:"rgba(255,255,255,0.6)" }}>{note}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );

  const renderSlides = () => analysis && (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ padding:"9px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        background:"rgba(0,0,0,0.12)", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:scoreColor || T.cyan,
            boxShadow:`0 0 10px ${scoreColor || T.cyan}` }}/>
          <span style={{ fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.3)",
            fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>VULN SLIDES</span>
        </div>
        <span style={{ fontSize:9, color:"rgba(255,255,255,0.15)",
          fontFamily:"'JetBrains Mono',monospace" }}>{activeSlide+1} / {analysis.issues.length}</span>
      </div>
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* Dot nav */}
        <div style={{ width:22, display:"flex", flexDirection:"column", alignItems:"center",
          justifyContent:"center", gap:8, padding:"16px 0",
          borderRight:"1px solid rgba(255,255,255,0.04)", background:"rgba(0,0,0,0.1)" }}>
          {analysis.issues.map((issue, idx) => {
            const s = SEV[issue.severity] || SEV.info;
            return (
              <button key={idx} className="dot-nav" onClick={() => goToSlide(idx)} style={{
                width: idx === activeSlide ? 10 : 6, height: idx === activeSlide ? 10 : 6,
                borderRadius:"50%", border:"none", cursor:"pointer", padding:0,
                background: idx === activeSlide ? s.color : "rgba(255,255,255,0.1)",
                boxShadow: idx === activeSlide ? `0 0 12px ${s.color}` : "none",
                transition:"all 0.3s cubic-bezier(0.34,1.56,0.64,1)", flexShrink:0 }}/>
            );
          })}
        </div>
        <div ref={slidesRef}
          onScroll={e => { const idx = Math.round(e.target.scrollTop / e.target.clientHeight); if (idx !== activeSlide) setActiveSlide(idx); }}
          style={{ flex:1, overflowY:"scroll", scrollSnapType:"y mandatory" }}>
          {analysis.issues.map((issue, idx) => (
            <div key={issue.id} style={{ height:"100%", scrollSnapAlign:"start" }}>
              <VulnSlide issue={issue} index={idx} total={analysis.issues.length}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderEmpty = () => (
    <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", gap:24, padding:"40px 24px", animation:"fadeIn 0.6s ease" }}>
      {/* Logo orb */}
      <div style={{
        width:80, height:80, borderRadius:26,
        background:"linear-gradient(135deg,rgba(0,212,255,0.12),rgba(139,92,246,0.12))",
        border:"1px solid rgba(0,212,255,0.18)", backdropFilter:"blur(30px)",
        display:"flex", alignItems:"center", justifyContent:"center", fontSize:34,
        boxShadow:`0 12px 40px rgba(0,212,255,0.1), inset 0 1px 0 rgba(0,212,255,0.2)`,
        animation:"float 4s ease-in-out infinite",
      }}>⟨/⟩</div>

      {!isSignedIn ? (
        <div style={{ textAlign:"center", maxWidth:320 }}>
          <h2 style={{ fontSize:22, fontWeight:900, marginBottom:12, fontFamily:"'Outfit',sans-serif",
            background:"linear-gradient(135deg,#00D4FF,#8B5CF6,#FF2D78)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", letterSpacing:-0.5 }}>
            Sign In to Start Scanning
          </h2>
          <p style={{ fontSize:13, color:"rgba(255,255,255,0.28)", lineHeight:1.75, marginBottom:24 }}>
            Sign in with GitHub or Google to detect vulnerabilities, bugs, and performance issues in seconds.
          </p>
          <button onClick={() => setShowAuthModal(true)} className="analyze-btn" style={{
            padding:"14px 36px", borderRadius:16, border:"none", cursor:"pointer",
            background:"linear-gradient(135deg,#00D4FF 0%,#7C3AED 100%)",
            color:"#fff", fontSize:14, fontWeight:800, fontFamily:"'Outfit',sans-serif",
            boxShadow:`0 4px 0 rgba(0,0,0,0.3), 0 8px 30px rgba(0,212,255,0.35)`,
            transition:"all 0.2s", letterSpacing:0.3,
          }}>Sign In →</button>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7, justifyContent:"center", marginTop:22 }}>
            {["SQL Injection","Memory Leaks","O(n²)","Hardcoded Secrets","eval()"].map(tag => (
              <span key={tag} style={{ fontSize:10, color:"rgba(255,255,255,0.2)",
                background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
                padding:"4px 11px", borderRadius:20, fontFamily:"'JetBrains Mono',monospace",
                backdropFilter:"blur(8px)" }}>{tag}</span>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ textAlign:"center", maxWidth:300 }}>
          <h2 style={{ fontSize:22, fontWeight:900, marginBottom:12, fontFamily:"'Outfit',sans-serif",
            background:"linear-gradient(135deg,#00D4FF,#8B5CF6)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", letterSpacing:-0.5 }}>
            Ready to Scan
          </h2>
          <p style={{ fontSize:13, color:"rgba(255,255,255,0.28)", lineHeight:1.75, marginBottom:18 }}>
            Paste your code{!isMobile && " in the editor"} and click{" "}
            <strong style={{ color:"rgba(0,212,255,0.7)" }}>Analyze</strong> to detect issues.
          </p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7, justifyContent:"center" }}>
            {["SQL Injection","Memory Leaks","O(n²)","Hardcoded Secrets","eval()"].map(tag => (
              <span key={tag} style={{ fontSize:10, color:"rgba(255,255,255,0.2)",
                background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
                padding:"4px 11px", borderRadius:20, fontFamily:"'JetBrains Mono',monospace" }}>{tag}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding:"10px 20px", borderRadius:30,
        background:"rgba(0,212,255,0.03)", border:"1px solid rgba(0,212,255,0.08)",
        backdropFilter:"blur(16px)" }}>
        <span style={{ fontSize:9, color:"rgba(0,212,255,0.3)",
          fontFamily:"'JetBrains Mono',monospace", letterSpacing:2.5 }}>
          AXON LATTICE LABS™ · CODELENS v2.0
        </span>
      </div>
    </div>
  );

  // ─── Home Page ────────────────────────────────────────────────────
  const renderHomePage = () => (
    <div className="page-scroll" style={{ background:"transparent" }}>
      {/* Hero */}
      <section className="page-section" style={{ minHeight:"88vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:isMobile ? "60px 24px 48px" : "100px 48px 72px", textAlign:"center", position:"relative" }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"6px 16px", borderRadius:30, background:"rgba(0,212,255,0.06)", border:"1px solid rgba(0,212,255,0.18)", marginBottom:28, backdropFilter:"blur(20px)" }}>
          <span style={{ width:6, height:6, borderRadius:"50%", background:T.cyan, boxShadow:`0 0 10px ${T.cyan}`, animation:"pulse 2s ease-in-out infinite", display:"inline-block" }}/>
          <span style={{ fontSize:11, color:"rgba(0,212,255,0.7)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:2.5 }}>POWERED BY GROQ AI</span>
        </div>
        <h1 style={{ fontSize:isMobile ? 36 : isTablet ? 52 : 72, fontWeight:900, fontFamily:"'Outfit',sans-serif", lineHeight:1.05, letterSpacing:-2, marginBottom:24, maxWidth:900 }}>
          <span style={{ background:"linear-gradient(135deg,#fff 0%,rgba(255,255,255,0.7) 100%)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Detect Code Vulnerabilities</span>
          <br/>
          <span style={{ background:"linear-gradient(135deg,#00D4FF 0%,#8B5CF6 50%,#FF2D78 100%)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Before They Hit Production</span>
        </h1>
        <p style={{ fontSize:isMobile ? 15 : 19, color:"rgba(255,255,255,0.42)", lineHeight:1.8, maxWidth:620, marginBottom:40, fontWeight:400 }}>
          CodeLens uses AI to scan your code for security vulnerabilities, bugs, and performance issues — giving you instant fixes and a full health score in seconds.
        </p>
        <div style={{ display:"flex", gap:14, flexWrap:"wrap", justifyContent:"center", marginBottom:64 }}>
          <button className="analyze-btn" onClick={() => setActivePage("analyze")} style={{
            padding:"15px 36px", borderRadius:18, border:"none", cursor:"pointer",
            background:"linear-gradient(135deg,#00D4FF 0%,#7C3AED 100%)", color:"#fff",
            fontSize:15, fontWeight:800, fontFamily:"'Outfit',sans-serif",
            boxShadow:"0 4px 0 rgba(0,0,0,0.35),0 8px 40px rgba(0,212,255,0.35)", letterSpacing:0.3,
          }}>Start Analyzing Free →</button>
          <button onClick={() => setActivePage("services")} style={{
            padding:"15px 36px", borderRadius:18, cursor:"pointer",
            background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.12)",
            color:"rgba(255,255,255,0.7)", fontSize:15, fontWeight:700, fontFamily:"'Outfit',sans-serif",
            backdropFilter:"blur(20px)", transition:"all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.background="rgba(255,255,255,0.08)"; e.currentTarget.style.color="#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.04)"; e.currentTarget.style.color="rgba(255,255,255,0.7)"; }}>
            View Plans
          </button>
        </div>
        {/* Stats bar */}
        <div style={{ display:"flex", gap:isMobile ? 24 : 48, flexWrap:"wrap", justifyContent:"center" }}>
          {[
            { val:"10+",    label:"Vulnerability Types Detected" },
            { val:"< 5s",   label:"Average Scan Time" },
            { val:"3",      label:"Languages Supported" },
            { val:"100%",   label:"Free to Start" },
          ].map(({ val, label }) => (
            <div key={label} style={{ textAlign:"center" }}>
              <div style={{ fontSize:isMobile ? 26 : 34, fontWeight:900, fontFamily:"'Outfit',sans-serif", background:"linear-gradient(135deg,#00D4FF,#8B5CF6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", lineHeight:1 }}>{val}</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:4, fontFamily:"'JetBrains Mono',monospace", letterSpacing:1 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Why We Built It */}
      <section style={{ padding:isMobile ? "56px 24px" : "80px 64px", maxWidth:1100, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:isMobile ? 40 : 60 }}>
          <span style={{ fontSize:10, color:T.violet, fontFamily:"'JetBrains Mono',monospace", letterSpacing:3, textTransform:"uppercase" }}>OUR STORY</span>
          <h2 style={{ fontSize:isMobile ? 28 : 42, fontWeight:900, fontFamily:"'Outfit',sans-serif", marginTop:12, letterSpacing:-1, background:"linear-gradient(135deg,#fff,rgba(255,255,255,0.65))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Why We Built CodeLens</h2>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:isMobile ? "1fr" : "1fr 1fr", gap:20 }}>
          {[
            { icon:"🔓", title:"Security Breaches Are Expensive", body:"The average data breach now costs $4.45M. Most originate from vulnerabilities that static analysis could have caught. We set out to make that analysis instant and accessible." },
            { icon:"⏳", title:"Developers Lose Hours to Debugging", body:"Engineers spend up to 30% of their time finding and fixing bugs. CodeLens cuts that time dramatically by surfacing issues the moment code is written." },
            { icon:"🧠", title:"Reviews Miss Critical Issues", body:"Manual code review is subjective and rushed. We wanted an unbiased, always-on AI reviewer that applies consistent security and performance standards every time." },
            { icon:"🚀", title:"Democratizing Code Quality", body:"Enterprise-grade code analysis was previously only available to large teams with expensive tooling. We built CodeLens to give every developer — solo or team — the same power." },
          ].map(({ icon, title, body }) => (
            <div key={title} className="card-hover" style={{
              padding:"28px 28px", borderRadius:20,
              background:"linear-gradient(145deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))",
              border:"1px solid rgba(255,255,255,0.07)", backdropFilter:"blur(30px)",
              boxShadow:"0 8px 30px rgba(0,0,0,0.3)",
            }}>
              <div style={{ fontSize:28, marginBottom:14 }}>{icon}</div>
              <h3 style={{ fontSize:17, fontWeight:800, fontFamily:"'Outfit',sans-serif", marginBottom:10, color:"rgba(255,255,255,0.9)" }}>{title}</h3>
              <p style={{ fontSize:13, color:"rgba(255,255,255,0.38)", lineHeight:1.8 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who It Serves */}
      <section style={{ padding:isMobile ? "56px 24px" : "80px 64px", background:"rgba(255,255,255,0.015)", borderTop:"1px solid rgba(255,255,255,0.05)", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth:1100, margin:"0 auto" }}>
          <div style={{ textAlign:"center", marginBottom:isMobile ? 40 : 60 }}>
            <span style={{ fontSize:10, color:T.cyan, fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>WHO WE SERVE</span>
            <h2 style={{ fontSize:isMobile ? 28 : 42, fontWeight:900, fontFamily:"'Outfit',sans-serif", marginTop:12, letterSpacing:-1, background:"linear-gradient(135deg,#fff,rgba(255,255,255,0.65))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Built for Every Developer</h2>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile ? "1fr 1fr" : isTablet ? "repeat(3,1fr)" : "repeat(5,1fr)", gap:16 }}>
            {[
              { icon:"👨‍💻", title:"Solo Devs",        body:"Ship with confidence knowing your code is clean and secure before deployment." },
              { icon:"🏢", title:"Startup Teams",    body:"Move fast without breaking things. Catch critical issues early in your sprint cycle." },
              { icon:"🔐", title:"Security Teams",   body:"Augment your security reviews with AI-powered vulnerability detection across every PR." },
              { icon:"🎓", title:"CS Students",      body:"Learn secure coding practices and understand why certain patterns are dangerous." },
              { icon:"🌐", title:"Open Source",      body:"Maintain code quality across contributor commits without slowing down your community." },
            ].map(({ icon, title, body }) => (
              <div key={title} className="card-hover" style={{
                padding:"22px 18px", borderRadius:18, textAlign:"center",
                background:"linear-gradient(145deg,rgba(0,212,255,0.04),rgba(139,92,246,0.04))",
                border:"1px solid rgba(0,212,255,0.1)", backdropFilter:"blur(20px)",
                boxShadow:"0 4px 20px rgba(0,0,0,0.25)",
              }}>
                <div style={{ fontSize:30, marginBottom:12 }}>{icon}</div>
                <h4 style={{ fontSize:13, fontWeight:800, fontFamily:"'Outfit',sans-serif", marginBottom:8, color:"rgba(255,255,255,0.85)" }}>{title}</h4>
                <p style={{ fontSize:11, color:"rgba(255,255,255,0.3)", lineHeight:1.7 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section style={{ padding:isMobile ? "56px 24px" : "80px 64px", maxWidth:1100, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:isMobile ? 40 : 60 }}>
          <span style={{ fontSize:10, color:T.emerald, fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>KEY BENEFITS</span>
          <h2 style={{ fontSize:isMobile ? 28 : 42, fontWeight:900, fontFamily:"'Outfit',sans-serif", marginTop:12, letterSpacing:-1, background:"linear-gradient(135deg,#fff,rgba(255,255,255,0.65))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Everything You Need</h2>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(3,1fr)", gap:20 }}>
          {[
            { color:T.pink,    icon:"🔐", title:"Security Scanning",      body:"Detects SQL injection, hardcoded secrets, unsafe eval(), XSS vulnerabilities, and 7+ more critical security patterns." },
            { color:T.amber,   icon:"🐛", title:"Bug Detection",           body:"Identifies resource leaks, unclosed connections, division by zero, and other common runtime bugs before they crash production." },
            { color:T.violet,  icon:"⚡", title:"Performance Analysis",    body:"Flags O(n²) algorithms, memory leaks, unbounded caches, and inefficient patterns that will slow your app at scale." },
            { color:T.cyan,    icon:"📊", title:"Health Score",            body:"Every scan produces a 0–100 health score giving you an instant, objective measure of your code's overall quality." },
            { color:T.emerald, icon:"✦",  title:"AI Fix Suggestions",      body:"Don't just find problems — fix them. CodeLens generates AI-powered code rewrites that resolve all detected issues at once." },
            { color:"#F472B6", icon:"📱", title:"Any Device, Any Screen",  body:"Fully responsive across mobile, tablet, and desktop. Scan code wherever you are, on any device." },
          ].map(({ color, icon, title, body }) => (
            <div key={title} className="card-hover" style={{
              padding:"28px", borderRadius:20,
              background:`linear-gradient(145deg,${color}08,rgba(3,8,18,0.8))`,
              border:`1px solid ${color}1a`, backdropFilter:"blur(30px)",
              boxShadow:"0 8px 30px rgba(0,0,0,0.35)",
            }}>
              <div style={{ width:44, height:44, borderRadius:14, background:`${color}15`, border:`1px solid ${color}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, marginBottom:16, boxShadow:`0 4px 16px ${color}20` }}>{icon}</div>
              <h3 style={{ fontSize:16, fontWeight:800, fontFamily:"'Outfit',sans-serif", marginBottom:10, color:"rgba(255,255,255,0.9)" }}>{title}</h3>
              <p style={{ fontSize:12, color:"rgba(255,255,255,0.38)", lineHeight:1.8 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{ padding:isMobile ? "56px 24px" : "80px 48px", textAlign:"center", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
        <h2 style={{ fontSize:isMobile ? 26 : 40, fontWeight:900, fontFamily:"'Outfit',sans-serif", letterSpacing:-1, marginBottom:18, background:"linear-gradient(135deg,#00D4FF,#8B5CF6,#FF2D78)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Ready to Write Safer Code?</h2>
        <p style={{ fontSize:15, color:"rgba(255,255,255,0.3)", marginBottom:32, maxWidth:460, margin:"0 auto 32px" }}>Join developers using CodeLens to ship with confidence. Free to start — no credit card required.</p>
        <button className="analyze-btn" onClick={() => { if (!isSignedIn) setShowAuthModal(true); else setActivePage("analyze"); }} style={{
          padding:"15px 44px", borderRadius:18, border:"none", cursor:"pointer",
          background:"linear-gradient(135deg,#00D4FF 0%,#7C3AED 100%)", color:"#fff",
          fontSize:16, fontWeight:800, fontFamily:"'Outfit',sans-serif",
          boxShadow:"0 4px 0 rgba(0,0,0,0.35),0 8px 50px rgba(0,212,255,0.4)",
        }}>{isSignedIn ? "Go to Analyzer →" : "Get Started Free →"}</button>
        <div style={{ marginTop:16, fontSize:10, color:"rgba(255,255,255,0.12)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:2 }}>AXON LATTICE LABS™ · CODELENS v2.0</div>
      </section>
    </div>
  );

  // ─── History Page ─────────────────────────────────────────────────
  const renderHistoryPage = () => (
    <div className="page-scroll" style={{ padding:isMobile ? "28px 16px" : "40px 48px" }}>
      <div style={{ maxWidth:860, margin:"0 auto" }}>
        <div style={{ marginBottom:32 }}>
          <span style={{ fontSize:10, color:T.cyan, fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>YOUR SCANS</span>
          <h2 style={{ fontSize:isMobile ? 26 : 36, fontWeight:900, fontFamily:"'Outfit',sans-serif", letterSpacing:-0.8, marginTop:8, background:"linear-gradient(135deg,#fff,rgba(255,255,255,0.65))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Analysis History</h2>
        </div>
        {analysisHistory.length === 0 ? (
          <div style={{ textAlign:"center", padding:"72px 24px", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:24 }}>
            <div style={{ fontSize:48, marginBottom:16 }}>⏱</div>
            <h3 style={{ fontSize:18, fontWeight:800, fontFamily:"'Outfit',sans-serif", color:"rgba(255,255,255,0.5)", marginBottom:10 }}>No analyses yet</h3>
            <p style={{ fontSize:13, color:"rgba(255,255,255,0.22)", marginBottom:24 }}>Your scan history will appear here after your first analysis.</p>
            <button className="analyze-btn" onClick={() => setActivePage("analyze")} style={{
              padding:"12px 28px", borderRadius:14, border:"none", cursor:"pointer",
              background:"linear-gradient(135deg,#00D4FF 0%,#7C3AED 100%)", color:"#fff",
              fontSize:13, fontWeight:800, fontFamily:"'Outfit',sans-serif",
              boxShadow:"0 4px 0 rgba(0,0,0,0.35),0 8px 30px rgba(0,212,255,0.3)",
            }}>Analyze Your First Code →</button>
          </div>
        ) : (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontSize:12, color:"rgba(255,255,255,0.25)", fontFamily:"'JetBrains Mono',monospace" }}>{analysisHistory.length} scan{analysisHistory.length !== 1 ? "s" : ""} recorded</span>
              <button onClick={() => { setAnalysisHistory([]); localStorage.removeItem("cl_history"); }} style={{
                padding:"5px 12px", borderRadius:8, border:"1px solid rgba(255,45,120,0.2)",
                background:"rgba(255,45,120,0.06)", color:"rgba(255,45,120,0.6)", cursor:"pointer",
                fontSize:10, fontFamily:"'JetBrains Mono',monospace",
              }}>Clear All</button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {analysisHistory.map((entry) => {
                const score = entry.health_score;
                const col = score >= 80 ? T.emerald : score >= 60 ? "#84CC16" : score >= 40 ? T.amber : T.pink;
                const d = new Date(entry.date);
                return (
                  <div key={entry.id} className="card-hover" style={{
                    padding:"18px 20px", borderRadius:18,
                    background:"linear-gradient(145deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))",
                    border:"1px solid rgba(255,255,255,0.07)", backdropFilter:"blur(20px)",
                    boxShadow:"0 4px 20px rgba(0,0,0,0.3)", cursor:"pointer",
                  }} onClick={() => setActivePage("analyze")}>
                    <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                      <div style={{ width:46, height:46, borderRadius:14, background:`${col}15`, border:`1px solid ${col}25`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <span style={{ fontSize:18, fontWeight:900, color:col, fontFamily:"'JetBrains Mono',monospace" }}>{score}</span>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                          <span style={{ fontSize:11, fontWeight:700, color:col, background:`${col}14`, padding:"2px 8px", borderRadius:6, fontFamily:"'JetBrains Mono',monospace" }}>{entry.language?.toUpperCase() || "UNKNOWN"}</span>
                          <span style={{ fontSize:11, color:"rgba(255,255,255,0.22)", fontFamily:"'JetBrains Mono',monospace" }}>{entry.total_issues} issue{entry.total_issues !== 1 ? "s" : ""}</span>
                        </div>
                        <code style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"'JetBrains Mono',monospace", display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{entry.code_snippet}…</code>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'JetBrains Mono',monospace" }}>{d.toLocaleDateString()}</div>
                        <div style={{ fontSize:10, color:"rgba(255,255,255,0.12)", fontFamily:"'JetBrains Mono',monospace" }}>{d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ─── About Page ───────────────────────────────────────────────────
  const renderAboutPage = () => (
    <div className="page-scroll" style={{ padding:isMobile ? "28px 16px" : "40px 48px" }}>
      <div style={{ maxWidth:860, margin:"0 auto" }}>
        <div style={{ marginBottom:40, textAlign:"center" }}>
          <span style={{ fontSize:10, color:T.violet, fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>OUR MISSION</span>
          <h2 style={{ fontSize:isMobile ? 28 : 42, fontWeight:900, fontFamily:"'Outfit',sans-serif", letterSpacing:-1, marginTop:12, background:"linear-gradient(135deg,#fff,rgba(255,255,255,0.65))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>About Axon Lattice Labs</h2>
          <p style={{ fontSize:15, color:"rgba(255,255,255,0.35)", lineHeight:1.9, maxWidth:620, margin:"18px auto 0" }}>We build intelligent developer tools that help engineers write better, safer code — without slowing them down.</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:isMobile ? "1fr" : "1fr 1fr", gap:20, marginBottom:32 }}>
          {[
            { color:T.cyan,    title:"Our Mission",  body:"To democratize enterprise-grade code intelligence. Every developer — regardless of team size or budget — deserves an AI-powered co-reviewer that never misses a vulnerability." },
            { color:T.violet,  title:"Our Vision",   body:"A world where code quality issues are caught in seconds, not discovered in production incidents. We're building the tools that make that future a reality." },
            { color:T.emerald, title:"Our Values",   body:"Transparency in how our AI makes decisions. Simplicity in the interfaces we build. Reliability in the results we deliver. Security first, always." },
            { color:T.amber,   title:"Our Stack",    body:"Groq LLM inference for lightning-fast analysis. FastAPI backend on Render. React + Vite frontend on Vercel. OAuth 2.0 with GitHub and Google." },
          ].map(({ color, title, body }) => (
            <div key={title} className="card-hover" style={{
              padding:"28px", borderRadius:20,
              background:`linear-gradient(145deg,${color}06,rgba(3,8,18,0.8))`,
              border:`1px solid ${color}18`, backdropFilter:"blur(30px)",
              boxShadow:"0 8px 30px rgba(0,0,0,0.3)",
            }}>
              <h3 style={{ fontSize:16, fontWeight:800, fontFamily:"'Outfit',sans-serif", color, marginBottom:12 }}>{title}</h3>
              <p style={{ fontSize:13, color:"rgba(255,255,255,0.38)", lineHeight:1.85 }}>{body}</p>
            </div>
          ))}
        </div>
        {/* Team */}
        <div style={{ padding:"32px", borderRadius:24, background:"linear-gradient(145deg,rgba(139,92,246,0.07),rgba(3,8,18,0.9))", border:"1px solid rgba(139,92,246,0.15)", textAlign:"center" }}>
          <div style={{ width:72, height:72, borderRadius:22, background:"linear-gradient(135deg,rgba(0,212,255,0.2),rgba(139,92,246,0.2))", border:"1px solid rgba(0,212,255,0.25)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", fontSize:28, boxShadow:"0 8px 30px rgba(0,212,255,0.15)" }}>⟨/⟩</div>
          <h3 style={{ fontSize:20, fontWeight:900, fontFamily:"'Outfit',sans-serif", color:"rgba(255,255,255,0.9)", marginBottom:4 }}>Steven K.</h3>
          <span style={{ fontSize:11, color:T.cyan, fontFamily:"'JetBrains Mono',monospace", letterSpacing:2 }}>FOUNDER · HEAD · AXON LATTICE LABS</span>
          <p style={{ fontSize:13, color:"rgba(255,255,255,0.3)", lineHeight:1.8, maxWidth:480, margin:"16px auto 0" }}>Building at the intersection of AI and developer tooling. Passionate about making secure, high-quality code accessible to every engineer on the planet.</p>
        </div>
      </div>
    </div>
  );

  // ─── Services Page ────────────────────────────────────────────────
  const renderServicesPage = () => (
    <div className="page-scroll" style={{ padding:isMobile ? "28px 16px" : "40px 48px" }}>
      <div style={{ maxWidth:900, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:isMobile ? 36 : 56 }}>
          <span style={{ fontSize:10, color:T.amber, fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>PRICING</span>
          <h2 style={{ fontSize:isMobile ? 28 : 42, fontWeight:900, fontFamily:"'Outfit',sans-serif", letterSpacing:-1, marginTop:12, background:"linear-gradient(135deg,#fff,rgba(255,255,255,0.65))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Simple, Transparent Plans</h2>
          <p style={{ fontSize:15, color:"rgba(255,255,255,0.3)", marginTop:12 }}>Start free. Upgrade when you need more power.</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:isMobile ? "1fr" : "1fr 1fr", gap:24, alignItems:"start" }}>
          {/* Basic */}
          <div className="card-hover" style={{ padding:"36px 32px", borderRadius:24, background:"linear-gradient(145deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))", border:"1px solid rgba(255,255,255,0.09)", backdropFilter:"blur(30px)", boxShadow:"0 8px 30px rgba(0,0,0,0.35)" }}>
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:2, marginBottom:10 }}>BASIC</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                <span style={{ fontSize:48, fontWeight:900, fontFamily:"'Outfit',sans-serif", color:"#fff" }}>$0</span>
                <span style={{ fontSize:14, color:"rgba(255,255,255,0.3)" }}>/month</span>
              </div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", marginTop:8 }}>Free forever. No credit card required.</div>
            </div>
            <button className="analyze-btn" onClick={() => { if (!isSignedIn) setShowAuthModal(true); else setActivePage("analyze"); }} style={{
              width:"100%", padding:"13px", borderRadius:14, border:"1px solid rgba(255,255,255,0.1)", cursor:"pointer",
              background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.75)",
              fontSize:14, fontWeight:700, fontFamily:"'Outfit',sans-serif", marginBottom:28,
            }}>Get Started Free</button>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {[
                "Up to 20 scans per day",
                "Security vulnerability detection",
                "Bug and resource leak analysis",
                "Performance issue flagging",
                "Health score (0–100)",
                "AI-powered fix suggestions",
                "Analysis history (last 30 scans)",
                "GitHub & Google sign-in",
              ].map(f => (
                <div key={f} style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, color:"rgba(255,255,255,0.55)" }}>
                  <span style={{ color:T.emerald, fontSize:14, flexShrink:0 }}>✓</span>{f}
                </div>
              ))}
            </div>
          </div>

          {/* Pro */}
          <div className="card-hover" style={{ padding:"36px 32px", borderRadius:24, background:"linear-gradient(145deg,rgba(0,212,255,0.07),rgba(139,92,246,0.07))", border:"1px solid rgba(0,212,255,0.2)", backdropFilter:"blur(30px)", boxShadow:"0 8px 40px rgba(0,212,255,0.12), 0 8px 30px rgba(0,0,0,0.4)", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:16, right:16, padding:"4px 12px", borderRadius:20, background:"linear-gradient(135deg,#00D4FF,#7C3AED)", fontSize:10, fontWeight:800, color:"#fff", fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5 }}>POPULAR</div>
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:12, color:T.cyan, fontFamily:"'JetBrains Mono',monospace", letterSpacing:2, marginBottom:10 }}>PRO</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                <span style={{ fontSize:48, fontWeight:900, fontFamily:"'Outfit',sans-serif", background:"linear-gradient(135deg,#00D4FF,#8B5CF6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>$12</span>
                <span style={{ fontSize:14, color:"rgba(255,255,255,0.3)" }}>/month</span>
              </div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", marginTop:8 }}>Everything in Basic, plus:</div>
            </div>
            <button className="analyze-btn" onClick={() => setActivePage("contact")} style={{
              width:"100%", padding:"13px", borderRadius:14, border:"none", cursor:"pointer",
              background:"linear-gradient(135deg,#00D4FF 0%,#7C3AED 100%)", color:"#fff",
              fontSize:14, fontWeight:800, fontFamily:"'Outfit',sans-serif", marginBottom:28,
              boxShadow:"0 4px 0 rgba(0,0,0,0.35),0 8px 30px rgba(0,212,255,0.3)",
            }}>Contact Us to Upgrade</button>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {[
                "Unlimited scans",
                "Priority AI processing (faster results)",
                "Full analysis history (unlimited)",
                "Team workspace (up to 10 seats)",
                "API access for CI/CD integration",
                "Custom language & framework rules",
                "Slack & GitHub PR integration",
                "Dedicated support channel",
                "Early access to new features",
              ].map(f => (
                <div key={f} style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, color:"rgba(255,255,255,0.65)" }}>
                  <span style={{ color:T.cyan, fontSize:14, flexShrink:0 }}>✦</span>{f}
                </div>
              ))}
            </div>
          </div>
        </div>
        <p style={{ textAlign:"center", marginTop:28, fontSize:12, color:"rgba(255,255,255,0.18)", fontFamily:"'JetBrains Mono',monospace" }}>All plans subject to fair-use policy · Prices in USD · Pro features coming soon</p>
      </div>
    </div>
  );

  // ─── FAQ Page ─────────────────────────────────────────────────────
  const renderFaqPage = () => {
    const openIdx = faqOpenIdx;
    const setOpenIdx = setFaqOpenIdx;
    const faqs = [
      {
        q: "What is CodeLens and how does it work?",
        a: "CodeLens is an AI-powered code analysis tool built by Axon Lattice Labs. You paste your code into the editor, click Analyze, and our backend sends it to a Groq-hosted LLM (Llama 3.3 70B) with an exhaustive 11-category audit checklist. The AI inspects every line for security vulnerabilities, bugs, performance issues, and code quality problems, then returns a structured report with a health score, issue list, fix suggestions, and predicted impact.",
      },
      {
        q: "What programming languages does CodeLens support?",
        a: "CodeLens can analyse any language the underlying LLM understands — which includes Python, JavaScript, TypeScript, Java, Go, Rust, C, C++, C#, Ruby, PHP, Swift, Kotlin, and more. Language is auto-detected from your code. For best line-number accuracy, avoid mixing multiple languages in a single paste.",
      },
      {
        q: "How is the health score calculated?",
        a: "The health score (0–100) is computed server-side — not by the AI — using a diminishing-returns formula: score = 100 / (1 + weight × 0.045), where weight = (critical issues × 10) + (warning issues × 4) + (info issues × 1). This means the score is completely deterministic: the same code always produces the same score, and it can never artificially bottom out to 0 just from having many issues.",
      },
      {
        q: "Why does CodeLens sometimes report more issues than I expect?",
        a: "CodeLens is designed to be exhaustive. It checks 11 categories on every line: syntax, type safety, all OWASP Top 10 security patterns, resource management, error handling, input validation, concurrency, performance, memory, code quality, and best practices. This intentionally surfaces issues that a quick manual review would miss. Each reported issue is a genuine finding — not a false positive.",
      },
      {
        q: "What does the 'Rework Code with AI Fixes' button do?",
        a: "After an analysis, clicking Rework sends your original code plus the full issue list back to the AI with instructions to fix every problem. The AI rewrites the code to use parameterised queries, context managers, safe crypto, validated input, and optimised algorithms — then returns the corrected version directly into the editor. Each changed line is annotated with a # FIX: comment explaining what was changed.",
      },
      {
        q: "Is my code stored or shared?",
        a: "No. Your code is sent directly to the Groq API for analysis and is not stored on our servers. We store only lightweight metadata in your browser's localStorage: your auth token, your display name/avatar, and a snippet of each scan (first 120 characters) for your History page. Nothing is ever shared with third parties.",
      },
      {
        q: "Do I need to sign in to use CodeLens?",
        a: "Yes — a free GitHub or Google sign-in is required to run analyses. This lets us associate scan history with your account, enforce fair-use rate limits (10 analyses/minute, 50/hour on Basic), and protect the API from abuse. Sign-in takes under 5 seconds and requires no personal information beyond your name and email.",
      },
      {
        q: "What are the rate limits?",
        a: "Basic (free) plan: 10 analyses per minute, 50 per hour. Rework (fix) requests: 5 per minute, 20 per hour. These limits are generous for individual use. If you need higher throughput for CI/CD pipelines or team workflows, the Pro plan removes these restrictions.",
      },
      {
        q: "What is the difference between Basic and Pro?",
        a: "Basic is free forever and covers individual use: unlimited code length, full vulnerability scanning, AI fix suggestions, and 30-scan history. Pro ($12/month) adds unlimited scan history, higher rate limits, team workspaces, CI/CD API access, custom rules, Slack/GitHub PR integration, and priority AI processing with faster response times.",
      },
      {
        q: "How accurate is the AI analysis?",
        a: "Very high for well-known patterns — SQL injection, hardcoded credentials, resource leaks, O(n²) algorithms, eval/exec usage, and OWASP Top 10 vulnerabilities are detected with near-certainty. For subtle logic errors or domain-specific business rule violations, the AI may occasionally miss edge cases. We recommend treating CodeLens as a first-pass automated reviewer that complements — not replaces — human code review.",
      },
      {
        q: "Can I analyse code from a GitHub repository?",
        a: "Yes. The backend has a /github/analyze endpoint that accepts a GitHub repository URL and file path, fetches the raw file, and runs the same full analysis. This feature will be surfaced in the UI in an upcoming release. For now, you can paste code directly or use the API endpoint manually.",
      },
      {
        q: "How do I report a bug or request a feature?",
        a: "Head to the Contact page and send us a message, or email axonlattice@gmail.com directly. For bug reports, include the code snippet that caused the issue (you can redact sensitive parts) and describe what you expected vs. what happened. Feature requests are very welcome — we prioritise based on user feedback.",
      },
    ];
    return (
      <div className="page-scroll" style={{ padding:isMobile ? "28px 16px" : "40px 48px" }}>
        <div style={{ maxWidth:780, margin:"0 auto" }}>
          <div style={{ textAlign:"center", marginBottom:isMobile ? 36 : 52 }}>
            <span style={{ fontSize:10, color:T.cyan, fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>FAQ</span>
            <h2 style={{ fontSize:isMobile ? 28 : 42, fontWeight:900, fontFamily:"'Outfit',sans-serif", letterSpacing:-1, marginTop:12, background:"linear-gradient(135deg,#fff,rgba(255,255,255,0.65))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Frequently Asked Questions</h2>
            <p style={{ fontSize:15, color:"rgba(255,255,255,0.3)", marginTop:12, lineHeight:1.7 }}>Everything you need to know about CodeLens.</p>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {faqs.map((faq, idx) => {
              const isOpen = openIdx === idx;
              return (
                <div key={idx} style={{
                  borderRadius:18, overflow:"hidden",
                  border:`1px solid ${isOpen ? "rgba(0,212,255,0.22)" : "rgba(255,255,255,0.07)"}`,
                  background: isOpen ? "linear-gradient(145deg,rgba(0,212,255,0.05),rgba(3,8,18,0.9))" : "rgba(255,255,255,0.025)",
                  backdropFilter:"blur(20px)", transition:"border-color 0.25s, background 0.25s",
                  boxShadow: isOpen ? "0 8px 30px rgba(0,212,255,0.08)" : "0 2px 10px rgba(0,0,0,0.2)",
                }}>
                  <button onClick={() => setOpenIdx(isOpen ? null : idx)} style={{
                    width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
                    gap:16, padding:isMobile ? "16px 18px" : "18px 24px",
                    background:"none", border:"none", cursor:"pointer", textAlign:"left",
                  }}>
                    <span style={{ fontSize:isMobile ? 13 : 14, fontWeight:700, fontFamily:"'Space Grotesk',sans-serif", color: isOpen ? T.cyan : "rgba(255,255,255,0.82)", lineHeight:1.4, flex:1 }}>{faq.q}</span>
                    <span style={{ fontSize:18, color: isOpen ? T.cyan : "rgba(255,255,255,0.25)", flexShrink:0, transition:"transform 0.3s cubic-bezier(0.34,1.56,0.64,1)", display:"inline-block", transform: isOpen ? "rotate(45deg)" : "none" }}>+</span>
                  </button>
                  {isOpen && (
                    <div style={{ padding:isMobile ? "0 18px 18px" : "0 24px 20px", animation:"fadeUp 0.25s ease" }}>
                      <div style={{ height:1, background:"rgba(0,212,255,0.12)", marginBottom:16 }}/>
                      <p style={{ fontSize:13, color:"rgba(255,255,255,0.5)", lineHeight:1.9, margin:0 }}>{faq.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:40, padding:"28px", borderRadius:20, textAlign:"center", background:"linear-gradient(145deg,rgba(139,92,246,0.06),rgba(3,8,18,0.9))", border:"1px solid rgba(139,92,246,0.14)" }}>
            <p style={{ fontSize:14, color:"rgba(255,255,255,0.4)", marginBottom:16 }}>Still have questions? We're happy to help.</p>
            <button onClick={() => setActivePage("contact")} style={{ padding:"11px 28px", borderRadius:14, border:"none", cursor:"pointer", background:"linear-gradient(135deg,#00D4FF,#7C3AED)", color:"#fff", fontSize:13, fontWeight:800, fontFamily:"'Outfit',sans-serif", boxShadow:"0 4px 0 rgba(0,0,0,0.3),0 6px 24px rgba(0,212,255,0.25)" }}>Contact Us →</button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Contact Page ─────────────────────────────────────────────────
  const [contactForm, setContactForm]       = useState({ name:"", email:"", message:"" });
  const [contactSending, setContactSending] = useState(false);
  const [contactStatus, setContactStatus]   = useState(null); // "sent" | "error" | null

  const handleContactSubmit = async () => {
    if (!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim()) {
      setContactStatus({ type:"error", text:"Please fill in all fields." });
      return;
    }
    setContactSending(true);
    setContactStatus(null);
    try {
      const res = await fetch(`${API_BASE}/contact`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(contactForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to send.");
      setContactStatus({ type:"sent", text:"Message sent! We'll get back to you soon." });
      setContactForm({ name:"", email:"", message:"" });
    } catch (e) {
      setContactStatus({ type:"error", text: e.message });
    } finally {
      setContactSending(false);
    }
  };

  const renderContactPage = () => {
    const inputStyle = { padding:"13px 16px", borderRadius:12, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.09)", color:"rgba(255,255,255,0.8)", fontSize:13, fontFamily:"'Space Grotesk',sans-serif", outline:"none" };
    return (
      <div className="page-scroll" style={{ padding:isMobile ? "28px 16px" : "40px 48px" }}>
        <div style={{ maxWidth:700, margin:"0 auto" }}>
          <div style={{ textAlign:"center", marginBottom:40 }}>
            <span style={{ fontSize:10, color:T.pink, fontFamily:"'JetBrains Mono',monospace", letterSpacing:3 }}>GET IN TOUCH</span>
            <h2 style={{ fontSize:isMobile ? 28 : 42, fontWeight:900, fontFamily:"'Outfit',sans-serif", letterSpacing:-1, marginTop:12, background:"linear-gradient(135deg,#fff,rgba(255,255,255,0.65))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Contact Us</h2>
            <p style={{ fontSize:15, color:"rgba(255,255,255,0.3)", marginTop:12, lineHeight:1.7 }}>Have questions, feedback, or want to upgrade to Pro? We'd love to hear from you.</p>
          </div>
          {/* Contact cards */}
          <div style={{ display:"grid", gridTemplateColumns:isMobile ? "1fr" : "1fr 1fr", gap:16, marginBottom:32 }}>
            {[
              { icon:"✉", label:"Email",   value:"axonlattice@gmail.com",       color:T.cyan, href:"mailto:axonlattice@gmail.com" },
              { icon:"🐙", label:"GitHub",  value:"github.com/Kamaumbugua-dev", color:"#fff",  href:"https://github.com/Kamaumbugua-dev" },
            ].map(({ icon, label, value, color, href }) => (
              <a key={label} href={href} target="_blank" rel="noreferrer" style={{ textDecoration:"none" }}>
                <div className="card-hover" style={{ padding:"22px 24px", borderRadius:18, background:"linear-gradient(145deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))", border:"1px solid rgba(255,255,255,0.08)", backdropFilter:"blur(20px)", boxShadow:"0 4px 20px rgba(0,0,0,0.3)", display:"flex", alignItems:"center", gap:16 }}>
                  <div style={{ width:44, height:44, borderRadius:13, background:`${color}18`, border:`1px solid ${color}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{icon}</div>
                  <div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:2, marginBottom:4 }}>{label.toUpperCase()}</div>
                    <div style={{ fontSize:13, fontWeight:600, color, fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
                  </div>
                </div>
              </a>
            ))}
          </div>
          {/* Message form */}
          <div style={{ padding:"32px", borderRadius:24, background:"linear-gradient(145deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))", border:"1px solid rgba(255,255,255,0.08)", backdropFilter:"blur(30px)" }}>
            <h3 style={{ fontSize:16, fontWeight:800, fontFamily:"'Outfit',sans-serif", color:"rgba(255,255,255,0.8)", marginBottom:20 }}>Send a Message</h3>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <input placeholder="Your name" value={contactForm.name}
                onChange={e => setContactForm(f => ({ ...f, name:e.target.value }))}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor="rgba(0,212,255,0.35)"} onBlur={e => e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
              <input placeholder="Your email" value={contactForm.email} type="email"
                onChange={e => setContactForm(f => ({ ...f, email:e.target.value }))}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor="rgba(0,212,255,0.35)"} onBlur={e => e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
              <textarea placeholder="Your message…" rows={5} value={contactForm.message}
                onChange={e => setContactForm(f => ({ ...f, message:e.target.value }))}
                style={{ ...inputStyle, resize:"vertical" }}
                onFocus={e => e.target.style.borderColor="rgba(0,212,255,0.35)"} onBlur={e => e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
              {contactStatus && (
                <div style={{ padding:"11px 16px", borderRadius:10, fontSize:13, fontWeight:600, fontFamily:"'Space Grotesk',sans-serif",
                  background: contactStatus.type === "sent" ? "rgba(0,212,100,0.1)" : "rgba(255,45,120,0.1)",
                  border: `1px solid ${contactStatus.type === "sent" ? "rgba(0,212,100,0.25)" : "rgba(255,45,120,0.25)"}`,
                  color: contactStatus.type === "sent" ? "#00D464" : "#FF2D78" }}>
                  {contactStatus.text}
                </div>
              )}
              <button disabled={contactSending} onClick={handleContactSubmit}
                style={{ padding:"13px", borderRadius:14, border:"none", cursor: contactSending ? "wait" : "pointer",
                  background: contactSending ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#00D4FF 0%,#7C3AED 100%)",
                  color: contactSending ? "rgba(255,255,255,0.3)" : "#fff", fontSize:14, fontWeight:800,
                  fontFamily:"'Outfit',sans-serif", boxShadow: contactSending ? "none" : "0 4px 0 rgba(0,0,0,0.35),0 8px 30px rgba(0,212,255,0.25)" }}>
                {contactSending ? "Sending…" : "Send Message →"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        html, body, #root { height:100%; }

        @keyframes fadeUp     { from{opacity:0;transform:translateY(14px)}  to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn     { from{opacity:0}                             to{opacity:1} }
        @keyframes float      { 0%,100%{transform:translateY(0)}            50%{transform:translateY(-14px)} }
        @keyframes pulse      { 0%,100%{opacity:0.5;transform:scale(1)}     50%{opacity:1;transform:scale(1.1)} }
        @keyframes spin       { from{transform:rotate(0deg)}                to{transform:rotate(360deg)} }
        @keyframes spin3d     { from{transform:rotateY(0deg) rotateX(0deg)} to{transform:rotateY(360deg) rotateX(15deg)} }
        @keyframes scanline   { 0%{top:-2px}                                100%{top:100%} }
        @keyframes shimmer    { 0%{transform:translateX(-100%)}             100%{transform:translateX(300%)} }
        @keyframes orb1       { 0%,100%{transform:translate(0,0) scale(1)}  50%{transform:translate(60px,-50px) scale(1.08)} }
        @keyframes orb2       { 0%,100%{transform:translate(0,0) scale(1)}  50%{transform:translate(-50px,60px) scale(1.05)} }
        @keyframes orb3       { 0%,100%{transform:translate(0,0)}           33%{transform:translate(40px,30px)} 66%{transform:translate(-30px,-20px)} }
        @keyframes glowBtn    { 0%,100%{box-shadow:0 4px 0 rgba(0,0,0,0.35),0 8px 30px rgba(0,212,255,0.3)} 50%{box-shadow:0 4px 0 rgba(0,0,0,0.35),0 8px 50px rgba(0,212,255,0.55),0 0 90px rgba(0,212,255,0.12)} }
        @keyframes shimmerText{ 0%{background-position:0% center}           100%{background-position:200% center} }
        @keyframes borderGlow { 0%,100%{opacity:0.5}                        50%{opacity:1} }

        ::-webkit-scrollbar       { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.07); border-radius:3px; }
        ::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.14); }
        textarea::selection { background:rgba(0,212,255,0.2); }
        textarea { -webkit-tap-highlight-color:transparent; caret-color:#00D4FF; }

        .dot-nav:hover  { transform:scale(1.6) !important; }
        .rework-btn:hover:not(:disabled) {
          background:linear-gradient(135deg,rgba(0,212,255,0.2) 0%,rgba(139,92,246,0.2) 100%) !important;
          border-color:rgba(0,212,255,0.45) !important;
          box-shadow:0 8px 32px rgba(0,212,255,0.18),inset 0 1px 0 rgba(0,212,255,0.2) !important;
          transform:translateY(-2px);
        }
        .analyze-btn:hover:not(:disabled) {
          transform:translateY(-3px) !important;
          box-shadow:0 7px 0 rgba(0,0,0,0.35),0 14px 50px rgba(0,212,255,0.5) !important;
        }
        .analyze-btn:active:not(:disabled) {
          transform:translateY(1px) !important;
          box-shadow:0 2px 0 rgba(0,0,0,0.35),0 4px 20px rgba(0,212,255,0.25) !important;
        }
        .sign-in-btn:hover { background:rgba(255,255,255,0.1) !important; transform:translateY(-1px); }
        .nav-link { background:none; border:none; cursor:pointer; padding:8px 14px; border-radius:10px; font-size:13px; font-weight:600; font-family:'Space Grotesk',sans-serif; transition:all 0.2s; color:rgba(255,255,255,0.45); letter-spacing:0.1px; position:relative; touch-action:manipulation; -webkit-tap-highlight-color:transparent; }
        .nav-link:hover { color:rgba(255,255,255,0.9); background:rgba(255,255,255,0.05); }
        .nav-link.active { color:#00D4FF; background:rgba(0,212,255,0.08); }
        .nav-link.active::after { content:''; position:absolute; bottom:2px; left:50%; transform:translateX(-50%); width:20px; height:2px; background:#00D4FF; border-radius:2px; box-shadow:0 0 8px rgba(0,212,255,0.6); }
        .page-section { animation:fadeUp 0.5s ease both; }
        .card-hover { transition:transform 0.25s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s; }
        .card-hover:hover { transform:translateY(-6px); box-shadow:0 20px 50px rgba(0,0,0,0.5) !important; }
        button { touch-action:manipulation; -webkit-tap-highlight-color:transparent; }
        .hamburger { background:none; border:none; cursor:pointer; padding:10px; border-radius:8px; display:flex; flex-direction:column; gap:5px; align-items:center; justify-content:center; transition:all 0.2s; min-width:44px; min-height:44px; touch-action:manipulation; -webkit-tap-highlight-color:transparent; }
        .hamburger:hover { background:rgba(255,255,255,0.06); }
        .page-scroll { overflow-y:auto; flex:1; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
        .page-scroll::-webkit-scrollbar { width:4px; }
        .page-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.07); border-radius:3px; }
      `}</style>

      <div style={{ height:"100dvh", background:T.bg, color:"#fff",
        fontFamily:"'Space Grotesk',sans-serif", position:"relative",
        display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* ── Ambient Background ──────────────────────────────── */}
        <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, overflow:"hidden" }}>
          {/* Orbs */}
          <div style={{ position:"absolute", top:"-10%", left:"-15%", width:"65vw", height:"65vw", borderRadius:"50%",
            background:"radial-gradient(circle,rgba(0,212,255,0.07) 0%,transparent 65%)",
            animation:"orb1 18s ease-in-out infinite" }}/>
          <div style={{ position:"absolute", bottom:"-15%", right:"-15%", width:"70vw", height:"70vw", borderRadius:"50%",
            background:"radial-gradient(circle,rgba(139,92,246,0.07) 0%,transparent 65%)",
            animation:"orb2 22s ease-in-out infinite" }}/>
          <div style={{ position:"absolute", top:"30%", right:"20%", width:"40vw", height:"40vw", borderRadius:"50%",
            background:"radial-gradient(circle,rgba(255,45,120,0.04) 0%,transparent 60%)",
            animation:"orb3 28s ease-in-out infinite" }}/>
          {/* Fine grid */}
          <div style={{ position:"absolute", inset:0,
            backgroundImage:"linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px)",
            backgroundSize:"64px 64px" }}/>
          {/* Vignette */}
          <div style={{ position:"absolute", inset:0,
            background:"radial-gradient(ellipse 80% 80% at 50% 50%,transparent 40%,rgba(2,6,12,0.6) 100%)" }}/>
        </div>

        {/* ── Server warm-up banner ───────────────────────────── */}
        {!serverReady && (
          <div style={{ background:"rgba(255,140,0,0.12)", borderBottom:"1px solid rgba(255,140,0,0.2)", padding:"6px 20px", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"#FF8C00", animation:"pulse 1s ease-in-out infinite" }}/>
            <span style={{ fontSize:11, color:"rgba(255,180,0,0.8)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:0.5 }}>
              Server warming up — first request may take 30s…
            </span>
          </div>
        )}

        {/* ── NavBar ─────────────────────────────────────────── */}
        <header style={{
          flexShrink:0, position:"relative", zIndex:100,
          background:"rgba(3,8,18,0.82)",
          backdropFilter:"blur(60px) saturate(200%)", WebkitBackdropFilter:"blur(60px) saturate(200%)",
          borderBottom:"1px solid rgba(255,255,255,0.07)",
          boxShadow:"0 1px 0 rgba(255,255,255,0.05), 0 4px 30px rgba(0,0,0,0.5)",
        }}>
          <div style={{ padding:`0 ${isMobile ? 14 : 28}px`, height:HEADER_H, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            {/* Brand */}
            <button onPointerDown={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setActivePage("home"); setMobileMenuOpen(false); }} style={{ display:"flex", alignItems:"center", gap:isMobile ? 10 : 12, background:"none", border:"none", cursor:"pointer", padding:isMobile ? "8px 4px" : 0, touchAction:"manipulation", WebkitTapHighlightColor:"transparent" }}>
              <div style={{
                width:isMobile ? 34 : 38, height:isMobile ? 34 : 38, borderRadius:isMobile ? 11 : 12,
                background:"linear-gradient(135deg,rgba(0,212,255,0.15),rgba(139,92,246,0.15))",
                border:"1px solid rgba(0,212,255,0.22)", backdropFilter:"blur(20px)",
                display:"flex", alignItems:"center", justifyContent:"center",
                boxShadow:"0 4px 20px rgba(0,212,255,0.12), inset 0 1px 0 rgba(0,212,255,0.2)",
                transition:"transform 0.3s cubic-bezier(0.34,1.56,0.64,1)",
              }}
                onMouseEnter={e => e.currentTarget.style.transform="rotate(-8deg) scale(1.1)"}
                onMouseLeave={e => e.currentTarget.style.transform=""}>
                <span style={{ fontSize:isMobile ? 13 : 15, fontWeight:900, background:"linear-gradient(135deg,#00D4FF,#8B5CF6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>⟨/⟩</span>
              </div>
              <div style={{ textAlign:"left" }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                  <span style={{ fontSize:isMobile ? 16 : 19, fontWeight:900, letterSpacing:"-0.5px", fontFamily:"'Outfit',sans-serif", background:"linear-gradient(135deg,#00D4FF 0%,#8B5CF6 60%,#FF2D78 100%)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>CodeLens</span>
                  <span style={{ fontSize:7, color:"rgba(0,212,255,0.5)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5, border:"1px solid rgba(0,212,255,0.2)", padding:"1px 4px", borderRadius:4 }}>™</span>
                </div>
                {!isMobile && <div style={{ fontSize:8, color:"rgba(255,255,255,0.14)", letterSpacing:2.5, fontFamily:"'JetBrains Mono',monospace", textTransform:"uppercase", marginTop:1 }}>AXON LATTICE LABS</div>}
              </div>
            </button>

            {/* Desktop nav links */}
            {!isMobile && (
              <nav style={{ display:"flex", alignItems:"center", gap:2 }}>
                {[
                  { key:"home",     label:"Home" },
                  { key:"analyze",  label:"Analyze Code" },
                  { key:"history",  label:"History" },
                  { key:"about",    label:"About" },
                  { key:"services", label:"Services" },
                  { key:"faq",      label:"FAQ" },
                  { key:"contact",  label:"Contact" },
                ].map(({ key, label }) => (
                  <button key={key} onClick={() => setActivePage(key)} className={`nav-link${activePage === key ? " active" : ""}`}>{label}</button>
                ))}
              </nav>
            )}

            {/* Token usage indicator — desktop only */}
            {!isMobile && usageData && (() => {
              const providers = [
                { key:"groq",     label:"Groq",     color:"#00D4FF" },
                { key:"cerebras", label:"Cerebras", color:"#8B5CF6" },
              ];
              return (
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  {providers.map(({ key, label, color }) => {
                    const d = usageData[key];
                    if (!d || d.limit === null) return null;
                    const pct = d.pct_used ?? 0;
                    const barColor = pct >= 90 ? "#FF2D78" : pct >= 75 ? "#FF8C00" : pct >= 50 ? "#FFD700" : color;
                    return (
                      <div key={key} title={`${label}: ${d.used.toLocaleString()} / ${d.limit.toLocaleString()} tokens used (${pct}%)\nResets in: ${d.resets_in ?? "—"}`}
                        style={{ display:"flex", flexDirection:"column", gap:3, cursor:"default" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:6 }}>
                          <span style={{ fontSize:9, color:"rgba(255,255,255,0.35)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:0.5 }}>{label}</span>
                          <span style={{ fontSize:9, color: barColor, fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>{pct}%</span>
                        </div>
                        <div style={{ width:64, height:3, borderRadius:2, background:"rgba(255,255,255,0.08)" }}>
                          <div style={{ width:`${Math.min(pct,100)}%`, height:"100%", borderRadius:2, background:barColor, transition:"width 0.5s ease" }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Right controls */}
            <div style={{ display:"flex", alignItems:"center", gap:isMobile ? 8 : 10 }}>
              {activePage === "analyze" && isSignedIn && !isMobile && (
                <button className="analyze-btn" onClick={handleAnalyze} disabled={loading || !code.trim()} style={{
                  padding:"8px 20px", borderRadius:22, border:"none", cursor:loading ? "wait" : "pointer",
                  background: loading ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#00D4FF 0%,#7C3AED 100%)",
                  color: loading ? "rgba(255,255,255,0.25)" : "#fff", fontSize:13, fontWeight:800,
                  fontFamily:"'Outfit',sans-serif", animation: !loading ? "glowBtn 3s ease-in-out infinite" : "none",
                  transition:"all 0.2s", boxShadow: loading ? "none" : "0 4px 0 rgba(0,0,0,0.35),0 8px 30px rgba(0,212,255,0.3)",
                }}>{loading ? "Scanning..." : "Analyze →"}</button>
              )}
              {!isSignedIn ? (
                <button className="sign-in-btn" onPointerDown={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setShowAuthModal(true); }} style={{
                  padding:isMobile ? "7px 13px" : "8px 18px", borderRadius:22,
                  border:"1px solid rgba(0,212,255,0.28)", cursor:"pointer",
                  background:"rgba(0,212,255,0.06)",
                  backdropFilter: isMobile ? "none" : "blur(20px)",
                  color:T.cyan, fontSize:isMobile ? 12 : 13, fontWeight:700,
                  fontFamily:"'Outfit',sans-serif", transition:"all 0.2s",
                  touchAction:"manipulation", WebkitTapHighlightColor:"transparent",
                  boxShadow:"inset 0 1px 0 rgba(0,212,255,0.12)" }}>Sign In →</button>
              ) : (
                <UserAvatar user={authUser} onSignOut={handleSignOut} isMobile={isMobile}/>
              )}
              {/* Mobile hamburger */}
              {isMobile && (
                <button className="hamburger"
                  onPointerDown={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setMobileMenuOpen(o => !o); }}
                  style={{ touchAction:"manipulation", WebkitTapHighlightColor:"transparent" }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width:22, height:2, borderRadius:2, background: mobileMenuOpen && i===1 ? "transparent" : "rgba(255,255,255,0.75)",
                      transition:"all 0.25s",
                      transform: mobileMenuOpen ? (i===0 ? "rotate(45deg) translate(5px,5px)" : i===2 ? "rotate(-45deg) translate(5px,-5px)" : "none") : "none",
                    }}/>
                  ))}
                </button>
              )}
            </div>
          </div>

          {/* Mobile dropdown menu */}
          {isMobile && mobileMenuOpen && (
            <div style={{ borderTop:"1px solid rgba(255,255,255,0.07)", padding:"10px 14px 16px",
              display:"flex", flexDirection:"column", gap:4, animation:"fadeUp 0.2s ease" }}>
              {[
                { key:"home",     label:"Home",         icon:"⌂" },
                { key:"analyze",  label:"Analyze Code", icon:"⟨/⟩" },
                { key:"history",  label:"History",      icon:"⏱" },
                { key:"about",    label:"About",        icon:"◈" },
                { key:"services", label:"Services",     icon:"◇" },
                { key:"faq",      label:"FAQ",          icon:"?" },
                { key:"contact",  label:"Contact",      icon:"✉" },
              ].map(({ key, label, icon }) => (
                <button key={key}
                  onPointerDown={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setActivePage(key); setMobileMenuOpen(false); }}
                  style={{
                  display:"flex", alignItems:"center", gap:12, padding:"14px 16px", borderRadius:12,
                  background: activePage === key ? "rgba(0,212,255,0.08)" : "rgba(255,255,255,0.025)",
                  border:`1px solid ${activePage === key ? "rgba(0,212,255,0.22)" : "rgba(255,255,255,0.06)"}`,
                  color: activePage === key ? T.cyan : "rgba(255,255,255,0.65)",
                  fontSize:15, fontWeight:600, fontFamily:"'Space Grotesk',sans-serif",
                  cursor:"pointer", transition:"all 0.2s", textAlign:"left",
                  width:"100%", minHeight:52, touchAction:"manipulation", WebkitTapHighlightColor:"transparent",
                }}>
                  <span style={{ fontSize:16, width:22, textAlign:"center" }}>{icon}</span>
                  {label}
                  {activePage === key && <span style={{ marginLeft:"auto", fontSize:10, color:T.cyan }}>●</span>}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* ── Main Content ───────────────────────────────────── */}
        <div style={{ flex:1, display:"flex", overflow:"hidden", position:"relative", zIndex:1, minHeight:0 }}>

          {/* Non-analyze pages */}
          {activePage !== "analyze" && (
            <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              {activePage === "home"     && renderHomePage()}
              {activePage === "history"  && renderHistoryPage()}
              {activePage === "about"    && renderAboutPage()}
              {activePage === "services" && renderServicesPage()}
              {activePage === "faq"      && renderFaqPage()}
              {activePage === "contact"  && renderContactPage()}
            </div>
          )}

          {/* Analyze page */}
          {activePage === "analyze" && (
            <>
              {/* DESKTOP ≥ 1024px */}
              {!isMobile && !isTablet && (
                <>
                  <div style={{ flex:(analysis||loading) ? "0 0 42%" : "1", transition:"flex 0.5s cubic-bezier(0.4,0,0.2,1)",
                    borderRight:"1px solid rgba(255,255,255,0.06)", display:"flex", flexDirection:"column", ...GLASS }}>
                    {renderEditor()}
                  </div>
                  {(analysis||loading) && (
                    <div style={{ flex:"0 0 33%", display:"flex", flexDirection:"column",
                      borderRight:"1px solid rgba(255,255,255,0.06)", animation:"fadeUp 0.5s ease", ...GLASS }}>
                      {renderAnalysis()}
                    </div>
                  )}
                  {analysis && (
                    <div style={{ flex:"0 0 25%", display:"flex", flexDirection:"column",
                      animation:"fadeUp 0.6s ease 0.1s both", ...GLASS }}>
                      {renderSlides()}
                    </div>
                  )}
                  {!analysis && !loading && renderEmpty()}
                </>
              )}

              {/* TABLET 640–1023px */}
              {isTablet && (
                <>
                  <div style={{ flex:"0 0 50%", borderRight:"1px solid rgba(255,255,255,0.06)",
                    display:"flex", flexDirection:"column", ...GLASS }}>
                    {renderEditor()}
                  </div>
                  <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", ...GLASS }}>
                    {(analysis||loading) ? (
                      <>
                        <div style={{ flex: analysis ? "0 0 58%" : "1", display:"flex", flexDirection:"column",
                          overflow:"hidden", borderBottom: analysis ? "1px solid rgba(255,255,255,0.06)" : "none",
                          animation:"fadeUp 0.5s ease" }}>
                          {renderAnalysis()}
                        </div>
                        {analysis && (
                          <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", animation:"fadeUp 0.5s ease 0.1s both" }}>
                            {renderSlides()}
                          </div>
                        )}
                      </>
                    ) : renderEmpty()}
                  </div>
                </>
              )}

              {/* MOBILE < 640px */}
              {isMobile && (
                <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", ...GLASS }}>
                  {mobilePanel === "editor"   && renderEditor()}
                  {mobilePanel === "analysis" && ((analysis||loading) ? renderAnalysis() : renderEmpty())}
                  {mobilePanel === "slides"   && (analysis ? renderSlides() : renderEmpty())}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Mobile Bottom Bar (analyze page only) ──────────── */}
        {isMobile && activePage === "analyze" && (
          <div style={{
            flexShrink:0, zIndex:200,
            background:"rgba(2,6,14,0.88)",
            backdropFilter:"blur(60px) saturate(200%)", WebkitBackdropFilter:"blur(60px) saturate(200%)",
            borderTop:"1px solid rgba(255,255,255,0.08)",
            boxShadow:"0 -4px 30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
            padding:"9px 12px max(10px, env(safe-area-inset-bottom))",
            display:"flex", alignItems:"center", gap:7,
          }}>
            {[
              { key:"editor",   label:"Editor",   icon:"⟨/⟩", badge:null,                    disabled:false },
              { key:"analysis", label:"Analysis",  icon:"◎",   badge:analysis?.total_issues,  disabled:false },
              { key:"slides",   label:"Slides",    icon:"▣",   badge:null,                    disabled:!analysis },
            ].map(({ key, label, icon, badge, disabled }) => (
              <button key={key} onClick={() => !disabled && setMobilePanel(key)} style={{
                flex:1, padding:"7px 4px", borderRadius:13, border:"1px solid",
                borderColor: mobilePanel === key ? "rgba(0,212,255,0.3)" : "rgba(255,255,255,0.06)",
                background: mobilePanel === key
                  ? "linear-gradient(135deg,rgba(0,212,255,0.14),rgba(139,92,246,0.1))"
                  : "rgba(255,255,255,0.025)",
                cursor: disabled ? "default" : "pointer",
                display:"flex", flexDirection:"column", alignItems:"center", gap:3,
                opacity: disabled ? 0.3 : 1, transition:"all 0.2s ease",
                backdropFilter:"blur(16px)", position:"relative",
                boxShadow: mobilePanel === key ? `inset 0 1px 0 rgba(0,212,255,0.15), 0 0 15px rgba(0,212,255,0.08)` : "none",
              }}>
                <span style={{ fontSize:13, filter: mobilePanel === key ? `drop-shadow(0 0 8px ${T.cyan})` : "none", transition:"filter 0.2s" }}>{icon}</span>
                <span style={{ fontSize:9, fontWeight:700, color: mobilePanel === key ? T.cyan : "rgba(255,255,255,0.25)",
                  fontFamily:"'JetBrains Mono',monospace", letterSpacing:0.5 }}>{label}</span>
                {badge > 0 && (
                  <span style={{ position:"absolute", top:3, right:5, background:T.pink, color:"#fff",
                    fontSize:8, fontWeight:800, padding:"1px 4px", borderRadius:6,
                    fontFamily:"'JetBrains Mono',monospace", boxShadow:`0 0 8px ${T.pink}80` }}>{badge}</span>
                )}
              </button>
            ))}

            {isSignedIn ? (
              <button className="analyze-btn" onClick={handleAnalyze} disabled={loading || !code.trim()} style={{
                flex:1.7, padding:"9px 6px", borderRadius:14, border:"none",
                cursor: loading ? "wait" : "pointer",
                background: loading ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#00D4FF 0%,#7C3AED 100%)",
                color: loading ? "rgba(255,255,255,0.25)" : "#fff",
                fontSize:12, fontWeight:800, fontFamily:"'Outfit',sans-serif",
                animation: !loading ? "glowBtn 3s ease-in-out infinite" : "none",
                transition:"all 0.2s",
                boxShadow: loading ? "none" : "0 4px 0 rgba(0,0,0,0.3),0 4px 18px rgba(0,212,255,0.3)",
              }}>{loading ? "Scanning..." : "Analyze →"}</button>
            ) : (
              <button onClick={() => setShowAuthModal(true)} style={{
                flex:1.7, padding:"9px 6px", borderRadius:14,
                border:"1px solid rgba(0,212,255,0.28)", cursor:"pointer",
                background:"rgba(0,212,255,0.07)", backdropFilter:"blur(16px)",
                color:T.cyan, fontSize:12, fontWeight:700, fontFamily:"'Outfit',sans-serif",
                transition:"all 0.2s",
              }}>Sign In →</button>
            )}

            <label style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, cursor:"pointer", padding:"4px 2px" }}>
              <input type="checkbox" checked={useMock} onChange={e => setUseMock(e.target.checked)}
                style={{ accentColor:T.cyan, width:15, height:15 }}/>
              <span style={{ fontSize:8, color:"rgba(255,255,255,0.15)", fontFamily:"'JetBrains Mono',monospace" }}>demo</span>
            </label>
          </div>
        )}

        {/* ── Auth Modal ─────────────────────────────────────── */}
        {showAuthModal && (
          <SignInModal
            onGoogle={() => { googleLogin(); setShowAuthModal(false); }}
            onGitHub={() => { setShowAuthModal(false); handleGitHubLogin(); }}
            onClose={() => setShowAuthModal(false)}
          />
        )}

        {/* ── Error Toast ────────────────────────────────────── */}
        {error && (
          <div style={{
            position:"fixed", bottom: isMobile ? BOTTOM_BAR + 14 : 24, left:"50%", transform:"translateX(-50%)",
            background:"rgba(5,10,22,0.95)", border:"1px solid rgba(245,158,11,0.25)",
            borderRadius:18, padding:"12px 18px", maxWidth: isMobile ? "calc(100vw - 28px)" : 480,
            backdropFilter:"blur(40px)", WebkitBackdropFilter:"blur(40px)",
            animation:"fadeUp 0.3s ease", zIndex:999,
            display:"flex", alignItems:"center", gap:12,
            boxShadow:"0 12px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(245,158,11,0.1)",
          }}>
            <span style={{ color:T.amber, fontSize:16, flexShrink:0 }}>⚠</span>
            <p style={{ fontSize:12, color:T.amber, margin:0, flex:1, lineHeight:1.5 }}>{error}</p>
            <button onClick={() => setError(null)} style={{ background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.15)", borderRadius:8, color:"rgba(245,158,11,0.5)", cursor:"pointer", fontSize:16, lineHeight:1, padding:"2px 8px", flexShrink:0, transition:"all 0.2s" }}>×</button>
          </div>
        )}

        {/* ── Footer (non-analyze pages) ─────────────────────── */}
        {activePage !== "analyze" && (
          <footer style={{
            flexShrink:0, position:"relative", zIndex:10,
            background:"rgba(2,5,14,0.92)",
            backdropFilter:"blur(40px) saturate(180%)",
            borderTop:"1px solid rgba(255,255,255,0.06)",
            padding:isMobile ? "32px 20px 24px" : "48px 64px 28px",
          }}>
            <div style={{ maxWidth:1100, margin:"0 auto" }}>
              {/* Top row */}
              <div style={{ display:"grid", gridTemplateColumns:isMobile ? "1fr" : "2fr 1fr 1fr 1fr", gap:isMobile ? 32 : 48, marginBottom:40 }}>
                {/* Brand column */}
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,rgba(0,212,255,0.15),rgba(139,92,246,0.15))", border:"1px solid rgba(0,212,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <span style={{ fontSize:14, fontWeight:900, background:"linear-gradient(135deg,#00D4FF,#8B5CF6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>⟨/⟩</span>
                    </div>
                    <span style={{ fontSize:18, fontWeight:900, fontFamily:"'Outfit',sans-serif", background:"linear-gradient(135deg,#00D4FF,#8B5CF6,#FF2D78)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>CodeLens</span>
                  </div>
                  <p style={{ fontSize:12, color:"rgba(255,255,255,0.28)", lineHeight:1.85, maxWidth:280, marginBottom:18 }}>Predictive code intelligence powered by AI. Detect vulnerabilities, bugs, and performance issues before they reach production.</p>
                  <div style={{ display:"flex", gap:10 }}>
                    {[
                      { label:"GitHub", href:"https://github.com/Kamaumbugua-dev" },
                      { label:"Email",  href:"mailto:axonlattice@gmail.com" },
                    ].map(({ label, href }) => (
                      <a key={label} href={href} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"rgba(255,255,255,0.3)", textDecoration:"none", padding:"5px 12px", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)", transition:"all 0.2s", fontFamily:"'JetBrains Mono',monospace" }}
                        onMouseEnter={e => { e.currentTarget.style.color=T.cyan; e.currentTarget.style.borderColor="rgba(0,212,255,0.3)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color="rgba(255,255,255,0.3)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.08)"; }}>{label}</a>
                    ))}
                  </div>
                </div>

                {/* Product links */}
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:2.5, marginBottom:16, textTransform:"uppercase" }}>Product</div>
                  {[
                    { label:"Analyze Code", page:"analyze" },
                    { label:"History",      page:"history" },
                    { label:"Services",     page:"services" },
                    { label:"FAQ",          page:"faq" },
                  ].map(({ label, page }) => (
                    <button key={page} onClick={() => setActivePage(page)} style={{ display:"block", background:"none", border:"none", cursor:"pointer", fontSize:13, color:"rgba(255,255,255,0.35)", fontFamily:"'Space Grotesk',sans-serif", padding:"5px 0", textAlign:"left", transition:"color 0.2s" }}
                      onMouseEnter={e => e.currentTarget.style.color="#fff"}
                      onMouseLeave={e => e.currentTarget.style.color="rgba(255,255,255,0.35)"}>{label}</button>
                  ))}
                </div>

                {/* Company links */}
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:2.5, marginBottom:16, textTransform:"uppercase" }}>Company</div>
                  {[
                    { label:"About Us",  page:"about" },
                    { label:"Contact",   page:"contact" },
                  ].map(({ label, page }) => (
                    <button key={page} onClick={() => setActivePage(page)} style={{ display:"block", background:"none", border:"none", cursor:"pointer", fontSize:13, color:"rgba(255,255,255,0.35)", fontFamily:"'Space Grotesk',sans-serif", padding:"5px 0", textAlign:"left", transition:"color 0.2s" }}
                      onMouseEnter={e => e.currentTarget.style.color="#fff"}
                      onMouseLeave={e => e.currentTarget.style.color="rgba(255,255,255,0.35)"}>{label}</button>
                  ))}
                </div>

                {/* Status / info */}
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"'JetBrains Mono',monospace", letterSpacing:2.5, marginBottom:16, textTransform:"uppercase" }}>Status</div>
                  <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:10 }}>
                    <span style={{ width:7, height:7, borderRadius:"50%", background:T.emerald, boxShadow:`0 0 8px ${T.emerald}`, display:"inline-block", animation:"pulse 2s ease-in-out infinite" }}/>
                    <span style={{ fontSize:12, color:T.emerald, fontFamily:"'JetBrains Mono',monospace" }}>All systems operational</span>
                  </div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:"'JetBrains Mono',monospace", lineHeight:1.9 }}>
                    <div>API: Render (free tier)</div>
                    <div>Frontend: Vercel</div>
                    <div>LLM: Groq · Llama 3.3 70B</div>
                    <div>Auth: GitHub · Google OAuth</div>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div style={{ height:1, background:"rgba(255,255,255,0.05)", marginBottom:22 }}/>

              {/* Bottom row */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
                <span style={{ fontSize:11, color:"rgba(255,255,255,0.15)", fontFamily:"'JetBrains Mono',monospace" }}>
                  © {new Date().getFullYear()} Axon Lattice Labs™ · CodeLens v2.0 · All rights reserved
                </span>
                <div style={{ display:"flex", gap:20 }}>
                  {["Privacy Policy","Terms of Service"].map(t => (
                    <span key={t} style={{ fontSize:11, color:"rgba(255,255,255,0.15)", fontFamily:"'JetBrains Mono',monospace", cursor:"default" }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </footer>
        )}
      </div>
    </>
  );
}
