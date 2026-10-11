import { useCallback, useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { apiJson } from "../api/client.js";

const FILTERS = [
  { id: "all", label: "All time" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

function formatLast(d) {
  if (!d) return "-";
  const dt = new Date(d);
  const diffDays = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (diffDays === 0) return "today " + dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return diffDays + "d ago";
  return dt.toLocaleDateString();
}

function fmtUpdated(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "updated just now";
  if (s < 60) return `updated ${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `updated ${m}m ago` : `updated ${Math.floor(m / 60)}h ago`;
}

// Mirrors leaderboard.html: each filter fetched ONCE (streak=1 batched
// server-side), tab switches render from memory, only Refresh refetches.
export default function LeaderboardPage() {
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);
  const cache = useRef({}); // filter -> { rows, ts }
  const stamps = useRef({});

  const load = useCallback(
    async (f, { refresh = false } = {}) => {
      setFilter(f);
      const hit = cache.current[f];
      if (!refresh && hit) {
        setRows(hit.rows);
        setUpdatedAt(stamps.current[f] || 0);
        setError("");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const data = await apiJson(`/api/leaderboard?filter=${encodeURIComponent(f)}&limit=50&streak=1`);
        cache.current[f] = { rows: data };
        stamps.current[f] = Date.now();
        setRows(data);
        setUpdatedAt(stamps.current[f]);
      } catch (e) {
        setError(e.message);
        setRows(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load("all");
  }, [load]);

  return (
    <div>
      <Topbar />
      <div className="lb-wrap">
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>Leaderboard</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
          Rank by solved problems · Filter by time window
        </p>
        <div className="filter-tabs" id="filter-tabs">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              data-filter={f.id}
              className={filter === f.id ? "active" : ""}
              onClick={() => load(f.id)}
            >
              {f.label}
            </button>
          ))}
          <button onClick={() => load(filter, { refresh: true })} title="Refetch from server" style={{ marginLeft: "auto" }}>
            ⟳ Refresh
          </button>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 11, margin: "-8px 0 10px" }}>{fmtUpdated(updatedAt)}</div>
        {loading ? (
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>
            <div className="loading">Loading leaderboard...</div>
          </div>
        ) : error ? (
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>Error: {error}</div>
        ) : !rows || !rows.length ? (
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>No users yet.</div>
        ) : (
          <table className="lb-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Rank</th>
                <th>User</th>
                <th style={{ width: 90 }}>Solved</th>
                <th style={{ width: 100 }}>Streak</th>
                <th style={{ width: 140 }}>Last solve</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id}>
                  <td>
                    <span className={`rank-badge ${i + 1 <= 3 ? "gold" : ""}`}>{i + 1}</span>
                  </td>
                  <td className="lb-user">
                    <a href={`/dashboard?id=${u.id}`}>{u.username}</a>
                  </td>
                  <td>{u.solvedCount}</td>
                  <td>{String(u.streak ?? "-")}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>{formatLast(u.lastSolvedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
