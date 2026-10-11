import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import ProblemList from "../components/ProblemList.jsx";
import ProblemView from "../components/ProblemView.jsx";
import EditorPane from "../components/EditorPane.jsx";
import Console from "../components/Console.jsx";
import SubmissionView from "../components/SubmissionView.jsx";
import ResultTab from "../components/ResultTab.jsx";
import PerfTab from "../components/PerfTab.jsx";
import AddQuestionModal from "../components/AddQuestionModal.jsx";
import ShortcutsModal from "../components/ShortcutsModal.jsx";
import { ToastProvider, useToast } from "../components/Toast.jsx";
import { useQuestions } from "../hooks/useQuestions.js";
import { useEditor } from "../hooks/useEditor.js";
import { useRun } from "../hooks/useRun.js";
import { useHistory } from "../hooks/useHistory.js";
import { useComplexity } from "../hooks/useComplexity.js";
import { useAuth } from "../context/AuthContext.jsx";

const LANG_LABEL = { cpp: "C++", javascript: "JavaScript", python: "Python" };

function WorkspaceInner() {
  const notify = useToast();
  const { user } = useAuth();
  const questions = useQuestions();
  const {
    currentQuestion: q,
    currentLang: lang,
    setCurrentLang,
    solvedSet,
    attemptedSet,
    manualSet,
    bookmarkedSet,
  } = questions;

  const qRef = useRef(q);
  qRef.current = q;
  const langRef = useRef(lang);
  langRef.current = lang;

  const editor = useEditor({
    getLang: () => langRef.current,
    getQuestion: () => qRef.current,
    notify,
  });
  const history = useHistory(q?.id);
  const complexity = useComplexity();
  const run = useRun({
    getQuestion: () => qRef.current,
    getLang: () => langRef.current,
    getCode: () => editor.getCode(),
    saveHistory: (entry) => history.saveEntry(entry),
    requestComplexity: (qq, code, l) => complexity.request(qq, code, l),
    notify,
  });

  const [tab, setTab] = useState("desc");
  const [showSidebar, setShowSidebar] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [lastRunMeta, setLastRunMeta] = useState("");
  const [marking, setMarking] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [customCases, setCustomCases] = useState([]); // [{key, text}] drafted custom inputs
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [modal, setModal] = useState(null); // null | { initial: question|null }
  const [listCount, setListCount] = useState("");
  const [lastRun, setLastRun] = useState(null); // { payload, qid } — feeds perf tab
  const [resultView, setResultView] = useState(null); // {kind:'live'|'run',code,lang} | {kind:'submission',entry}
  const [sideW, setSideW] = useState(280);
  const [leftGrow, setLeftGrow] = useState(1.1);
  const [editorGrow, setEditorGrow] = useState(1);
  const [topGrow, setTopGrow] = useState(1);
  const [bottomGrow, setBottomGrow] = useState(1);
  const mainRef = useRef(null);
  const leftRef = useRef(null);
  const editorPaneRef = useRef(null);

  // Drag resizers (mirrors makeVerticalResizer/makeHorizontalResizer).
  function startDrag(kind, e) {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let leftPx = 0;
    let mainW = 1;
    let topPx = 0;
    let paneH = 1;
    try {
      if (kind === "split" && mainRef.current) {
        mainW = mainRef.current.getBoundingClientRect().width || 1;
        leftPx = leftRef.current ? leftRef.current.getBoundingClientRect().width : mainW / 2;
      }
      if (kind === "editor" && editorPaneRef.current) {
        const r = editorPaneRef.current.getBoundingClientRect();
        paneH = r.height || 1;
        topPx = (paneH * topGrow) / (topGrow + bottomGrow);
      }
    } catch {
      // measure failures keep defaults
    }
    const sW = sideW;
    function onMove(ev) {
      if (kind === "side") {
        setSideW(Math.max(200, Math.min(520, sW + (ev.clientX - sx))));
      } else if (kind === "split") {
        const nl = Math.max(260, leftPx + (ev.clientX - sx));
        const rest = Math.max(320, mainW - nl);
        setLeftGrow(nl);
        setEditorGrow(rest);
      } else if (kind === "editor") {
        const nt = Math.max(120, topPx + (ev.clientY - sy));
        const nb = Math.max(120, paneH - nt);
        setTopGrow(nt);
        setBottomGrow(nb);
      }
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function syncCtx(question, language) {
    try {
      window.__cmLang = language;
    } catch {
      // ignore
    }
    try {
      if (question) {
        window.__questionCtx = {
          functionName: question.cppFunctionName || question.functionName,
          params: question.params,
        };
      }
    } catch {
      // ignore
    }
    try {
      editor.editorApi?.setLanguage(language);
    } catch {
      // editor not ready
    }
  }

  const openQuestion = useCallback(
    async (id) => {
      setStatus("Loading problem...");
      try {
        const question = await questions.loadQuestion(id);
        syncCtx(question, langRef.current);
        if (tab === "result") setTab("desc");
        await editor.loadStarter(question, langRef.current);
        try {
          editor.editorApi?.resetUndo?.();
        } catch {
          // ignore
        }
        history.refresh(question.id);
        run.clear();
        setResultView(null);
        setCustomCases([]); // drafts belong to the previous question's params
        setStatus(`Loaded: ${question.title}`);
      } catch (e) {
        setStatus("Failed to load question: " + id);
        notify("Failed to load question: " + id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab]
  );
  const openQuestionRef = useRef(openQuestion);
  openQuestionRef.current = openQuestion;

  // boot: questions + solved state, then hash question or first question
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = await questions.fetchQuestions();
        await questions.refreshSolvedState();
        if (cancelled) return;
        const hash = (window.location.hash || "").slice(1);
        if (hash && qs.some((x) => x.id === hash)) await openQuestionRef.current(hash);
        else if (qs.length) await openQuestionRef.current(qs[0].id);
      } catch {
        setStatus("Failed to load questions. Run `node server.js`");
      }
    })();
    const onHash = () => {
      const id = (window.location.hash || "").slice(1);
      if (id && (!qRef.current || id !== qRef.current.id)) openQuestionRef.current(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keyboard: Ctrl+Enter run, Ctrl+Shift+Enter submit, Ctrl+S save
  useEffect(() => {
    function onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doRun("run");
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        doRun("submit");
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        editor.saveToDb().catch(() => {});
        notify("Saved");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addCustomCase() {
    const first = qRef.current?.visibleTestCases?.[0];
    const prefill = first && first.input ? JSON.stringify(first.input) : "{}";
    setCustomCases((prev) => [...prev, { key: Date.now() + "_" + Math.random().toString(36).slice(2, 7), text: prefill }]);
  }

  async function doRun(mode) {
    if (!qRef.current) {
      notify("Select a problem first");
      return;
    }
    // parse drafted customs first — abort before spending a compile on bad JSON
    let customs = [];
    try {
      customs = customCases.map((c, i) => {
        let input;
        try {
          input = JSON.parse(c.text || "{}");
        } catch (e) {
          throw new Error(`Custom ${i + 1} is not valid JSON: ` + e.message);
        }
        if (typeof input !== "object" || input === null || Array.isArray(input)) {
          throw new Error(`Custom ${i + 1} must be a JSON object keyed by param name`);
        }
        return input;
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      setStatus(msg);
      notify(msg);
      return;
    }
    complexity.clear();
    try {
      window.__lastSubmissionId = null;
    } catch {
      // ignore
    }
    history.setViewingSubmission(null);
    const code = editor.getCode();
    const lang = langRef.current;
    setResultView({ kind: "live", code, lang });
    setTab("result");
    setStatus(mode === "run" ? "Running visible tests..." : "Submitting (all tests)...");
    let result = null;
    try {
      result = await run.run(mode);
    } catch (e) {
      const msg = "Execution error: " + String((e && e.message) || e);
      setStatus(msg);
      notify(msg);
      return;
    }
    if (result && customs.length) {
      // customs run after stored cases (one cheap customOnly call each),
      // appended as Custom 1..N rows — output-only, never scored
      const rows = [];
      for (let k = 0; k < customs.length; k++) {
        const row = await run.runCustomOne(customs[k]);
        rows.push({ ...row, testCaseId: `custom-${k + 1}` });
      }
      result = { ...result, results: [...result.results, ...rows] };
      run.setResult(result); // keep the right console in sync (it reads hook state)
    }
    if (result) {
      setLastRunMeta(`${mode} · ${result.passed}/${result.total} · ${new Date().toLocaleTimeString()}`);
      setStatus(result.passed === result.total ? "All tests passed ✓" : `${result.total - result.passed} test(s) failed`);
      setLastRun({ payload: result, qid: qRef.current.id });
      setResultView({ kind: "run", payload: result, code, lang });
      await questions.refreshSolvedState();
      await history.refresh();
    } else {
      setStatus("Execution error");
    }
  }

  function openSubmission(e) {
    if (!e) return;
    history.setViewingSubmission(e);
    setResultView({ kind: "submission", entry: e });
    setTab("result");
  }

  async function doLangChange(next) {
    await editor.saveToDb().catch(() => {});
    editor.resetSaveMarker();
    setCurrentLang(next);
    const qq = qRef.current;
    syncCtx(qq, next);
    if (qq) await editor.loadStarter(qq, next);
  }

  async function doToggleMark() {
    setMarking(true);
    try {
      const marked = await questions.toggleMarkDone();
      setStatus(marked ? "Marked as done" : "Unmarked");
      notify(marked ? "Marked as done" : "Unmarked — back to attempted");
    } catch (e) {
      notify("Failed: " + e.message);
    } finally {
      setMarking(false);
    }
  }

  async function doToggleBookmark() {
    setBookmarking(true);
    try {
      const on = await questions.toggleBookmark();
      notify(on ? "Bookmarked — find it under Saved" : "Bookmark removed");
    } catch (e) {
      notify("Failed: " + e.message);
    } finally {
      setBookmarking(false);
    }
  }

  async function doDelete() {
    if (!q) return;
    if (!window.confirm(`Delete "${q.title}" permanently? Submissions for it will also be removed.`)) return;
    try {
      const qs = await questions.deleteCurrentQuestion();
      notify("Deleted " + q.id);
      if (qs.length) await openQuestion(qs[0].id);
    } catch (e) {
      notify("Delete failed: " + e.message);
    }
  }

  function doRestore(e) {
    if (!e) return;
    setCurrentLang(e.language);
    syncCtx(qRef.current, e.language);
    editor.setCode(e.code);
    editor.saveLocal();
    notify(`Restored ${e.language} code to editor`);
    history.setViewingSubmission(null);
    setTab("desc");
    if (qRef.current && e.questionId !== qRef.current.id) openQuestion(e.questionId);
  }

  const me = user;
  const canEdit =
    !!me && !!q && (me.role === "admin" || (q.addedBy != null && Number(q.addedBy) === Number(me.id)));

  const perfRun =
    lastRun && lastRun.qid === q?.id ? { ...lastRun.payload, questionId: lastRun.qid } : null;

  return (
    <div>
      <Topbar
        extra={
          <>
            <button id="menu-toggle" className="btn ghost" title="Toggle problems" style={{ padding: "6px 10px" }} onClick={() => setShowSidebar((v) => !v)}>
              ☰
            </button>
            <span id="question-count">{listCount}</span>
            <Link to="/add-question" className="btn primary" style={{ padding: "6px 12px", textDecoration: "none" }}>
              + Add Question
            </Link>
          </>
        }
      />
      <div className="container" id="container">
        {showSidebar ? (
          <aside className="sidebar" id="sidebar" style={{ width: sideW, minWidth: 200, maxWidth: 520, flexShrink: 0 }}>
            <ProblemList
              questions={questions.questions}
              currentId={q?.id}
              solvedSet={solvedSet}
              attemptedSet={attemptedSet}
              manualSet={manualSet}
              bookmarkedSet={bookmarkedSet}
              onSelect={openQuestion}
              onCount={setListCount}
            />
          </aside>
        ) : null}
        {showSidebar ? (
          <div id="sidebar-resizer" className="resizer vertical" onMouseDown={(e) => startDrag("side", e)}></div>
        ) : null}
        <main className="main" id="main" ref={mainRef}>
          <section className="problem-pane" id="problem-pane" ref={leftRef} style={{ flex: `${leftGrow} 1 0`, minWidth: 0 }}>
            <div className="problem-tabs">
              <button className={`ptab${tab === "desc" ? " active" : ""}`} onClick={() => setTab("desc")}>
                Description
              </button>
              {tab === "result" || resultView ? (
                <button className={`ptab${tab === "result" ? " active" : ""}`} onClick={() => setTab("result")}>
                  Result
                </button>
              ) : null}
              <button className={`ptab${tab === "submissions" ? " active" : ""}`} onClick={() => setTab("submissions")}>
                Submissions
              </button>
              <button className={`ptab${tab === "perf" ? " active" : ""}`} onClick={() => setTab("perf")}>
                Performance
              </button>
            </div>
            {tab === "desc" ? (
              <div id="ptab-desc" className="ptab-panel active">
                <div id="problem-view">
                  <ProblemView
                    question={q}
                    solved={q ? solvedSet.has(q.id) : false}
                    manuallyDone={q ? manualSet.has(q.id) : false}
                    bookmarked={q ? bookmarkedSet.has(q.id) : false}
                    canEdit={canEdit}
                    onToggleMark={doToggleMark}
                    onToggleBookmark={doToggleBookmark}
                    onEdit={() => q && setModal({ initial: q })}
                    onDelete={doDelete}
                    marking={marking}
                    bookmarking={bookmarking}
                  />
                </div>
              </div>
            ) : null}
            {tab === "result" ? (
              <div id="ptab-result" className="ptab-panel active">
                <div id="result-view">
                  <ResultPanel
                    view={resultView}
                    live={run.live}
                    lang={lang}
                    liveComplexity={complexity.lastComplexity}
                    expectedTime={q?.timeComplexity}
                    expectedSpace={q?.spaceComplexity}
                  />
                </div>
              </div>
            ) : null}
            {tab === "submissions" ? (
              <div id="ptab-submissions" className="ptab-panel active">
                <SubmissionsPanel
                  historyApi={history}
                  readOnly={false}
                  onView={openSubmission}
                  onRestore={doRestore}
                />
              </div>
            ) : null}
            {tab === "perf" ? (
              <div id="ptab-perf" className="ptab-panel active">
                <div id="perf-view">
                  <PerfTab question={q} run={perfRun} complexity={complexity.lastComplexity} />
                </div>
              </div>
            ) : null}
          </section>
          <div id="main-resizer" className="resizer vertical" onMouseDown={(e) => startDrag("split", e)}></div>
          <section className="editor-pane" id="editor-pane" ref={editorPaneRef} style={{ flex: `${editorGrow} 1 0`, minWidth: 0 }}>
            {history.viewingSubmission ? (
              <div id="submission-view" className="submission-view" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <SubmissionView
                  entry={history.viewingSubmission}
                  readOnly={false}
                  onRestore={doRestore}
                  onBack={() => history.setViewingSubmission(null)}
                />
              </div>
            ) : (
              <div id="editor-edit-mode" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <EditorPane
                  lang={lang}
                  onLangChange={doLangChange}
                  onFormat={() => {
                    editor.format();
                    notify("Formatted");
                  }}
                  onReset={() => {
                    if (!q) return;
                    editor.resetToStarter(q, lang);
                    notify("Reset to starter code");
                  }}
                  running={run.running}
                  onRun={doRun}
                  onShortcuts={() => setShortcutsOpen(true)}
                  topStyle={{ flex: `${topGrow} 1 0`, minHeight: 0 }}
                />
                <div id="editor-resizer" className="resizer horizontal" onMouseDown={(e) => startDrag("editor", e)}></div>
                <div id="editor-bottom" className="editor-bottom" style={{ flex: `${bottomGrow} 1 0`, minHeight: 0 }}>
                  <div className="status-bar">
                    <span id="status-text">{status}</span>
                    <span id="last-run-meta">{lastRunMeta}</span>
                  </div>
                  <div id="test-results" className="test-results">
                    <Console
                      payload={run.payload}
                      live={run.live}
                      complexity={complexity.lastComplexity}
                      expectedTime={q?.timeComplexity}
                      expectedSpace={q?.spaceComplexity}
                      statusText={status}
                      lastRunMeta={lastRunMeta}
                      visibleCases={q?.visibleTestCases}
                      customs={customCases}
                      params={q?.params}
                      onAddCustom={addCustomCase}
                      onUpdateCustom={(key, text) =>
                        setCustomCases((prev) => prev.map((c) => (c.key === key ? { ...c, text } : c)))
                      }
                      onRemoveCustom={(key) => setCustomCases((prev) => prev.filter((c) => c.key !== key))}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {modal ? (
        <AddQuestionModal
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={async (id) => {
            await questions.fetchQuestions();
            await openQuestion(id);
          }}
        />
      ) : null}
    </div>
  );
}

 // Left Result tab content: live progress while running, final verdict after
// run/submit, or a stored submission opened from history.
function ResultPanel({ view, live, lang, liveComplexity, expectedTime, expectedSpace }) {
  if (view && view.kind === "submission" && view.entry) {
    const e = view.entry;
    const cx =
      e.complexityTime || e.complexitySpace ? { time: e.complexityTime || "?", space: e.complexitySpace || "?" } : null;
    return (
      <ResultTab
        payload={{ mode: e.mode, results: e.results || [], total: e.total ?? (e.results || []).length, passed: e.passed ?? 0 }}
        code={e.code}
        langLabel={LANG_LABEL[e.language] || e.language}
        lang={e.language}
        sub={`${e.mode || "submit"} · ${e.language} · ${e.ts ? new Date(e.ts).toLocaleString() : ""}`}
        complexity={cx}
      />
    );
  }
  if (view && view.kind === "run" && view.payload) {
    const p = view.payload;
    return (
      <ResultTab
        payload={p}
        code={view.code}
        langLabel={LANG_LABEL[view.lang] || view.lang}
        lang={view.lang}
        sub={`${p.mode} · ${view.lang} · just now`}
        complexity={p.mode === "submit" ? liveComplexity : null}
        expectedTime={expectedTime}
        expectedSpace={expectedSpace}
      />
    );
  }
  if (live) {
    const passed = (live.results || []).filter((r) => r.passed).length;
    return (
      <ResultTab
        payload={{ mode: live.mode, results: live.results || [], total: live.total, passed }}
        code={view?.code || ""}
        langLabel={LANG_LABEL[lang] || lang}
        lang={lang}
        sub={`${live.mode} · running… ${passed}/${live.total} passed so far`}
        complexity={null}
        expectedTime={expectedTime}
        expectedSpace={expectedSpace}
      />
    );
  }
  return (
    <div className="empty-state">
      <h2>No submission yet</h2>
      <p>
        Hit <strong>Run</strong> or <strong>Submit</strong> to see your verdict here, LeetCode-style.
      </p>
    </div>
  );
}

function SubmissionsPanel({ historyApi, readOnly, onView, onRestore }) {
  const { history, loading } = historyApi;
  if (loading) return <div className="loading">Loading history...</div>;
  if (!history.length) {
    return (
      <div className="empty-hist">
        No runs yet.<br />
        Hit Run or Submit.
      </div>
    );
  }
  return (
    <>
      <div className="submissions-header">
        <span>Submission History</span>
      </div>
      <div className="history-list">
        {history.slice(0, 20).map((e) => (
          <div className="history-item" key={e.id} onClick={() => onView(e)}>
            <div className="hist-top">
              <span className="hist-q">{e.title || e.questionId}</span>
              <span className={`hist-badge ${e.passed === e.total ? "pass" : "fail"}`}>
                {e.passed}/{e.total}
              </span>
            </div>
            <div className="hist-meta">
              <span>{e.mode} · {e.language}</span>
              <span>{new Date(e.ts).toLocaleTimeString() + " " + new Date(e.ts).toLocaleDateString()}</span>
            </div>
            {!readOnly ? (
              <div className="hist-actions">
                <button
                  className="btn ghost restore-btn"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onRestore(e);
                  }}
                >
                  Restore
                </button>
                <button
                  className="btn ghost view-btn"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onView(e);
                  }}
                >
                  View
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, padding: "8px 0" }}>
        Select a submission to view code &amp; results in the right panel.
      </div>
    </>
  );
}

export default function WorkspacePage() {
  return (
    <ToastProvider>
      <WorkspaceInner />
    </ToastProvider>
  );
}
