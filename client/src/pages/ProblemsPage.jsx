import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import { apiFetch } from "../api/client.js";

// Mirrors problems.html: question table with search, difficulty/tag/status/
// sort filters, community stats, and solved indicators.
export default function ProblemsPage() {
  const [questions, setQuestions] = useState([]);
  const [statsMap, setStatsMap] = useState({});
  const [solvedSet, setSolvedSet] = useState(new Set());
  const [attemptedSet, setAttemptedSet] = useState(new Set());
  const [savedSet, setSavedSet] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [diff, setDiff] = useState("all");
  const [tag, setTag] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [qsRes, stRes] = await Promise.all([
          apiFetch("/api/questions"),
          apiFetch("/api/questions/stats").catch(() => null),
        ]);
        if (!qsRes.ok) throw new Error("questions failed");
        const qs = await qsRes.json();
        let st = [];
        if (stRes && stRes.ok) {
          try {
            st = await stRes.json();
          } catch {
            st = [];
          }
        }
        const solved = new Set();
        const attempted = new Set();
        const saved = new Set();
        try {
          const r1 = await apiFetch("/api/questions/solved");
          if (r1.ok) (await r1.json()).forEach((id) => solved.add(id));
          const r2 = await apiFetch("/api/submissions?limit=100");
          if (r2.ok) {
            (await r2.json()).forEach((s) => {
              if (!solved.has(s.questionId)) attempted.add(s.questionId);
            });
          }
          try {
            const r3 = await apiFetch("/api/bookmarks");
            if (r3.ok) (await r3.json()).forEach((id) => saved.add(id));
          } catch {
            // anonymous or unavailable: no saved state
          }
        } catch {
          // anonymous: no solved state
        }
        if (cancelled) return;
        setQuestions(qs);
        const sm = {};
        (st || []).forEach((s) => {
          sm[s.questionId] = { attempted: s.attempted || 0, submissions: s.submissions || 0, solved: s.solved || 0 };
        });
        setStatsMap(sm);
        setSolvedSet(solved);
        setAttemptedSet(attempted);
        setSavedSet(saved);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tags = useMemo(
    () => [...new Set(questions.flatMap((q) => q.tags || []))].sort(),
    [questions]
  );

  const st = (id) => statsMap[id] || { attempted: 0, submissions: 0, solved: 0 };
  const rate = (q) => {
    const s = st(q.id);
    return s.attempted ? s.solved / s.attempted : -1;
  };

  const list = useMemo(() => {
    let out = [...questions];
    const q = search.toLowerCase().trim();
    if (diff !== "all") out = out.filter((x) => x.difficulty === diff);
    if (tag !== "all") out = out.filter((x) => (x.tags || []).includes(tag));
    if (q)
      out = out.filter(
        (x) =>
          x.title.toLowerCase().includes(q) ||
          x.id.includes(q) ||
          (x.tags || []).join(" ").toLowerCase().includes(q)
      );
    if (status === "saved") out = out.filter((x) => savedSet.has(x.id));
    else if (status === "solved") out = out.filter((x) => solvedSet.has(x.id));
    else if (status === "attempted") out = out.filter((x) => !solvedSet.has(x.id) && attemptedSet.has(x.id));
    else if (status === "todo") out = out.filter((x) => !solvedSet.has(x.id) && !attemptedSet.has(x.id));
    if (sort === "recent") out.sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
    else if (sort === "title") out.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "difficulty") {
      const o = { Easy: 0, Medium: 1, Hard: 2 };
      out.sort((a, b) => (o[a.difficulty] ?? 9) - (o[b.difficulty] ?? 9) || a.title.localeCompare(b.title));
    } else if (sort === "attempted") out.sort((a, b) => st(b.id).attempted - st(a.id).attempted);
    else if (sort === "solved") out.sort((a, b) => st(b.id).solved - st(a.id).solved);
    else if (sort === "rate") out.sort((a, b) => rate(b) - rate(a));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, statsMap, solvedSet, attemptedSet, savedSet, search, diff, tag, status, sort]);

  const sel = {
    flex: 1,
    minWidth: 120,
    background: "var(--panel2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "7px 10px",
    fontSize: 13,
  };

  return (
    <div>
      <Topbar />
      <div className="lb-wrap" style={{ maxWidth: 1100 }}>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>All Problems</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }} id="problems-sub">
          {list.length} of {questions.length} problems
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <input
            placeholder="Search title/tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...sel, flex: 2, minWidth: 160 }}
          />
          <select value={diff} onChange={(e) => setDiff(e.target.value)} title="Filter difficulty" style={sel}>
            <option value="all">All difficulties</option>
            <option value="Easy">Easy</option>
            <option value="Medium">Medium</option>
            <option value="Hard">Hard</option>
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)} title="Tag" style={sel}>
            <option value="all">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} title="My status" style={sel}>
            <option value="all">All statuses</option>
            <option value="saved">★ Saved by me</option>
            <option value="solved">Solved by me</option>
            <option value="attempted">Attempted</option>
            <option value="todo">Todo</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} title="Sort" style={sel}>
            <option value="recent">Recently added</option>
            <option value="title">Title A–Z</option>
            <option value="difficulty">Difficulty</option>
            <option value="attempted">Most attempted</option>
            <option value="solved">Most solved</option>
            <option value="rate">Highest success rate</option>
          </select>
        </div>
        {loading ? (
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>Loading...</div>
        ) : error ? (
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>Error: {error}</div>
        ) : !list.length ? (
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>No problems match the filters.</div>
        ) : (
          <table className="lb-table" id="problems-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Title</th>
                <th style={{ width: 100 }}>Difficulty</th>
                <th style={{ width: 110 }}>Attempted</th>
                <th style={{ width: 100 }}>Solved</th>
                <th style={{ width: 150 }}>Success rate</th>
                <th style={{ width: 90 }}>You</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x, i) => {
                const s = st(x.id);
                const r = rate(x);
                const pct = r < 0 ? 0 : Math.round(r * 100);
                const you = solvedSet.has(x.id) ? (
                  <span style={{ color: "#00b8a3", fontWeight: 700 }}>✓</span>
                ) : attemptedSet.has(x.id) ? (
                  <span style={{ color: "#ffa116", fontWeight: 700 }}>●</span>
                ) : (
                  <span style={{ color: "var(--muted)" }}>–</span>
                );
                return (
                  <tr key={x.id}>
                    <td style={{ color: "var(--muted)" }}>{i + 1}</td>
                    <td className="lb-user">
                      <Link to={`/workspace#${x.id}`}>{x.title}</Link>
                      <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                        {(x.tags || []).join(" · ")}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${x.difficulty}`}>{x.difficulty}</span>
                    </td>
                    <td>
                      {s.attempted} <span style={{ color: "var(--muted)", fontSize: 11 }}>({s.submissions} tries)</span>
                    </td>
                    <td>{s.solved}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div className="diff-bar" style={{ flex: 1 }}>
                          <span style={{ width: `${pct}%` }}></span>
                        </div>
                        <span style={{ fontSize: 12, minWidth: 36 }}>{r < 0 ? "–" : pct + "%"}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>{you}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
