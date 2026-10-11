import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";

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
    cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nvector<int> solve(vector<int>& nums, int target) {\n    // write code here\n    \n}",
  },
  visibleTestCases: [{ id: "v1", input: { nums: [1, 2, 3], target: 3 }, expectedOutput: [0, 1] }],
  hiddenTestCases: [{ id: "h1", input: { nums: [0, 0], target: 0 }, expectedOutput: [0, 1] }],
};

function validateQuestion(q) {
  const errs = [];
  if (!q.id || !/^[a-z0-9-]+$/.test(q.id)) errs.push("id must match ^[a-z0-9-]+$ (e.g. two-sum)");
  if (!q.title) errs.push("title required");
  if (!["Easy", "Medium", "Hard"].includes(q.difficulty)) errs.push("difficulty must be Easy/Medium/Hard");
  if (!q.problemStatement) errs.push("problemStatement required");
  if (!q.functionName) errs.push("functionName required");
  if (!Array.isArray(q.params) || q.params.length === 0) errs.push("params must be non-empty array");
  if (!q.starterCode || !q.starterCode.javascript) errs.push("starterCode.javascript required");
  if (!Array.isArray(q.visibleTestCases) || q.visibleTestCases.length === 0) errs.push("visibleTestCases must have at least 1");
  if (!Array.isArray(q.hiddenTestCases)) errs.push("hiddenTestCases must be array");
  const allCases = [...(q.visibleTestCases || []), ...(q.hiddenTestCases || [])];
  for (const tc of allCases) {
    if (!tc.id || !tc.input || tc.expectedOutput === undefined) errs.push(`test case ${tc.id || "?"} missing id/input/expectedOutput`);
    if (tc.input) {
      for (const p of q.params) if (!(p in tc.input)) errs.push(`test case ${tc.id}: missing param "${p}" in input`);
    }
  }
  return errs;
}

// Mirrors public/js/add-question.js: Raw JSON + guided form tabs, create and
// edit modes. `initial` is a full question for editing (null = create).
// onSaved(id) reloads the caller; onClose dismisses.
export default function AddQuestionModal({ initial, onSaved, onClose }) {
  const editingId = initial?.id || null;
  const [tab, setTab] = useState("json");
  const [json, setJson] = useState(() =>
    initial ? JSON.stringify(stripInternal(initial), null, 2) : ""
  );
  const [form, setForm] = useState(() => fromQuestion(initial));
  const [msg, setMsg] = useState({ text: "", ok: false, show: false });
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);

  function stripInternal(q) {
    const c = { ...q };
    delete c._createdAt;
    delete c._file;
    return c;
  }

  function fromQuestion(q) {
    if (!q) {
      return {
        id: "", title: "", difficulty: "Easy", tags: "", fn: "", pyfn: "", params: "",
        statement: "", constraints: "", examples: "", starterJs: "", starterPy: "",
        visible: "", hidden: "",
      };
    }
    return {
      id: q.id || "",
      title: q.title || "",
      difficulty: ["Easy", "Medium", "Hard"].includes(q.difficulty) ? q.difficulty : "Easy",
      tags: (q.tags || []).join(", "),
      fn: q.functionName || "",
      pyfn: q.pythonFunctionName || "",
      params: (q.params || []).join(", "),
      statement: q.problemStatement || "",
      constraints: (q.constraints || []).join("\n"),
      examples: JSON.stringify(q.examples || [], null, 2),
      starterJs: (q.starterCode && q.starterCode.javascript) || "",
      starterPy: (q.starterCode && q.starterCode.python) || "",
      visible: JSON.stringify(q.visibleTestCases || [], null, 2),
      hidden: JSON.stringify(q.hiddenTestCases || [], null, 2),
    };
  }

  function isFormActive() {
    return tab === "form";
  }

  // Overlay form fields onto a base object (preserves C++/complexity fields
  // the form doesn't cover) — mirrors readFormInto().
  function readFormInto(base) {
    const q = { ...(base || {}) };
    q.id = form.id.trim();
    q.title = form.title.trim();
    q.difficulty = form.difficulty;
    q.tags = form.tags.split(",").map((s) => s.trim()).filter(Boolean);
    q.problemStatement = form.statement.trim();
    q.constraints = form.constraints.split("\n").map((s) => s.trim()).filter(Boolean);
    q.examples = JSON.parse(form.examples.trim() || "[]");
    q.functionName = form.fn.trim();
    q.pythonFunctionName = form.pyfn.trim() || undefined;
    q.params = form.params.split(",").map((s) => s.trim()).filter(Boolean);
    q.starterCode = { ...((base && base.starterCode) || {}) };
    q.starterCode.javascript = form.starterJs;
    if (form.starterPy) q.starterCode.python = form.starterPy;
    else delete q.starterCode.python;
    q.visibleTestCases = JSON.parse(form.visible.trim() || "[]");
    q.hiddenTestCases = JSON.parse(form.hidden.trim() || "[]");
    if (!q.pythonFunctionName) delete q.pythonFunctionName;
    return q;
  }

  function generateFromForm() {
    try {
      let base = {};
      try {
        base = JSON.parse(json.trim() || "{}");
      } catch {
        base = {};
      }
      const q = readFormInto(base);
      const errs = validateQuestion(q);
      if (errs.length) throw new Error(errs.join("; "));
      setJson(JSON.stringify(q, null, 2));
      setTab("json");
      setMsg({ text: "Generated from form. Review and Save.", ok: true, show: true });
    } catch (e) {
      setFormErr("Form error: " + e.message);
      setTimeout(() => setFormErr(""), 4000);
    }
  }

  function validate() {
    try {
      const q = JSON.parse(json);
      const errs = validateQuestion(q);
      if (errs.length) setMsg({ text: "Validation failed:\n- " + errs.join("\n- "), ok: false, show: true });
      else setMsg({ text: "Valid JSON — ready to save.", ok: true, show: true });
    } catch (e) {
      setMsg({ text: "Invalid JSON: " + e.message, ok: false, show: true });
    }
  }

  async function save() {
    // Guided-form edits flow into the save (merged object used directly —
    // state updates are async, so don't re-read `json` after merging).
    let base = null;
    if (isFormActive()) {
      try {
        try {
          base = JSON.parse(json.trim() || "{}");
        } catch {
          base = {};
        }
        const merged = readFormInto(base);
        const formErrs = validateQuestion(merged);
        if (formErrs.length) throw new Error(formErrs.join("; "));
        setJson(JSON.stringify(merged, null, 2));
        base = merged;
      } catch (e) {
        setMsg({ text: "Form has errors: " + e.message, ok: false, show: true });
        return;
      }
    }
    let q;
    try {
      q = base || JSON.parse(json);
    } catch (e) {
      setMsg({ text: "Invalid JSON: " + e.message, ok: false, show: true });
      return;
    }
    const errs = validateQuestion(q);
    if (errs.length) {
      setMsg({ text: "Fix errors:\n- " + errs.join("\n- "), ok: false, show: true });
      return;
    }
    setBusy(true);
    try {
      const isEdit = !!editingId;
      if (isEdit && q.id && q.id !== editingId) throw new Error("Question id cannot be changed");
      const url = isEdit ? `/api/questions/${encodeURIComponent(editingId)}` : "/api/questions";
      const res = await apiFetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(q),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "save failed");
      onSaved(isEdit ? editingId : q.id);
      onClose();
    } catch (e) {
      setMsg({
        text: "Save failed: " + e.message + (String(e.message).includes("Failed to fetch") ? " — is server running?" : ""),
        ok: false,
        show: true,
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={onClose}></div>
      <div className="modal-panel">
        <div className="modal-header">
          <h2>{editingId ? `Edit ${editingId}` : "Add New Question"}</h2>
          <button className="btn ghost" style={{ padding: "4px 8px" }} onClick={onClose}>✕</button>
        </div>
        <div className="modal-tabs">
          <button className={`tab-btn${tab === "json" ? " active" : ""}`} onClick={() => setTab("json")}>Raw JSON</button>
          <button className={`tab-btn${tab === "form" ? " active" : ""}`} onClick={() => setTab("form")}>Guided Form</button>
          <span className="modal-hint">Past output from agent or fill form — saves to <code>questions/&lt;id&gt;.json</code></span>
        </div>
        {tab === "json" ? (
          <div className="tab-panel active" id="tab-json">
            <div className="modal-actions-row">
              <button className="btn ghost" onClick={() => { setJson(JSON.stringify(TEMPLATE, null, 2)); setMsg({ text: "Template loaded. Edit id/title and tests.", ok: true, show: true }); }}>
                Load Template
              </button>
              <button className="btn secondary" onClick={validate}>Validate</button>
            </div>
            <textarea spellCheck="false" placeholder='Paste JSON here, e.g. {"id":"my-question", ...}' value={json} onChange={(e) => setJson(e.target.value)} style={{ width: "100%", minHeight: 320 }} id="new-question-json" />
            {msg.show ? <div className={`form-error${msg.ok ? " ok" : ""}`} style={{ display: "block" }}>{msg.text}</div> : <div id="json-error" className="form-error hidden"></div>}
          </div>
        ) : (
          <div className="tab-panel active" id="tab-form">
            <div className="form-grid">
              <label>Slug ID <span className="req">*</span><input value={form.id} onChange={setF("id")} placeholder="e.g. two-sum (a-z0-9-)" /></label>
              <label>Title <span className="req">*</span><input value={form.title} onChange={setF("title")} placeholder="Two Sum" /></label>
              <label>Difficulty <span className="req">*</span>
                <select value={form.difficulty} onChange={setF("difficulty")}><option>Easy</option><option>Medium</option><option>Hard</option></select>
              </label>
              <label>Tags (comma separated)<input value={form.tags} onChange={setF("tags")} placeholder="Array, Hash Map" /></label>
              <label>Function (JS) <span className="req">*</span><input value={form.fn} onChange={setF("fn")} placeholder="twoSum" /></label>
              <label>Function (Python)<input value={form.pyfn} onChange={setF("pyfn")} placeholder="two_sum (optional)" /></label>
              <label>Params (comma) <span className="req">*</span><input value={form.params} onChange={setF("params")} placeholder="nums, target" /></label>
              <label className="full">Problem Statement (HTML allowed) <span className="req">*</span><textarea rows={3} value={form.statement} onChange={setF("statement")} placeholder="Given nums..." /></label>
              <label className="full">Constraints (one per line)<textarea rows={2} value={form.constraints} onChange={setF("constraints")} placeholder="2 <= nums.length <= 10^4" /></label>
              <label className="full">Examples JSON array<textarea rows={3} value={form.examples} onChange={setF("examples")} placeholder='[{"input":"nums=[2,7,11,15], target=9","output":"[0,1]","explanation":"..."}]' /></label>
              <label className="full">Starter JS <span className="req">*</span><textarea rows={3} value={form.starterJs} onChange={setF("starterJs")} placeholder="function twoSum(nums, target) { }" /></label>
              <label className="full">Starter Python<textarea rows={3} value={form.starterPy} onChange={setF("starterPy")} placeholder="def two_sum(nums, target): pass" /></label>
              <label className="full">Visible Tests JSON <span className="req">*</span><textarea rows={4} value={form.visible} onChange={setF("visible")} /></label>
              <label className="full">Hidden Tests JSON <span className="req">*</span><textarea rows={4} value={form.hidden} onChange={setF("hidden")} /></label>
            </div>
            <button className="btn secondary" style={{ marginTop: 10, width: "100%" }} onClick={generateFromForm}>Generate JSON → Raw tab</button>
            {formErr ? <div className="form-error" style={{ display: "block" }}>{formErr}</div> : <div id="form-error" className="form-error hidden"></div>}
          </div>
        )}
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? (editingId ? "Updating..." : "Saving...") : editingId ? `Update ${editingId}` : "Save to questions/"}</button>
        </div>
        <div className="modal-note">Also works by dropping a file into <code>/questions</code> manually — this UI writes the same file via <code>POST /api/questions</code>.</div>
      </div>
    </div>
  );
}
