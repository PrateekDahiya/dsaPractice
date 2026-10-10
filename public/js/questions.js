// questions.js — question list, filters, problem view, solved state. Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.


// solved/attempted/manual sets
let solvedSet = new Set();

let attemptedSet = new Set();

let manualSet = new Set();

async function refreshSolvedState(){
  solvedSet.clear(); attemptedSet.clear(); manualSet.clear();
  const t = getToken();
  if(!t) return;
  try{
    const r1 = await apiFetch("/api/questions/solved");
    if(r1.ok){
      const ids = await r1.json();
      if(Array.isArray(ids)) ids.forEach(id=>solvedSet.add(id));
    }
    try {
      const rm = await apiFetch("/api/manual-solved");
      if(rm.ok){
        const mids = await rm.json();
        if(Array.isArray(mids)) mids.forEach(id=>{ manualSet.add(id); solvedSet.add(id); });
      }
    } catch {}
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

async function toggleMarkDone(){
  if(!currentQuestion) return;
  const t = getToken();
  if(!t){ toast("Login to mark as done"); return; }
  const qid = currentQuestion.id;
  const isMarked = manualSet.has(qid);
  const btn = document.getElementById("mark-done-btn");
  if(btn){ btn.disabled = true; btn.textContent = isMarked ? "Unmarking..." : "Marking..."; }
  try{
    const res = await apiFetch(`/api/questions/${encodeURIComponent(qid)}/mark-done`, {
      method: isMarked ? "DELETE" : "POST"
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || "failed");
    if(isMarked) manualSet.delete(qid);
    else manualSet.add(qid);
    await refreshSolvedState();
    renderProblem();
    renderList();
    toast(isMarked ? "Unmarked — back to attempted" : "Marked as done");
  }catch(e){
    toast("Failed: " + e.message);
    renderProblem();
  }
}


async function fetchQuestions() {
  if(questionListEl) questionListEl.innerHTML = `<div class="loading">Loading problems...</div>`;
  showLoader();
  try {
    try {
      const cached = await cachedApiFetch("/api/questions", 15000);
      questions = await cached.json();
      populateTagFilter(); renderList();
      setTimeout(async () => {
        try {
          const fresh = await apiFetch("/api/questions");
          if (fresh.ok) {
            const data = await fresh.json();
            _apiCache.set("/api/questions", { data: JSON.parse(JSON.stringify(data)), ts: Date.now() });
            if (JSON.stringify(data) !== JSON.stringify(questions)) {
              questions = data; populateTagFilter(); renderList();
            }
          }
        } catch {}
      }, 2000);
      hideLoader();
      return;
    } catch {}
    const res = await apiFetch("/api/questions");
    if (!res.ok) throw new Error("api failed");
    questions = await res.json();
    _apiCache.set("/api/questions", { data: JSON.parse(JSON.stringify(questions)), ts: Date.now() });
    populateTagFilter(); renderList();
    hideLoader();
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
    if(solvedSet.has(q.id)) {
      const isMan = manualSet.has(q.id);
      indicator = `<span class="q-indicator solved" title="${isMan ? "Manually marked done" : "Solved"}"><span class="dot-sm"></span> ${isMan ? "Done" : "Solved"}</span>`;
    }
    else if(attemptedSet.has(q.id)) indicator = `<span class="q-indicator attempted" title="Attempted"><span class="dot-sm"></span> Attempted</span>`;
    return `
    <div class="question-item ${currentQuestion && currentQuestion.id===q.id ? 'active':''}" data-id="${esc(q.id)}">
      <div class="q-title">${esc(q.title)}</div>
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
  if(problemViewEl) problemViewEl.innerHTML = `<div class="loading">Loading problem...</div>`;
  showLoader();
  try {
    let q;
    const res = await apiFetch(`/api/questions/${id}`);
    if (res.ok) q = await res.json();
    else {
      const r2 = await fetch(`questions/${id}.json`);
      q = await r2.json();
    }
    currentQuestion = q;
    syncQuestionCtx();
    resetResultTab();
    renderProblem();
    // Starter code + history are independent fetches: run in parallel instead
    // of sequentially (each is a 0.3-1s DB roundtrip on hosted deployments).
    await Promise.all([loadStarterCode(), renderHistory()]);
    if (window.__oe && typeof window.__oe.resetUndo === "function") { try { window.__oe.resetUndo(); } catch {} }
    renderList();
    if(resultsEl) resultsEl.innerHTML = `<div style="color:var(--muted);font-size:13px">Hit <strong>Run</strong> to test visible cases, <strong>Submit</strong> for all.</div>`;
    if(statusText) statusText.textContent = `Loaded: ${q.title}`;
    history.replaceState(null, "", `#${id}`);
    if(isPerfActive()) renderPerformance();
    hideLoader();
  } catch (e) {
    console.error(e);
    toast("Failed to load question: " + id);
    hideLoader();
  }
}


function renderProblem() {
  if (!currentQuestion || !problemViewEl) return;
  const q = currentQuestion;
  const isSolved = solvedSet.has(q.id);
  const isManual = manualSet.has(q.id);
  const markBtnHtml = (() => {
    if(!getToken()) return "";
    if(isManual) return `<button id="mark-done-btn" class="btn secondary" style="padding:6px 12px;font-size:12px" title="Remove manual override">Marked Done (Undo)</button>`;
    if(isSolved) return `<span style="color:var(--green);font-size:12px;font-weight:700">Solved</span>`;
    return `<button id="mark-done-btn" class="btn ghost" style="padding:6px 12px;font-size:12px" title="Mark as done even if tests fail (e.g. wrong test case)">Mark as Done</button>`;
  })();
  problemViewEl.innerHTML = `
    <div class="problem-title">${esc(q.title)}</div>
    <div class="problem-meta">
      <span class="badge ${esc(q.difficulty)}">${esc(q.difficulty)}</span>
      <span style="color:var(--muted);font-size:13px">${(q.tags||[]).join(" · ")}</span>
      <span style="margin-left:auto;display:flex;gap:8px;align-items:center">${markBtnHtml}</span>
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
  const markBtn = document.getElementById("mark-done-btn");
  if(markBtn) markBtn.addEventListener("click", toggleMarkDone);
}
