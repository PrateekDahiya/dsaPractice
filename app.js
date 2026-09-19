// Vanilla JS — no framework, no bundler
const $ = (s) => document.querySelector(s);
const questionListEl = $("#question-list");
const problemViewEl = $("#problem-view");
const codeEditor = $("#code-editor");
const langSelect = $("#language-select");
const runBtn = $("#run-btn");
const submitBtn = $("#submit-btn");
const resetBtn = $("#reset-btn");
const resultsEl = $("#test-results");
const statusText = $("#status-text");
const lastRunMeta = $("#last-run-meta");
const toastEl = $("#toast");
const filterEl = $("#difficulty-filter");
const countEl = $("#question-count");

let questions = [];
let currentQuestion = null;
let currentLang = "cpp";

// ---------- Auth helpers ----------
function getToken(){ return localStorage.getItem("token"); }
function getUser(){ try{ return JSON.parse(localStorage.getItem("user")||"null"); } catch{ return null; } }
function setAuth(token, user){ if(token) localStorage.setItem("token", token); if(user) localStorage.setItem("user", JSON.stringify(user)); }
function clearAuth(){ localStorage.removeItem("token"); localStorage.removeItem("user"); }
function authHeaders(headers={}){
  const t = getToken();
  const h = { ...headers };
  if(t) h["Authorization"] = "Bearer " + t;
  return h;
}
async function apiFetch(url, opts={}){
  const headers = authHeaders(opts.headers||{});
  const res = await fetch(url, { ...opts, headers });
  if(res.status===401){
    // token invalid -> clear and update topbar, but not force redirect unless on protected action
    // we keep UI, caller may handle
    if(url.includes("/api/me")) clearAuth();
  }
  return res;
}
function updateTopbar(user){
  const authArea = document.getElementById("auth-area");
  if(!authArea) return;
  const navDash = document.getElementById("nav-dashboard");
  if(user){
    if(navDash) navDash.classList.remove("hidden");
    authArea.innerHTML = `
      <a href="dashboard.html" style="color:var(--text);text-decoration:none;font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px">
        <span style="width:26px;height:26px;border-radius:50%;background:var(--panel2);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:11px">${esc(user.username.slice(0,2).toUpperCase())}</span>
        ${esc(user.username)}
      </a>
      <button id="logout-btn" class="btn ghost" style="padding:6px 10px;font-size:12px">Logout</button>
    `;
    const lb = document.getElementById("logout-btn");
    if(lb) lb.addEventListener("click", ()=>{
      clearAuth();
      updateTopbar(null);
      toast("Logged out");
      // refresh solved indicators
      solvedSet.clear(); attemptedSet.clear();
      renderList();
      renderHistory();
    });
  } else {
    if(navDash) navDash.classList.add("hidden");
    authArea.innerHTML = `
      <a href="login.html" class="ghost-link" style="padding:6px 10px;font-size:12px">Login</a>
      <a href="register.html" class="btn primary" style="padding:6px 12px;font-size:12px">Register</a>
    `;
  }
}
async function checkAuth(){
  const t = getToken();
  if(!t){ updateTopbar(null); return null; }
  try{
    const res = await fetch("/api/me", { headers:{ Authorization:"Bearer "+t } });
    if(res.ok){
      const user = await res.json();
      localStorage.setItem("user", JSON.stringify(user));
      updateTopbar(user);
      return user;
    } else {
      clearAuth();
      updateTopbar(null);
      return null;
    }
  }catch{
    const u = getUser();
    updateTopbar(u);
    return u;
  }
}

function toast(msg, ms = 2500) {
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), ms);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (currentQuestion && currentQuestion.id === "two-sum" && a.every(x=>typeof x==="number")) {
      const sa = [...a].sort((x,y)=>x-y);
      const sb = [...b].sort((x,y)=>x-y);
      return sa.every((v,i)=>v===sb[i]);
    }
    return a.every((v,i)=>deepEqual(v,b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// solved/attempted sets
let solvedSet = new Set();
let attemptedSet = new Set();
async function refreshSolvedState(){
  solvedSet.clear(); attemptedSet.clear();
  const t = getToken();
  if(!t) return;
  try{
    const r1 = await apiFetch("/api/questions/solved");
    if(r1.ok){
      const ids = await r1.json();
      if(Array.isArray(ids)) ids.forEach(id=>solvedSet.add(id));
    }
    const r2 = await apiFetch("/api/submissions?limit=100");
    if(r2.ok){
      const subs = await r2.json();
      if(Array.isArray(subs)){
        subs.forEach(s=>{
          if(!solvedSet.has(s.questionId)) attemptedSet.add(s.questionId);
        });
      }
    }
  }catch{}
}

async function fetchQuestions() {
  try {
    const res = await apiFetch("/api/questions");
    if (!res.ok) throw new Error("api failed");
    questions = await res.json();
  } catch (e) {
    console.warn("API not available, fallback to static probe", e);
    const ids = ["two-sum", "reverse-string", "valid-parentheses"];
    questions = [];
    for (const id of ids) {
      try {
        const r = await fetch(`questions/${id}.json`);
        if (r.ok) {
          const q = await r.json();
          questions.push({ id: q.id, title: q.title, difficulty: q.difficulty, tags: q.tags });
        }
      } catch {}
    }
    if (questions.length === 0) toast("No questions found. Run `node server.js`");
  }
}

function getFilteredSorted() {
  let list = [...questions];
  const diff = filterEl ? filterEl.value : "all";
  const tag = document.getElementById("tag-filter")?.value || "all";
  const search = document.getElementById("search-input")?.value?.toLowerCase().trim() || "";
  const sort = document.getElementById("sort-select")?.value || "recent";
  if (diff !== "all") list = list.filter(q => q.difficulty === diff);
  if (tag !== "all") list = list.filter(q => (q.tags||[]).includes(tag));
  if (search) list = list.filter(q => q.title.toLowerCase().includes(search) || q.id.includes(search) || (q.tags||[]).join(" ").toLowerCase().includes(search));
  if (sort === "recent") list.sort((a,b)=> (b._createdAt||0)-(a._createdAt||0));
  else if (sort === "title") list.sort((a,b)=> a.title.localeCompare(b.title));
  else if (sort === "difficulty") {
    const order={Easy:0,Medium:1,Hard:2};
    list.sort((a,b)=> (order[a.difficulty]??9)-(order[b.difficulty]??9) || a.title.localeCompare(b.title));
  }
  return list;
}
function renderList() {
  if(!questionListEl) return;
  const filtered = getFilteredSorted();
  if(countEl) countEl.textContent = `${filtered.length} problems`;
  questionListEl.innerHTML = filtered.map(q => {
    let indicator="";
    if(solvedSet.has(q.id)) indicator = `<span class="q-indicator solved" title="Solved"><span class="dot-sm"></span> Solved</span>`;
    else if(attemptedSet.has(q.id)) indicator = `<span class="q-indicator attempted" title="Attempted"><span class="dot-sm"></span> Attempted</span>`;
    return `
    <div class="question-item ${currentQuestion && currentQuestion.id===q.id ? 'active':''}" data-id="${esc(q.id)}">
      <div class="q-title">${esc(q.title)} ${solvedSet.has(q.id) ? '<span style="color:#00b8a3;margin-left:6px">✓</span>' : attemptedSet.has(q.id) ? '<span style="color:#ffa116;margin-left:6px">●</span>' : ''}</div>
      <div class="q-meta">
        <span class="badge ${esc(q.difficulty)}">${esc(q.difficulty)}</span>
        <span>${(q.tags||[]).join(" · ")}</span>
        ${indicator ? `<span style="margin-left:auto">${indicator}</span>` : ""}
      </div>
    </div>
  `}).join("") || `<div style="color:var(--muted);padding:10px;font-size:13px">No problems for filter</div>`;
  questionListEl.querySelectorAll(".question-item").forEach(el => {
    el.addEventListener("click", () => loadQuestion(el.dataset.id));
  });
}

async function loadQuestion(id) {
  try {
    let q;
    const res = await apiFetch(`/api/questions/${id}`);
    if (res.ok) q = await res.json();
    else {
      const r2 = await fetch(`questions/${id}.json`);
      q = await r2.json();
    }
    currentQuestion = q;
    renderProblem();
    await loadStarterCode();
    renderList();
    if(resultsEl) resultsEl.innerHTML = `<div style="color:var(--muted);font-size:13px">Hit <strong>Run</strong> to test visible cases, <strong>Submit</strong> for all.</div>`;
    if(statusText) statusText.textContent = `Loaded: ${q.title}`;
    history.replaceState(null, "", `#${id}`);
    renderHistory();
  } catch (e) {
    console.error(e);
    toast("Failed to load question: " + id);
  }
}

function renderProblem() {
  if (!currentQuestion || !problemViewEl) return;
  const q = currentQuestion;
  problemViewEl.innerHTML = `
    <div class="problem-title">${esc(q.title)}</div>
    <div class="problem-meta">
      <span class="badge ${esc(q.difficulty)}">${esc(q.difficulty)}</span>
      <span style="color:var(--muted);font-size:13px">${(q.tags||[]).join(" · ")}</span>
    </div>
    <div class="problem-statement">${q.problemStatement}</div>
    ${q.examples ? `<div class="examples"><h3>Examples</h3>${q.examples.map((ex,i)=>`
      <div class="example-card">
        <div class="ex-row"><span class="ex-label">Input:</span> <pre>${esc(ex.input)}</pre></div>
        <div class="ex-row"><span class="ex-label">Output:</span> <pre>${esc(ex.output)}</pre></div>
        ${ex.explanation?`<div class="ex-row"><span class="ex-label">Explanation:</span> <span>${esc(ex.explanation)}</span></div>`:""}
      </div>`).join("")}</div>` : ""}
    ${q.constraints ? `<div class="constraints"><h3>Constraints</h3><ul>${q.constraints.map(c=>`<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    <div class="constraints"><h3>Test Cases</h3>
      <p style="color:var(--muted);font-size:13px">Visible: ${q.visibleTestCases.length} · Hidden: ${q.hiddenTestCases.length} (only on Submit)</p>
    </div>
  `;
}

function isCppCode(code){ return /#include|using namespace std|vector<|int\s+\w+\s*\(/.test(code); }
function isJsCode(code){ return /^\s*function\s+\w+\s*\(/.test(code); }
async function loadStarterCode() {
  if (!currentQuestion || !codeEditor) return;
  const starter = currentQuestion.starterCode[currentLang] || currentQuestion.starterCode.javascript || "";
  try {
    const res = await apiFetch(`/api/code/${encodeURIComponent(currentQuestion.id)}/${encodeURIComponent(currentLang)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.code !== null && data.code !== undefined) {
        codeEditor.value = data.code;
        localStorage.setItem(`code:${currentQuestion.id}:${currentLang}`, data.code);
        return;
      }
    }
  } catch {}
  const saved = localStorage.getItem(`code:${currentQuestion.id}:${currentLang}`);
  if (saved !== null) {
    if (currentLang === "cpp" && isJsCode(saved) && !isCppCode(saved)) {
      localStorage.removeItem(`code:${currentQuestion.id}:${currentLang}`);
      codeEditor.value = starter;
      return;
    }
    if (currentLang === "javascript" && isCppCode(saved) && !isJsCode(saved)) {
      localStorage.removeItem(`code:${currentQuestion.id}:${currentLang}`);
      codeEditor.value = starter;
      return;
    }
    codeEditor.value = saved;
  } else {
    codeEditor.value = starter;
  }
}

function saveCode() {
  if (!currentQuestion || !codeEditor) return;
  localStorage.setItem(`code:${currentQuestion.id}:${currentLang}`, codeEditor.value);
}
let lastDbSavedCode = "";
async function saveCodeToDb() {
  if (!currentQuestion || !codeEditor) return;
  const code = codeEditor.value;
  if (code === lastDbSavedCode) return;
  if (!code.trim()) return;
  try {
    const res = await apiFetch("/api/code/save", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ questionId: currentQuestion.id, language: currentLang, code })
    });
    if(res.status===401){
      toast("Login to autosave to DB");
      return;
    }
    lastDbSavedCode = code;
  } catch {}
}
setInterval(saveCodeToDb, 10000);
let saveDebounce = null;
function scheduleDbSave(){ clearTimeout(saveDebounce); saveDebounce=setTimeout(saveCodeToDb, 2000); }
if(codeEditor) codeEditor.addEventListener("input", () => { saveCode(); scheduleDbSave(); });
if(langSelect) langSelect.addEventListener("change", async () => {
  await saveCodeToDb();
  currentLang = langSelect.value;
  lastDbSavedCode = "";
  if (currentQuestion) await loadStarterCode();
});
if(resetBtn) resetBtn.addEventListener("click", () => {
  if (!currentQuestion) return;
  localStorage.removeItem(`code:${currentQuestion.id}:${currentLang}`);
  loadStarterCode();
  toast("Reset to starter code");
});
if(filterEl) filterEl.addEventListener("change", renderList);
document.getElementById("sort-select")?.addEventListener("change", renderList);
document.getElementById("tag-filter")?.addEventListener("change", renderList);
document.getElementById("search-input")?.addEventListener("input", renderList);
function populateTagFilter(){
  const sel=document.getElementById("tag-filter");
  if(!sel) return;
  const tags=[...new Set(questions.flatMap(q=>q.tags||[]))].sort();
  const cur=sel.value;
  sel.innerHTML='<option value="all">All tags</option>'+tags.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
  if(tags.includes(cur)) sel.value=cur;
}

const INDENT = currentLang === "cpp" || currentLang === "javascript" ? 4 : 4;
function getIndentSize() { return 4; }

if(codeEditor){
codeEditor.addEventListener("keydown", (e) => {
  const start = codeEditor.selectionStart, end = codeEditor.selectionEnd;
  const val = codeEditor.value;
  if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      const before = val.substring(0, start);
      const lineStart = before.lastIndexOf("\n") + 1;
      const blockStart = val.substring(lineStart, end);
      const unindented = blockStart.split("\n").map(l => l.replace(/^ {1,4}|\t/, "")).join("\n");
      codeEditor.value = val.substring(0, lineStart) + unindented + val.substring(end);
      const diff = blockStart.length - unindented.length;
      codeEditor.selectionStart = Math.max(lineStart, start - Math.min(4, 4));
      codeEditor.selectionEnd = end - diff;
    } else {
      if (start !== end) {
        const before = val.substring(0, start);
        const lineStart = before.lastIndexOf("\n") + 1;
        const selected = val.substring(lineStart, end);
        const indented = selected.split("\n").map(l => "    " + l).join("\n");
        codeEditor.value = val.substring(0, lineStart) + indented + val.substring(end);
        codeEditor.selectionStart = start + 4;
        codeEditor.selectionEnd = end + indented.length - selected.length;
      } else {
        codeEditor.value = val.substring(0, start) + "    " + val.substring(end);
        codeEditor.selectionStart = codeEditor.selectionEnd = start + 4;
      }
    }
    saveCode(); return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const before = val.substring(0, start);
    const after = val.substring(end);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = before.substring(lineStart);
    const indentMatch = line.match(/^(\s*)/);
    let indent = indentMatch ? indentMatch[1] : "";
    const trimmed = line.trim();
    if (/[\{\(:\[]\s*$/.test(trimmed) || /^\s*(if|for|while|else)\b.*/.test(trimmed) && !trimmed.endsWith(";")) {}
    let extra = "";
    if (trimmed.endsWith("{") || trimmed.endsWith("(") || trimmed.endsWith("[")) extra = "    ";
    const nextChar = after[0];
    if ((trimmed.endsWith("{") && nextChar === "}") || (trimmed.endsWith("(") && nextChar === ")")) {
      const newVal = before + "\n" + indent + extra + "\n" + indent + after;
      codeEditor.value = newVal;
      codeEditor.selectionStart = codeEditor.selectionEnd = before.length + 1 + indent.length + extra.length;
    } else {
      const insert = "\n" + indent + extra;
      codeEditor.value = before + insert + after;
      codeEditor.selectionStart = codeEditor.selectionEnd = before.length + insert.length;
    }
    saveCode(); return;
  }
  const pairs = { "{": "}", "(": ")", "[": "]", '"': '"', "'": "'" };
  if (pairs[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (val[end] === pairs[e.key] && e.key !== '"' && e.key !== "'") {
      e.preventDefault();
      codeEditor.selectionStart = codeEditor.selectionEnd = start + 1;
      return;
    }
    if (e.key === '"' || e.key === "'") {
      const prev = val[start - 1];
      if (prev && /[a-zA-Z0-9_]/.test(prev)) return;
    }
    if (e.key === "{" || e.key === "(" || e.key === "[" || e.key === '"' || e.key === "'") {
      if (start === end) {
        e.preventDefault();
        const close = pairs[e.key];
        codeEditor.value = val.substring(0, start) + e.key + close + val.substring(end);
        codeEditor.selectionStart = codeEditor.selectionEnd = start + 1;
        saveCode(); return;
      }
    }
  }
  if (e.key === "}" || e.key === ")" || e.key === "]") {
    if (val[end] === e.key) {
      e.preventDefault();
      codeEditor.selectionStart = codeEditor.selectionEnd = start + 1;
      return;
    }
  }
});
}

const formatBtn = document.getElementById("format-btn");
function fixSpacing(s) {
  const placeholders = [];
  s = s.replace(/("[^"]*"|'[^']*')/g, (m) => { placeholders.push(m); return `__STR${placeholders.length-1}__`; });
  const ops = ["==","!=","<=",">=","&&","||","<<",">>","++","--","+=","-=","*=","/=","%="];
  const opPlace = [];
  ops.forEach(op => {
    const esc2 = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(esc2, 'g'), (m) => { opPlace.push(m); return `__OP${opPlace.length-1}__`; });
  });
  s = s.replace(/,\s*/g, ', ');
  s = s.replace(/;\s*/g, '; ');
  s = s.replace(/; $/, ';');
  s = s.replace(/\s*=\s*/g, ' = ');
  s = s.replace(/\s*\+\s*/g, ' + ');
  s = s.replace(/\s*-\s*/g, ' - ');
  s = s.replace(/\s*\*\s*/g, ' * ');
  s = s.replace(/\s*\/\s*/g, ' / ');
  s = s.replace(/\s*%\s*/g, ' % ');
  s = s.replace(/\b(for|if|while|switch|catch)\s*\(/g, '$1 (');
  s = s.replace(/\)\s*\{/g, ') {');
  s = s.replace(/\}\s*else/g, '} else');
  s = s.replace(/else\s*\{/g, 'else {');
  opPlace.forEach((op, i) => {
    const spaced = (op === "++" || op === "--") ? op : ` ${op} `;
    s = s.replace(`__OP${i}__`, spaced);
  });
  placeholders.forEach((ph, i) => { s = s.replace(`__STR${i}__`, ph); });
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\(\s+/g, '(');
  s = s.replace(/\s+\)/g, ')');
  s = s.replace(/\[\s+/g, '[');
  s = s.replace(/\s+\]/g, ']');
  s = s.replace(/\s+,/g, ',');
  s = s.replace(/\s+;/g, ';');
  return s.trim();
}
function formatCode(code) {
  const size = 4;
  let indent = 0;
  const lines = code.split("\n");
  const out = [];
  for (let raw of lines) {
    let trimmed = raw.trim();
    if (!trimmed) { out.push(""); continue; }
    if (trimmed.startsWith("#")) { out.push(trimmed); continue; }
    trimmed = fixSpacing(trimmed);
    const leadingCloses = (() => {
      const m = trimmed.match(/^[}\]\)]+/);
      return m ? m[0].length : 0;
    })();
    if (leadingCloses) indent = Math.max(0, indent - leadingCloses);
    out.push(" ".repeat(indent * size) + trimmed);
    const rest = trimmed.slice(leadingCloses);
    const opens = (rest.match(/\{/g) || []).length;
    const closes = (rest.match(/\}/g) || []).length;
    let delta = opens - closes;
    if (trimmed.endsWith(":") && !trimmed.includes("?") && !trimmed.startsWith("case")) delta += 1;
    indent = Math.max(0, indent + delta);
    if (/[\(\[]\s*$/.test(trimmed) && !/[\]\)]\s*$/.test(trimmed)) indent++;
  }
  return out.join("\n");
}
if(formatBtn) formatBtn.addEventListener("click", () => {
  const before = codeEditor.value;
  const pos = codeEditor.selectionStart;
  const beforeLines = before.slice(0, pos).split("\n");
  const lineIdx = beforeLines.length - 1;
  const col = beforeLines[beforeLines.length - 1].length;
  const formatted = formatCode(before);
  codeEditor.value = formatted;
  const newLines = formatted.split("\n");
  const targetLine = Math.min(lineIdx, newLines.length - 1);
  const newLineLen = newLines[targetLine].length;
  const newCol = Math.min(col, newLineLen);
  const newPos = newLines.slice(0, targetLine).join("\n").length + (targetLine > 0 ? 1 : 0) + newCol;
  codeEditor.selectionStart = codeEditor.selectionEnd = Math.min(newPos, formatted.length);
  saveCode();
  toast("Formatted");
});

function renderResults(payload) {
  if(!resultsEl) return;
  const { mode, results, total, passed } = payload;
  const allPass = passed === total;
  resultsEl.innerHTML = `
    <div class="results-header">
      <div class="results-title">${mode==="run" ? "Run — Visible Tests" : "Submit — All Tests"}</div>
      <span class="results-summary ${allPass?'pass':'fail'}">${passed} / ${total} passed</span>
    </div>
    ${results.map((r,i)=>`
      <div class="test-case ${i===0?'open':''}">
        <div class="test-case-header">
          <span class="test-label"><span class="dot ${r.passed?'pass':'fail'}"></span> Case ${i+1} ${r.hidden ? '(hidden)' : ''} — ${r.passed?'Passed':'Failed'}</span>
          <span class="test-vis">${r.hidden ? 'hidden' : 'visible'}${r.timeMs!=null?` · ${r.timeMs}ms`:''}</span>
        </div>
        <div class="test-body">
          <div class="kv"><span class="kv-label">Input</span><span class="kv-value"><pre>${esc(JSON.stringify(r.input, null, 2))}</pre></span></div>
          <div class="kv"><span class="kv-label">Expected</span><span class="kv-value"><pre>${esc(JSON.stringify(r.expected, null, 2))}</pre></span></div>
          <div class="kv"><span class="kv-label">Got</span><span class="kv-value ${r.error?'error':''}"><pre>${esc(r.error ? r.error : JSON.stringify(r.actual, null, 2))}</pre></span></div>
          ${r.error?`<div class="kv"><span class="kv-label">Error</span><span class="kv-value error"><pre>${esc(r.error)}</pre></span></div>`:""}
        </div>
      </div>
    `).join("")}
  `;
  resultsEl.querySelectorAll(".test-case-header").forEach((h, idx) => {
    h.addEventListener("click", () => h.parentElement.classList.toggle("open"));
  });
  if(lastRunMeta) lastRunMeta.textContent = `${mode} · ${passed}/${total} · ${new Date().toLocaleTimeString()}`;
  if(statusText) statusText.textContent = allPass ? "All tests passed ✓" : `${total-passed} test(s) failed`;
}

async function localRun(mode) {
  if (!currentQuestion) { toast("Select a problem first"); return; }
  const code = codeEditor.value;
  if (!code.trim()) { toast("Write some code first"); return; }
  if (currentLang !== "javascript") { toast("Local fallback only supports JavaScript. Run `node server.js` for Python/C++."); return; }
  const testCases = mode==="run" ? currentQuestion.visibleTestCases : [...currentQuestion.visibleTestCases, ...currentQuestion.hiddenTestCases];
  const results = [];
  let passed = 0;
  for (const tc of testCases) {
    const isHidden = mode==="submit" && currentQuestion.hiddenTestCases.some(h=>h.id===tc.id);
    const start = performance.now();
    try {
      const fnName = currentQuestion.functionName;
      const params = currentQuestion.params;
      const args = params.map(p => JSON.stringify(tc.input[p]));
      const wrapped = `
        ${code}
        ; return (${fnName}).apply(null, [${args.join(",")}]);
      `;
      const fn = new Function(wrapped);
      let actual = fn();
      if (actual === undefined && params.length===1) {
        const capture = `
          ${code}
          let _input = ${args[0]};
          let _orig = JSON.parse(JSON.stringify(_input));
          let _ret = (${fnName})(_input);
          if (_ret === undefined) _ret = _input;
          return _ret;
        `;
        const fn2 = new Function(capture);
        actual = fn2();
      }
      const ok = deepEqual(actual, tc.expectedOutput);
      if (ok) passed++;
      results.push({ testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual, hidden: isHidden, timeMs: Math.round(performance.now()-start) });
    } catch (e) {
      results.push({ testCaseId: tc.id, passed: false, input: tc.input, expected: tc.expectedOutput, actual: null, error: String(e.message||e), hidden: isHidden, timeMs: Math.round(performance.now()-start) });
    }
  }
  const payload = { mode, results, total: testCases.length, passed };
  renderResults(payload);
  saveHistoryEntry({
    id: Date.now() + "_" + Math.random().toString(36).slice(2,6),
    ts: Date.now(),
    questionId: currentQuestion.id,
    title: currentQuestion.title,
    language: currentLang,
    mode,
    code,
    passed,
    total: testCases.length,
    results
  });
}

// ---------- History (DB + local fallback) ----------
const HISTORY_KEY = "dsa_history_v1";
const HISTORY_LIMIT = 100;
let historyCache = [];
async function fetchHistoryFromDb() {
  try {
    const q = currentQuestion ? `?questionId=${encodeURIComponent(currentQuestion.id)}&limit=50` : `?limit=50`;
    const res = await apiFetch(`/api/submissions${q}`);
    if (!res.ok) throw new Error();
    const rows = await res.json();
    historyCache = rows.map(r => ({ ...r, ts: r.ts || new Date(r.createdAt).getTime() }));
    return historyCache;
  } catch {
    try { historyCache = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { historyCache = []; }
    return historyCache;
  }
}
function loadHistory() { return historyCache; }
async function saveHistoryEntry(entry) {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    h.unshift(entry);
    if (h.length > HISTORY_LIMIT) h.length = HISTORY_LIMIT;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {}
  try {
    const res = await apiFetch("/api/submissions", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        questionId: entry.questionId,
        title: entry.title,
        language: entry.language,
        mode: entry.mode,
        code: entry.code,
        passed: entry.passed,
        total: entry.total,
        results: entry.results
      })
    });
    if(res && res.status===401){
      // not logged in — history stays local only
    }
  } catch {}
  await renderHistory();
  // after submit success, refresh solved indicators
  if(entry.mode==="submit" && entry.passed===entry.total){
    await refreshSolvedState();
    renderList();
  } else if(entry.mode==="submit"){
    await refreshSolvedState();
    renderList();
  }
}
async function renderHistory() {
  const listEl = document.getElementById("history-list");
  const detailEl = document.getElementById("history-detail");
  if (!listEl) return;
  const all = await fetchHistoryFromDb();
  const filtered = all;
  // detect read-only view (other user's dashboard)
  const isReadOnly = window.__DASHBOARD_READONLY === true;
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-hist">No runs yet.<br>Hit Run or Submit.</div>`;
    if (detailEl) detailEl.innerHTML = `<div class="empty-hist">History saved to DB (and local) — persists across devices. Every Run/Submit + code autosave every 10s to DB.</div>`;
    return;
  }
  listEl.innerHTML = filtered.slice(0, 20).map((e) => {
    const d = new Date(e.ts);
    const time = d.toLocaleTimeString() + " " + d.toLocaleDateString();
    const badge = e.passed === e.total ? "pass" : "fail";
    const label = e.mode === "run" ? "Run" : "Submit";
    return `<div class="history-item" data-hid="${e.id}">
      <div class="hist-top"><span class="hist-q">${esc(e.title || e.questionId)}</span><span class="hist-badge ${badge}">${e.passed}/${e.total}</span></div>
      <div class="hist-meta"><span>${label} · ${esc(e.language)}</span><span>${esc(time)}</span></div>
      ${isReadOnly ? "" : `<div class="hist-actions"><button class="btn ghost restore-btn" data-hid="${e.id}">Restore</button><button class="btn ghost view-btn" data-hid="${e.id}">View</button></div>`}
    </div>`;
  }).join("");
  if(isReadOnly) return;
  const findById = (hid) => all.find(x => String(x.id) === String(hid));
  listEl.querySelectorAll(".restore-btn").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const e = findById(btn.dataset.hid);
      if (!e) return;
      currentLang = e.language;
      if(langSelect) langSelect.value = currentLang;
      codeEditor.value = e.code;
      saveCode();
      toast(`Restored ${e.language} code from ${new Date(e.ts).toLocaleTimeString()}`);
      if (currentQuestion && e.questionId !== currentQuestion.id) loadQuestion(e.questionId);
    });
  });
  listEl.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const e = findById(btn.dataset.hid);
      if (detailEl) showHistoryDetail(e);
    });
  });
  listEl.querySelectorAll(".history-item").forEach(el => {
    el.addEventListener("click", () => {
      const e = findById(el.dataset.hid);
      if (detailEl) showHistoryDetail(e);
      listEl.querySelectorAll(".history-item").forEach(x => x.classList.remove("active"));
      el.classList.add("active");
    });
  });
}
function showHistoryDetail(e) {
  const detailEl = document.getElementById("history-detail");
  if (!detailEl) return;
  const isReadOnly = window.__DASHBOARD_READONLY === true;
  detailEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center"><strong>${esc(e.title || e.questionId)} · ${e.mode} · ${esc(e.language)} · ${e.passed}/${e.total}</strong><span style="color:var(--muted);font-size:11px">${new Date(e.ts).toLocaleString()}</span></div>
    ${isReadOnly ? "<div style='color:var(--muted);font-size:12px;margin-top:6px'>Read-only view — code hidden for other user</div>" : `<div style="margin-top:6px;display:flex;gap:6px"><button class="btn ghost" id="hist-copy">Copy code</button><button class="btn ghost" id="hist-restore">Restore to editor</button></div>
    <pre>${esc((e.code||"").slice(0, 4000))}${(e.code||"").length > 4000 ? "\n...truncated" : ""}</pre>`}
    <div style="margin-top:8px"><strong>Results:</strong> ${e.results ? e.results.map((r,i)=>`<div style="margin-top:4px;padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--panel2)"><span class="dot ${r.passed?'pass':'fail'}"></span> Case ${i+1} ${r.hidden?'(hidden)':''} — ${r.passed?'Passed':'Failed'}<br><small>Input: ${esc(JSON.stringify(r.input))} | Expected: ${esc(JSON.stringify(r.expected))} | Got: ${esc(r.error || JSON.stringify(r.actual))}</small></div>`).join("") : "no results"}</div>
  `;
  if(isReadOnly) return;
  detailEl.querySelector("#hist-copy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(e.code); toast("Copied"); } catch { toast("Copy failed"); }
  });
  detailEl.querySelector("#hist-restore")?.addEventListener("click", () => {
    currentLang = e.language; if(langSelect) langSelect.value = currentLang;
    codeEditor.value = e.code; saveCode(); toast("Restored to editor");
  });
}
document.getElementById("clear-history-btn")?.addEventListener("click", async () => {
  if(window.__DASHBOARD_READONLY){ toast("Read-only — cannot clear"); return; }
  if (!confirm("Clear history? (local only, DB submissions remain)")) return;
  localStorage.removeItem(HISTORY_KEY);
  await renderHistory();
  toast("Local history cleared");
});
document.getElementById("export-history-btn")?.addEventListener("click", async () => {
  const all = await fetchHistoryFromDb();
  const data = JSON.stringify(all, null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "dsa-history.json"; a.click(); URL.revokeObjectURL(url);
});

async function execute(mode) {
  if (!currentQuestion) { toast("Select a problem first"); return; }
  const code = codeEditor.value;
  if (!code.trim()) { toast("Write some code first"); return; }
  saveCode();
  if(runBtn) runBtn.disabled = true; if(submitBtn) submitBtn.disabled = true;
  if(statusText) statusText.textContent = mode==="run" ? "Running visible tests..." : "Submitting (all tests)...";
  if(resultsEl) resultsEl.innerHTML = `<div style="color:var(--muted);font-size:13px">Executing…</div>`;
  let payload = null;
  let execError = null;
  try {
    const res = await apiFetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: currentQuestion.id, code, language: currentLang, mode })
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({error: res.statusText}));
      if(res.status===401) toast("Please login to run code");
      throw new Error(err.error || "execution failed");
    }
    payload = await res.json();
    renderResults(payload);
  } catch (e) {
    console.warn("API execute failed, fallback local", e);
    if (String(e.message).includes("Failed to fetch") || String(e.message).includes("fetch")) {
      await localRun(mode);
      payload = null;
    } else {
      execError = String(e.message);
      if(resultsEl) resultsEl.innerHTML = `<div class="test-case"><div class="test-body" style="display:block;color:#ff8a9a"><pre>${esc(execError)}</pre></div></div>`;
      if(statusText) statusText.textContent = "Execution error";
    }
  } finally {
    if(runBtn) runBtn.disabled = false; if(submitBtn) submitBtn.disabled = false;
    if (payload) {
      saveHistoryEntry({
        id: Date.now() + "_" + Math.random().toString(36).slice(2,6),
        ts: Date.now(),
        questionId: currentQuestion.id,
        title: currentQuestion.title,
        language: currentLang,
        mode,
        code,
        passed: payload.passed,
        total: payload.total,
        results: payload.results
      });
    } else if (execError) {
      saveHistoryEntry({
        id: Date.now() + "_" + Math.random().toString(36).slice(2,6),
        ts: Date.now(),
        questionId: currentQuestion.id,
        title: currentQuestion.title,
        language: currentLang,
        mode,
        code,
        passed: 0,
        total: 0,
        results: [{ passed:false, error: execError, input:{}, expected:null, actual:null, hidden:false }]
      });
    }
  }
}

if(runBtn) runBtn.addEventListener("click", () => execute("run"));
if(submitBtn) submitBtn.addEventListener("click", () => execute("submit"));

// ---------- Add Question Modal ----------
const addBtn = $("#add-question-btn");
const modal = $("#add-modal");
const modalBackdrop = $("#modal-backdrop");
const modalClose = $("#modal-close");
const modalCancel = $("#modal-cancel");
const jsonTextarea = $("#new-question-json");
const jsonError = $("#json-error");
const formError = $("#form-error");
const loadTemplateBtn = $("#load-template-btn");
const validateBtn = $("#validate-btn");
const saveBtn = $("#save-question-btn");
const importFile = $("#import-file");

const TEMPLATE = {
  id: "my-question",
  title: "My Question",
  difficulty: "Easy",
  tags: ["Array"],
  problemStatement: "Describe the problem here. Supports <code>inline code</code> and <ul><li>lists</li></ul>",
  constraints: ["1 <= n <= 10^5"],
  examples: [{ input: "nums = [1,2,3], target = 3", output: "[0,1]", explanation: "Because ..." }],
  functionName: "solve",
  pythonFunctionName: "solve",
  params: ["nums", "target"],
  starterCode: {
    javascript: "function solve(nums, target) {\n  // write code here\n}",
    python: "def solve(nums, target):\n    # write code here\n    pass",
    cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nvector<int> solve(vector<int>& nums, int target) {\n    // write code here\n    \n}"
  },
  visibleTestCases: [{ id: "v1", input: { nums: [1,2,3], target: 3 }, expectedOutput: [0,1] }],
  hiddenTestCases: [{ id: "h1", input: { nums: [0,0], target: 0 }, expectedOutput: [0,1] }],
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nvector<int> solve(vector<int>& nums, int target) {\n    \n}"
};

function openModal() {
  if(!modal || !jsonTextarea) return;
  modal.classList.remove("hidden");
  if (!jsonTextarea.value.trim()) jsonTextarea.value = JSON.stringify(TEMPLATE, null, 2);
}
function closeModal() { if(!modal) return; modal.classList.add("hidden"); if(jsonError) jsonError.classList.add("hidden"); if(formError) formError.classList.add("hidden"); }
if(addBtn) addBtn.addEventListener("click", openModal);
if(modalClose) modalClose.addEventListener("click", closeModal);
if(modalCancel) modalCancel.addEventListener("click", closeModal);
if(modalBackdrop) modalBackdrop.addEventListener("click", closeModal);
document.addEventListener("keydown", e => { if (e.key==="Escape" && modal && !modal.classList.contains("hidden")) closeModal(); });

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
  });
});

if(loadTemplateBtn) loadTemplateBtn.addEventListener("click", () => {
  jsonTextarea.value = JSON.stringify(TEMPLATE, null, 2);
  jsonError.textContent = "Template loaded. Edit id/title and tests.";
  jsonError.classList.remove("hidden"); jsonError.classList.add("ok");
  setTimeout(()=>jsonError.classList.add("hidden"), 2000);
});

if(importFile) importFile.addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const text = await file.text();
  jsonTextarea.value = text;
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
  document.querySelector('[data-tab="json"]').classList.add("active");
  $("#tab-json").classList.add("active");
  toast("Imported " + file.name);
});

function validateQuestion(q) {
  const errs = [];
  if (!q.id || !/^[a-z0-9-]+$/.test(q.id)) errs.push("id must match ^[a-z0-9-]+$ (e.g. two-sum)");
  if (!q.title) errs.push("title required");
  if (!["Easy","Medium","Hard"].includes(q.difficulty)) errs.push("difficulty must be Easy/Medium/Hard");
  if (!q.problemStatement) errs.push("problemStatement required");
  if (!q.functionName) errs.push("functionName required");
  if (!Array.isArray(q.params) || q.params.length===0) errs.push("params must be non-empty array");
  if (!q.starterCode || !q.starterCode.javascript) errs.push("starterCode.javascript required");
  if (!Array.isArray(q.visibleTestCases) || q.visibleTestCases.length===0) errs.push("visibleTestCases must have at least 1");
  if (!Array.isArray(q.hiddenTestCases)) errs.push("hiddenTestCases must be array");
  const allCases = [...(q.visibleTestCases||[]), ...(q.hiddenTestCases||[])];
  for (const tc of allCases) {
    if (!tc.id || !tc.input || tc.expectedOutput===undefined) errs.push(`test case ${tc.id||"?"} missing id/input/expectedOutput`);
    if (tc.input) {
      for (const p of q.params) if (!(p in tc.input)) errs.push(`test case ${tc.id}: missing param "${p}" in input`);
    }
  }
  return errs;
}

if(validateBtn) validateBtn.addEventListener("click", () => {
  try {
    const q = JSON.parse(jsonTextarea.value);
    const errs = validateQuestion(q);
    if (errs.length) {
      jsonError.textContent = "Validation failed:\n- " + errs.join("\n- ");
      jsonError.classList.remove("hidden","ok");
    } else {
      jsonError.textContent = "✓ Valid JSON — ready to save.";
      jsonError.classList.remove("hidden"); jsonError.classList.add("ok");
    }
    jsonError.classList.remove("hidden");
  } catch (e) {
    jsonError.textContent = "Invalid JSON: " + e.message;
    jsonError.classList.remove("hidden","ok");
  }
});

document.getElementById("form-to-json-btn")?.addEventListener("click", () => {
  try {
    const q = {
      id: $("#f-id").value.trim(),
      title: $("#f-title").value.trim(),
      difficulty: $("#f-diff").value,
      tags: $("#f-tags").value.split(",").map(s=>s.trim()).filter(Boolean),
      problemStatement: $("#f-statement").value.trim(),
      constraints: $("#f-constraints").value.split("\n").map(s=>s.trim()).filter(Boolean),
      examples: JSON.parse($("#f-examples").value.trim() || "[]"),
      functionName: $("#f-fn").value.trim(),
      pythonFunctionName: $("#f-pyfn").value.trim() || undefined,
      params: $("#f-params").value.split(",").map(s=>s.trim()).filter(Boolean),
      starterCode: {
        javascript: $("#f-starter-js").value,
        python: $("#f-starter-py").value || undefined
      },
      visibleTestCases: JSON.parse($("#f-visible").value.trim() || "[]"),
      hiddenTestCases: JSON.parse($("#f-hidden").value.trim() || "[]")
    };
    if (!q.pythonFunctionName) delete q.pythonFunctionName;
    if (!q.starterCode.python) delete q.starterCode.python;
    const errs = validateQuestion(q);
    if (errs.length) throw new Error(errs.join("; "));
    jsonTextarea.value = JSON.stringify(q, null, 2);
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    document.querySelector('[data-tab="json"]').classList.add("active");
    $("#tab-json").classList.add("active");
    jsonError.textContent = "✓ Generated from form. Review and Save.";
    jsonError.classList.remove("hidden"); jsonError.classList.add("ok");
    toast("Generated JSON from form");
  } catch (e) {
    formError.textContent = "Form error: " + e.message;
    formError.classList.remove("hidden");
    setTimeout(()=>formError.classList.add("hidden"), 4000);
  }
});

if(saveBtn) saveBtn.addEventListener("click", async () => {
  let q;
  try { q = JSON.parse(jsonTextarea.value); } catch (e) {
    jsonError.textContent = "Invalid JSON: " + e.message; jsonError.classList.remove("hidden","ok"); return;
  }
  const errs = validateQuestion(q);
  if (errs.length) {
    jsonError.textContent = "Fix errors:\n- " + errs.join("\n- "); jsonError.classList.remove("hidden","ok"); return;
  }
  saveBtn.disabled = true; saveBtn.textContent = "Saving...";
  try {
    const res = await apiFetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "save failed");
    toast(`Saved ${q.id}.json ✓`);
    closeModal();
    await fetchQuestions(); renderList();
    await loadQuestion(q.id);
  } catch (e) {
    jsonError.textContent = "Save failed: " + e.message + (String(e.message).includes("Failed to fetch") ? " — is server running? Use manual drop into /questions instead." : "");
    jsonError.classList.remove("hidden","ok");
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = "Save to questions/";
  }
});

// ---------- UI: Resizable + Tabs + Sidebar ----------
const menuToggle = document.getElementById("menu-toggle");
const sidebar = document.getElementById("sidebar");
const sidebarResizer = document.getElementById("sidebar-resizer");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const mainResizer = document.getElementById("main-resizer");
const editorResizer = document.getElementById("editor-resizer");
const problemPane = document.getElementById("problem-pane");
const editorPane = document.getElementById("editor-pane");
const editorTop = document.getElementById("editor-top");
const editorBottom = document.getElementById("editor-bottom");

function openSidebar(){ if(sidebar) sidebar.classList.remove("hidden"); if(sidebarResizer) sidebarResizer.classList.remove("hidden"); }
function closeSidebar(){ if(sidebar) sidebar.classList.add("hidden"); if(sidebarResizer) sidebarResizer.classList.add("hidden"); }
if(menuToggle) menuToggle.addEventListener("click", () => {
  if (sidebar && sidebar.classList.contains("hidden")) openSidebar(); else closeSidebar();
});

document.querySelectorAll(".ptab").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".ptab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".ptab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("ptab-"+btn.dataset.ptab).classList.add("active");
  });
});

function makeVerticalResizer(resizer, leftEl, rightEl){
  if(!resizer || !leftEl) return;
  let startX=0, startLeftW=0, startRightW=0, dragging=false;
  resizer.addEventListener("mousedown", e=>{
    dragging=true; startX=e.clientX;
    startLeftW=leftEl.getBoundingClientRect().width;
    if(rightEl) startRightW=rightEl.getBoundingClientRect().width;
    resizer.classList.add("dragging");
    document.body.style.cursor="col-resize"; document.body.style.userSelect="none";
    e.preventDefault();
  });
  window.addEventListener("mousemove", e=>{
    if(!dragging) return;
    const dx=e.clientX-startX;
    const newLeft=Math.max(200, Math.min(520, startLeftW+dx));
    leftEl.style.flex=`0 0 ${newLeft}px`;
  });
  window.addEventListener("mouseup", ()=>{
    if(!dragging) return;
    dragging=false; resizer.classList.remove("dragging");
    document.body.style.cursor=""; document.body.style.userSelect="";
  });
}
function makeHorizontalResizer(resizer, topEl, bottomEl){
  if(!resizer || !topEl) return;
  let startY=0, startTopH=0, dragging=false;
  resizer.addEventListener("mousedown", e=>{
    dragging=true; startY=e.clientY;
    startTopH=topEl.getBoundingClientRect().height;
    resizer.classList.add("dragging");
    document.body.style.cursor="row-resize"; document.body.style.userSelect="none";
    e.preventDefault();
  });
  window.addEventListener("mousemove", e=>{
    if(!dragging) return;
    const dy=e.clientY-startY;
    const newTop=Math.max(120, Math.min(600, startTopH+dy));
    topEl.style.flex=`0 0 ${newTop}px`;
  });
  window.addEventListener("mouseup", ()=>{
    if(!dragging) return;
    dragging=false; resizer.classList.remove("dragging");
    document.body.style.cursor=""; document.body.style.userSelect="";
  });
}
makeVerticalResizer(sidebarResizer, sidebar, document.getElementById("main"));
makeVerticalResizer(mainResizer, problemPane, editorPane);
makeHorizontalResizer(editorResizer, editorTop, editorBottom);

async function init() {
  await checkAuth();
  await fetchQuestions();
  await refreshSolvedState();
  populateTagFilter();
  renderList();
  renderHistory();
  const hash = location.hash.slice(1);
  if (hash && questions.some(q=>q.id===hash)) await loadQuestion(hash);
  else if (questions.length) await loadQuestion(questions[0].id);
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (id && (!currentQuestion || id!==currentQuestion.id)) loadQuestion(id);
  });
}
init();
