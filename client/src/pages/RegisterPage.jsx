import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import { apiJson } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

// Mirrors register.html: username/email/password+confirm, honeypot, error box.
// Note: a honeypot trip returns fake success with NO token — guard for that.
export default function RegisterPage() {
  const { login, user, ready } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (ready && user) navigate("/workspace", { replace: true });
  }, [ready, user, navigate]);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const payload = { username: username.trim(), password, website };
      if (email.trim()) payload.email = email.trim();
      const data = await apiJson("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!data.token || !data.user) throw new Error("Registration failed");
      login(data.token, data.user);
      navigate("/workspace", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Topbar />
      <div className="auth-wrap">
        <form className="auth-card" onSubmit={onSubmit}>
          <h1>Create account</h1>
          <p className="muted">Username 3-20 chars (a-z0-9_). Email optional.</p>
          <label>
            Username <span style={{ color: "var(--red)" }}>*</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. coder123"
              required
              pattern="^[a-z0-9_]{3,20}$"
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password <span style={{ color: "var(--red)" }}>*</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min 6 characters"
              required
              minLength={6}
            />
          </label>
          <label>
            Confirm Password <span style={{ color: "var(--red)" }}>*</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="repeat password"
              required
              minLength={6}
            />
          </label>
          <div
            aria-hidden="true"
            style={{ position: "absolute", left: -9999, top: "auto", width: 1, height: 1, overflow: "hidden" }}
          >
            <label>
              Website (leave blank)
              <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <button type="submit" className="btn primary" style={{ width: "100%", marginTop: 8, padding: 10 }} disabled={busy}>
            {busy ? "Creating..." : "Create account"}
          </button>
          {error ? <div className="auth-error">{error}</div> : null}
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
            Have account? <Link to="/login" style={{ color: "var(--accent)" }}>Login</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
