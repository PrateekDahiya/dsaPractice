// run.js — Run/Submit execution (server + local fallback). Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.


function fmtMem(kb){ if(kb==null) return ""; return kb>=1024?` · ~${(kb/1024).toFixed(1)} MB`:` · ~${kb} KB`; }

// Compact one-line JSON for short values (readable at a glance), pretty only
// when long. Stops nested arrays like 4Sum expected-outputs exploding vertically.
function fmtJson(v){
  try {
    const compact = JSON.stringify(v);
    if (compact === undefined) return "undefined";
    if (compact.length <= 160) return compact;
    return JSON.stringify(v, null, 2);
  } catch { try { return String(v); } catch { return "?"; } }
}

function runStatsHtml(results){
  if(!results || !results.length) return "";
  const times=results.map(r=>r.timeMs||0);
  const avg=Math.round(times.reduce((a,b)=>a+b,0)/times.length);
  const max=Math.max(...times);
  const mems=results.map(r=>r.memKb).filter(m=>m!=null);
  const mem=mems.length?` · 🧠 max${fmtMem(Math.max(...mems))}`:" · 🧠 memory n/a";
  return `<div class="run-stats" style="font-size:12px;color:var(--muted);margin:-4px 0 10px">⏱ avg ${avg}ms · max ${max}ms${mem}</div>`;
}


async function localRun(mode) {
  if (!currentQuestion) { toast("Select a problem first"); return; }
  const code = getCode();
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


async function execute(mode) {
  if (!currentQuestion) { toast("Select a problem first"); return; }
  const code = getCode();
  if (!code.trim()) { toast("Write some code first"); return; }
  saveCode();
  showLoader();
  if(runBtn) { runBtn.disabled = true; runBtn.innerHTML = `<span class="loading" style="padding:0;gap:6px">Running...</span>`; }
  if(submitBtn) submitBtn.disabled = true;
  if(statusText) statusText.textContent = mode==="run" ? "Running visible tests..." : "Submitting (all tests)...";
  if(resultsEl) resultsEl.innerHTML = `<div class="loading">Executing ${mode==="run"?"visible":"all"} tests...</div>`;
  let payload = null;
  let execError = null;
  window.__lastComplexity = null;
  window.__lastSubmissionId = null;
  // Best: per-testcase API — UI renders each case immediately, no waiting for all
  try {
    const total = currentQuestion.visibleTestCases.length + (mode==="submit"?currentQuestion.hiddenTestCases.length:0);
    let results = [];
    if(resultsEl) resultsEl.innerHTML = `<div class="results-header"><div class="results-title">${mode==="run"?"Run — Visible Tests":"Submit — All Tests"} (live...)</div><span class="results-summary">0 / ${total}</span></div><div id="stream-results"></div>`;
    const streamContainer = document.getElementById("stream-results");
    const appendCase = (r, idx) => {
      const div = document.createElement("div");
      div.className = "test-case open";
      div.innerHTML = `<div class="test-case-header"><span class="test-label"><span class="dot ${r.passed?'pass':'fail'}"></span> Case ${idx+1} ${r.hidden?'(hidden)':''} — ${r.passed?'Passed':'Failed'}</span><span class="test-vis">${r.hidden?'hidden':'visible'}${r.timeMs?` · ${r.timeMs}ms`:''}${fmtMem(r.memKb)}</span></div><div class="test-body" style="display:block"><div class="kv"><span class="kv-label">Input</span><span class="kv-value"><pre>${esc(fmtJson(r.input))}</pre></span></div><div class="kv"><span class="kv-label">Expected</span><span class="kv-value"><pre>${esc(fmtJson(r.expected))}</pre></span></div><div class="kv"><span class="kv-label">Got</span><span class="kv-value ${r.error?'error':''}"><pre>${esc(r.error?r.error:fmtJson(r.actual))}</pre></span></div></div>`;
      if(streamContainer) streamContainer.appendChild(div);
      const hdr = resultsEl.querySelector(".results-summary");
      if(hdr) hdr.textContent = `${results.filter(x=>x.passed).length} / ${total} passed`;
      if(statusText) statusText.textContent = `${results.length}/${total} done (${results.filter(x=>x.passed).length} passed)`;
    };
    // fire sequentially so each renders as soon as it resolves (first pays compile ~1s, rest cached instant)
    for(let i=0;i<total;i++){
      // transient 429 (concurrent compile / background PCH build) => backoff-retry, not an error
      let resCase = null;
      for(let attempt=0; attempt<6; attempt++){
        resCase = await apiFetch("/api/execute/case", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: currentQuestion.id, code, language: currentLang, mode, index: i })
        });
        if(resCase.status!==429 || attempt===5) break;
        if(statusText) statusText.textContent = `Server busy, retrying case ${i+1} in 3s... (attempt ${attempt+1}/5)`;
        await new Promise(r=>setTimeout(r, 3000));
      }
      if(!resCase.ok){
        const err = await resCase.json().catch(()=>({error: resCase.statusText}));
        throw new Error(err.error||"case failed");
      }
      const r = await resCase.json();
      results.push(r);
      appendCase(r, i);
    }
    payload = { mode, total, passed: results.filter(r=>r.passed).length, results };
    renderResults(payload);
    if(mode==="submit") requestComplexity(currentQuestion, code, currentLang);
    hideLoader();
    if(runBtn) { runBtn.disabled = false; runBtn.textContent = "Run"; }
    if(submitBtn) submitBtn.disabled = false;
    if(payload) saveHistoryEntry({ id: Date.now()+"_"+Math.random().toString(36).slice(2,6), ts: Date.now(), questionId: currentQuestion.id, title: currentQuestion.title, language: currentLang, mode, code, passed: payload.passed, total: payload.total, results: payload.results });
    return;
  } catch(e) {
    console.log("per-case failed, fallback to batch", String(e).slice(0,120));
    if(resultsEl) resultsEl.innerHTML = `<div class="loading">Retrying batch...</div>`;
  }
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
    if(mode==="submit") requestComplexity(currentQuestion, code, currentLang);
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
    hideLoader();
    if(runBtn) { runBtn.disabled = false; runBtn.textContent = "Run"; }
    if(submitBtn) submitBtn.disabled = false;
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

// ---------- Custom input run (output only, never scored) ----------
function prefillCustomInput(){
  const ta = document.getElementById("custom-input");
  if(!ta || !currentQuestion) return;
  if(ta.value.trim()) return; // don't clobber what the user typed
  const first = currentQuestion.visibleTestCases && currentQuestion.visibleTestCases[0];
  if(first && first.input) ta.value = JSON.stringify(first.input);
}
const customToggleBtn = document.getElementById("custom-btn");
if(customToggleBtn) customToggleBtn.addEventListener("click", () => {
  const p = document.getElementById("custom-panel");
  if(!p) return;
  p.classList.toggle("hidden");
  if(!p.classList.contains("hidden")) prefillCustomInput();
});
async function runCustom(){
  if (!currentQuestion) { toast("Select a problem first"); return; }
  const code = getCode();
  if (!code.trim()) { toast("Write some code first"); return; }
  const ta = document.getElementById("custom-input");
  let customInput;
  try {
    customInput = JSON.parse((ta && ta.value) || "{}");
    if (typeof customInput !== "object" || customInput === null || Array.isArray(customInput)) {
      throw new Error("must be a JSON object keyed by param name");
    }
  } catch(e) {
    toast("Custom input is not valid JSON: " + e.message);
    return;
  }
  saveCode();
  showLoader();
  const runCustomBtn = document.getElementById("run-custom-btn");
  if(runBtn) runBtn.disabled = true;
  if(submitBtn) submitBtn.disabled = true;
  if(runCustomBtn) runCustomBtn.disabled = true;
  if(statusText) statusText.textContent = "Running custom input...";
  if(resultsEl) resultsEl.innerHTML = `<div class="loading">Running your input...</div>`;
  window.__lastComplexity = null;
  window.__lastSubmissionId = null;
  try {
    const res = await apiFetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: currentQuestion.id, code, language: currentLang, mode: "run", customInput, customOnly: true })
    });
    const payload = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(payload.error || "custom run failed");
    renderResults({ mode: "run", total: payload.total ?? 0, passed: payload.passed ?? 0, results: payload.results || [] });
    if(statusText && payload.results && payload.results.length===1 && payload.results[0].error) statusText.textContent = "Custom run error";
    saveHistoryEntry({
      id: Date.now() + "_" + Math.random().toString(36).slice(2,6),
      ts: Date.now(),
      questionId: currentQuestion.id,
      title: currentQuestion.title,
      language: currentLang,
      mode: "run",
      code,
      passed: payload.passed ?? 0,
      total: payload.total ?? 0,
      results: payload.results || []
    });
  } catch(e) {
    if(resultsEl) resultsEl.innerHTML = `<div class="test-case"><div class="test-body" style="display:block;color:#ff8a9a"><pre>${esc(String(e.message||e))}</pre></div></div>`;
    if(statusText) statusText.textContent = "Custom run error";
  } finally {
    hideLoader();
    if(runBtn) { runBtn.disabled = false; runBtn.textContent = "Run"; }
    if(submitBtn) submitBtn.disabled = false;
    if(runCustomBtn) runCustomBtn.disabled = false;
  }
}
const runCustomBtnEl = document.getElementById("run-custom-btn");
if(runCustomBtnEl) runCustomBtnEl.addEventListener("click", runCustom);
