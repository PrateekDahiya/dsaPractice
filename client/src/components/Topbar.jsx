import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/workspace", label: "Problems" },
  { to: "/problems", label: "Browse" },
  { to: "/roadmap", label: "Roadmap" },
  { to: "/leaderboard", label: "Leaderboard" },
];

// Shared header — replaces the copy-pasted <header class="topbar"> in all 10
// HTML pages. `extra` renders page-specific right-side items (e.g. + Add
// Question, question count). Username links to /settings (matches vanilla).
export default function Topbar({ extra = null }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/dashboard" className="logo">
          <img
            src="/logo.png"
            alt="Logo"
            style={{ height: 32, width: "auto", borderRadius: 6, objectFit: "contain" }}
          />
          DSA Practice
        </Link>
        <nav className="topbar-nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => `ghost-link${isActive ? " active" : ""}`}
            >
              {n.label}
            </NavLink>
          ))}
          {user?.role === "admin" && (
            <NavLink
              to="/admin"
              className={({ isActive }) => `ghost-link${isActive ? " active" : ""}`}
            >
              Admin
            </NavLink>
          )}
        </nav>
      </div>
      <div className="topbar-right">
        {extra}
        {user ? (
          <span id="auth-area" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              to="/settings"
              title="Account settings"
              style={{
                color: "var(--text)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "var(--panel2)",
                  border: "1px solid var(--border)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                }}
              >
                {user.username.slice(0, 2).toUpperCase()}
              </span>
              {user.username}
            </Link>
            <button
              className="btn ghost"
              style={{ padding: "6px 10px", fontSize: 12 }}
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              Logout
            </button>
          </span>
        ) : (
          <span id="auth-area" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link to="/login" className="ghost-link" style={{ padding: "6px 10px", fontSize: 12 }}>
              Login
            </Link>
            <Link to="/register" className="btn primary" style={{ padding: "6px 12px", fontSize: 12 }}>
              Register
            </Link>
          </span>
        )}
      </div>
    </header>
  );
}
