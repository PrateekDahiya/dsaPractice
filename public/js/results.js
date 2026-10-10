// results.js — verdict, console, Result tab (submit + history views). Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.

function verdictOf(payload) {
  const { results, total, passed } = payload;
  if (results && results.length && results.every(r => r.error)) {
    const msg = results[0].error || "";
    return { label: /compile/i.test(msg) ? "Compile Error" : "Runtime Error", cls: "verdict-error", allPass: false, allError: true };
  }
  // custom-only run (no stored cases scored): neutral verdict, output below
  if (total === 0 && results && results.length) {
    return { label: "Custom Output", cls: "verdict-custom", allPass: false, allError: false };
  }
  if (passed === total) return { label: "Accepted", cls: "verdict-accepted", allPass: true, allError: false };
  return { label: "Wrong Answer", cls: "verdict-wrong", allPass: false, allError: false };
}

function runtimeAvg(results) {
  if (!results || !results.length) return 0;
  return Math.round(results.reduce((a, r) => a + (r.timeMs || 0), 0) / results.length);
}

function maxMemKb(results) {
  const ms = (results || []).map(r => r.memKb).filter(m => m != null);
  return ms.length ? Math.max(...ms) : null;
}

function fmtMemShort(kb) {
  if (kb == null) return "n/a";
  return kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
}

// LeetCode-style per-param input lines: `s = "abcabcb"`
function lcInputHtml(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const keys = Object.keys(input);
    if (keys.length) return keys.map(k => `<div class="lc-param"><span class="lc-param-name">${esc(k)} =</span><pre class="lc-param-val">${esc(fmtJson(input[k]))}</pre></div>`).join("");
  }
  return `<pre class="lc-param-val">${esc(fmtJson(input))}</pre>`;
}

// Shared case detail: Input / Output / Expected cards (Output red + Expected
// green on failure, like LeetCode).
function lcDetailHtml(r) {
  if (!r) return "";
  if (r.error && r.actual == null) {
    return `<div class="lc-label">Error</div><div class="lc-card lc-error-card"><pre>${esc(r.error)}</pre></div>`;
  }
  // custom-input rows are output-only (never scored): no Expected card
  if (r.testCaseId === "custom") {
    return `<div class="lc-label">Input <span style="color:var(--muted);font-weight:400">(custom — output only, not scored)</span></div><div class="lc-card">${lcInputHtml(r.input)}</div>`
      + `<div class="lc-label">Output</div><div class="lc-card"><pre>${esc(r.error ? r.error : fmtJson(r.actual))}</pre></div>`;
  }
  const failed = !r.passed;
  return `<div class="lc-label">Input</div><div class="lc-card">${lcInputHtml(r.input)}</div>`
    + `<div class="lc-label">Output</div><div class="lc-card"><pre class="${failed ? "lc-out-fail" : ""}">${esc(r.error ? r.error : fmtJson(r.actual))}</pre></div>`
    + `<div class="lc-label">Expected</div><div class="lc-card"><pre class="${failed ? "lc-exp-fail" : ""}">${esc(fmtJson(r.expected))}</pre></div>`;
}

function casePillsHtml(results, sel, cls) {
  return (results || []).map((r, i) => {
    const isCustom = r.testCaseId === "custom";
    const icon = r.passed === true ? "✓" : (r.passed === false ? "✕" : "•");
    const state = r.passed === true ? "pass" : (r.passed === false ? "fail" : "custom");
    const label = isCustom ? "Custom" : `Case ${i + 1}`;
    return `<button class="${cls || "case-pill"} ${state} ${i === sel ? "active" : ""}" data-idx="${i}" title="${isCustom ? "Custom input — output only" : `Case ${i + 1}${r.hidden ? " (hidden)" : ""} — ${r.passed ? "Passed" : "Failed"}`}"><span class="pill-icon">${icon}</span> ${label}</button>`;
  }).join("");
}

function switchPtab(name) {
  document.querySelectorAll(".ptab").forEach(b => b.classList.toggle("active", b.dataset.ptab === name));
  document.querySelectorAll(".ptab-panel").forEach(p => p.classList.toggle("active", p.id === "ptab-" + name));
  if (name === "desc") showEditMode();
  else if (name === "perf") renderPerformance();
}

function resetResultTab() {
  const btn = document.querySelector('.ptab[data-ptab="result"]');
  if (btn) btn.classList.add("hidden");
  if (document.querySelector('.ptab[data-ptab="result"]')?.classList.contains("active")) switchPtab("desc");
}

// Shared LeetCode-style verdict markup for the LEFT Result tab.
// o: { verdict, passed, total, failed, sub (pre-escaped html), stats:{avg,mem}|null,
//      results, sel, code, langLabel, complexityHtml (static) | null (live placeholder),
//      errText }
function resultViewInner(o) {
  const v = o.verdict;
  return `
    <div class="lc-verdict-row"><span class="${v.cls}">${v.label}</span></div>
    <div class="lc-count">${o.passed} / ${o.total} testcases passed${o.failed ? ` · ${o.failed} failed` : ""}</div>
    <div class="lc-sub">${o.sub}</div>
    ${o.stats ? `<div class="lc-cards">
      <div class="lc-card lc-stat"><div class="lc-card-label">⏱ Runtime</div><div class="lc-card-val">${o.stats.avg} ms</div></div>
      <div class="lc-card lc-stat"><div class="lc-card-label">🧠 Memory</div><div class="lc-card-val">${esc(fmtMemShort(o.stats.mem))}</div></div>
    </div>` : ""}
    ${v.allError
      ? `<div class="lc-label">Error</div><div class="lc-card lc-error-card"><pre>${esc(o.errText || "Unknown error")}</pre></div>`
      : `${o.complexityHtml != null ? `<div class="lc-complexity">${o.complexityHtml}</div>` : `<div id="complexity-line-left" class="lc-complexity"></div>`}
         <div class="case-pills">${casePillsHtml(o.results, o.sel)}</div>
         <div id="result-detail">${lcDetailHtml(o.results[o.sel])}</div>`}
    <div class="lc-code-head">Code <span style="color:var(--muted)">|</span> ${esc(o.langLabel)}</div>
    <pre class="lc-code">${esc(o.code)}</pre>
  `;
}

function wireResultPills(view, results) {
  view.querySelectorAll(".case-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      window.__resultSel = parseInt(btn.dataset.idx, 10) || 0;
      view.querySelectorAll(".case-pill").forEach(b => b.classList.toggle("active", b === btn));
      const d = document.getElementById("result-detail");
      if (d) d.innerHTML = lcDetailHtml(results[window.__resultSel]);
    });
  });
}

function revealResultTab() {
  const tabBtn = document.querySelector('.ptab[data-ptab="result"]');
  if (tabBtn) tabBtn.classList.remove("hidden");
  switchPtab("result");
}

// LeetCode-style submit verdict in the LEFT panel: verdict + counts, runtime /
// memory cards on accept, failed-case browser + submitted code.
function showSubmitResult(payload) {
  const view = document.getElementById("result-view");
  if (!view || !currentQuestion) return;
  const v = verdictOf(payload);
  const { results, total, passed } = payload;
  const failedIdx = results.findIndex(r => !r.passed);
  const sel = failedIdx >= 0 ? failedIdx : 0;
  window.__resultSel = sel;
  const langLabel = { cpp: "C++", javascript: "JavaScript", python: "Python" }[currentLang] || currentLang;
  const code = (getCode() || "").slice(0, 8000);
  view.innerHTML = resultViewInner({
    verdict: v, passed, total,
    failed: results.filter(r => !r.passed).length,
    sub: `submitted just now · ${esc(currentLang)}`,
    stats: v.allPass ? { avg: runtimeAvg(results), mem: maxMemKb(results) } : null,
    results, sel, code, langLabel, complexityHtml: null,
    errText: results[0] && results[0].error,
  });
  wireResultPills(view, results);
  revealResultTab();
}

// Same verdict view for a STORED submission opened from the Submissions tab:
// verdict + counts (+ static AI complexity when recorded) + code.
function showSubmissionInResult(e) {
  const view = document.getElementById("result-view");
  if (!view || !e) return;
  const results = Array.isArray(e.results) ? e.results : [];
  const total = e.total != null ? e.total : results.length;
  const passed = e.passed != null ? e.passed : results.filter(r => r.passed).length;
  const v = verdictOf({ results, total, passed });
  const failedIdx = results.findIndex(r => !r.passed);
  const sel = failedIdx >= 0 ? failedIdx : 0;
  window.__resultSel = sel;
  const lang = e.language || "javascript";
  const langLabel = { cpp: "C++", javascript: "JavaScript", python: "Python" }[lang] || lang;
  const dt = e.ts ? new Date(e.ts).toLocaleString() : (e.createdAt ? new Date(e.createdAt).toLocaleString() : "");
  const cx = (e.complexityTime || e.complexitySpace)
    ? `Complexity (AI): <strong>${esc(e.complexityTime || "?")} time · ${esc(e.complexitySpace || "?")} space</strong>`
    : null;
  const readOnly = window.__DASHBOARD_READONLY === true;
  const code = readOnly ? "Read-only view — code hidden for other user" : String(e.code || "").slice(0, 8000);
  view.innerHTML = resultViewInner({
    verdict: v, passed, total,
    failed: results.filter(r => !r.passed).length,
    sub: `${esc(e.mode || "submit")} · ${esc(lang)}${dt ? ` · ${esc(dt)}` : ""}`,
    stats: v.allPass ? { avg: runtimeAvg(results), mem: maxMemKb(results) } : null,
    results, sel, code, langLabel, complexityHtml: cx,
    errText: results[0] && results[0].error,
  });
  wireResultPills(view, results);
  revealResultTab();
}

function renderResults(payload) {
  if(!resultsEl) return;
  const { mode, results, total, passed } = payload;
  const v = verdictOf(payload);
  const avg = runtimeAvg(results);
  window.__consoleSel = 0;
  resultsEl.innerHTML = `
    <div class="console-head">
      <span class="${v.cls}">${v.label}</span>
      <span class="run-meta" id="console-runtime">Runtime: ${avg} ms</span>
      <span class="results-summary ${passed === total ? "pass" : "fail"}" style="margin-left:auto">${passed} / ${total}</span>
    </div>
    ${mode==="submit"?`<div id="complexity-line" class="run-stats" style="font-size:12px;color:var(--muted);margin:-4px 0 10px">Analyzing complexity…</div>`:""}
    <div class="case-pills" id="console-pills">${casePillsHtml(results, 0)}</div>
    <div id="console-detail">${lcDetailHtml(results[0])}</div>
  `;
  const pillsEl = document.getElementById("console-pills");
  if (pillsEl) pillsEl.querySelectorAll(".case-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.idx, 10) || 0;
      window.__consoleSel = i;
      pillsEl.querySelectorAll(".case-pill").forEach(b => b.classList.toggle("active", b === btn));
      const d = document.getElementById("console-detail");
      if (d) d.innerHTML = lcDetailHtml(results[i]);
      const rt = document.getElementById("console-runtime");
      if (rt && results[i]) rt.textContent = `Runtime: ${results[i].timeMs ?? 0} ms`;
    });
  });
  if(lastRunMeta) lastRunMeta.textContent = `${mode} · ${passed}/${total} · ${new Date().toLocaleTimeString()}`;
  if(statusText) statusText.textContent = v.cls === "verdict-custom" ? "Custom run complete — output only" : (v.allPass ? "All tests passed ✓" : `${total-passed} test(s) failed`);
  window.__lastRun = { questionId: currentQuestion && currentQuestion.id, mode, passed, total, results, ts: Date.now() };
  if (payload.mode === "submit") { try { showSubmitResult(payload); } catch (e) { console.warn("result view failed", e); } }
  if(isPerfActive()) renderPerformance();
}
