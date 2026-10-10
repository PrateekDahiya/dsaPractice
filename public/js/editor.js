// editor.js — editor adapter, starter code, autosave, formatting, key handling. Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.


// ---------- Editor adapter (own-editor when active, CodeMirror compat, textarea fallback) ----------
function getCode(){
  if (window.__oe && window.__oeActive) { try { return window.__oe.getValue(); } catch {} }
  if (window.__cm && window.__cmActive) { try { return window.__cm.getValue(); } catch {} }
  return codeEditor ? codeEditor.value : "";
}

function setCode(v){
  if (codeEditor) codeEditor.value = v;
  if (window.__oe && window.__oeActive) { try { window.__oe.setValue(v); } catch {} }
  if (window.__cm && window.__cmActive) { try { window.__cm.setValue(v); } catch {} }
}

function syncQuestionCtx(){
  window.__cmLang = currentLang;
  if (currentQuestion) {
    window.__questionCtx = {
      functionName: currentQuestion.cppFunctionName || currentQuestion.functionName,
      params: currentQuestion.params,
    };
  }
  if (window.__cm && window.__cmActive) { try { window.__cm.setLanguage(currentLang); } catch {} }
  if (window.__oe && typeof window.__oe.setLanguage === "function") { try { window.__oe.setLanguage(currentLang); } catch {} }
}

window.__onEditorInput = () => { try { saveCode(); scheduleDbSave(); } catch {} };


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
        setCode(data.code);
        localStorage.setItem(`code:${currentQuestion.id}:${currentLang}`, data.code);
        return;
      }
    }
  } catch {}
  const saved = localStorage.getItem(`code:${currentQuestion.id}:${currentLang}`);
  if (saved !== null) {
    if (currentLang === "cpp" && isJsCode(saved) && !isCppCode(saved)) {
      localStorage.removeItem(`code:${currentQuestion.id}:${currentLang}`);
      setCode(starter);
      return;
    }
    if (currentLang === "javascript" && isCppCode(saved) && !isJsCode(saved)) {
      localStorage.removeItem(`code:${currentQuestion.id}:${currentLang}`);
      setCode(starter);
      return;
    }
    setCode(saved);
  } else {
    setCode(starter);
  }
}


function saveCode() {
  if (!currentQuestion || !codeEditor) return;
  localStorage.setItem(`code:${currentQuestion.id}:${currentLang}`, getCode());
}

let lastDbSavedCode = "";

async function saveCodeToDb() {
  if (!currentQuestion || !codeEditor) return;
  try { if (document.hidden) return; } catch {}
  const code = getCode();
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

setInterval(saveCodeToDb, 20000);

let saveDebounce = null;

function scheduleDbSave(){ clearTimeout(saveDebounce); saveDebounce=setTimeout(saveCodeToDb, 4000); }

if(codeEditor) codeEditor.addEventListener("input", () => { saveCode(); scheduleDbSave(); });

if(langSelect) langSelect.addEventListener("change", async () => {
  await saveCodeToDb();
  currentLang = langSelect.value;
  lastDbSavedCode = "";
  syncQuestionCtx();
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
  if (window.__cmActive || window.__oeActive) return; // CodeMirror / own-editor handles keys when active
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
    // skip-over only for closers typed when next char is the same closer;
    // never skip on openers (fixes: typing '(' before ')' must insert, not jump)
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
  const before = getCode();
  const cmActive = !!((window.__cm && window.__cmActive) || window.__oeActive);
  const pos = cmActive ? before.length : codeEditor.selectionStart;
  const beforeLines = before.slice(0, pos).split("\n");
  const lineIdx = beforeLines.length - 1;
  const col = beforeLines[beforeLines.length - 1].length;
  const formatted = formatCode(before);
  setCode(formatted);
  if (!cmActive) {
    const newLines = formatted.split("\n");
    const targetLine = Math.min(lineIdx, newLines.length - 1);
    const newLineLen = newLines[targetLine].length;
    const newCol = Math.min(col, newLineLen);
    const newPos = newLines.slice(0, targetLine).join("\n").length + (targetLine > 0 ? 1 : 0) + newCol;
    codeEditor.selectionStart = codeEditor.selectionEnd = Math.min(newPos, formatted.length);
  }
  saveCode();
  toast("Formatted");
});
