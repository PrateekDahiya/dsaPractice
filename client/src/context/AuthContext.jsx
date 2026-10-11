import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, clearAuth as clearStoredAuth, getToken, getUser, setAuth } from "../api/client.js";

const AuthContext = createContext(null);

// Mirrors checkAuth()/updateTopbar() from public/js/core.js:
// revalidates the stored token against /api/me on mount.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getUser());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = getToken();
      if (!t) {
        setUser(null);
        setReady(true);
        return;
      }
      try {
        const res = await apiFetch("/api/me");
        if (res.ok) {
          const u = await res.json();
          setAuth(t, u);
          if (!cancelled) setUser(u);
        } else {
          clearStoredAuth();
          if (!cancelled) setUser(null);
        }
      } catch {
        if (!cancelled) setUser(getUser());
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((token, nextUser) => {
    setAuth(token, nextUser);
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const t = getToken();
    if (!t) {
      setUser(null);
      return null;
    }
    const res = await apiFetch("/api/me");
    if (!res.ok) {
      clearStoredAuth();
      setUser(null);
      return null;
    }
    const u = await res.json();
    setAuth(t, u);
    setUser(u);
    return u;
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, refresh, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
