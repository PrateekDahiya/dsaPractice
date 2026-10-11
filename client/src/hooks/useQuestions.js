import { useCallback, useState } from "react";
import { apiFetch, apiJson, getToken } from "../api/client.js";

// Mirrors public/js/questions.js: question list + detail + solved/manual/
// bookmark sets + mark/bookmark/delete actions. Caller re-renders on state
// change (replaces renderList()/renderProblem()).
export function useQuestions() {
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [currentLang, setCurrentLang] = useState("cpp");
  const [solvedSet, setSolvedSet] = useState(() => new Set());
  const [attemptedSet, setAttemptedSet] = useState(() => new Set());
  const [manualSet, setManualSet] = useState(() => new Set());
  const [bookmarkedSet, setBookmarkedSet] = useState(() => new Set());

  const refreshSolvedState = useCallback(async () => {
    const solved = new Set();
    const attempted = new Set();
    const manual = new Set();
    const bookmarked = new Set();
    if (!getToken()) {
      setSolvedSet(solved);
      setAttemptedSet(attempted);
      setManualSet(manual);
      setBookmarkedSet(bookmarked);
      return;
    }
    try {
      const r1 = await apiFetch("/api/questions/solved");
      if (r1.ok) (await r1.json()).forEach((id) => solved.add(id));
      try {
        const rm = await apiFetch("/api/manual-solved");
        if (rm.ok) {
          (await rm.json()).forEach((id) => {
            manual.add(id);
            solved.add(id);
          });
        }
      } catch {
        // anonymous or unavailable
      }
      try {
        const rb = await apiFetch("/api/bookmarks");
        if (rb.ok) (await rb.json()).forEach((id) => bookmarked.add(id));
      } catch {
        // anonymous or unavailable
      }
      const r2 = await apiFetch("/api/submissions?limit=100");
      if (r2.ok) {
        (await r2.json()).forEach((s) => {
          if (!solved.has(s.questionId)) attempted.add(s.questionId);
        });
      }
    } catch {
      // keep empty sets
    }
    setSolvedSet(solved);
    setAttemptedSet(attempted);
    setManualSet(manual);
    setBookmarkedSet(bookmarked);
  }, []);

  const fetchQuestions = useCallback(async () => {
    const qs = await apiJson("/api/questions");
    setQuestions(qs);
    return qs;
  }, []);

  const loadQuestion = useCallback(async (id) => {
    let q;
    const res = await apiFetch(`/api/questions/${id}`);
    if (res.ok) q = await res.json();
    else {
      const r2 = await fetch(`questions/${id}.json`);
      q = await r2.json();
    }
    setCurrentQuestion(q);
    return q;
  }, []);

  const toggleMarkDone = useCallback(async () => {
    if (!currentQuestion) throw new Error("Select a problem first");
    if (!getToken()) throw new Error("Login to mark as done");
    const qid = currentQuestion.id;
    const isMarked = manualSet.has(qid);
    const res = await apiFetch(`/api/questions/${encodeURIComponent(qid)}/mark-done`, {
      method: isMarked ? "DELETE" : "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "failed");
    }
    await refreshSolvedState();
    return !isMarked;
  }, [currentQuestion, manualSet, refreshSolvedState]);

  const toggleBookmark = useCallback(async () => {
    if (!currentQuestion) throw new Error("Select a problem first");
    if (!getToken()) throw new Error("Login to bookmark");
    const qid = currentQuestion.id;
    const on = bookmarkedSet.has(qid);
    const res = await apiFetch(`/api/bookmarks/${encodeURIComponent(qid)}`, {
      method: on ? "DELETE" : "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "failed");
    }
    setBookmarkedSet((prev) => {
      const next = new Set(prev);
      if (on) next.delete(qid);
      else next.add(qid);
      return next;
    });
    return !on;
  }, [currentQuestion, bookmarkedSet]);

  const deleteCurrentQuestion = useCallback(async () => {
    if (!currentQuestion) throw new Error("Select a problem first");
    const qid = currentQuestion.id;
    const res = await apiFetch(`/api/questions/${encodeURIComponent(qid)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "delete failed");
    }
    setCurrentQuestion(null);
    const qs = await fetchQuestions();
    return qs;
  }, [currentQuestion, fetchQuestions]);

  return {
    questions,
    currentQuestion,
    setCurrentQuestion,
    currentLang,
    setCurrentLang,
    solvedSet,
    attemptedSet,
    manualSet,
    bookmarkedSet,
    fetchQuestions,
    loadQuestion,
    refreshSolvedState,
    toggleMarkDone,
    toggleBookmark,
    deleteCurrentQuestion,
  };
}
