import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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

// Route map mirrors the vanilla pages:
//   / or /dashboard  <- dashboard.html      /workspace <- index.html (editor)
//   /problems         <- problems.html       /roadmap   <- roadmap.html
//   /leaderboard      <- leaderboard.html    /login /register /admin /settings
//   /add-question     <- add-question.html
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
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
