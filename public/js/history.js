// history.js — submission history (DB + local), submission view. Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.


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
  if (entry.mode === "submit" && window.__lastComplexity && !entry.complexityTime) {
    entry.complexityTime = window.__lastComplexity.time;
    entry.complexitySpace = window.__lastComplexity.space;
  }
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
        results: entry.results,
        complexityTime: entry.complexityTime || null,
        complexitySpace: entry.complexitySpace || null
      })
    });
    if(res && res.status===401){
      // not logged in — history stays local only
    } else if (res) {
      const d = await res.json().catch(()=>({}));
      if (d && d.id && entry.mode === "submit") window.__lastSubmissionId = d.id;
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

let viewingSubmission = null;

function showEditMode(){
  viewingSubmission = null;
  const editMode = document.getElementById("editor-edit-mode");
  const viewMode = document.getElementById("submission-view");
  if(editMode) editMode.classList.remove("hidden");
  if(editMode) editMode.style.display = "flex";
  if(viewMode) viewMode.classList.add("hidden");
  if(viewMode) viewMode.style.display = "none";
}

function showSubmissionView(e){
  viewingSubmission = e;
  const editMode = document.getElementById("editor-edit-mode");
  const viewMode = document.getElementById("submission-view");
  if(editMode) editMode.classList.add("hidden");
  if(editMode) editMode.style.display = "none";
  if(viewMode) viewMode.classList.remove("hidden");
  if(viewMode) viewMode.style.display = "flex";
  const titleEl = document.getElementById("submission-view-title");
  const metaEl = document.getElementById("submission-view-meta");
  const codeEl = document.getElementById("submission-view-code");
  const resultsEl2 = document.getElementById("submission-view-results");
  const isReadOnly = window.__DASHBOARD_READONLY === true;
  if(titleEl) titleEl.textContent = `${e.title || e.questionId} · ${e.mode} · ${e.language} · ${e.passed}/${e.total}`;
  if(metaEl) metaEl.textContent = new Date(e.ts).toLocaleString();
  if(codeEl){
    if(isReadOnly){
      codeEl.textContent = "Read-only view — code hidden for other user";
      if(window.__cmView) try{ window.__cmView.hide(); }catch{}
      if(window.__oeView && typeof window.__oeView.hide === "function") try{ window.__oeView.hide(); }catch{}
    } else {
      const text = (e.code||"").slice(0, 8000) + ((e.code||"").length>8000 ? "\n...truncated" : "");
      if(window.__cmView && window.__cmActive){
        try{ window.__cmView.show(text, e.language); }catch{ codeEl.textContent = text; }
      } else {
        codeEl.textContent = text;
      }
      if(window.__oeView && typeof window.__oeView.show === "function") try{ window.__oeView.show(e.code, e.language); }catch{}
    }
  }
  if(resultsEl2){
    const cx=(e.complexityTime||e.complexitySpace)?`<div class="run-stats" style="font-size:12px;color:var(--muted);margin:-4px 0 10px">Complexity (AI): ${esc(e.complexityTime||"?")} time · ${esc(e.complexitySpace||"?")} space</div>`:"";
    resultsEl2.innerHTML = `<div class="results-header"><div class="results-title">Results ${e.passed}/${e.total}</div></div>` + runStatsHtml(e.results||[]) + cx +
      (e.results ? e.results.map((r,i)=>`<div class="test-case open"><div class="test-case-header"><span class="test-label"><span class="dot ${r.passed?'pass':'fail'}"></span> Case ${i+1} ${r.hidden?'(hidden)':''} — ${r.passed?'Passed':'Failed'}</span></div><div class="test-body" style="display:block"><div class="kv"><span class="kv-label">Input</span><span class="kv-value"><pre>${esc(fmtJson(r.input))}</pre></span></div><div class="kv"><span class="kv-label">Expected</span><span class="kv-value"><pre>${esc(fmtJson(r.expected))}</pre></span></div><div class="kv"><span class="kv-label">Got</span><span class="kv-value ${r.error?'error':''}"><pre>${esc(r.error || fmtJson(r.actual))}</pre></span></div></div></div>`).join("") : "no results");
  }
  const restoreBtn = document.getElementById("submission-restore-btn");
  if(restoreBtn){
    restoreBtn.style.display = isReadOnly ? "none" : "";
    restoreBtn.onclick = () => restoreSubmissionToEditor(e);
  }
  const backBtn = document.getElementById("submission-back-btn");
  if(backBtn){
    backBtn.onclick = () => {
      showEditMode();
      // stay on submissions tab, but show editor — user can switch to Description to continue editing
    };
  }
  // Mirror the verdict into the LEFT Result tab (LeetCode-style), so opening a
  // submission from history shows Accepted/Wrong Answer + cases + code there.
  try { showSubmissionInResult(e); } catch (err) { console.warn("result tab mirror failed", err); }
}

function restoreSubmissionToEditor(e){
  if(!e) return;
  if(window.__DASHBOARD_READONLY){ toast("Read-only — cannot restore"); return; }
  currentLang = e.language;
  if(langSelect) langSelect.value = currentLang;
  syncQuestionCtx();
  setCode(e.code);
  saveCode();
  toast(`Restored ${e.language} code to editor`);
  showEditMode();
  // switch left to Description so user sees editor context
  document.querySelectorAll(".ptab").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".ptab-panel").forEach(p=>p.classList.remove("active"));
  const descBtn = document.querySelector('.ptab[data-ptab="desc"]');
  if(descBtn) descBtn.classList.add("active");
  const descPanel = document.getElementById("ptab-desc");
  if(descPanel) descPanel.classList.add("active");
  if (currentQuestion && e.questionId !== currentQuestion.id) loadQuestion(e.questionId);
}

async function renderHistory() {
  const listEl = document.getElementById("history-list");
  if (!listEl) return;
  listEl.innerHTML = `<div class="loading">Loading history...</div>`;
  const all = await fetchHistoryFromDb();
  const filtered = all;
  const isReadOnly = window.__DASHBOARD_READONLY === true;
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-hist">No runs yet.<br>Hit Run or Submit.</div>`;
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
      restoreSubmissionToEditor(e);
      listEl.querySelectorAll(".history-item").forEach(x => x.classList.remove("active"));
      btn.closest(".history-item")?.classList.add("active");
    });
  });
  listEl.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const e = findById(btn.dataset.hid);
      if (!e) return;
      showSubmissionView(e);
      listEl.querySelectorAll(".history-item").forEach(x => x.classList.remove("active"));
      btn.closest(".history-item")?.classList.add("active");
    });
  });
  listEl.querySelectorAll(".history-item").forEach(el => {
    el.addEventListener("click", () => {
      const e = findById(el.dataset.hid);
      if (!e) return;
      showSubmissionView(e);
      listEl.querySelectorAll(".history-item").forEach(x => x.classList.remove("active"));
      el.classList.add("active");
    });
  });
}

function showHistoryDetail(e) {
  // Backward compat: route to right panel (no bottom scroll)
  if (!e) return;
  showSubmissionView(e);
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
