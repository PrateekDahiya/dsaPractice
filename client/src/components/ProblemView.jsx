import { useAuth } from "../context/AuthContext.jsx";

// Mirrors renderProblem() from public/js/questions.js: title, badges,
// bookmark/mark/edit/delete actions, statement, examples, constraints.
export default function ProblemView({
  question,
  solved,
  manuallyDone,
  bookmarked,
  canEdit,
  onToggleMark,
  onToggleBookmark,
  onEdit,
  onDelete,
  marking,
  bookmarking,
}) {
  const { user } = useAuth();
  if (!question) {
    return (
      <div className="empty-state">
        <h2>Select a problem</h2>
        <p>
          Choose a question from the left. Write code on the right, hit <strong>Run</strong> for visible
          tests or <strong>Submit</strong> for all tests.
        </p>
      </div>
    );
  }
  const q = question;
  const markBtn = (() => {
    if (!user) return null;
    if (manuallyDone)
      return (
        <button className="btn secondary" style={{ padding: "6px 12px", fontSize: 12 }} title="Remove manual override" onClick={onToggleMark} disabled={marking}>
          {marking ? "Unmarking..." : "Marked Done (Undo)"}
        </button>
      );
    if (solved) return <span style={{ color: "var(--green)", fontSize: 12, fontWeight: 700 }}>Solved</span>;
    return (
      <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12 }} title="Mark as done even if tests fail (e.g. wrong test case)" onClick={onToggleMark} disabled={marking}>
        {marking ? "Marking..." : "Mark as Done"}
      </button>
    );
  })();

  return (
    <>
      <div className="problem-title">{q.qno != null ? <span style={{ color: "var(--muted)", fontWeight: 400 }}>#{q.qno} · </span> : null}{q.title}</div>
      <div className="problem-meta">
        <span className={`badge ${q.difficulty}`}>{q.difficulty}</span>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>{(q.tags || []).join(" · ")}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {user ? (
            <button
              className="btn ghost"
              style={{ padding: "6px 10px", fontSize: 13 }}
              title={bookmarked ? "Remove bookmark" : "Bookmark for later"}
              onClick={onToggleBookmark}
              disabled={bookmarking}
            >
              {bookmarked ? "★" : "☆"}
            </button>
          ) : null}
          {markBtn}
          {canEdit ? (
            <>
              <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12 }} title="Edit this question" onClick={onEdit}>
                Edit
              </button>
              <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12, color: "var(--red)" }} title="Delete this question" onClick={onDelete}>
                Delete
              </button>
            </>
          ) : null}
        </span>
      </div>
      <div className="problem-statement" dangerouslySetInnerHTML={{ __html: q.problemStatement }} />
      {q.examples ? (
        <div className="examples">
          <h3>Examples</h3>
          {q.examples.map((ex, i) => (
            <div className="example-card" key={i}>
              <div className="ex-row">
                <span className="ex-label">Input:</span> <pre>{ex.input}</pre>
              </div>
              <div className="ex-row">
                <span className="ex-label">Output:</span> <pre>{ex.output}</pre>
              </div>
              {ex.explanation ? (
                <div className="ex-row">
                  <span className="ex-label">Explanation:</span> <span>{ex.explanation}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {q.constraints ? (
        <div className="constraints">
          <h3>Constraints</h3>
          <ul>
            {q.constraints.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="constraints">
        <h3>Test Cases</h3>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Visible: {q.visibleTestCases.length} · Hidden: {q.hiddenTestCases.length} (only on Submit)
        </p>
      </div>
    </>
  );
}
