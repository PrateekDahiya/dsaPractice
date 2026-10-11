import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import { apiJson } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

// Mirrors login.html: username+password, honeypot `website` field (bots fill
// it; server answers 401 like bad credentials), error box, redirect.
export default function LoginPage() {
  const { login, user, ready } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (ready && user) navigate("/workspace", { replace: true });
  }, [ready, user, navigate]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await apiJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, website }),
      });
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
          <h1>Login</h1>
          <p className="muted">Welcome back.</p>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your username"
              required
              pattern="^[a-z0-9_]{3,20}$"
              title="3-20 chars a-z0-9_"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
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
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>
          <button type="submit" className="btn primary" style={{ width: "100%", marginTop: 8, padding: 10 }} disabled={busy}>
            {busy ? "Logging in..." : "Login"}
          </button>
          {error ? <div className="auth-error">{error}</div> : null}
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
            No account? <Link to="/register" style={{ color: "var(--accent)" }}>Register</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
