import { useCallback, useState } from "react";
import { apiFetch } from "../api/client.js";

// Mirrors public/js/history.js: DB-backed submission history with local
// fallback, save entries, and the currently-viewed submission.
const HISTORY_KEY = "dsa_history_v1";
const HISTORY_LIMIT = 100;

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function useHistory(questionId) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewingSubmission, setViewingSubmission] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const q = questionId ? `?questionId=${encodeURIComponent(questionId)}&limit=50` : `?limit=50`;
      const res = await apiFetch(`/api/submissions${q}`);
      if (!res.ok) throw new Error();
      const rows = await res.json();
      setHistory(rows.map((r) => ({ ...r, ts: r.ts || new Date(r.createdAt).getTime() })));
    } catch {
      setHistory(readLocal());
    } finally {
      setLoading(false);
    }
  }, [questionId]);

  const saveEntry = useCallback(
    async (entry) => {
      try {
        const h = readLocal();
        h.unshift(entry);
        if (h.length > HISTORY_LIMIT) h.length = HISTORY_LIMIT;
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
      } catch {
        // storage may be unavailable; DB save below still runs
      }
      try {
        const res = await apiFetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: entry.questionId,
            title: entry.title,
            language: entry.language,
            mode: entry.mode,
            code: entry.code,
            passed: entry.passed,
            total: entry.total,
            results: entry.results,
            complexityTime: entry.complexityTime || null,
            complexitySpace: entry.complexitySpace || null,
          }),
        });
        if (res) {
          const d = await res.json().catch(() => ({}));
          if (d && d.id && entry.mode === "submit") window.__lastSubmissionId = d.id;
        }
      } catch {
        // not logged in — history stays local only
      }
      await refresh();
    },
    [refresh]
  );

  const clearLocal = useCallback(async () => {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // ignore
    }
    await refresh();
  }, [refresh]);

  return { history, loading, refresh, saveEntry, clearLocal, viewingSubmission, setViewingSubmission };
}
