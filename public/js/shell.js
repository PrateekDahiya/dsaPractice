// shell.js — sidebar, resizers, tabs, shortcuts, boot. Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.


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
    // Right panel follows left tab: desc -> editor, submissions -> submission view (or empty)
    if(btn.dataset.ptab === "desc"){
      showEditMode();
    } else if(btn.dataset.ptab === "result"){
      showEditMode();
    } else if(btn.dataset.ptab === "perf"){
      renderPerformance();
    } else if(btn.dataset.ptab === "submissions"){
      // if already viewing, keep it; else show empty placeholder in right panel
      if(!viewingSubmission){
        // show empty submission view so right panel mirrors submissions tab
        const editMode = document.getElementById("editor-edit-mode");
        const viewMode = document.getElementById("submission-view");
        if(editMode) { editMode.classList.add("hidden"); editMode.style.display = "none"; }
        if(viewMode) {
          viewMode.classList.remove("hidden");
          viewMode.style.display = "flex";
          const titleEl = document.getElementById("submission-view-title");
          const metaEl = document.getElementById("submission-view-meta");
          const codeEl = document.getElementById("submission-view-code");
          const resultsEl2 = document.getElementById("submission-view-results");
          if(titleEl) titleEl.textContent = "No submission selected";
          if(metaEl) metaEl.textContent = "";
          if(codeEl) codeEl.textContent = "Select a submission from the left to view code & results here (no scroll needed).";
          if(window.__oeView && typeof window.__oeView.hide === "function") try{ window.__oeView.hide(); }catch{}
          if(window.__cmView) try{ window.__cmView.hide(); }catch{}
          if(resultsEl2) resultsEl2.innerHTML = "";
          const restoreBtn = document.getElementById("submission-restore-btn");
          if(restoreBtn) restoreBtn.style.display = "none";
        }
      }
    }
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
