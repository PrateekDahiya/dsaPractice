// add-question.js — add-question modal (JSON + guided form). Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.


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
  editingId = null;
  if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = "Save to questions/"; }
  modal.classList.remove("hidden");
  if (!jsonTextarea.value.trim()) jsonTextarea.value = JSON.stringify(TEMPLATE, null, 2);
}

function openEditModal(q) {
  if(!modal || !jsonTextarea || !q) return;
  editingId = q.id;
  const clean = { ...q };
  delete clean._createdAt; delete clean._file;
  jsonTextarea.value = JSON.stringify(clean, null, 2);
  if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = `Update ${q.id}`; }
  modal.classList.remove("hidden");
  if(jsonError) jsonError.classList.add("hidden");
}

function closeModal() { editingId = null; if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = "Save to questions/"; } if(!modal) return; modal.classList.add("hidden"); if(jsonError) jsonError.classList.add("hidden"); if(formError) formError.classList.add("hidden"); }

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
      jsonError.textContent = "Valid JSON — ready to save.";
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
    jsonError.textContent = "Generated from form. Review and Save.";
    jsonError.classList.remove("hidden"); jsonError.classList.add("ok");
    toast("Generated JSON from form");
  } catch (e) {
    formError.textContent = "Form error: " + e.message;
    formError.classList.remove("hidden");
    setTimeout(()=>formError.classList.add("hidden"), 4000);
  }
});


// set by openEditModal(); null = create mode
let editingId = null;

if(saveBtn) saveBtn.addEventListener("click", async () => {
  let q;
  try { q = JSON.parse(jsonTextarea.value); } catch (e) {
    jsonError.textContent = "Invalid JSON: " + e.message; jsonError.classList.remove("hidden","ok"); return;
  }
  const errs = validateQuestion(q);
  if (errs.length) {
    jsonError.textContent = "Fix errors:\n- " + errs.join("\n- "); jsonError.classList.remove("hidden","ok"); return;
  }
  saveBtn.disabled = true; saveBtn.textContent = editingId ? "Updating..." : "Saving...";
  try {
    const isEdit = !!editingId;
    if (isEdit && q.id && q.id !== editingId) throw new Error("Question id cannot be changed");
    const url = isEdit ? `/api/questions/${encodeURIComponent(editingId)}` : "/api/questions";
    const res = await apiFetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "save failed");
    toast(isEdit ? `Updated ${editingId}` : `Saved ${q.id}.json`);
    const savedId = isEdit ? editingId : q.id;
    editingId = null;
    closeModal();
    invalidateCache("/api/questions");
    await fetchQuestions(); renderList();
    await loadQuestion(savedId);
  } catch (e) {
    jsonError.textContent = "Save failed: " + e.message + (String(e.message).includes("Failed to fetch") ? " — is server running? Use manual drop into /questions instead." : "");
    jsonError.classList.remove("hidden","ok");
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = "Save to questions/";
  }
});
