import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import ProblemList from "../components/ProblemList.jsx";
import ProblemView from "../components/ProblemView.jsx";
import EditorPane from "../components/EditorPane.jsx";
import Console from "../components/Console.jsx";
import CustomPanel from "../components/CustomPanel.jsx";
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
  const [showSidebar, setShowSidebar] = useState(true);
  const [status, setStatus] = useState("Ready");
  const [lastRunMeta, setLastRunMeta] = useState("");
  const [marking, setMarking] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [modal, setModal] = useState(null); // null | { initial: question|null }
  const [listCount, setListCount] = useState("");
  const [lastRun, setLastRun] = useState(null); // { payload, qid }

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

  async function doRun(mode) {
    if (!qRef.current) {
      notify("Select a problem first");
      return;
    }
    complexity.clear();
    try {
      window.__lastSubmissionId = null;
    } catch {
      // ignore
    }
    setStatus(mode === "run" ? "Running visible tests..." : "Submitting (all tests)...");
    const result = await run.run(mode);
    if (result) {
      setLastRunMeta(`${mode} · ${result.passed}/${result.total} · ${new Date().toLocaleTimeString()}`);
      setStatus(result.passed === result.total ? "All tests passed ✓" : `${result.total - result.passed} test(s) failed`);
      setLastRun({ payload: result, qid: qRef.current.id });
      if (mode === "submit") setTab("result");
      await questions.refreshSolvedState();
      await history.refresh();
    } else {
      setStatus("Execution error");
    }
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
          <aside className="sidebar" id="sidebar">
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
        <main className="main" id="main">
          <section className="problem-pane" id="problem-pane" style={{ flex: 1.1 }}>
            <div className="problem-tabs">
              <button className={`ptab${tab === "desc" ? " active" : ""}`} onClick={() => setTab("desc")}>
                Description
              </button>
              {tab === "result" || (lastRun && lastRun.qid === q?.id) ? (
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
                  <ResultTabView
                    lastRun={lastRun}
                    qid={q?.id}
                    getCode={() => editor.getCode()}
                    lang={lang}
                    complexity={complexity.lastComplexity}
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
                  onView={(e) => history.setViewingSubmission(e)}
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
          <section className="editor-pane" id="editor-pane" style={{ flex: 1 }}>
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
                  onCustom={() => setCustomOpen((v) => !v)}
                />
                <div id="editor-top" className="editor-top" style={{ display: "none" }}></div>
                <div id="editor-bottom" className="editor-bottom">
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
                    />
                  </div>
                  {customOpen ? <CustomPanel question={q} running={run.running} onRun={(input) => run.runCustom(input)} /> : null}
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

function ResultTabView({ lastRun, qid, getCode, lang, complexity, expectedTime, expectedSpace }) {
  const payload = lastRun && lastRun.qid === qid ? lastRun.payload : null;
  if (!payload) {
    return (
      <div className="empty-state">
        <h2>No submission yet</h2>
        <p>
          Hit <strong>Submit</strong> to see your verdict here, LeetCode-style.
        </p>
      </div>
    );
  }
  return (
    <ResultTab
      payload={payload}
      code={getCode()}
      langLabel={{ cpp: "C++", javascript: "JavaScript", python: "Python" }[lang] || lang}
      lang={lang}
      sub={`submitted just now · ${lang}`}
      complexity={complexity}
      expectedTime={expectedTime}
      expectedSpace={expectedSpace}
    />
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
