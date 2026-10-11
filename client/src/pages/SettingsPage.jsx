import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import { apiFetch, apiJson } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

const inputStyle = {
  background: "var(--code)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
};

// Mirrors settings.html: profile (avatar/bio) + account (password, export,
// delete). Requires login; redirects otherwise.
export default function SettingsPage() {
  const { user, ready, login, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [avatar, setAvatar] = useState("");
  const [bio, setBio] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    if (ready && !user) navigate("/login", { replace: true });
  }, [ready, user, navigate]);

  useEffect(() => {
    if (user) {
      setAvatar(user.avatar || "");
      setBio(user.bio || "");
    }
  }, [user?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div>
        <Topbar />
        <div className="lb-wrap" style={{ maxWidth: 760 }}>
          <div className="loading">Loading…</div>
        </div>
      </div>
    );
  }
  if (!user) return null;

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const d = await apiJson("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: avatar.trim(), bio }),
      });
      login(localStorage.getItem("token"), { ...user, avatar: d.avatar || null, bio: d.bio || null });
      setProfileMsg("Saved ✓");
      await refresh();
    } catch (e) {
      setProfileMsg("Failed: " + e.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    setChangingPw(true);
    try {
      await apiJson("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      setPwMsg("Password changed ✓");
      setCurPw("");
      setNewPw("");
    } catch (e) {
      setPwMsg("Failed: " + e.message);
    } finally {
      setChangingPw(false);
    }
  }

  async function exportData() {
    try {
      const res = await apiFetch("/api/me/export");
      if (!res.ok) throw new Error("export failed (" + res.status + ")");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dsa-export.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setPwMsg("Export failed: " + e.message);
    }
  }

  async function deleteAccount() {
    const pw = window.prompt(
      "Type your password to PERMANENTLY delete your account, submissions, saves and bookmarks. Questions you added stay (anonymized)."
    );
    if (pw === null) return;
    if (!pw) {
      setPwMsg("Password required");
      return;
    }
    if (!window.confirm("Last chance — delete everything?")) return;
    try {
      await apiJson("/api/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      logout();
      navigate("/register", { replace: true });
    } catch (e) {
      setPwMsg("Delete failed: " + e.message);
    }
  }

  return (
    <div>
      <Topbar />
      <div className="lb-wrap" style={{ maxWidth: 760 }}>
        <h1 style={{ fontSize: 22, marginBottom: 14 }}>Settings</h1>
        <div className="list-card" style={{ marginBottom: 16, display: "flex", gap: 14, alignItems: "flex-start" }}>
          {user.avatar ? (
            <img
              src={user.avatar}
              alt=""
              style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }}
              onError={(e) => {
                e.target.style.display = "none";
              }}
            />
          ) : (
            <span
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "var(--panel2)",
                border: "1px solid var(--border)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              {(user.username || "?").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{user.username}</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {user.bio || "Add a bio so others know you."}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setShowForm((v) => !v)}>
                Edit profile
              </button>
            </div>
            {showForm ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>
                  Avatar image URL
                  <input placeholder="https://..." value={avatar} onChange={(e) => setAvatar(e.target.value)} style={inputStyle} />
                </label>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>
                  Bio (max 500)
                  <textarea rows={2} maxLength={500} placeholder="Short bio..." value={bio} onChange={(e) => setBio(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" style={{ padding: "6px 12px", fontSize: 12 }} disabled={savingProfile} onClick={saveProfile}>
                    {savingProfile ? "Saving..." : "Save"}
                  </button>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{profileMsg}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="list-card" style={{ marginBottom: 16 }}>
          <h3>Account</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                Current password
                <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} style={{ ...inputStyle, display: "block", marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                New password (min 6)
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={{ ...inputStyle, display: "block", marginTop: 4 }} />
              </label>
              <button className="btn secondary" style={{ padding: "7px 12px", fontSize: 12 }} disabled={changingPw} onClick={changePassword}>
                {changingPw ? "Changing..." : "Change password"}
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{pwMsg}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={exportData}>
                ⬇ Export my data (JSON)
              </button>
              <button
                className="btn ghost"
                style={{ padding: "6px 12px", fontSize: 12, color: "var(--red)", borderColor: "rgba(255,55,87,0.4)" }}
                onClick={deleteAccount}
              >
                Delete account…
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
