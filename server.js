// Vanilla Node http server — MySQL + file fallback
const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");
const os = require("os");
const crypto = require("crypto");
let bcrypt = null;
let jwt = null;
try { bcrypt = require("bcryptjs"); } catch (e) { console.warn("bcryptjs not installed, auth will fallback"); }
try { jwt = require("jsonwebtoken"); } catch (e) { console.warn("jsonwebtoken not installed, auth will fallback"); }

// load .env if present (no dotenv dep)
(() => {
  try {
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      });
    }
  } catch {}
})();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const QUESTIONS_DIR = path.join(ROOT, "questions");
let db = null;
try { db = require("./db"); } catch { db = null; }
let dbReady = false;
let useDb = !!db;
let cache = { questions: null, questionsTs: 0, leaderboard: new Map() };
// ---------- lint guards: single-flight + cache + rate limit (OOM fix for /api/lint) ----------
const lintStats = { total: 0, cacheHits: 0, rateLimited: 0, execRejected: 0 };
let lintInflightCpp = 0; // max 1 concurrent g++ lint process
let lastLintEnd = 0; // last finished g++ lint; keeps lazy PCH builds out of active typing windows
const lintCache = new Map(); // sha256(code+language) -> { diagnostics, ts }
const LINT_CACHE_TTL_MS = 60 * 1000;
const LINT_CACHE_MAX = parseInt(process.env.LINT_CACHE_MAX || "100", 10) || 100;
const lintRate = new Map(); // ip -> lastAcceptedMs
const LINT_MIN_GAP_MS = 1200;
// ---------- global execution gate (free-tier OOM fix: max 1 g++ at a time) ----------
const EXEC_MAX_CPP = parseInt(process.env.EXEC_MAX_CPP || "1", 10) || 1;
const EXEC_MAX_PYTHON = parseInt(process.env.EXEC_MAX_PYTHON || "2", 10) || 2;
const EXEC_MAX_TOTAL = parseInt(process.env.EXEC_MAX_TOTAL || "3", 10) || 3;
let execInflightCpp = 0, execInflightPython = 0, execInflightTotal = 0;
let lastExecEnd = 0; // updated on every gate release; gates lazy PCH builds to idle windows
const DISABLE_CPP = process.env.DISABLE_CPP === "1";
const ENABLE_PCH = process.env.ENABLE_PCH === "1";
const MAX_BODY_BYTES = 60000;
const MAX_CHILD_BYTES = 65536; // cap stdout/stderr buffering per child process
function execTryAcquire(kind) {
  if (execInflightTotal >= EXEC_MAX_TOTAL) return false;
  if (kind === "cpp" && execInflightCpp >= EXEC_MAX_CPP) return false;
  if (kind === "python" && execInflightPython >= EXEC_MAX_PYTHON) return false;
  execInflightTotal++;
  if (kind === "cpp") execInflightCpp++;
  if (kind === "python") execInflightPython++;
  return true;
}
function execRelease(kind) {
  execInflightTotal = Math.max(0, execInflightTotal - 1);
  if (kind === "cpp") execInflightCpp = Math.max(0, execInflightCpp - 1);
  if (kind === "python") execInflightPython = Math.max(0, execInflightPython - 1);
  lastExecEnd = Date.now();
}
// Sweep stale rate-limit entries so per-IP maps can't grow forever (slow leak/DoS).
setInterval(() => {
  try {
    const now = Date.now();
    for (const [m, ttl] of [[lintRate, LINT_MIN_GAP_MS * 10], [compRate, COMP_MIN_GAP_MS * 2], [genRate, GEN_MIN_GAP_MS * 2]]) {
      if (m.size > 1000) {
        for (const [k, v] of m) { if (now - v > ttl) m.delete(k); if (m.size <= 1000) break; }
      } else {
        for (const [k, v] of m) if (now - v > ttl) m.delete(k);
      }
    }
    if (cache.leaderboard.size > 100) cache.leaderboard.clear();
  } catch {}
}, 60000).unref();
// Per-question detail cache (avoids re-read + re-parse of all files per execute).
// TTL is generous (questions change rarely; persistQuestion invalidates on write).
const questionCache = new Map(); // id -> { q, ts }
const QUESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const QUESTION_CACHE_MAX = 100;
function questionCacheGet(id) {
  const e = questionCache.get(id);
  if (!e) return null;
  if (Date.now() - e.ts > QUESTION_CACHE_TTL_MS) { try { questionCache.delete(id); } catch {} return null; }
  return e.q;
}
function questionCacheSet(id, q) {
  try {
    if (!questionCache.has(id) && questionCache.size >= QUESTION_CACHE_MAX) {
      const oldest = questionCache.keys().next().value;
      if (oldest !== undefined) questionCache.delete(oldest);
    }
    questionCache.set(id, { q, ts: Date.now() });
  } catch {}
}
// Bounded C++ exe cache: max N exes + TTL eviction (old code never deleted).
const EXE_CACHE_MAX = parseInt(process.env.EXE_CACHE_MAX || "20", 10) || 20;
const EXE_CACHE_TTL_MS = 10 * 60 * 1000;
function exeCacheDir() {
  const d = path.join(os.tmpdir(), "dsa_cache");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
// ---------- lazy PCH: precompiled bits/stdc++.h for ALL g++ invocations ----------
// Built once in the background (never at boot, so no startup RAM spike), holding
// the cpp gate slot so it can never run concurrently with a user compile (OOM-safe).
// Every compile site appends pchCompileArgs(); when no .gch exists it is just [].
function pchPath() {
  return path.join(os.tmpdir(), "dsa_pch_v2", "bits", "stdc++.h.gch");
}
function pchDir() {
  return path.join(os.tmpdir(), "dsa_pch_v2");
}
function pchExists() {
  try { return fs.existsSync(pchPath()); } catch { return false; }
}
function pchCompileArgs() {
  // GCC has no -include-pch (that's Clang-only and fatals with
  // "-pch: No such file or directory"). The correct GCC mechanism is
  // -I <dir-containing-bits/>: #include <bits/stdc++.h> then finds the
  // .gch first and memory-maps it instead of re-parsing the STL.
  if (!ENABLE_PCH || !pchExists()) return [];
  try { return ["-I", pchDir()]; } catch { return []; }
}
let pchBuilding = false;
function maybeBuildPch() {
  // Self-throttling: only when enabled, missing, idle (>30s since last exec/lint g++),
  // and no g++ currently running. Safe to call from any cpp entry point.
  if (!ENABLE_PCH || pchBuilding || pchExists()) return;
  if (execInflightTotal !== 0 || lintInflightCpp !== 0) return;
  if (Date.now() - lastExecEnd < 30000) return;
  if (Date.now() - lastLintEnd < 30000) return;
  pchBuilding = true;
  if (!execTryAcquire("cpp")) { pchBuilding = false; return; }
  (async () => {
    try {
      const { ensureBitsPch } = require("./server/utils/lint");
      const p = await ensureBitsPch(ROOT);
      if (p) console.log("PCH ready (lazy):", p);
      else console.warn("lazy PCH build produced nothing (continuing without PCH)");
    } catch (e) {
      console.warn("lazy PCH build skipped:", (e && e.message) || e);
    } finally {
      execRelease("cpp");
      pchBuilding = false;
    }
  })();
}
function exeCachePrune() {
  try {
    const d = path.join(os.tmpdir(), "dsa_cache");
    if (!fs.existsSync(d)) return;
    const files = fs.readdirSync(d).map(f => {
      const fp = path.join(d, f);
      try { return { fp, mt: fs.statSync(fp).mtimeMs }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => a.mt - b.mt);
    const now = Date.now();
    for (const f of files) {
      if (now - f.mt > EXE_CACHE_TTL_MS) { try { fs.unlinkSync(f.fp); } catch {} }
    }
    const rest = fs.readdirSync(d);
    if (rest.length > EXE_CACHE_MAX) {
      rest.map(f => {
        const fp = path.join(d, f);
        try { return { fp, mt: fs.statSync(fp).mtimeMs }; } catch { return null; }
      }).filter(Boolean).sort((a, b) => a.mt - b.mt)
        .slice(0, rest.length - EXE_CACHE_MAX)
        .forEach(f => { try { fs.unlinkSync(f.fp); } catch {} });
    }
  } catch {}
}
function lintCacheKey(code, language) {
  return crypto.createHash("sha256").update(language + "\0" + code).digest("hex");
}
function lintCacheGet(key) {
  const e = lintCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > LINT_CACHE_TTL_MS) { try { lintCache.delete(key); } catch {} return null; }
  return e.diagnostics;
}
function lintCacheSet(key, diagnostics) {
  try {
    if (!lintCache.has(key) && lintCache.size >= LINT_CACHE_MAX) {
      const oldest = lintCache.keys().next().value;
      if (oldest !== undefined) lintCache.delete(oldest);
    }
    lintCache.set(key, { diagnostics, ts: Date.now() });
  } catch {}
}
// ---------- runtime stats helpers: best-effort per-case memory (null = n/a) ----------
function jsHeapKb(before) {
  try { return Math.max(0, Math.round((process.memoryUsage().heapUsed - before) / 1024)); }
  catch { return null; }
}
// appended to python drivers: prints __PEAK_KB__<n> (Linux/macOS via resource); silent elsewhere
const PY_PEAK_TAIL = `
try:
 import resource,sys
 _dsa_pk=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
 if sys.platform=="darwin": _dsa_pk//=1024
 print("__PEAK_KB__%d"%_dsa_pk)
except Exception:
 pass
`;
function pyPeakKb(stdout) {
  const m = String(stdout || "").match(/__PEAK_KB__(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function pyValueLines(stdout) {
  return String(stdout || "").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("__PEAK_KB__"));
}
function parsePySingle(stdout) {
  const lines = pyValueLines(stdout);
  if (!lines.length) throw new Error("empty python output");
  return { actual: JSON.parse(lines[0]), memKb: pyPeakKb(stdout) };
}
let _hasTimeV = null;
function hasTimeV() {
  if (_hasTimeV === null) { try { _hasTimeV = fs.existsSync("/usr/bin/time"); } catch { _hasTimeV = false; } }
  return _hasTimeV;
}
// run an exe, tracking peak RSS via /usr/bin/time -v when present (Linux); resolves {out, memKb}
// NOTE: stdout/stderr capped at MAX_CHILD_BYTES so a runaway program can't OOM Node.
// Set USE_TIME_V=0 to skip the extra /usr/bin/time fork on low-memory boxes.
function runExeTracked(exe, args, env, timeoutMs, tmsg) {
  return new Promise((resolve, reject) => {
    const useTime = process.env.USE_TIME_V === "0" ? false : hasTimeV();
    const child = useTime
      ? spawn("/usr/bin/time", ["-v", exe, ...(args || [])], { env })
      : spawn(exe, args || [], { env });
    let out = "", err = "", truncated = false;
    const cap = (s, chunk) => {
      if (truncated) return s;
      if (s.length + chunk.length > MAX_CHILD_BYTES) {
        truncated = true;
        try { child.kill(); } catch {}
        return s + chunk.slice(0, Math.max(0, MAX_CHILD_BYTES - s.length));
      }
      return s + chunk;
    };
    child.stdout.on("data", d => { out = cap(out, d.toString()); });
    child.stderr.on("data", d => { err = cap(err, d.toString()); });
    const killTimer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error(tmsg || "Time Limit Exceeded")); }, timeoutMs || 3500);
    child.on("close", c => {
      clearTimeout(killTimer);
      if (c !== 0) return reject(new Error(err.trim() || `exit ${c}`));
      let memKb = null;
      if (useTime) {
        const m = err.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
        if (m) memKb = parseInt(m[1], 10);
      }
      resolve({ out, memKb });
    });
    child.on("error", e => { clearTimeout(killTimer); reject(new Error("Run error: " + e.message)); });
  });
}
// ---------- AI generation guards: per-user rate limit + single flight ----------
const genRate = new Map(); // userId -> lastAcceptedMs
const GEN_MIN_GAP_MS = 30000;
const genInflight = new Set(); // userIds with a generation running
// ---------- complexity guards: per-IP rate limit + sha cache (mirrors lint) ----------
const compRate = new Map(); // ip -> lastAcceptedMs
const COMP_MIN_GAP_MS = 60000;
const compCache = new Map(); // sha256(question+lang+code) -> { est, ts }
const COMP_CACHE_TTL_MS = 3600 * 1000;
const COMP_CACHE_MAX = parseInt(process.env.COMP_CACHE_MAX || "50", 10) || 50;
function compCacheGet(key) {
  const e = compCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > COMP_CACHE_TTL_MS) { try { compCache.delete(key); } catch {} return null; }
  return e.est;
}
function compCacheSet(key, est) {
  try {
    if (!compCache.has(key) && compCache.size >= COMP_CACHE_MAX) {
      const oldest = compCache.keys().next().value;
      if (oldest !== undefined) compCache.delete(oldest);
    }
    compCache.set(key, { est, ts: Date.now() });
  } catch {}
}
async function ensureDb() {
  if (!useDb || dbReady) return dbReady;
  try {
    await db.initDb();
    await db.migrateFromFiles(QUESTIONS_DIR);
    dbReady = true;
    console.log("DB: connected to", process.env.DB_HOST, "— using MySQL");
  } catch (e) {
    console.warn("DB: init failed, falling back to files:", e.message);
    useDb = false;
  }
  return dbReady;
}

// ---------- auth helpers ----------
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
function hashPassword(password) {
  if (!bcrypt) throw new Error("bcryptjs not available");
  return bcrypt.hashSync(password, 10);
}
function verifyPassword(password, hash) {
  if (!bcrypt) throw new Error("bcryptjs not available");
  return bcrypt.compareSync(password, hash);
}
function signToken(payload) {
  if (!jwt) throw new Error("jsonwebtoken not available");
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
function verifyToken(token) {
  if (!jwt) throw new Error("jsonwebtoken not available");
  return jwt.verify(token, JWT_SECRET);
}
function authenticate(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  if (!h || !h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (!token) return null;
  try {
    const decoded = verifyToken(token);
    req.user = { id: decoded.id, username: decoded.username, role: decoded.role };
    return req.user;
  } catch (e) {
    return null;
  }
}
function tryAuthenticate(req) {
  // optional auth: attach user if token present, else leave null (for backward compat scoping)
  const u = authenticate(req);
  if (u) req.user = u;
  else req.user = null;
  return req.user;
}
function requireAuth(req, res) {
  const u = authenticate(req);
  if (!u) {
    sendJson(res, { error: "Unauthorized" }, 401);
    return null;
  }
  return u;
}

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".txt": "text/plain",
  ".ico": "image/x-icon",
};

// ---------- question loader ----------
function loadQuestionsSync() {
  const files = fs.readdirSync(QUESTIONS_DIR).filter(f => f.endsWith(".json") && !f.startsWith("_"));
  const questions = [];
  for (const file of files) {
    try {
      const full = path.join(QUESTIONS_DIR, file);
      const raw = fs.readFileSync(full, "utf8");
      const q = JSON.parse(raw);
      if (!q.id || !q.title || !q.functionName || !q.params || !q.visibleTestCases) {
        console.warn(`Skipping ${file}: missing required fields`);
        continue;
      }
      const stat = fs.statSync(full);
      q._createdAt = q.createdAt ? new Date(q.createdAt).getTime() : stat.mtimeMs;
      q._file = file;
      questions.push(q);
    } catch (e) {
      console.warn(`Failed to load ${file}: ${e.message}`);
    }
  }
  return questions;
}
async function loadQuestions() {
  if (useDb) {
    await ensureDb();
    if (dbReady) {
      const dbQs = await db.dbLoadQuestions();
      if (dbQs && dbQs.length >= 0) return dbQs;
    }
  }
  return loadQuestionsSync();
}
async function getQuestionById(id) {
  const cached = questionCacheGet(id);
  if (cached) return cached;
  let q = null;
  if (useDb) {
    await ensureDb();
    if (dbReady) {
      q = await db.dbGetQuestion(id);
      if (q) { questionCacheSet(id, q); return q; }
    }
  }
  q = loadQuestionsSync().find(x => x.id === id) || null;
  if (q) questionCacheSet(id, q);
  return q;
}

// ---------- shared question validation + persistence (used by manual + AI add) ----------
function validateQuestionPayload(q) {
  const errs = [];
  if (!q.id || !/^[a-z0-9-]+$/.test(q.id)) errs.push("id must match ^[a-z0-9-]+$");
  if (!q.title) errs.push("title required");
  if (!["Easy","Medium","Hard"].includes(q.difficulty)) errs.push("difficulty must be Easy/Medium/Hard");
  if (!q.problemStatement) errs.push("problemStatement required");
  if (!Array.isArray(q.examples) || q.examples.length===0) errs.push("examples must be a non-empty array");
  if (!q.functionName) errs.push("functionName required");
  if (!Array.isArray(q.params) || q.params.length===0) errs.push("params required");
  if (!q.starterCode || !q.starterCode.javascript) errs.push("starterCode.javascript required");
  if (!Array.isArray(q.visibleTestCases) || q.visibleTestCases.length===0) errs.push("visibleTestCases must be a non-empty array");
  if (!Array.isArray(q.hiddenTestCases) || q.hiddenTestCases.length===0) errs.push("hiddenTestCases must be a non-empty array");
  return errs;
}
function validateTestCaseInputs(cases, params) {
  for (const tc of cases) {
    if (!tc || !tc.input) return `test case ${tc && tc.id} missing input`;
    for (const p of params) if (!(p in tc.input)) return `test case ${tc.id}: missing param "${p}"`;
  }
  return null;
}
async function persistQuestion(q, u) {
  // throws Error with .status on duplicate; saves to DB (+file backup) and invalidates caches
  if (!q.createdAt) q.createdAt = new Date().toISOString();
  q.updatedAt = new Date().toISOString();
  let savedToDb = false;
  if (useDb) {
    await ensureDb();
    if (dbReady) {
      try {
        await db.dbCreateQuestion(q, u.id, u.username);
        savedToDb = true;
        console.log(`DB: Created ${q.id} by ${u.username}`);
      } catch (e) {
        if (String(e.message).includes("Duplicate")) {
          const err = new Error(`Question id "${q.id}" already exists.`);
          err.status = 409;
          throw err;
        }
        console.warn("DB save failed, falling back to file:", e.message);
      }
    }
  }
  q.addedBy = u.id;
  q.addedByUsername = u.username;
  const filePath = path.join(QUESTIONS_DIR, `${q.id}.json`);
  if (!savedToDb && fs.existsSync(filePath)) {
    const err = new Error(`Question id "${q.id}" already exists (${q.id}.json). Use different id or delete old file.`);
    err.status = 409;
    throw err;
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(q, null, 2), "utf8");
    console.log(`Created ${filePath}`);
  }
  cache.questions = null; // invalidate
  try { questionCache.delete(q.id); } catch {}
  cache.leaderboard.clear();
  return { savedToDb };
}

function deepEqual(a, b, qId) {
  if (a === b) return true;
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (qId === "two-sum" && a.every(x=>typeof x==="number")) {
      const sa = [...a].sort((x,y)=>x-y);
      const sb = [...b].sort((x,y)=>x-y);
      return sa.every((v,i)=>v===sb[i]);
    }
    return a.every((v,i)=>deepEqual(v,b[i], qId));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k], qId));
  }
  return false;
}

// ---------- runners ----------
function runJS(code, question, input, expectedOutput) {
  const fnName = question.functionName;
  const params = question.params;
  const args = params.map(p => JSON.stringify(input[p]));
  const isComposite = expectedOutput && typeof expectedOutput === "object" && !Array.isArray(expectedOutput) && ("k" in expectedOutput);
  const needsMutationFallback = question.id === "reverse-string" || question.id === "move-zeroes" || isComposite;
  let scriptCode;
  if (isComposite) {
    const mutatedParam = params[0];
    scriptCode = `
      ${code}
      let _args = [${args.join(",")}];
      let _ret = ${fnName}.apply(null, _args);
      let _actual = { k: _ret, ${mutatedParam}: _args[0] };
      _actual;
    `;
  } else if (needsMutationFallback) {
    scriptCode = `
      ${code}
      let _args = [${args.join(",")}];
      let _ret = ${fnName}.apply(null, _args);
      if (_ret === undefined) _ret = _args[0];
      _ret;
    `;
  } else {
    scriptCode = `
      ${code}
      ; ${fnName}.apply(null, [${args.join(",")}])
    `;
  }
  const context = vm.createContext({});
  const script = new vm.Script(scriptCode);
  const result = script.runInContext(context, { timeout: 2000 });
  return result;
}

function runPython(code, question, input, expectedOutput) {
  return new Promise((resolve, reject) => {
    const fnName = question.pythonFunctionName || question.functionName;
    const params = question.params;
    const tmpFile = path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    const inputArgs = params.map(p => JSON.stringify(input[p])).join(", ");
    const isComposite = expectedOutput && typeof expectedOutput === "object" && !Array.isArray(expectedOutput) && ("k" in expectedOutput);
    const isReverse = question.id === "reverse-string";
    let driver;
    if (isComposite) {
      driver = `
import json
_ret = ${fnName}(${inputArgs})
_actual = {"k": _ret, "${params[0]}": ${params[0]}}
print(json.dumps(_actual))
`;
    } else if (isReverse) {
      driver = `
import json
_ret = ${fnName}(${inputArgs})
if _ret is None:
    _ret = ${params[0]}
print(json.dumps(_ret))
`;
    } else {
      driver = `
import json
_ret = ${fnName}(${inputArgs})
print(json.dumps(_ret))
`;
    }
    const fileContent = code + "\n" + driver + PY_PEAK_TAIL;
    fs.writeFileSync(tmpFile, fileContent, "utf8");
    const py = spawn("python", [tmpFile], { timeout: 3000 });
    let stdout = "", stderr = "";
    py.stdout.on("data", d => stdout += d);
    py.stderr.on("data", d => stderr += d);
    py.on("error", (err) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err.code === "ENOENT") {
        const py3 = spawn("python3", [tmpFile], { timeout: 3000 });
        let s2="", e2="";
        py3.stdout.on("data", d=>s2+=d);
        py3.stderr.on("data", d=>e2+=d);
        py3.on("close", (code2) => {
          try { fs.unlinkSync(tmpFile); } catch {}
          if (code2 !== 0) return reject(new Error(e2 || `python3 exit ${code2}`));
          try { resolve(parsePySingle(s2)); } catch(parseErr){ reject(new Error("Invalid python output: "+s2)) }
        });
        py3.on("error", (e3)=> reject(new Error("python not found: install python3 and ensure 'python' or 'python3' in PATH")));
      } else {
        reject(err);
      }
    });
    py.on("close", (code) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `python exit ${code}`));
      }
      try {
        resolve(parsePySingle(stdout));
      } catch (e) {
        reject(new Error("Invalid python output: " + stdout + " err: " + e.message));
      }
    });
    setTimeout(() => {
      try { py.kill(); } catch {}
      reject(new Error("Time Limit Exceeded (python >3s)"));
    }, 3500);
  });
}

// ---------- C++ runner ----------
function jsonToCppLiteral(val) {
  if (typeof val === "number") {
    return Number.isInteger(val) ? String(val) : String(val);
  }
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "string") return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  if (Array.isArray(val)) {
    if (val.length === 0) return "{}";
    const first = val[0];
    if (typeof first === "number") return "{" + val.join(",") + "}";
    if (typeof first === "string") {
      const allSingle = val.every(s => typeof s === "string" && s.length === 1);
      if (allSingle) return "{" + val.map(s => "'" + s.replace(/'/g, "\\'") + "'").join(",") + "}";
      return "{" + val.map(s => '"' + String(s).replace(/"/g, '\\"') + '"').join(",") + "}";
    }
    if (typeof first === "boolean") return "{" + val.map(b => b ? "true" : "false").join(",") + "}";
    if (Array.isArray(first)) return "{" + val.map(v => jsonToCppLiteral(v)).join(",") + "}";
  }
  if (val === null) return "0";
  return "0";
}
function cppTypeFor(val) {
  if (typeof val === "number") return Number.isInteger(val) ? "int" : "double";
  if (typeof val === "boolean") return "bool";
  if (typeof val === "string") return "string";
  if (Array.isArray(val)) {
    if (val.length === 0) return "vector<int>";
    const f = val[0];
    if (typeof f === "number") return "vector<int>";
    if (typeof f === "string") return f.length === 1 ? "vector<char>" : "vector<string>";
    if (typeof f === "boolean") return "vector<bool>";
    if (Array.isArray(f)) return "vector<" + cppTypeFor(f) + ">";
  }
  return "auto";
}
function runCpp(code, question, input, expectedOutput) {
  return new Promise((resolve, reject) => {
    const fnName = question.cppFunctionName || question.functionName;
    const params = question.params;
    const isReverse = question.id === "reverse-string";
    const isComposite = expectedOutput && typeof expectedOutput === "object" && !Array.isArray(expectedOutput) && ("k" in expectedOutput);
    const decls = params.map(p => {
      const v = input[p];
      const type = cppTypeFor(v);
      const lit = jsonToCppLiteral(v);
      return `${type} ${p} = ${lit};`;
    }).join("\n  ");
    const callArgs = params.join(", ");
    const tmpCpp = path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.cpp`);
    const exe = tmpCpp.replace(/\.cpp$/, os.platform() === "win32" ? ".exe" : ".out");
    const hasInclude = code.includes("#include");
    const header = hasInclude ? "" : '#include <bits/stdc++.h>\nusing namespace std;\n';
    const printHelpers = `
template<typename T> void printJsonVal(const T& v);
void printJsonVal(int v){ cout << v; }
void printJsonVal(double v){ cout << v; }
void printJsonVal(bool v){ cout << (v?"true":"false"); }
void printJsonVal(const string& v){ cout << '"' << v << '"'; }
void printJsonVal(char v){ cout << '"' << v << '"'; }
template<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }
`;
    const isInPlaceVoid = isReverse || question.id === "move-zeroes" || question.id === "move-zero";
    let driver;
    if (isComposite) {
      driver = `
int main(){
  ${decls}
  int _k = ${fnName}(${callArgs});
  cout << "{\\"k\\":" << _k << ",\\"${params[0]}\\":";
  printJsonVal(${params[0]});
  cout << "}" << endl;
  return 0;
}
`;
    } else if (isInPlaceVoid) {
      driver = `
int main(){
  ${decls}
  ${fnName}(${callArgs});
  printJsonVal(${params[0]});
  cout << endl;
  return 0;
}
`;
    } else {
      driver = `
int main(){
  ${decls}
  auto _ret = ${fnName}(${callArgs});
  printJsonVal(_ret);
  cout << endl;
  return 0;
}
`;
    }
    const fileContent = header + "\n" + code + "\n" + printHelpers + "\n" + driver;
    fs.writeFileSync(tmpCpp, fileContent, "utf8");
    const localGpps = [
      path.join(ROOT, "tools", "mingw64", "bin", "g++.exe"),
      path.join(ROOT, "tools", "w64devkit", "bin", "g++.exe"),
      path.join(ROOT, "tools", "gcc", "bin", "g++.exe"),
      "C:\\mingw64\\bin\\g++.exe",
      "C:\\tools\\mingw64\\bin\\g++.exe",
      "C:\\tools\\w64devkit\\bin\\g++.exe",
    ];
    let compiler = "g++";
    for (const p of localGpps) if (fs.existsSync(p)) { compiler = p; break; }
    // Low-memory flags: -O0 uses far less RAM than -O2; -s strips symbols (smaller exe).
    const compile = spawn(compiler, ["-std=c++17", "-O0", "-s", ...pchCompileArgs(), tmpCpp, "-o", exe]);
    let cErr = "";
    compile.stderr.on("data", d => { if (cErr.length < MAX_CHILD_BYTES) cErr += d.toString().slice(0, MAX_CHILD_BYTES - cErr.length); });
    compile.on("error", err => {
      try { fs.unlinkSync(tmpCpp); } catch {}
      if (err.code === "ENOENT") return reject(new Error("g++ not found. No bundled compiler at tools/w64devkit/bin/g++.exe and no system g++. Run setup-cpp.ps1 to bundle it (downloads portable w64devkit into project, no admin/PATH needed) OR install MinGW system-wide: https://code.visualstudio.com/docs/cpp/config-mingw"));
      reject(new Error("Compile spawn error: " + err.message));
    });
    compile.on("close", async cCode => {
      if (cCode !== 0) {
        try { fs.unlinkSync(tmpCpp); } catch {}
        return reject(new Error("Compile Error:\\n" + cErr));
      }
      const binDir = path.dirname(compiler);
      const runEnv = { ...process.env, PATH: binDir + path.delimiter + process.env.PATH };
      let tracked;
      try {
        tracked = await runExeTracked(exe, [], runEnv, 3000, "Time Limit Exceeded (C++ >3s)");
      } catch (e) {
        try { fs.unlinkSync(tmpCpp); } catch {}
        try { fs.unlinkSync(exe); } catch {}
        return reject(e);
      }
      try { fs.unlinkSync(tmpCpp); } catch {}
      try { fs.unlinkSync(exe); } catch {}
      try {
        resolve({ actual: JSON.parse(tracked.out.trim()), memKb: tracked.memKb });
      } catch {
        reject(new Error("Invalid C++ output (not JSON): " + tracked.out.trim()));
      }
    });
  });
}

async function runPythonBatch(code, question, testCases) {
  const fnName = question.pythonFunctionName || question.functionName;
  const tmpFile = path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const isComposite = testCases[0] && testCases[0].expectedOutput && typeof testCases[0].expectedOutput === "object" && !Array.isArray(testCases[0].expectedOutput) && ("k" in testCases[0].expectedOutput);
  const isReverse = question.id === "reverse-string";
  const casesJson = JSON.stringify(testCases.map(tc => ({ input: tc.input, expected: tc.expectedOutput, id: tc.id })));
  let driver;
  if (isComposite) {
    driver = `
import json, sys
cases = json.loads('''${casesJson.replace(/'/g, "\\'")}''')
for tc in cases:
    inp = tc["input"]
    _ret = ${fnName}(**inp)
    _actual = {"k": _ret, "${question.params[0]}": inp["${question.params[0]}"] if "_ret" is not None else inp["${question.params[0]}"]}
    # handle in-place where _ret is k and inp mutated
    if isinstance(inp["${question.params[0]}"], list) and _ret is not None:
        # for removeDuplicates, inp is mutated by call, need to use the same list object
        pass
    print(json.dumps(_actual))
`;
    // Actually for in-place we need to capture mutated list: we passed inp dict, but function may mutate the list object inside inp
    // So we need to keep reference
    driver = `
import json
cases = json.loads('''${casesJson.replace(/'/g, "\\'")}''')
for tc in cases:
    inp = {k: list(v) if isinstance(v, list) else v for k,v in tc["input"].items()}
    _ret = ${fnName}(**inp)
    _actual = {"k": _ret, "${question.params[0]}": inp["${question.params[0]}"]}
    print(json.dumps(_actual))
`;
  } else if (isReverse) {
    driver = `
import json
cases = json.loads('''${casesJson.replace(/'/g, "\\'")}''')
for tc in cases:
    inp = {k: list(v) if isinstance(v, list) else v for k,v in tc["input"].items()}
    _ret = ${fnName}(**inp)
    if _ret is None:
        _ret = inp["${question.params[0]}"]
    print(json.dumps(_ret))
`;
  } else {
    driver = `
import json
cases = json.loads('''${casesJson.replace(/'/g, "\\'")}''')
for tc in cases:
    _ret = ${fnName}(**tc["input"])
    print(json.dumps(_ret))
`;
  }
  const fileContent = code + "\n" + driver + PY_PEAK_TAIL;
  fs.writeFileSync(tmpFile, fileContent, "utf8");
  return new Promise((resolve, reject) => {
    const py = spawn("python", [tmpFile], { timeout: 8000 });
    let stdout="", stderr="";
    py.stdout.on("data", d=> stdout+=d); py.stderr.on("data", d=> stderr+=d);
    py.on("error", err => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err.code === "ENOENT") {
        const py3 = spawn("python3", [tmpFile], { timeout: 8000 });
        let s2="", e2=""; py3.stdout.on("data", d=>s2+=d); py3.stderr.on("data", d=>e2+=d);
        py3.on("close", code2 => { try{fs.unlinkSync(tmpFile);}catch{}; if(code2!==0) return reject(new Error(e2||`python3 exit ${code2}`)); try{ resolve({ actuals: pyValueLines(s2).map(l=>JSON.parse(l)), memKb: pyPeakKb(s2) }); }catch{ reject(new Error("Invalid python batch output: "+s2)) }});
        py3.on("error", ()=> reject(new Error("python not found")));
      } else reject(err);
    });
    py.on("close", code => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code!==0) return reject(new Error(stderr.trim()||`python exit ${code}`));
      try { resolve({ actuals: pyValueLines(stdout).map(l=>JSON.parse(l)), memKb: pyPeakKb(stdout) }); } catch(e){ reject(new Error("Invalid python batch output: "+stdout)) }
    });
    setTimeout(()=>{ try{py.kill();}catch{}; reject(new Error("Time Limit Exceeded (python >8s)")); },8500);
  });
}

async function runCppBatch(code, question, testCases) {
  const fnName = question.cppFunctionName || question.functionName;
  const params = question.params;
  const isReverse = question.id === "reverse-string";
  const isComposite = testCases[0] && testCases[0].expectedOutput && typeof testCases[0].expectedOutput === "object" && !Array.isArray(testCases[0].expectedOutput) && ("k" in testCases[0].expectedOutput);
  const isInPlaceVoid = isReverse || question.id === "move-zeroes" || question.id === "move-zero";
  // Build batch vectors per param
  const batchDecls = params.map(p => {
    const firstVal = testCases[0].input[p];
    const baseType = cppTypeFor(firstVal);
    const batchType = `vector<${baseType}>`;
    // for vector<int> nums, batch is vector<vector<int>>
    // for int target, batch is vector<int>
    const lits = testCases.map(tc => jsonToCppLiteral(tc.input[p])).join(", ");
    return `${batchType} _batch_${p} = {${lits}};`;
  }).join("\n  ");
  const n = testCases.length;
  const tmpCpp = path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.cpp`);
  const exe = tmpCpp.replace(/\.cpp$/, os.platform()==="win32"?".exe":".out");
  const hasInclude = code.includes("#include");
  const header = hasInclude ? "" : '#include <bits/stdc++.h>\nusing namespace std;\n';
  const printHelpers = `\ntemplate<typename T> void printJsonVal(const T& v);\nvoid printJsonVal(int v){ cout << v; }\nvoid printJsonVal(double v){ cout << v; }\nvoid printJsonVal(bool v){ cout << (v?"true":"false"); }\nvoid printJsonVal(const string& v){ cout << '"' << v << '"'; }\nvoid printJsonVal(char v){ cout << '"' << v << '"'; }\ntemplate<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }\n`;
  let driver;
  if (isComposite) {
    driver = `
int main(){
  ${batchDecls}
  for(int i=0;i<${n};i++){
    auto _k = ${fnName}(_batch_${params[0]}[i]${params.length>1 ? ", " + params.slice(1).map(p=>`_batch_${p}[i]`).join(", ") : ""});
    cout << "{\\"k\\":" << _k << ",\\"${params[0]}\\":";
    printJsonVal(_batch_${params[0]}[i]);
    cout << "}";
    if(i+1<${n}) cout << "\\n";
  }
  cout << endl;
  return 0;
}
`;
  } else if (isInPlaceVoid) {
    driver = `
int main(){
  ${batchDecls}
  for(int i=0;i<${n};i++){
    ${fnName}(_batch_${params[0]}[i]${params.length>1 ? ", " + params.slice(1).map(p=>`_batch_${p}[i]`).join(", ") : ""});
    printJsonVal(_batch_${params[0]}[i]);
    if(i+1<${n}) cout << "\\n";
  }
  cout << endl;
  return 0;
}
`;
  } else {
    // generic with multiple params
    const callArgs = params.map(p=>`_batch_${p}[i]`).join(", ");
    driver = `
int main(){
  ${batchDecls}
  for(int i=0;i<${n};i++){
    auto _ret = ${fnName}(${callArgs});
    printJsonVal(_ret);
    if(i+1<${n}) cout << "\\n";
  }
  cout << endl;
  return 0;
}
`;
  }
  const fileContent = header + "\n" + code + "\n" + printHelpers + "\n" + driver;
  fs.writeFileSync(tmpCpp, fileContent, "utf8");
  const localGpps = [path.join(ROOT,"tools","mingw64","bin","g++.exe"),path.join(ROOT,"tools","w64devkit","bin","g++.exe"),path.join(ROOT,"tools","gcc","bin","g++.exe"),"C:\\mingw64\\bin\\g++.exe","C:\\tools\\mingw64\\bin\\g++.exe","C:\\tools\\w64devkit\\bin\\g++.exe"];
  let compiler="g++"; for(const p of localGpps) if(fs.existsSync(p)){compiler=p;break;}
  return new Promise((resolve, reject) => {
    const compile = spawn(compiler, ["-std=c++17","-O0","-s",...pchCompileArgs(),tmpCpp,"-o",exe]);
    let cErr=""; compile.stderr.on("data",d=>{ if (cErr.length < MAX_CHILD_BYTES) cErr += d.toString().slice(0, MAX_CHILD_BYTES - cErr.length); });
    compile.on("error", err=>{ try{fs.unlinkSync(tmpCpp);}catch{}; if(err.code==="ENOENT") return reject(new Error("g++ not found")); reject(new Error("Compile spawn error: "+err.message)); });
    compile.on("close", async cCode=>{ if(cCode!==0){ try{fs.unlinkSync(tmpCpp);}catch{}; return reject(new Error("Compile Error:\\n"+cErr)); }
      const binDir=path.dirname(compiler); const runEnv={...process.env, PATH: binDir+path.delimiter+process.env.PATH};
      let tracked;
      try { tracked = await runExeTracked(exe, [], runEnv, 8000, "Time Limit Exceeded (C++ >8s)"); }
      catch(e){ try{fs.unlinkSync(tmpCpp);}catch{} try{fs.unlinkSync(exe);}catch{} return reject(e); }
      try{fs.unlinkSync(tmpCpp);}catch{} try{fs.unlinkSync(exe);}catch{};
      try{ resolve({ actuals: tracked.out.trim().split("\n").filter(Boolean).map(l=>JSON.parse(l)), memKb: tracked.memKb }); }catch{ reject(new Error("Invalid C++ batch output (not JSON): "+tracked.out.trim())) } });
    });
}

async function executeQuestion(question, code, language) {
  const testCases = question._testCasesForMode;
  const results = [];
  let passed = 0;
  // batch for cpp/python (compile once), js keep per-case (fast vm)
  if (language === "cpp" && testCases.length > 1) {
    const startAll = Date.now();
    try {
      const { actuals, memKb } = await runCppBatch(code, question, testCases);
      for (let i=0;i<testCases.length;i++) {
        const tc=testCases[i];
        const actual=actuals[i];
        const ok=deepEqual(actual, tc.expectedOutput, question.id);
        if(ok) passed++;
        results.push({testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual, error: null, hidden: !!tc._hidden, timeMs: Math.round((Date.now()-startAll)/testCases.length), memKb});
      }
    } catch (e) {
      const msg=e.message;
      for (const tc of testCases) results.push({testCaseId: tc.id, passed:false, input: tc.input, expected: tc.expectedOutput, actual:null, error: msg, hidden: !!tc._hidden, timeMs: 0, memKb: null});
    }
    return { total: testCases.length, passed, results };
  }
  if (language === "python" && testCases.length > 1) {
    const startAll = Date.now();
    try {
      const { actuals, memKb } = await runPythonBatch(code, question, testCases);
      for (let i=0;i<testCases.length;i++) {
        const tc=testCases[i];
        const actual=actuals[i];
        const ok=deepEqual(actual, tc.expectedOutput, question.id);
        if(ok) passed++;
        results.push({testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual, error: null, hidden: !!tc._hidden, timeMs: Math.round((Date.now()-startAll)/testCases.length), memKb});
      }
    } catch (e) {
      const msg=e.message;
      for (const tc of testCases) results.push({testCaseId: tc.id, passed:false, input: tc.input, expected: tc.expectedOutput, actual:null, error: msg, hidden: !!tc._hidden, timeMs: 0, memKb: null});
    }
    return { total: testCases.length, passed, results };
  }
  for (const tc of testCases) {
    const start = Date.now();
    let actual, error = null, memKb = null;
    let ok = false;
    try {
      if (language === "javascript") {
        const hb = process.memoryUsage().heapUsed;
        actual = runJS(code, question, tc.input, tc.expectedOutput);
        memKb = jsHeapKb(hb);
      } else if (language === "python") {
        ({ actual, memKb } = await runPython(code, question, tc.input, tc.expectedOutput));
      } else if (language === "cpp") {
        ({ actual, memKb } = await runCpp(code, question, tc.input, tc.expectedOutput));
      } else {
        throw new Error(`Unsupported language: ${language}`);
      }
      ok = deepEqual(actual, tc.expectedOutput, question.id);
    } catch (e) {
      error = e.message;
      if (String(e.message).includes("Script execution timed out")) error = "Time Limit Exceeded (JS >2s)";
    }
    if (ok) passed++;
    results.push({
      testCaseId: tc.id,
      passed: ok,
      input: tc.input,
      expected: tc.expectedOutput,
      actual: error ? null : actual,
      error,
      hidden: !!tc._hidden,
      timeMs: Date.now() - start,
      memKb
    });
  }
  return { total: testCases.length, passed, results };
}

// ---------- http helpers ----------
function sendJson(res, obj, status=200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" });
  res.end(body);
}
function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ---------- Health (lint counters + memory) ----------
  if (pathname === "/api/health" && req.method === "GET") {
    const mem = process.memoryUsage();
    return sendJson(res, {
      ok: true,
      heapMB: +(mem.heapUsed / 1048576).toFixed(1),
      rssMB: +(mem.rss / 1048576).toFixed(1),
      uptimeSec: Math.floor(process.uptime()),
      lint: { inflight: lintInflightCpp, total: lintStats.total, cacheHits: lintStats.cacheHits, rateLimited: lintStats.rateLimited },
      exec: { cpp: execInflightCpp, python: execInflightPython, total: execInflightTotal, rejected: lintStats.execRejected, cppDisabled: DISABLE_CPP }
    }, 200);
  }

  // ---------- Auth APIs ----------
  if (pathname === "/api/auth/register" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { username, email, password } = JSON.parse(body || "{}");
        // validation
        if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
          return sendJson(res, { error: "Invalid username: must match ^[a-z0-9_]{3,20}$" }, 400);
        }
        if (email !== undefined && email !== null && String(email).trim() !== "") {
          const em = String(email).trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return sendJson(res, { error: "Invalid email" }, 400);
        }
        if (!password || typeof password !== "string" || password.length < 6) {
          return sendJson(res, { error: "Password must be at least 6 characters" }, 400);
        }
        if (!db) return sendJson(res, { error: "DB not available" }, 500);
        await ensureDb();
        if (!dbReady) return sendJson(res, { error: "DB not ready" }, 500);
        // check existing username
        const existing = await db.findUserByUsername(username);
        if (existing) return sendJson(res, { error: "Username already exists" }, 409);
        if (email) {
          const existingEmail = await db.findUserByEmail(String(email).trim().toLowerCase());
          if (existingEmail) return sendJson(res, { error: "Email already exists" }, 409);
        }
        const hash = hashPassword(password);
        const finalEmail = email && String(email).trim() ? String(email).trim().toLowerCase() : `${username}@placeholder.local`;
        const id = await db.createUser({ username, email: finalEmail, password_hash: hash, role: "user" });
        const user = { id, username, email: finalEmail, role: "user" };
        const token = signToken({ id, username, role: "user" });
        return sendJson(res, { ok: true, token, user }, 201);
      } catch (e) {
        console.error("register error", e);
        if (String(e.message).toLowerCase().includes("duplicate")) return sendJson(res, { error: "Username or email already exists" }, 409);
        return sendJson(res, { error: e.message }, 500);
      }
    });
    return;
  }
  if (pathname === "/api/auth/login" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { username, password } = JSON.parse(body || "{}");
        if (!username || !password) return sendJson(res, { error: "Missing username or password" }, 400);
        if (!db) return sendJson(res, { error: "DB not available" }, 500);
        await ensureDb();
        if (!dbReady) return sendJson(res, { error: "DB not ready" }, 500);
        const userRow = await db.findUserByUsername(username);
        if (!userRow) return sendJson(res, { error: "Invalid credentials" }, 401);
        const ok = verifyPassword(password, userRow.password_hash);
        if (!ok) return sendJson(res, { error: "Invalid credentials" }, 401);
        const user = { id: userRow.id, username: userRow.username, email: userRow.email, role: userRow.role };
        const token = signToken({ id: user.id, username: user.username, role: user.role });
        return sendJson(res, { token, user }, 200);
      } catch (e) {
        console.error("login error", e);
        return sendJson(res, { error: e.message }, 500);
      }
    });
    return;
  }
  if (pathname === "/api/me" && req.method === "GET") {
    const u = requireAuth(req, res);
    if (!u) return;
    try {
      await ensureDb();
      if (dbReady) {
        const row = await db.findUserById(u.id);
        if (!row) return sendJson(res, { error: "User not found" }, 404);
        return sendJson(res, { id: row.id, username: row.username, email: row.email, role: row.role }, 200);
      } else {
        return sendJson(res, u, 200);
      }
    } catch (e) {
      return sendJson(res, { error: e.message }, 500);
    }
  }

  // ---------- Stats / Streaks / Leaderboard APIs ----------
  if (pathname === "/api/questions/solved" && req.method === "GET") {
    tryAuthenticate(req);
    const userId = req.user ? req.user.id : null;
    if (!userId) return sendJson(res, [], 200);
    await ensureDb();
    if (!dbReady || !db.getSolvedIds) return sendJson(res, [], 200);
    try {
      const ids = await db.getSolvedIds(userId);
      return sendJson(res, ids, 200);
    } catch (e) {
      return sendJson(res, { error: e.message }, 500);
    }
  }
  if (pathname === "/api/leaderboard" && req.method === "GET") {
    const filterParam = (url.searchParams.get("filter") || "all").toLowerCase().trim();
    let filter = "all";
    if (["weekly","week","7d","last7"].includes(filterParam)) filter = "weekly";
    else if (["monthly","month","30d","last30"].includes(filterParam)) filter = "monthly";
    else if (filterParam === "all-time" || filterParam === "alltime" || filterParam === "all") filter = "all";
    else filter = filterParam;
    const rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
    const cacheKey = `${filter}:${limit}`;
    const now = Date.now();
    const cached = cache.leaderboard.get(cacheKey);
    if (cached && now - cached.ts < 30000) return sendJson(res, cached.data, 200);
    await ensureDb();
    if (!dbReady || !db.getLeaderboard) return sendJson(res, [], 200);
    try {
      const rows = await db.getLeaderboard(filter, limit);
      cache.leaderboard.set(cacheKey, { data: rows, ts: now });
      return sendJson(res, rows, 200);
    } catch (e) {
      return sendJson(res, { error: e.message }, 500);
    }
  }
  if (pathname.startsWith("/api/users/") && req.method === "GET") {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 4 && (parts[3] === "stats" || parts[3] === "dashboard")) {
      const idPart = decodeURIComponent(parts[2]);
      const action = parts[3];
      tryAuthenticate(req);
      let userId = null;
      if (idPart === "me") {
        if (!req.user) return sendJson(res, { error: "Unauthorized" }, 401);
        userId = req.user.id;
      } else if (/^\d+$/.test(idPart)) {
        userId = parseInt(idPart, 10);
      } else {
        // allow username lookup fallback (optional auth)
        if (req.user) userId = req.user.id;
        else return sendJson(res, { error: "Invalid user id" }, 400);
      }
      await ensureDb();
      if (!dbReady) return sendJson(res, { error: "DB not ready" }, 500);
      try {
        if (action === "stats") {
          const stats = await db.getStats(userId);
          return sendJson(res, stats, 200);
        } else {
          const dash = await db.getUserDashboard(userId);
          return sendJson(res, dash, 200);
        }
      } catch (e) {
        return sendJson(res, { error: e.message }, 500);
      }
    }
  }

  // API — cached 10s for questions
  if (pathname === "/api/questions" && req.method === "GET") {
    const now = Date.now();
    if (cache.questions && now - cache.questionsTs < 10000) {
      return sendJson(res, cache.questions);
    }
    const qs = await loadQuestions();
    qs.sort((a,b)=> (b._createdAt||0) - (a._createdAt||0));
    const summaries = qs.map(q => ({ id: q.id, title: q.title, difficulty: q.difficulty, tags: q.tags || [], createdAt: q.createdAt || new Date(q._createdAt).toISOString(), _createdAt: q._createdAt, addedBy: q.addedBy || null, addedByUsername: q.addedByUsername || null }));
    cache.questions = summaries;
    cache.questionsTs = now;
    return sendJson(res, summaries);
  }
  if (pathname === "/api/questions/stats" && req.method === "GET") {
    try {
      await ensureDb();
      if (!dbReady) return sendJson(res, [], 200);
      const rows = await db.getQuestionStats();
      return sendJson(res, rows, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  // Per-question performance: community + personal aggregates (powers the Performance tab)
  if (pathname.match(/^\/api\/questions\/[^/]+\/perf$/) && req.method === "GET") {
    const parts = pathname.split("/").filter(Boolean);
    const qid = decodeURIComponent(parts[2]);
    try {
      tryAuthenticate(req);
      const userId = req.user ? req.user.id : null;
      await ensureDb();
      if (!dbReady || !db.getQuestionPerf) return sendJson(res, { error: "DB not ready" }, 500);
      const q = await getQuestionById(qid);
      if (!q) return sendJson(res, { error: "Question not found" }, 404);
      const perf = await db.getQuestionPerf(qid, userId);
      return sendJson(res, {
        questionId: qid,
        expectedTime: q.timeComplexity || null,
        expectedSpace: q.spaceComplexity || null,
        overall: perf.overall,
        mine: perf.mine,
      }, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  if (pathname.startsWith("/api/questions/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/questions/".length));
    const q = await getQuestionById(id);
    if (!q) return sendJson(res, { error: "Question not found" }, 404);
    return sendJson(res, q);
  }
  if (pathname === "/api/questions" && req.method === "POST") {
    const u = requireAuth(req, res);
    if (!u) return;
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const q = JSON.parse(body || "{}");
        const errs = validateQuestionPayload(q);
        if (errs.length) return sendJson(res, { error: errs.join("; ") }, 400);
        const bad = validateTestCaseInputs([...q.visibleTestCases, ...q.hiddenTestCases], q.params);
        if (bad) return sendJson(res, { error: bad }, 400);
        await persistQuestion(q, u);
        return sendJson(res, { ok: true, id: q.id }, 201);
      } catch (e) {
        if (e && e.status) return sendJson(res, { error: e.message }, e.status);
        console.error(e);
        return sendJson(res, { error: "Invalid JSON: " + e.message }, 400);
      }
    });
    return;
  }

  // AI models available for question generation
  if (pathname === "/api/generate/models" && req.method === "GET") {
    try {
      const { ALLOWED_MODELS, DEFAULT_MODEL } = require("./server/utils/groq");
      return sendJson(res, {
        models: Object.entries(ALLOWED_MODELS).map(([id, m]) => ({ id, label: m.label })),
        defaultModel: DEFAULT_MODEL,
        keyConfigured: !!process.env.GROQ_API_KEY,
      }, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  // AI question generation: Groq proposes, runJS oracle computes expectedOutputs
  if (pathname === "/api/questions/generate" && req.method === "POST") {
    const u = requireAuth(req, res);
    if (!u) return;
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        let parsed = {};
        try { parsed = JSON.parse(body || "{}"); }
        catch { return sendJson(res, { error: "Invalid JSON body" }, 400); }
        const topic = String(parsed.topic || "").trim();
        const difficulty = parsed.difficulty || "Easy";
        const model = parsed.model || undefined;
        const extraTags = Array.isArray(parsed.tags) ? parsed.tags.filter(t => typeof t === "string").slice(0, 8) : [];
        if (!topic || topic.length > 200) return sendJson(res, { error: "topic is required (max 200 chars)" }, 400);
        if (!["Easy","Medium","Hard"].includes(difficulty)) return sendJson(res, { error: "difficulty must be Easy/Medium/Hard" }, 400);
        const { groqChat, extractJson, buildGenerationPrompt, ALLOWED_MODELS, DEFAULT_MODEL } = require("./server/utils/groq");
        if (model && !ALLOWED_MODELS[model]) return sendJson(res, { error: `model must be one of: ${Object.keys(ALLOWED_MODELS).join(", ")}` }, 400);
        if (!process.env.GROQ_API_KEY) return sendJson(res, { error: "AI generation not configured (GROQ_API_KEY missing)" }, 503);
        const now = Date.now();
        const last = genRate.get(u.id) || 0;
        if (now - last < GEN_MIN_GAP_MS) return sendJson(res, { error: `Rate limited: wait ${Math.ceil((GEN_MIN_GAP_MS - (now - last)) / 1000)}s before generating again` }, 429);
        if (genInflight.has(u.id)) return sendJson(res, { error: "A generation is already in progress for this user" }, 429);
        genRate.set(u.id, now);
        genInflight.add(u.id);
        try {
          const { runJS } = require("./server/utils/runner");
          const { groqChat, extractJson, buildGenerationPrompt, validateDraft, ALLOWED_MODELS, DEFAULT_MODEL } = require("./server/utils/groq");
          const messages = buildGenerationPrompt(topic, difficulty, extraTags);
          const MAX_ATTEMPTS = 3;
          let draft = null, usedModel = null, visibleTestCases = null, hiddenTestCases = null;
          let lastError = "unknown error", attempts = 0;
          for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
            let content;
            try {
              const r = await groqChat(messages, model);
              content = r.content; usedModel = r.model;
            } catch (e) {
              lastError = e.message; // transport / Groq rate errors: surface immediately, don't burn retries
              break;
            }
            messages.push({ role: "assistant", content });
            let reasons = [];
            try { draft = extractJson(content); }
            catch { reasons.push("output was not valid JSON"); draft = null; }
            if (draft) {
              reasons = validateDraft(draft, difficulty);
              if (!reasons.length) {
                const badIn = validateTestCaseInputs([...draft.testInputsVisible, ...draft.testInputsHidden], draft.params);
                if (badIn) reasons.push(badIn);
              }
              if (!reasons.length) {
                const existing = await getQuestionById(draft.id);
                if (existing) reasons.push(`id "${draft.id}" already exists — pick a different slug`);
              }
            }
            if (!reasons.length) {
              // oracle: run reference solution to compute every expectedOutput
              const shell = { id: draft.id, functionName: draft.functionName, params: draft.params };
              try {
                const fill = (list) => list.map((tc, i) => {
                  let actual;
                  try { actual = runJS(draft.referenceSolution, shell, tc.input, null); }
                  catch (e) { throw new Error(`reference solution failed on test input ${tc.id}: ${e.message}`); }
                  try { actual = JSON.parse(JSON.stringify(actual)); }
                  catch { throw new Error(`reference solution returned non-serializable output on ${tc.id}`); }
                  if (actual === undefined) throw new Error(`reference solution returned undefined on ${tc.id}`);
                  return { id: tc.id || `t${i + 1}`, input: tc.input, expectedOutput: actual };
                });
                const v = fill(draft.testInputsVisible), h = fill(draft.testInputsHidden);
                const outs = [...v, ...h].map(tc => JSON.stringify(tc.expectedOutput));
                const ins = [...v, ...h].map(tc => JSON.stringify(tc.input));
                if (new Set(outs).size === 1 && new Set(ins).size > 1) {
                  throw new Error("reference solution returns the same output for every input — it is likely wrong");
                }
                visibleTestCases = v; hiddenTestCases = h;
              } catch (e) { reasons.push(e.message); }
            }
            if (!reasons.length) break;
            lastError = reasons.join("; ");
            console.warn(`generate attempt ${attempts} invalid: ${lastError}`);
            messages.push({ role: "user", content: `Your previous draft failed validation: ${lastError}. Fix ONLY those issues and output the FULL corrected JSON object again (no prose, no fences).` });
            draft = null; visibleTestCases = null; hiddenTestCases = null;
          }
          if (!draft || !visibleTestCases) {
            return sendJson(res, { error: `AI could not produce a valid question after ${attempts} attempt(s): ${lastError}` }, 502);
          }
          const tagSet = ["ai-generated", ...(Array.isArray(draft.tags) ? draft.tags.filter(t => typeof t === "string") : []), ...extraTags];
          const q = {
            id: draft.id,
            title: draft.title,
            difficulty,
            tags: [...new Set(tagSet)],
            problemStatement: draft.problemStatement,
            constraints: Array.isArray(draft.constraints) ? draft.constraints : [],
            timeComplexity: draft.timeComplexity || undefined,
            spaceComplexity: draft.spaceComplexity || undefined,
            examples: draft.examples,
            functionName: draft.functionName,
            pythonFunctionName: draft.pythonFunctionName || undefined,
            cppFunctionName: draft.cppFunctionName || undefined,
            params: draft.params,
            starterCode: draft.starterCode,
            visibleTestCases,
            hiddenTestCases,
            referenceSolution: draft.referenceSolution,
            generatedBy: "groq:" + usedModel,
          };
          if (!q.pythonFunctionName) delete q.pythonFunctionName;
          if (!q.cppFunctionName) delete q.cppFunctionName;
          if (!q.timeComplexity) delete q.timeComplexity;
          if (!q.spaceComplexity) delete q.spaceComplexity;
          const errs = validateQuestionPayload(q);
          if (errs.length) return sendJson(res, { error: "Generated question invalid: " + errs.join("; ") }, 502);
          await persistQuestion(q, u);
          return sendJson(res, {
            ok: true, id: q.id, title: q.title, difficulty: q.difficulty,
            visible: visibleTestCases.length, hidden: hiddenTestCases.length, model: usedModel, attempts,
          }, 201);
        } finally {
          genInflight.delete(u.id);
        }
      } catch (e) {
        if (e && e.status) return sendJson(res, { error: e.message }, e.status);
        console.error("generate failed:", e);
        return sendJson(res, { error: "Generation failed: " + e.message }, 500);
      }
    });
    return;
  }

  // AI complexity estimation (Big-O of submitted code; failures are non-fatal to UI)
  if (pathname === "/api/complexity" && req.method === "POST") {
    tryAuthenticate(req);
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        let parsed = {};
        try { parsed = JSON.parse(body || "{}"); }
        catch { return sendJson(res, { error: "Invalid JSON body" }, 400); }
        const { questionId, language, code } = parsed;
        if (!questionId || !language || code === undefined) return sendJson(res, { error: "Missing fields: questionId, language, code" }, 400);
        if (!["javascript","python","cpp"].includes(language)) return sendJson(res, { error: "bad language" }, 400);
        if (code.length > 50000) return sendJson(res, { error: "Code too large" }, 400);
        if (!process.env.GROQ_API_KEY) return sendJson(res, { error: "AI complexity not configured" }, 503);
        const ip = (req.socket && req.socket.remoteAddress) || "anon";
        const now = Date.now();
        const key = crypto.createHash("sha256").update(questionId + "\0" + language + "\0" + code).digest("hex");
        const hit = compCacheGet(key);
        if (hit) {
          const qh = await getQuestionById(questionId);
          return sendJson(res, { ...hit, expectedTime: (qh && qh.timeComplexity) || null, expectedSpace: (qh && qh.spaceComplexity) || null, cached: true }, 200);
        }
        const last = compRate.get(ip) || 0;
        if (now - last < COMP_MIN_GAP_MS) return sendJson(res, { error: "Rate limited: try again shortly" }, 429);
        compRate.set(ip, now);
        const q = await getQuestionById(questionId);
        if (!q) return sendJson(res, { error: "Question not found" }, 404);
        const { groqChat, extractJson, buildComplexityPrompt, isBigO } = require("./server/utils/groq");
        const { content } = await groqChat(buildComplexityPrompt(q.title, language, code), "openai/gpt-oss-20b");
        let est;
        try { est = extractJson(content); }
        catch { return sendJson(res, { error: "Model returned invalid JSON" }, 502); }
        if (!est || !isBigO(est.time) || !isBigO(est.space)) return sendJson(res, { error: "Model returned invalid complexity" }, 502);
        const out = { time: est.time.trim(), space: est.space.trim(), note: String(est.note || "").slice(0, 300) };
        compCacheSet(key, out);
        return sendJson(res, { ...out, expectedTime: q.timeComplexity || null, expectedSpace: q.spaceComplexity || null }, 200);
      } catch (e) {
        if (e && e.status) return sendJson(res, { error: e.message }, e.status);
        return sendJson(res, { error: "Complexity failed: " + e.message }, 500);
      }
    });
    return;
  }

  // code autosave (every 10s from frontend) — scoped by user if authenticated
  if (pathname === "/api/code/save" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { questionId, language, code } = JSON.parse(body || "{}");
        if (!questionId || !language || code===undefined) return sendJson(res, { error: "Missing fields" }, 400);
        if (!["cpp","javascript","python"].includes(language)) return sendJson(res, { error: "bad language" }, 400);
        if (code.length > 50000) return sendJson(res, { error: "Too large" }, 400);
        // try optional auth
        tryAuthenticate(req);
        const userId = req.user ? req.user.id : null;
        if (useDb) { await ensureDb(); if (dbReady) await db.dbSaveCode(questionId, language, code, userId); }
        return sendJson(res, { ok: true }, 200);
      } catch (e) { return sendJson(res, { error: e.message }, 500); }
    });
    return;
  }
  if (pathname.startsWith("/api/code/") && req.method === "GET") {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length===4) {
      const qid = decodeURIComponent(parts[2]);
      const lang = decodeURIComponent(parts[3]);
      let code = null;
      tryAuthenticate(req);
      const userId = req.user ? req.user.id : null;
      if (useDb) { await ensureDb(); if (dbReady) code = await db.dbGetCode(qid, lang, userId); }
      if (code !== null) return sendJson(res, { code }, 200);
      return sendJson(res, { code: null }, 200);
    }
    return sendJson(res, { error: "bad path" }, 400);
  }
  // submissions / history — scoped by user if authenticated
  if (pathname === "/api/submissions" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { questionId, language, mode, code, passed, total, results, title, complexityTime, complexitySpace } = JSON.parse(body || "{}");
        if (!questionId || !language || !mode || code===undefined) return sendJson(res, { error: "Missing fields" }, 400);
        tryAuthenticate(req);
        const userId = req.user ? req.user.id : null;
        const arr = Array.isArray(results) ? results : [];
        const times = arr.map(r=>r && r.timeMs).filter(t=>t!=null);
        const mems = arr.map(r=>r && r.memKb).filter(m=>m!=null);
        const { isBigO } = require("./server/utils/groq");
        const stats = {
          avgTimeMs: times.length ? Math.round(times.reduce((a,b)=>a+b,0)/times.length) : null,
          maxTimeMs: times.length ? Math.max(...times) : null,
          maxMemKb: mems.length ? Math.max(...mems) : null,
          complexityTime: isBigO(complexityTime) ? complexityTime.trim() : null,
          complexitySpace: isBigO(complexitySpace) ? complexitySpace.trim() : null,
        };
        let id=null;
        if (useDb) { await ensureDb(); if (dbReady) id = await db.dbCreateSubmission({questionId, title, language, mode, code, passed, total, results: results||[], userId, ...stats}); }
        cache.leaderboard.clear();
        if (userId && db.clearStatsCache) db.clearStatsCache(userId);
        return sendJson(res, { ok:true, id }, 201);
      } catch (e) { return sendJson(res, { error: e.message }, 500); }
    });
    return;
  }
  if (pathname.match(/^\/api\/submissions\/\d+\/complexity$/) && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const id = parseInt(pathname.split("/")[3], 10);
        const { time, space } = JSON.parse(body || "{}");
        const { isBigO } = require("./server/utils/groq");
        if (!isBigO(time) || !isBigO(space)) return sendJson(res, { error: "bad complexity (want O(...))" }, 400);
        tryAuthenticate(req);
        const userId = req.user ? req.user.id : null;
        await ensureDb();
        if (!dbReady || !db.dbUpdateSubmissionComplexity) return sendJson(res, { error: "DB not ready" }, 500);
        const ok = await db.dbUpdateSubmissionComplexity(id, time.trim(), space.trim(), userId);
        if (!ok) return sendJson(res, { error: "submission not found" }, 404);
        return sendJson(res, { ok: true }, 200);
      } catch (e) { return sendJson(res, { error: e.message }, 500); }
    });
    return;
  }
  if (pathname === "/api/submissions" && req.method === "GET") {
    const qid = url.searchParams.get("questionId");
    const limit = parseInt(url.searchParams.get("limit")||"50",10);
    let rows=[];
    tryAuthenticate(req);
    const userId = req.user ? req.user.id : null;
    if (useDb) { await ensureDb(); if (dbReady) rows = await db.dbGetSubmissions(qid||null, Math.min(limit,100), userId); }
    return sendJson(res, rows, 200);
  }
  // Manual mark-as-done (override for wrong test cases)
  if (pathname === "/api/manual-solved" && req.method === "GET") {
    const u = requireAuth(req, res);
    if (!u) return;
    try {
      await ensureDb();
      const ids = db.getManualSolvedIds ? await db.getManualSolvedIds(u.id) : [];
      return sendJson(res, ids, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  if (pathname.match(/^\/api\/questions\/[^/]+\/mark-done$/) && (req.method === "POST" || req.method === "DELETE")) {
    const u = requireAuth(req, res);
    if (!u) return;
    const parts = pathname.split("/").filter(Boolean);
    const qid = decodeURIComponent(parts[2]);
    try {
      await ensureDb();
      if (!dbReady) return sendJson(res, { error: "DB not ready" }, 500);
      const q = await getQuestionById(qid);
      if (!q) return sendJson(res, { error: "Question not found" }, 404);
      if (req.method === "POST") {
        await db.markDone(u.id, qid);
        cache.leaderboard.clear();
        if (db.clearStatsCache) db.clearStatsCache(u.id);
        return sendJson(res, { ok: true, marked: true }, 200);
      } else {
        await db.unmarkDone(u.id, qid);
        cache.leaderboard.clear();
        if (db.clearStatsCache) db.clearStatsCache(u.id);
        return sendJson(res, { ok: true, marked: false }, 200);
      }
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  // Streaming execute — sends each test case as it finishes (SSE-like NDJSON)
  if (pathname === "/api/execute/stream" && req.method === "POST") {
    const cl = parseInt(req.headers["content-length"] || "0", 10);
    if (cl > MAX_BODY_BYTES) { res.writeHead(413, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"Request body too large"})); }
    let body = "";
    let bodyTooLarge = false;
    req.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) { bodyTooLarge = true; try { req.destroy(); } catch {} }
    });
    req.on("end", async () => {
      let gateKind = null, held = false;
      try {
        if (bodyTooLarge) { res.writeHead(413, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"Request body too large"})); }
        const { questionId, code, language, mode } = JSON.parse(body || "{}");
        if (!questionId || !code || !language || !mode) { res.writeHead(400, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"Missing fields"})); }
        if (!["run","submit"].includes(mode) || !["javascript","python","cpp"].includes(language) || code.length>50000) { res.writeHead(400, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"bad request"})); }
        if (language === "cpp" && DISABLE_CPP) { res.writeHead(503, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"C++ execution disabled on this instance (low memory). Use JavaScript or Python."})); }
        gateKind = language === "cpp" ? "cpp" : (language === "python" ? "python" : null);
        if (gateKind && !execTryAcquire(gateKind)) {
          lintStats.execRejected++;
          res.writeHead(429, {"Content-Type":"application/json"});
          return res.end(JSON.stringify({error:"Server busy: another run is compiling. Retry shortly."}));
        }
        held = !!gateKind;
        const q = await getQuestionById(questionId);
        if (!q) { if (held) execRelease(gateKind); held = false; res.writeHead(404, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"Question not found"})); }
        const visible = q.visibleTestCases.map(tc=>({...tc,_hidden:false}));
        const hidden = q.hiddenTestCases.map(tc=>({...tc,_hidden:true}));
        q._testCasesForMode = mode==="run"?visible:[...visible,...hidden];
        const testCases = q._testCasesForMode;
        res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","Access-Control-Allow-Origin":"*"});
        res.write(`event: start\ndata: ${JSON.stringify({mode, total:testCases.length})}\n\n`);
        // Use batch for cpp/python but stream per case after batch returns? For true streaming, run per-case and flush each.
        // For JS, per-case is already fast. For cpp/python batch, we still get all at once, so we simulate streaming by iterating after batch.
        // To keep streaming granular, we run per-case sequentially and flush each.
        let passed=0, streamMemKb=null;
        // Kill in-flight children if the client disconnects mid-stream (no orphans).
        const activeKids = new Set();
        const untrack = (k) => { try { activeKids.delete(k); } catch {} };
        try {
          req.on("close", () => {
            if (!res.writableEnded) {
              for (const k of activeKids) { try { k.kill(); } catch {} }
            }
          });
        } catch {}
        const sendOne = (tc, actual, error, timeMs, memKb) => {
          const ok = !error && deepEqual(actual, tc.expectedOutput, q.id);
          if(ok) passed++;
          const payload = { testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual: error?null:actual, error, hidden: !!tc._hidden, timeMs, memKb: memKb==null?null:memKb };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          return ok;
        };
        if (language==="javascript") {
          for(const tc of testCases){
            const start=Date.now(); let actual, err=null, memKb=null;
            try{ const hb=process.memoryUsage().heapUsed; actual=runJS(code,q,tc.input,tc.expectedOutput); memKb=jsHeapKb(hb); if(memKb!=null) streamMemKb=Math.max(streamMemKb||0,memKb); }catch(e){ err=e.message; if(String(e.message).includes("Script execution timed out")) err="Time Limit Exceeded (JS >2s)"; }
            sendOne(tc, actual, err, Date.now()-start, memKb);
          }
        } else if (language==="python") {
          // Stream Python per-case with flush for true streaming
          try{
            const tmpFile = path.join(os.tmpdir(), `dsa_stream_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
            const fnName = q.pythonFunctionName || q.functionName;
            const casesJson = JSON.stringify(testCases.map(tc=>({input:tc.input})));
            const isComposite = testCases[0] && testCases[0].expectedOutput && typeof testCases[0].expectedOutput==="object" && !Array.isArray(testCases[0].expectedOutput) && ("k" in testCases[0].expectedOutput);
            const isReverse = q.id==="reverse-string";
            let driver;
            if(isComposite) driver = `\nimport json,sys\ncases=json.loads('''${casesJson.replace(/'/g,"\\'")}''')\nfor tc in cases:\n    inp={k: list(v) if isinstance(v,list) else v for k,v in tc["input"].items()}\n    _ret=${fnName}(**inp)\n    print(json.dumps({"k":_ret,"${q.params[0]}": inp["${q.params[0]}"]}), flush=True)\n`;
            else if(isReverse) driver = `\nimport json\ncases=json.loads('''${casesJson.replace(/'/g,"\\'")}''')\nfor tc in cases:\n    inp={k: list(v) if isinstance(v,list) else v for k,v in tc["input"].items()}\n    _ret=${fnName}(**inp)\n    if _ret is None: _ret=inp["${q.params[0]}"]\n    print(json.dumps(_ret), flush=True)\n`;
            else driver = `\nimport json\ncases=json.loads('''${casesJson.replace(/'/g,"\\'")}''')\nfor tc in cases:\n    _ret=${fnName}(**tc["input"])\n    print(json.dumps(_ret), flush=True)\n`;
            fs.writeFileSync(tmpFile, code+"\n"+driver+PY_PEAK_TAIL, "utf8");
            const py = spawn("python", [tmpFile]);
            activeKids.add(py);
            let stderr=""; py.stderr.on("data",d=>{ if (stderr.length < MAX_CHILD_BYTES) stderr += d.toString().slice(0, MAX_CHILD_BYTES - stderr.length); });
            py.on("error", async()=>{ try{ const py3=spawn("python3",[tmpFile]); let out=""; py3.stdout.on("data",d=>{ const lines=d.toString().split("\n").filter(Boolean); for(const line of lines){ const t=line.trim(); if(t.startsWith("__PEAK_KB__")){ const pk=parseInt(t.slice(11),10); if(!isNaN(pk)) streamMemKb=Math.max(streamMemKb||0,pk); continue; } try{ const actual=JSON.parse(line); const tc=testCases.shift(); if(tc) sendOne(tc, actual, null, 0, null); }catch{} } }); py3.on("close",c=>{ try{fs.unlinkSync(tmpFile);}catch{}; if(c!==0) for(const tc of testCases) sendOne(tc,null,"python3 error "+c,0,null); }); }catch{} });
            let outBuf=""; py.stdout.on("data", d=>{
              outBuf+=d.toString();
              if (outBuf.length > MAX_CHILD_BYTES * 2) outBuf = outBuf.slice(-MAX_CHILD_BYTES);
              let lines=outBuf.split("\n");
              outBuf=lines.pop();
              for(const line of lines){ const t=line.trim(); if(!t) continue; if(t.startsWith("__PEAK_KB__")){ const pk=parseInt(t.slice(11),10); if(!isNaN(pk)) streamMemKb=Math.max(streamMemKb||0,pk); continue; } try{ const actual=JSON.parse(line); const tc=testCases.shift(); if(tc) sendOne(tc, actual, null, 0, null); }catch(e){} }
            });
            await new Promise((res,rej)=>{ py.on("close", c=>{ untrack(py); try{fs.unlinkSync(tmpFile);}catch{}; if(outBuf.trim()){ const t=outBuf.trim(); if(t.startsWith("__PEAK_KB__")){ const pk=parseInt(t.slice(11),10); if(!isNaN(pk)) streamMemKb=Math.max(streamMemKb||0,pk); } else { try{ const actual=JSON.parse(t); const tc=testCases.shift(); if(tc) sendOne(tc, actual, null, 0, null); }catch{} } } if(c!==0 && c!==null) { /* already handled */ } res(); }); py.on("error", (e)=>{ untrack(py); rej(e); }); });
          }catch(e){ for(const tc of testCases) sendOne(tc, null, e.message, 0, null); }
        } else if (language==="cpp") {
          // Compile once (ALL cases embedded, mode-independent hash v3), then run
          // each mode case by absolute index. Exe startup is milliseconds, so
          // streaming granularity is preserved and Run->Submit shares the binary.
          const full=[...visible, ...hidden];
          const absOf=(tc)=>full.findIndex(t=>t.id===tc.id);
          try{
            const fnName = q.cppFunctionName || q.functionName;
            const params = q.params;
            const isReverse = q.id==="reverse-string";
            const isCompositeSample = full[0] && full[0].expectedOutput && typeof full[0].expectedOutput==="object" && !Array.isArray(full[0].expectedOutput) && ("k" in full[0].expectedOutput);
            const isInPlaceVoid = isReverse || q.id==="move-zeroes";
            const batchDecls = params.map(p=>{
              const firstVal = full[0].input[p];
              const baseType = cppTypeFor(firstVal);
              return `vector<${baseType}> _batch_${p} = {${full.map(tc=>jsonToCppLiteral(tc.input[p])).join(", ")}};`;
            }).join("\n  ");
            const n = full.length;
            const hasInclude = code.includes("#include");
            const header = hasInclude ? "" : '#include <bits/stdc++.h>\nusing namespace std;\n';
            const printHelpers = `\ntemplate<typename T> void printJsonVal(const T& v);\nvoid printJsonVal(int v){ cout << v; }\nvoid printJsonVal(double v){ cout << v; }\nvoid printJsonVal(bool v){ cout << (v?"true":"false"); }\nvoid printJsonVal(const string& v){ cout << '"' << v << '"'; }\nvoid printJsonVal(char v){ cout << '"' << v << '"'; }\ntemplate<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }\n`;
            let driver;
            const idxSupport = `int _s=0,_e=${n}; if(argc>1){_s=atoi(argv[1]); _e=_s+1; if(_s<0||_s>=${n}) return 0;}`;
            if(isCompositeSample){
              driver=`\nint main(int argc, char** argv){\n  ${batchDecls}\n  ${idxSupport}\n  for(int i=_s;i<_e;i++){\n    auto _k = ${fnName}(_batch_${params[0]}[i]${params.length>1?", "+params.slice(1).map(p=>`_batch_${p}[i]`).join(", "):""});\n    cout << "{\\"k\\":" << _k << ",\\"${params[0]}\\" :"; printJsonVal(_batch_${params[0]}[i]); cout << "}" << endl;\n  }\n  return 0;\n}\n`;
            } else if(isInPlaceVoid){
              driver=`\nint main(int argc, char** argv){\n  ${batchDecls}\n  ${idxSupport}\n  for(int i=_s;i<_e;i++){\n    ${fnName}(_batch_${params[0]}[i]${params.length>1?", "+params.slice(1).map(p=>`_batch_${p}[i]`).join(", "):""});\n    printJsonVal(_batch_${params[0]}[i]); cout << endl;\n  }\n  return 0;\n}\n`;
            } else {
              const callArgs=params.map(p=>`_batch_${p}[i]`).join(", ");
              driver=`\nint main(int argc, char** argv){\n  ${batchDecls}\n  ${idxSupport}\n  for(int i=_s;i<_e;i++){\n    auto _ret = ${fnName}(${callArgs});\n    printJsonVal(_ret); cout << endl;\n  }\n  return 0;\n}\n`;
            }
            const crypto = require("crypto");
            const hash = crypto.createHash("sha256").update(code+"|"+q.id+"|v3-all").digest("hex").slice(0,16);
            const cacheDir = exeCacheDir();
            const exe=path.join(cacheDir, `dsa_${hash}.exe`);
            const tmpCpp=path.join(os.tmpdir(), `dsa_stream_${Date.now()}_${Math.random().toString(36).slice(2)}.cpp`);
            const localGpps=[path.join(ROOT,"tools","mingw64","bin","g++.exe"),"C:\\mingw64\\bin\\g++.exe","C:\\tools\\mingw64\\bin\\g++.exe","g++"];
            let compiler="g++"; for(const p of localGpps) if(fs.existsSync(p)){compiler=p;break;}
            let cacheHit = fs.existsSync(exe);
            if(!cacheHit){
              fs.writeFileSync(tmpCpp, header+"\n"+code+"\n"+printHelpers+"\n"+driver, "utf8");
              let cErr="";
              await new Promise((res,rej)=>{
                const comp=spawn(compiler, ["-std=c++17","-O0","-s",...pchCompileArgs(),tmpCpp,"-o",exe]);
                comp.stderr.on("data",d=>{ if (cErr.length < MAX_CHILD_BYTES) cErr += d.toString().slice(0, MAX_CHILD_BYTES - cErr.length); });
                comp.on("close",c=>{ exeCachePrune(); c===0?res():rej(new Error("Compile Error:\\n"+cErr)); });
                comp.on("error",e=>rej(new Error("Compile spawn error: "+e.message)));
              });
              try{fs.unlinkSync(tmpCpp);}catch{}
            } else {
              try{fs.unlinkSync(tmpCpp);}catch{}
            }
            const binDir=path.dirname(compiler);
            const runEnv={...process.env, PATH: binDir+path.delimiter+process.env.PATH};
            const useTime=process.env.USE_TIME_V === "0" ? false : hasTimeV();
            for (const tc of testCases) {
              const ai=absOf(tc);
              const t0=Date.now();
              await new Promise((res2)=>{
                const args=[String(ai)];
                const run=useTime?spawn("/usr/bin/time",["-v",exe,...args],{env: runEnv}):spawn(exe,args,{env: runEnv});
                activeKids.add(run);
                let out="",rErr="";
                run.stdout.on("data",d=>{ if(out.length<MAX_CHILD_BYTES) out+=d.toString().slice(0,MAX_CHILD_BYTES-out.length); });
                run.stderr.on("data",d=>{ if(rErr.length<MAX_CHILD_BYTES) rErr+=d.toString().slice(0,MAX_CHILD_BYTES-rErr.length); });
                const kill=setTimeout(()=>{ try{run.kill();}catch{}; sendOne(tc,null,"Time Limit Exceeded (C++ >3s)",Date.now()-t0,null); res2(); },3500);
                const memFromTime=()=>{
                  if(!useTime) return null;
                  const m=rErr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
                  return m?parseInt(m[1],10):null;
                };
                run.on("close",c=>{
                  clearTimeout(kill);
                  untrack(run);
                  if(c!==0){ sendOne(tc,null,rErr.trim().slice(0,500)||`exit ${c}`,Date.now()-t0,memFromTime()); }
                  else {
                    try{
                      const line=out.trim().split("\n").filter(Boolean)[0];
                      const actual=JSON.parse(line);
                      const mem=memFromTime();
                      if(mem!=null) streamMemKb=Math.max(streamMemKb||0,mem);
                      sendOne(tc,actual,null,Date.now()-t0,mem);
                    }catch{ sendOne(tc,null,"Invalid C++ output (not JSON): "+out.trim().slice(0,500),Date.now()-t0,memFromTime()); }
                  }
                  res2();
                });
                run.on("error",(e)=>{ clearTimeout(kill); untrack(run); sendOne(tc,null,"Run error: "+e.message,Date.now()-t0,null); res2(); });
              });
            }
          }catch(e){
            for(const tc of testCases) sendOne(tc, null, e.message, 0, null);
          }
        }
        res.write(`event: done\ndata: ${JSON.stringify({passed, total:testCases.length, memKb: streamMemKb})}\n\n`);
        res.end();
      } catch(e){ try{ res.writeHead(500, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); }catch{} }
      finally { if (held) execRelease(gateKind); }
    });
    return;
  }
  // Per-testcase API — UI calls once per case, renders immediately without waiting for all
  if (pathname === "/api/execute/case" && req.method === "POST") {
    const cl = parseInt(req.headers["content-length"] || "0", 10);
    if (cl > MAX_BODY_BYTES) return sendJson(res, { error: "Request body too large" }, 413);
    let body = "";
    let bodyTooLarge = false;
    req.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) { bodyTooLarge = true; try { req.destroy(); } catch {} }
    });
    req.on("end", async () => {
      let gateKind = null, held = false;
      try {
        if (bodyTooLarge) return sendJson(res, { error: "Request body too large" }, 413);
        const { questionId, code, language, mode, index } = JSON.parse(body || "{}");
        if (!questionId || !code || !language || !mode || index===undefined) return sendJson(res, { error: "Missing fields: questionId, code, language, mode, index" }, 400);
        if (!["run","submit"].includes(mode) || !["javascript","python","cpp"].includes(language) || code.length>50000) return sendJson(res, { error: "bad request" }, 400);
        if (language === "cpp" && DISABLE_CPP) return sendJson(res, { error: "C++ execution disabled on this instance (low memory). Use JavaScript or Python." }, 503);
        gateKind = language === "cpp" ? "cpp" : (language === "python" ? "python" : null);
        if (gateKind && !execTryAcquire(gateKind)) {
          lintStats.execRejected++;
          return sendJson(res, { error: "Server busy: another run is compiling. Retry shortly." }, 429);
        }
        held = !!gateKind;
        const q = await getQuestionById(questionId);
        if (!q) { if (held) execRelease(gateKind); return sendJson(res, { error: "Question not found" }, 404); }
        const visible = q.visibleTestCases.map(tc=>({...tc,_hidden:false}));
        const hidden = (q.hiddenTestCases||[]).map(tc=>({...tc,_hidden:true}));
        const all = mode==="run"?visible:[...visible,...hidden];
        const tc = all[index];
        if (!tc) { if (held) execRelease(gateKind); return sendJson(res, { error: "bad index" }, 400); }
        const start = Date.now();
        let actual=null, error=null, ok=false, memKb=null;
        try{
          if(language==="javascript"){ const hb=process.memoryUsage().heapUsed; actual=runJS(code,q,tc.input,tc.expectedOutput); memKb=jsHeapKb(hb); }
          else if(language==="python") ({ actual, memKb } = await runPython(code,q,tc.input,tc.expectedOutput));
          else if(language==="cpp"){
            // Reuse cached exe with index arg (compile once, run single).
            // The binary embeds ALL cases (visible+hidden) and the hash ignores
            // mode, so Run -> Submit with unchanged code compiles exactly once.
            const crypto=require("crypto");
            const hash=crypto.createHash("sha256").update(code+"|"+q.id+"|v3-all").digest("hex").slice(0,16);
            const cacheDir=exeCacheDir();
            const exe=path.join(cacheDir,`dsa_${hash}.exe`);
            const full=[...visible, ...hidden];
            const absIndex=full.findIndex(t=>t.id===tc.id);
            if(!fs.existsSync(exe)){
              // compile batch exe on-demand (same driver as stream, with index support)
              const fnName=q.cppFunctionName||q.functionName;
              const params=q.params;
              const batchDecls=params.map(p=>{ const v=full[0].input[p]; return `vector<${cppTypeFor(v)}> _batch_${p} = {${full.map(t=>jsonToCppLiteral(t.input[p])).join(", ")}};`; }).join("\n  ");
              const n=full.length;
              const hasInclude=code.includes("#include");
              const header=hasInclude?"":'#include <bits/stdc++.h>\nusing namespace std;\n';
              const printHelpers=`\ntemplate<typename T> void printJsonVal(const T& v);\nvoid printJsonVal(int v){ cout << v; }\nvoid printJsonVal(double v){ cout << v; }\nvoid printJsonVal(bool v){ cout << (v?"true":"false"); }\nvoid printJsonVal(const string& v){ cout << '"' << v << '"'; }\nvoid printJsonVal(char v){ cout << '"' << v << '"'; }\ntemplate<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }\n`;
              const isComp=full[0].expectedOutput && typeof full[0].expectedOutput==="object" && !Array.isArray(full[0].expectedOutput) && ("k" in full[0].expectedOutput);
              const isInP=q.id==="reverse-string"||q.id==="move-zeroes";
              const idxSup=`int _s=0,_e=${n}; if(argc>1){_s=atoi(argv[1]); _e=_s+1; if(_s<0||_s>=${n}) return 0;}`;
              let driver;
              if(isComp) driver=`\nint main(int argc,char**argv){\n ${batchDecls}\n ${idxSup}\n for(int i=_s;i<_e;i++){ auto _k=${fnName}(_batch_${params[0]}[i]); cout<<"{\\"k\\":"<<_k<<",\\"${params[0]}\\":"; printJsonVal(_batch_${params[0]}[i]); cout<<"}"<<endl; } return 0;}\n`;
              else if(isInP) driver=`\nint main(int argc,char**argv){\n ${batchDecls}\n ${idxSup}\n for(int i=_s;i<_e;i++){ ${fnName}(_batch_${params[0]}[i]); printJsonVal(_batch_${params[0]}[i]); cout<<endl; } return 0;}\n`;
              else driver=`\nint main(int argc,char**argv){\n ${batchDecls}\n ${idxSup}\n for(int i=_s;i<_e;i++){ auto _ret=${fnName}(${params.map(p=>`_batch_${p}[i]`).join(", ")}); printJsonVal(_ret); cout<<endl; } return 0;}\n`;
              const tmpCpp=path.join(os.tmpdir(),`dsa_case_${Date.now()}.cpp`);
              fs.writeFileSync(tmpCpp, header+"\n"+code+"\n"+printHelpers+"\n"+driver, "utf8");
              const localGpps=[path.join(ROOT,"tools","mingw64","bin","g++.exe"),"C:\\mingw64\\bin\\g++.exe","g++"];
              let compiler="g++"; for(const p of localGpps) if(fs.existsSync(p)){compiler=p;break;}
              let cErr="";
              await new Promise((rs,rj)=>{ const c=spawn(compiler,["-std=c++17","-O0","-s",...pchCompileArgs(),tmpCpp,"-o",exe]); c.stderr.on("data",d=>{ if (cErr.length < MAX_CHILD_BYTES) cErr += d.toString().slice(0, MAX_CHILD_BYTES - cErr.length); }); c.on("close",cc=>{ if(cc===0) exeCachePrune(); cc===0?rs():rj(new Error("Compile Error:\\n"+cErr)); }); c.on("error",e=>rj(new Error("Compile spawn: "+e.message))); });
              try{fs.unlinkSync(tmpCpp);}catch{}
            }
            const binDir=path.dirname(fs.existsSync("C:\\mingw64\\bin\\g++.exe")?"C:\\mingw64\\bin\\g++.exe":"g++");
            // find actual compiler dir for DLLs
            let cdir="C:\\mingw64\\bin"; try{ if(!fs.existsSync(exe)) throw 0; }catch{}
            const runEnv={...process.env, PATH: cdir+path.delimiter+process.env.PATH};
            const tracked=await runExeTracked(exe,[String(absIndex)],runEnv,3000,"Time Limit Exceeded");
            try{ actual=JSON.parse(tracked.out.trim().split("\n")[0]); }catch{ throw new Error("Invalid output: "+tracked.out); }
            memKb=tracked.memKb;
          } else throw new Error("bad lang");
          ok=deepEqual(actual, tc.expectedOutput, q.id);
        }catch(e){ error=e.message; if(String(e.message).includes("Script execution timed out")) error="Time Limit Exceeded (JS >2s)"; }
        if (held) execRelease(gateKind);
        return sendJson(res, { testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual: error?null:actual, error, hidden: !!tc._hidden, timeMs: Date.now()-start, memKb, index }, 200);
      }catch(e){ if (held && gateKind) execRelease(gateKind); return sendJson(res, { error: e.message }, 500); }
    });
    return;
  }
  if (pathname === "/api/lint" && req.method === "POST") {
    let body = "";
    let rawTooLarge = false;
    req.on("data", chunk => { body += chunk; if (body.length > MAX_BODY_BYTES) { rawTooLarge = true; try { req.destroy(); } catch {} } });
    req.on("end", async () => {
      try {
        if (rawTooLarge) return sendJson(res, { error: "Code too large (max 50k)" }, 400);
        const { code, language } = JSON.parse(body || "{}");
        if (code === undefined || !language) return sendJson(res, { error: "Missing fields: code, language" }, 400);
        if (!["javascript", "python", "cpp"].includes(language)) return sendJson(res, { error: "bad language" }, 400);
        if (code.length > 50000) return sendJson(res, { error: "Code too large (max 50k)" }, 400);
        lintStats.total++;
        // Result cache: check BEFORE rate-limit and single-flight gates
        // so repeats are fast and do not consume rate budget or g++ slots.
        const key = lintCacheKey(code, language);
        const cached = lintCacheGet(key);
        if (cached) {
          lintStats.cacheHits++;
          return sendJson(res, { diagnostics: cached }, 200);
        }
        // Per-IP rate limit: min 1200ms between ACCEPTED requests
        const ip = (req.socket && req.socket.remoteAddress) || "unknown";
        const now = Date.now();
        const last = lintRate.get(ip) || 0;
        if (now - last < LINT_MIN_GAP_MS) {
          lintStats.rateLimited++;
          return sendJson(res, { diagnostics: [] }, 429);
        }
        // Single-flight for C++ g++ lint: max 1 concurrent g++ process.
        // JS/python stay unlimited (cheap, in-process/py_compile).
        const isCpp = language === "cpp";
        if (isCpp && lintInflightCpp >= 1) {
          return sendJson(res, { diagnostics: [] }, 429);
        }
        // Accepted: record timestamp, occupy g++ slot for cpp
        lintRate.set(ip, now);
        if (isCpp) lintInflightCpp++;
        try {
          const { lint } = require("./server/utils/lint");
          const diagnostics = await lint(code, language, ROOT);
          lintCacheSet(key, diagnostics);
          return sendJson(res, { diagnostics }, 200);
        } finally {
          if (isCpp) {
            lintInflightCpp = Math.max(0, lintInflightCpp - 1);
            lastLintEnd = Date.now();
            // Idle typing lull => good moment to build the PCH in the background.
            try { maybeBuildPch(); } catch {}
          }
        }
      } catch (e) {
        return sendJson(res, { error: e.message }, 500);
      }
    });
    return;
  }
  if (pathname === "/api/methods" && req.method === "GET") {
    const language = (url.searchParams.get("language") || "").toLowerCase();
    const q = (url.searchParams.get("q") || "").trim();
    const lim = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "10", 10) || 10, 1), 200);
    if (!["cpp", "javascript", "python"].includes(language)) return sendJson(res, { error: "bad language" }, 400);
    try {
      await ensureDb();
      if (!dbReady) return sendJson(res, [], 200);
      const rows = await db.searchMethods(language, q, lim);
      return sendJson(res, rows, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  if (pathname.match(/^\/api\/methods\/[^/]+\/[^/]+$/) && req.method === "GET") {
    const parts = pathname.split("/").filter(Boolean);
    const language = decodeURIComponent(parts[2]).toLowerCase();
    const name = decodeURIComponent(parts[3]);
    try {
      await ensureDb();
      if (!dbReady) return sendJson(res, null, 200);
      const row = await db.getMethodDoc(language, name);
      return sendJson(res, row, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  if (pathname === "/api/execute" && req.method === "POST") {
    // Early Content-Length guard (cheap, before buffering).
    const cl = parseInt(req.headers["content-length"] || "0", 10);
    if (cl > MAX_BODY_BYTES) { return sendJson(res, { error: "Request body too large" }, 413); }
    let body = "";
    let bodyTooLarge = false;
    req.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) { bodyTooLarge = true; try { req.destroy(); } catch {} }
    });
    req.on("end", async () => {
      try {
        if (bodyTooLarge) return sendJson(res, { error: "Request body too large" }, 413);
        const { questionId, code, language, mode } = JSON.parse(body || "{}");
        if (!questionId || !code || !language || !mode) return sendJson(res, { error: "Missing fields: questionId, code, language, mode" }, 400);
        if (!["run","submit"].includes(mode)) return sendJson(res, { error: "mode must be run or submit" }, 400);
        if (!["javascript","python","cpp"].includes(language)) return sendJson(res, { error: "language must be javascript, python or cpp" }, 400);
        if (code.length > 50000) return sendJson(res, { error: "Code too large (max 50k)" }, 400);
        if (language === "cpp" && DISABLE_CPP) return sendJson(res, { error: "C++ execution disabled on this instance (low memory). Use JavaScript or Python." }, 503);
        // Global execution gate: bounds concurrent g++/python so free-tier RAM can't OOM.
        const gateKind = language === "cpp" ? "cpp" : (language === "python" ? "python" : null);
        let held = false;
        if (gateKind) {
          if (!execTryAcquire(gateKind)) {
            lintStats.execRejected++;
            return sendJson(res, { error: "Server busy: another run is compiling. Retry shortly." }, 429);
          }
          held = true;
        }
        try {
          const q = await getQuestionById(questionId);
          if (!q) return sendJson(res, { error: "Question not found" }, 404);
          const visible = q.visibleTestCases.map(tc => ({ ...tc, _hidden: false }));
          const hidden = (q.hiddenTestCases||[]).map(tc => ({ ...tc, _hidden: true }));
          q._testCasesForMode = mode === "run" ? visible : [...visible, ...hidden];
          const result = await executeQuestion(q, code, language);
          return sendJson(res, { mode, ...result });
        } finally {
          if (held) execRelease(gateKind);
        }
      } catch (e) {
        console.error(e);
        return sendJson(res, { error: e.message }, 500);
      }
    });
    return;
  }

  // Default route → dashboard (app must open on dashboard)
  if (pathname === "/" ) {
    return sendFile(res, path.join(ROOT, "dashboard.html"));
  }
  // Static
  let filePath = path.join(ROOT, pathname === "/" ? "dashboard.html" : pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {}
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendFile(res, filePath);
  }
  if (!pathname.startsWith("/api/")) {
    return sendFile(res, path.join(ROOT, "index.html"));
  }
  res.writeHead(404); res.end("Not found");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} already in use. Kill old process or run: PORT=3001 node server.js`);
    console.error(`On Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F`);
    process.exit(1);
  } else {
    console.error(err);
    process.exit(1);
  }
});
server.listen(PORT, async () => {
  await ensureDb();
  const qs = await loadQuestions();
  console.log(`DSA Practice running at http://localhost:${PORT}`);
  console.log(`Questions: ${qs.length} loaded from ${useDb && dbReady ? "MySQL "+process.env.DB_HOST : QUESTIONS_DIR}`);
  console.log(`Memory guards: heap cap via NODE_OPTIONS, exec gate cpp<=${EXEC_MAX_CPP} py<=${EXEC_MAX_PYTHON} total<=${EXEC_MAX_TOTAL}, PCH ${ENABLE_PCH ? "on" : "off"}, C++ ${DISABLE_CPP ? "disabled" : "enabled"}`);
  // Lightweight g++ presence check only (no warm compile, no worker pool — saves RAM).
  try{
    const { spawn: _sp } = require("child_process");
    const _c = _sp("g++", ["--version"]);
    let _done = false;
    _c.on("close",(code)=>{ if(_done) return; _done=true; if(code===0) console.log("g++ available (PATH)"); else console.warn("g++ check exit "+code+" — C++ execution may fail; set DISABLE_CPP=1 for JS/Python-only mode"); });
    _c.on("error",()=>{ if(_done) return; _done=true; console.warn("g++ not found in PATH — C++ execution will fail; set DISABLE_CPP=1 for JS/Python-only mode"); });
  }catch{}
  // Drop the legacy v1 PCH dir if present (built without matching flags; the
  // v2 dir above supersedes it). Cheap unlink, frees ~80MB of ephemeral disk.
  try {
    const legacy = path.join(os.tmpdir(), "dsa_pch");
    if (fs.existsSync(legacy)) {
      try { fs.rmSync(legacy, { recursive: true, force: true }); console.log("removed legacy PCH dir"); }
      catch {}
    }
  } catch {}
  // Precompiled bits header for lint (non-blocking, failures swallowed).
  // Generates <os.tmpdir()>/dsa_pch_v2/bits/stdc++.h.gch once so per-keystroke
  // g++ -fsyntax-only parses far less and uses far less RAM.
  // Disabled by default on low-memory hosts (ENABLE_PCH=1 to opt in).
  if (ENABLE_PCH) {
    try {
      const { ensureBitsPch } = require("./server/utils/lint");
      ensureBitsPch(ROOT).then(
        (p) => { if (p) console.log("PCH ready:", p); },
        () => {}
      );
    } catch {}
  } else {
    console.log("PCH skipped (ENABLE_PCH=0) — lint uses plain -fsyntax-only");
  }
});

// Graceful shutdown (Render sends SIGTERM on deploy/spin-down): stop accepting,
// close the server + DB pool so in-flight compiles aren't orphaned mid-write.
function shutdown(signal) {
  console.log(`${signal} received — draining...`);
  try {
    server.close(() => {
      try {
        if (db && db.getPool) {
          db.getPool().end().catch(() => {}).finally(() => process.exit(0));
          setTimeout(() => process.exit(0), 5000).unref();
        } else process.exit(0);
      } catch { process.exit(0); }
    });
    setTimeout(() => process.exit(0), 10000).unref();
  } catch { process.exit(0); }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
