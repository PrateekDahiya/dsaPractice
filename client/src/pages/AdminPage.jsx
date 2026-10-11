import { useCallback, useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { apiJson } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

const LIMIT = 25;

// Mirrors admin.html: role-gated user table (search + pagination + role
// select) and stale-AI prune. Server enforces admin on every call.
export default function AdminPage() {
  const { user, ready } = useAuth();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pruning, setPruning] = useState(false);
  const [pruneOut, setPruneOut] = useState("");

  const loadUsers = useCallback(
    async (off, q) => {
      setLoading(true);
      setError("");
      try {
        const d = await apiJson(`/api/admin/users?limit=${LIMIT}&offset=${off}&q=${encodeURIComponent(q)}`);
        setUsers(d.users || []);
        setTotal(d.total || 0);
      } catch (e) {
        setError(e.message);
        setUsers([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (ready && user?.role === "admin") loadUsers(0, "");
  }, [ready, user, loadUsers]);

  async function setRole(uid, role) {
    try {
      await apiJson(`/api/admin/users/${uid}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      setNotice(`User ${uid} → ${role}`);
      loadUsers(offset, search);
    } catch (e) {
      setNotice("Failed: " + e.message);
      loadUsers(offset, search);
    }
  }

  async function prune() {
    if (!window.confirm("Delete up to 50 unsolved AI-tagged questions? This cannot be undone.")) return;
    setPruning(true);
    try {
      const d = await apiJson("/api/admin/questions/stale-ai", { method: "DELETE" });
      setPruneOut(`Deleted ${d.deleted.length}: ${(d.deleted || []).join(", ") || "none"}`);
      setNotice(`Pruned ${d.deleted.length} questions`);
    } catch (e) {
      setNotice("Prune failed: " + e.message);
    } finally {
      setPruning(false);
    }
  }

  if (!ready) {
    return (
      <div>
        <Topbar />
        <div className="lb-wrap">
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div>
        <Topbar />
        <div className="lb-wrap">
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>
            <h2 style={{ color: "var(--text)" }}>Forbidden</h2>
            <p>Admin access only.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar />
      <div className="lb-wrap">
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>Admin</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
          User roles &amp; AI content moderation. Every action is enforced server-side.
        </p>
        {notice ? (
          <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
            {notice}
          </div>
        ) : null}
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Users</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            placeholder="Search username/email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
              loadUsers(0, e.target.value);
            }}
            style={{ flex: 1, minWidth: 160, background: "var(--panel2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}
          />
          <button
            className="btn ghost"
            style={{ padding: "6px 12px" }}
            onClick={() => {
              const off = Math.max(0, offset - LIMIT);
              setOffset(off);
              loadUsers(off, search);
            }}
          >
            ← Prev
          </button>
          <button
            className="btn ghost"
            style={{ padding: "6px 12px" }}
            onClick={() => {
              const off = offset + LIMIT;
              setOffset(off);
              loadUsers(off, search);
            }}
          >
            Next →
          </button>
        </div>
        {loading ? (
          <div style={{ color: "var(--muted)", padding: 12 }}>Loading...</div>
        ) : error ? (
          <div style={{ color: "var(--muted)", padding: 12 }}>Error: {error}</div>
        ) : (
          <>
            <table className="lb-table" id="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>ID</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th style={{ width: 110 }}>Role</th>
                  <th style={{ width: 120 }}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ color: "var(--muted)" }}>{u.id}</td>
                    <td className="lb-user">{u.username}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{u.email || "–"}</td>
                    <td>
                      <select
                        value={u.role === "admin" ? "admin" : "user"}
                        onChange={(e) => setRole(u.id, e.target.value)}
                        style={{ background: "var(--panel2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 12 }}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ color: "var(--muted)", fontSize: 12, margin: "8px 0 20px" }}>
              Showing {users.length} of {total} users
            </div>
          </>
        )}
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>AI moderation</h2>
        <div className="lc-card">
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Delete up to 50 <code>AI</code>-tagged questions nobody ever solved.
          </div>
          <button className="btn secondary" style={{ padding: "6px 12px" }} disabled={pruning} onClick={prune}>
            {pruning ? "Pruning..." : "Prune stale AI questions"}
          </button>
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>{pruneOut}</span>
        </div>
      </div>
    </div>
  );
}
