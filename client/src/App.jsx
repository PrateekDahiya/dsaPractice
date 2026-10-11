import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider } from "./context/AuthContext.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import WorkspacePage from "./pages/WorkspacePage.jsx";
import ProblemsPage from "./pages/ProblemsPage.jsx";
import RoadmapPage from "./pages/RoadmapPage.jsx";
import LeaderboardPage from "./pages/LeaderboardPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import AddQuestionPage from "./pages/AddQuestionPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

// Vanilla locks <body> (workspace) vs scrolls it (list pages) per HTML file.
// The SPA has one body, so mirror that per route: only /workspace locks.
function ScrollManager() {
  const { pathname } = useLocation();
  useEffect(() => {
    const locked = pathname === "/workspace" || pathname.startsWith("/workspace/");
    try {
      document.body.classList.toggle("route-locked", locked);
      document.body.classList.toggle("route-scroll", !locked);
    } catch {
      // ignore
    }
  }, [pathname]);
  return null;
}

// Route map mirrors the vanilla pages:
//   / or /dashboard  <- dashboard.html      /workspace/:id <- index.html (editor)
//   /problems         <- problems.html       /roadmap   <- roadmap.html
//   /leaderboard      <- leaderboard.html    /login /register /admin /settings
//   /add-question     <- add-question.html
export default function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workspace/:id?" element={<WorkspacePage />} />
          <Route path="/problems" element={<ProblemsPage />} />
          <Route path="/roadmap" element={<RoadmapPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/add-question" element={<AddQuestionPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
