import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import { apiFetch, apiJson } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

function levelClass(count) {
  if (count === 0) return "";
  if (count === 1) return "l1";
  if (count === 2) return "l2";
  if (count === 3) return "l3";
  if (count >= 4 && count < 6) return "l4";
  return "l5";
}

function renderRing(solved, total) {
  const pct = total ? Math.round((solved / total) * 100) : 0;
  const r = 60;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div className="ring">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--panel2)" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={r} fill="none" stroke="var(--accent)" strokeWidth="12"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        />
      </svg>
      <div className="ring-center">
        <span className="big">{solved}/{total}</span>
        <span className="small">{pct}% solved</span>
      </div>
    </div>
  );
}

function CollapseList({ items, group, initial = 8, moreLabel }) {
  const [open, setOpen] = useState(false);
  if (items.length <= initial) return <ul>{items}</ul>;
  return (
    <>
      <ul>
        {items.slice(0, initial)}
        {!open ? null : items.slice(initial).map((li, i) => <li key={`x${i}`} className="extra">{li.props.children}</li>)}
      </ul>
      <button
        className="btn ghost collapse-toggle"
        style={{ padding: "4px 10px", fontSize: 12, marginTop: 6 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Show less ▴" : `Show all ${items.length} ▾`}
      </button>
    </>
  );
}

// Mirrors dashboard.html: stats ring, streaks, heatmap, daily challenge,
// lists. Supports ?id=<userId> read-only view.
export default function DashboardPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [daily, setDaily] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const viewId = searchParams.get("id") || searchParams.get("user") || searchParams.get("userId");
  const isOther = !!viewId && (!user || String(user.id) !== String(viewId));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dash, qs] = await Promise.all([
          apiJson(`/api/users/${viewId ? encodeURIComponent(viewId) : "me"}/dashboard`),
          apiFetch("/api/questions").then(async (r) => (r.ok ? r.json() : [])),
        ]);
        let today = null;
        try {
          const rd = await apiFetch("/api/daily");
          if (rd.ok) today = await rd.json();
        } catch {
          today = null;
        }
        let prof = null;
        if (viewId) {
          try {
            const rp = await apiFetch(`/api/users/${encodeURIComponent(viewId)}/profile`);
            if (rp.ok) prof = await rp.json();
          } catch {
            prof = null;
          }
        }
        if (cancelled) return;
        setData(dash);
        setQuestions(qs);
        setDaily(today);
        setProfile(prof);
        // background daily ensure (logged-in only): swap card when it lands
        if (today && !today.generated && localStorage.getItem("token")) {
          apiFetch("/api/daily/ensure", { method: "POST" })
            .then(async (r) => {
              const d = await r.json().catch(() => ({}));
              if (!r.ok || !d.generated) return;
              try {
                const rd2 = await apiFetch("/api/daily");
                if (rd2.ok && !cancelled) setDaily(await rd2.json());
              } catch {
                // keep fallback
              }
            })
            .catch(() => {});
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  if (loading) {
    return (
      <div>
        <Topbar />
        <div className="lb-wrap" id="dash-root">
          <div className="loading">Loading dashboard...</div>
        </div>
      </div>
    );
  }
  if (error || !data) {
    const anon = !localStorage.getItem("token") && !viewId;
    return (
      <div>
        <Topbar />
        <div className="lb-wrap" id="dash-root">
          {anon ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
              <h2 style={{ color: "var(--text)" }}>Login required</h2>
              <p>Please <Link to="/login" style={{ color: "var(--accent)" }}>Login</Link> to view your dashboard.</p>
              <p style={{ marginTop: 10 }}>Or view <Link to="/leaderboard" style={{ color: "var(--accent)" }}>Leaderboard</Link></p>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
              <h2 style={{ color: "var(--text)" }}>Error</h2>
              <p>{error || "Failed to load"}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const stats = data.stats;
  const solvedIds = new Set(data.solvedIds || []);
  const userLabel = isOther ? `User #${viewId}` : user ? user.username : "You";
  const diff = stats.byDifficulty || { Easy: { solved: 0, total: 0 }, Medium: { solved: 0, total: 0 }, Hard: { solved: 0, total: 0 } };
  const diffPct = (d) => (d.total ? Math.round((d.solved / d.total) * 100) : 0);
  const streaks = stats.streaks || { current: 0, longest: 0, totalActive: 0, calendar: [] };
  const recent = stats.recent || [];
  const unsolved = questions.filter((q) => !solvedIds.has(q.id));
  const added = questions.filter(
    (q) => String(q.addedBy) === String(user?.id) || (q.addedByUsername && user && q.addedByUsername === user.username)
  );

  const calByMonth = (() => {
    const groups = {};
    for (const cell of streaks.calendar || []) {
      const month = cell.date.slice(0, 7);
      if (!groups[month]) groups[month] = [];
      groups[month].push(cell);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  })();
  const monthName = (ym) => {
    const [y, m] = ym.split("-");
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  };

  const recentItems = recent.map((r) => (
    <li key={r.questionId}>
      <Link to={`/workspace#${r.questionId}`} className="q-link">{r.title}</Link>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span className={`badge ${r.difficulty}`}>{r.difficulty}</span>
        <span style={{ color: "var(--muted)", fontSize: 11 }}>{new Date(r.solvedAt).toLocaleDateString()}</span>
      </span>
    </li>
  ));
  const unsolvedItems = unsolved.map((q) => (
    <li key={q.id}>
      <Link to={`/workspace#${q.id}`} className="q-link">{q.title}</Link>
      <span className={`badge ${q.difficulty}`}>{q.difficulty}</span>
    </li>
  ));
  const addedItems = added.map((q) => (
    <li key={q.id}>
      <Link to={`/workspace#${q.id}`} className="q-link">{q.title}</Link>
      <span className={`badge ${q.difficulty}`}>{q.difficulty}</span>
    </li>
  ));

  return (
    <div>
      <Topbar />
      <div className="dash-wrap" id="dash-root">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h1 style={{ fontSize: 22 }}>
            {isOther ? `Dashboard — ${userLabel}` : "Dashboard"}
            {isOther ? ' <span style="color:var(--muted);font-size:13px;font-weight:400">(read-only)</span>' : ""}
          </h1>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>{stats.solved} solved · {stats.total} total</span>
        </div>
        {isOther && profile ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, color: "var(--muted)", fontSize: 13 }}>
            {profile.avatar ? (
              <img src={profile.avatar} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }} onError={(e) => { e.target.style.display = "none"; }} />
            ) : null}
            <span>
              <strong style={{ color: "var(--text)" }}>{profile.username}</strong>
              {profile.bio ? ` · ${profile.bio}` : ""}
            </span>
          </div>
        ) : null}
        {daily ? (
          <div className="daily-card">
            <span className="daily-icon">📅</span>
            <div className="daily-body">
              <div className="daily-eyebrow">
                Daily challenge <span className="daily-date">· {daily.date}</span>
              </div>
              <div style={{ marginTop: 3 }}>
                <Link to={`/workspace#${daily.questionId}`} className="daily-title">{daily.title}</Link>{" "}
                <span className={`badge ${daily.difficulty}`}>{daily.difficulty}</span>
              </div>
              <div className="daily-sub">
                {solvedIds.has(daily.questionId) ? (
                  <span className="daily-solved">Solved ✓ — nice work</span>
                ) : daily.generated ? (
                  <span className="daily-fresh">Fresh today ✨ — generated for you</span>
                ) : (
                  "Rotation pick · Medium/Hard"
                )}
              </div>
            </div>
            <Link
              to={`/workspace#${daily.questionId}`}
              className="btn primary"
              style={{ padding: "8px 16px", textDecoration: "none" }}
            >
              {solvedIds.has(daily.questionId) ? "Review →" : "Solve →"}
            </Link>
          </div>
        ) : null}
        <div className="dash-grid">
          <div className="ring-card">
            {renderRing(stats.solved, stats.total)}
            <div className="diff-breakdown">
              {["Easy", "Medium", "Hard"].map((k) => {
                const d = diff[k] || { solved: 0, total: 0 };
                return (
                  <div className="diff-row" key={k}>
                    <span style={{ minWidth: 60 }}>{k}</span>
                    <div className={`diff-bar ${k.toLowerCase()}`}>
                      <span style={{ width: `${diffPct(d)}%` }}></span>
                    </div>
                    <span style={{ minWidth: 60, textAlign: "right" }}>{d.solved}/{d.total}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="streak-grid">
              <div className="streak-card"><div className="num">{streaks.current}</div><div className="lbl">Current streak</div></div>
              <div className="streak-card"><div className="num">{streaks.longest}</div><div className="lbl">Longest streak</div></div>
              <div className="streak-card"><div className="num">{streaks.totalActive}</div><div className="lbl">Active days</div></div>
            </div>
            <div className="heatmap">
              <h3>Activity — last 12 months</h3>
              <div className="months-grid">
                {calByMonth.map(([ym, cells]) => (
                  <div className="month-block" key={ym}>
                    <div className="month-label">
                      {monthName(ym)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({cells.filter((c) => c.count > 0).length} active)</span>
                    </div>
                    <div className="cal-grid small">
                      {cells.map((cell) => (
                        <div
                          key={cell.date}
                          className={`cal-cell ${levelClass(cell.count)}`}
                          title={`${cell.date}: ${cell.count} solve${cell.count !== 1 ? "s" : ""}`}
                        ></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
                Less
                <span style={{ display: "flex", gap: 3 }}>
                  {[0, 1, 2, 3, 5].map((c) => (
                    <span key={c} className={`cal-cell ${levelClass(c)}`} style={{ width: 12, height: 12 }}></span>
                  ))}
                </span>
                More
              </div>
            </div>
          </div>
        </div>
        <div className="dash-lists">
          <div className="list-card">
            <h3>Recently solved</h3>
            {recent.length ? <CollapseList items={recentItems} group="recent" initial={8} /> : <div style={{ color: "var(--muted)", fontSize: 13 }}>No solves yet — start solving!</div>}
          </div>
          <div className="list-card">
            <h3>Unsolved</h3>
            {unsolved.length ? <CollapseList items={unsolvedItems} group="unsolved" initial={12} /> : <div style={{ color: "var(--muted)", fontSize: 13 }}>All caught up! 🎉</div>}
          </div>
        </div>
        <div className="list-card" style={{ marginTop: 16 }}>
          <h3>Added Questions <span style={{ color: "var(--muted)", fontWeight: 400 }}>({added.length})</span></h3>
          {added.length ? <CollapseList items={addedItems} group="added" initial={8} /> : <div style={{ color: "var(--muted)", fontSize: 13 }}>No questions added yet.</div>}
        </div>
      </div>
    </div>
  );
}
