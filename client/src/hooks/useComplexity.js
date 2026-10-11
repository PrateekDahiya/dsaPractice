import { useCallback, useState } from "react";
import { apiFetch } from "../api/client.js";

// Mirrors requestComplexity() from public/js/performance.js: AI Big-O
// estimate for submitted code, plus the last estimate for the perf tab.
export function useComplexity() {
  const [lastComplexity, setLastComplexity] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const request = useCallback(async (question, code, lang) => {
    setLastComplexity(null);
    setError("");
    if (!question) return null;
    setLoading(true);
    try {
      const res = await apiFetch("/api/complexity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, language: lang, code }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "status " + res.status);
      const est = { time: d.time.trim(), space: d.space.trim(), note: String(d.note || "").slice(0, 300) };
      setLastComplexity(est);
      window.__lastComplexity = est;
      const sid = window.__lastSubmissionId;
      if (sid) {
        try {
          await apiFetch(`/api/submissions/${sid}/complexity`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ time: est.time, space: est.space }),
          });
        } catch {
          // non-fatal
        }
      }
      return { ...est, expectedTime: d.expectedTime || null, expectedSpace: d.expectedSpace || null };
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { lastComplexity, loading, error, request };
}
