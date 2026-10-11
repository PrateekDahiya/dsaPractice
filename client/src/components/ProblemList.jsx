import { useEffect, useMemo, useState } from "react";

// Mirrors renderList()/getFilteredSorted()/populateTagFilter() from
// public/js/questions.js: filterable sidebar question list.
export default function ProblemList({
  questions,
  currentId,
  solvedSet,
  attemptedSet,
  manualSet,
  bookmarkedSet,
  onSelect,
  onCount,
  onToggle,
}) {
  const [search, setSearch] = useState("");
  const [diff, setDiff] = useState("all");
  const [tag, setTag] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");

  const tags = useMemo(
    () => [...new Set(questions.flatMap((q) => q.tags || []))].sort(),
    [questions]
  );

  const filtered = useMemo(() => {
    let list = [...questions];
    const q = search.toLowerCase().trim();
    if (diff !== "all") list = list.filter((x) => x.difficulty === diff);
    if (tag !== "all") list = list.filter((x) => (x.tags || []).includes(tag));
    if (status === "saved") list = list.filter((x) => bookmarkedSet.has(x.id));
    else if (status === "solved") list = list.filter((x) => solvedSet.has(x.id));
    else if (status === "attempted")
      list = list.filter((x) => !solvedSet.has(x.id) && attemptedSet.has(x.id));
    else if (status === "todo")
      list = list.filter((x) => !solvedSet.has(x.id) && !attemptedSet.has(x.id));
    if (q)
      list = list.filter(
        (x) =>
          x.title.toLowerCase().includes(q) ||
          x.id.includes(q) ||
          (x.tags || []).join(" ").toLowerCase().includes(q)
      );
    if (sort === "recent") list.sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
    else if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "difficulty") {
      const order = { Easy: 0, Medium: 1, Hard: 2 };
      list.sort((a, b) => (order[a.difficulty] ?? 9) - (order[b.difficulty] ?? 9) || a.title.localeCompare(b.title));
    }
    return list;
  }, [questions, solvedSet, attemptedSet, bookmarkedSet, search, diff, tag, status, sort]);

  useEffect(() => {
    if (onCount) onCount(`${filtered.length} problems`);
  }, [filtered, onCount]);

  const sel = {
    background: "var(--panel2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
  };

  return (
    <>
      <div className="sidebar-header">
        {onToggle ? (
          <button id="menu-toggle" className="btn ghost" title="Hide problems" style={{ padding: "6px 10px" }} onClick={onToggle}>
            ☰
          </button>
        ) : null}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
          <select value={sort} onChange={(e) => setSort(e.target.value)} title="Sort" style={sel}>
            <option value="recent">Recent</option>
            <option value="title">Title A-Z</option>
            <option value="difficulty">Difficulty</option>
          </select>
          <select value={diff} onChange={(e) => setDiff(e.target.value)} title="Filter difficulty" style={sel}>
            <option value="all">All</option>
            <option value="Easy">Easy</option>
            <option value="Medium">Medium</option>
            <option value="Hard">Hard</option>
          </select>
        </div>
      </div>
      <div className="sidebar-controls" style={{ padding: "8px 8px 0", display: "flex", gap: 6, borderBottom: "none" }}>
        <button
          className={`btn ghost${status === "saved" ? " active" : ""}`}
          style={status === "saved" ? { flex: 1, borderColor: "var(--accent)", color: "var(--text)" } : { flex: 1 }}
          title="Show only starred questions"
          onClick={() => setStatus(status === "saved" ? "all" : "saved")}
        >
          ★ Starred
        </button>
      </div>
      <div className="sidebar-controls" style={{ padding: 8, display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
        <input
          placeholder="Search title/tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...sel, flex: 1, minWidth: 120 }}
        />
        <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ ...sel, flex: 1, minWidth: 110 }}>
          <option value="all">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} title="My status" style={{ ...sel, flex: 1, minWidth: 110 }}>
          <option value="all">All statuses</option>
          <option value="saved">★ Saved</option>
          <option value="solved">Solved</option>
          <option value="attempted">Attempted</option>
          <option value="todo">Todo</option>
        </select>
      </div>
      <div id="question-list" className="question-list">
        {filtered.map((q) => {
          let indicator = null;
          if (solvedSet.has(q.id)) {
            const isMan = manualSet.has(q.id);
            indicator = (
              <span className="q-indicator solved" title={isMan ? "Manually marked done" : "Solved"}>
                <span className="dot-sm"></span> {isMan ? "Done" : "Solved"}
              </span>
            );
          } else if (attemptedSet.has(q.id)) {
            indicator = (
              <span className="q-indicator attempted" title="Attempted">
                <span className="dot-sm"></span> Attempted
              </span>
            );
          }
          const bm = bookmarkedSet.has(q.id) ? (
            <span className="q-indicator saved" title="Bookmarked">★</span>
          ) : null;
          return (
            <div
              key={q.id}
              className={`question-item${currentId === q.id ? " active" : ""}`}
              data-id={q.id}
              onClick={() => onSelect(q.id)}
            >
              <div className="q-title">{q.title}</div>
              <div className="q-meta">
                <span className={`badge ${q.difficulty}`}>{q.difficulty}</span>
                <span>{(q.tags || []).join(" · ")}</span>
                {indicator || bm ? (
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    {bm}
                    {indicator}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
        {!filtered.length ? (
          <div style={{ color: "var(--muted)", padding: 10, fontSize: 13 }}>No problems for filter</div>
        ) : null}
      </div>
    </>
  );
}
