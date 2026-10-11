import { CaseDetail } from "./Console.jsx";

// Right-panel read-only submission view (mirrors showSubmissionView()).
// Code hidden when readOnly (other user's dashboard).
export default function SubmissionView({ entry, readOnly, onRestore, onBack }) {
  if (!entry) return null;
  const e = entry;
  const code = (e.code || "").slice(0, 8000) + ((e.code || "").length > 8000 ? "\n...truncated" : "");
  return (
    <>
      <div className="editor-header">
        <div className="editor-header-left">
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            {e.title || e.questionId} · {e.mode} · {e.language} · {e.passed}/{e.total}
          </span>
          <span style={{ fontSize: 12 }}>{new Date(e.ts).toLocaleString()}</span>
        </div>
        <div className="editor-actions" style={{ display: "flex", gap: 8 }}>
          {!readOnly ? (
            <button className="btn primary" style={{ padding: "6px 12px" }} onClick={() => onRestore(e)}>
              Restore to editor
            </button>
          ) : null}
          <button className="btn ghost" style={{ padding: "6px 10px" }} onClick={onBack}>
            Back to editor
          </button>
        </div>
      </div>
      <div className="submission-view-body" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative", background: "#0f1117" }}>
          <pre className="submission-code oe-highlight" style={{ flex: 1, overflow: "auto", margin: 0 }}>
            {readOnly ? "Read-only view — code hidden for other user" : code}
          </pre>
        </div>
        <div className="test-results" style={{ flex: 1, borderTop: "1px solid var(--border)" }}>
          <div className="results-header">
            <div className="results-title">
              Results {e.passed}/{e.total}
            </div>
          </div>
          {e.complexityTime || e.complexitySpace ? (
            <div className="run-stats" style={{ fontSize: 12, color: "var(--muted)", margin: "-4px 0 10px" }}>
              Complexity (AI): {e.complexityTime || "?"} time · {e.complexitySpace || "?"} space
            </div>
          ) : null}
          {(e.results || []).map((r, i) => (
            <div className="test-case open" key={r.testCaseId + i}>
              <div className="test-case-header">
                <span className="test-label">
                  <span className={`dot ${r.passed ? "pass" : "fail"}`}></span> Case {i + 1} {r.hidden ? "(hidden)" : ""} —{" "}
                  {r.passed ? "Passed" : "Failed"}
                </span>
              </div>
              <CaseDetail r={r} />
            </div>
          ))}
          {!(e.results || []).length ? "no results" : null}
        </div>
      </div>
    </>
  );
}
