import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar.jsx";
import { apiFetch, apiJson } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

const STEPS = [
  { slug: "basics", title: "Basics & Maths", blurb: "Language basics, time complexity, number drills.", seedIds: ["find-missing-number", "single-number"], genDifficulty: "Easy", planned: ["Count Digits", "Reverse a Number", "Palindrome Number", "GCD and LCM", "Armstrong Number", "Print All Divisors"] },
  { slug: "sorting", title: "Sorting", blurb: "Implement the sorts yourself before using built-ins.", seedIds: ["union-of-two-sorted-arrays"], genDifficulty: "Easy", planned: ["Selection Sort", "Bubble Sort", "Insertion Sort", "Merge Sort", "Quick Sort"] },
  { slug: "arrays", title: "Arrays", blurb: "The workhorse topic — traversal, two pointers, prefix sums.", seedIds: ["two-sum", "move-zeroes", "remove-duplicates-sorted-array", "maximum-subarray", "majority-element", "best-time-to-buy-and-sell-stock", "rearrange-array-by-sign", "count-subarrays-with-sum-k", "maximum-consecutive-ones", "move-negative-numbers", "rotate-array", "leaders-in-array", "longest-subarray-given-sum", "subarray-sum-equals-k", "product-of-array-except-self", "longest-consecutive-sequence", "maximum-product-subarray", "three-sum", "container-with-most-water", "intersection-of-two-arrays", "linear-search-unsorted-array"], genDifficulty: "Medium", planned: ["Second Largest Element", "Check if Array is Sorted", "Left Rotate by One", "Missing Number", "Merge Intervals", "Next Permutation"] },
  { slug: "hashing", title: "Hashing", blurb: "Trade space for time with maps and sets.", seedIds: ["two-sum", "majority-element", "count-subarrays-with-sum-k", "subarray-sum-equals-k", "longest-consecutive-sequence", "longest-subarray-given-sum", "intersection-of-two-arrays"], genDifficulty: "Easy", planned: ["Two Sum", "Group Anagrams", "Longest Consecutive Sequence", "Subarray Sum Equals K"] },
  { slug: "binary-search", title: "Binary Search", blurb: "Sorted data means logarithmic answers.", seedIds: ["find-target-index-in-sorted-array"], genDifficulty: "Easy", planned: ["Binary Search", "First and Last Occurrence", "Search in Rotated Array", "Find Minimum in Rotated Array", "Single Element in Sorted Array"] },
  { slug: "strings-basic", title: "Strings (Basic)", blurb: "The everyday string toolkit.", seedIds: ["reverse-string", "valid-parentheses"], genDifficulty: "Easy", planned: ["Reverse String", "Valid Anagram", "Longest Common Prefix", "Reverse Words", "Valid Parentheses"] },
  { slug: "recursion", title: "Recursion", blurb: "Think in base case + smaller problem.", seedIds: [], genDifficulty: "Easy", planned: ["Pow(x,n)", "Subsets", "Combination Sum", "Generate Parentheses", "Permutations"] },
  { slug: "linked-list", title: "Linked List", blurb: "Pointer juggling, simulated with arrays here.", seedIds: [], genDifficulty: "Easy", planned: ["Reverse Linked List", "Middle of Linked List", "Detect Cycle", "Merge Two Sorted Lists"] },
  { slug: "bit-manipulation", title: "Bit Manipulation", blurb: "XOR tricks and bit surgery.", seedIds: ["single-number", "find-missing-number"], genDifficulty: "Easy", planned: ["Single Number", "Count Set Bits", "Power of Two", "Single Number II"] },
  { slug: "greedy", title: "Greedy", blurb: "Locally optimal choices that stay globally optimal.", seedIds: ["best-time-to-buy-and-sell-stock", "container-with-most-water"], genDifficulty: "Easy", planned: ["Assign Cookies", "Jump Game", "Gas Station", "Best Time to Buy Stock"] },
  { slug: "sliding-window", title: "Sliding Window / Two Pointers", blurb: "Linear scans over contiguous ranges.", seedIds: ["container-with-most-water"], genDifficulty: "Medium", planned: ["Longest Substring Without Repeat", "Longest Repeating Char Replacement", "Minimum Window Substring", "Max Consecutive Ones III"] },
  { slug: "stack-queue", title: "Stack / Queue", blurb: "LIFO and FIFO problem patterns.", seedIds: ["valid-parentheses"], genDifficulty: "Easy", planned: ["Valid Parentheses", "Min Stack", "Next Greater Element", "Daily Temperatures", "Implement Queue using Stacks"] },
  { slug: "binary-trees", title: "Binary Trees", blurb: "Traversals and tree recursion, array-represented.", seedIds: [], genDifficulty: "Medium", planned: ["Max Depth", "Inorder Traversal", "Level Order Traversal", "Same Tree", "Diameter of Binary Tree"] },
  { slug: "bst", title: "Binary Search Trees", blurb: "Ordered trees, ordered answers.", seedIds: [], genDifficulty: "Medium", planned: ["Search in BST", "Validate BST", "Kth Smallest Element", "Lowest Common Ancestor"] },
  { slug: "heaps", title: "Heaps", blurb: "Top-K and streaming order statistics.", seedIds: [], genDifficulty: "Medium", planned: ["Kth Largest Element", "Top K Frequent Elements", "Last Stone Weight"] },
  { slug: "graphs", title: "Graphs", blurb: "BFS/DFS over adjacency lists.", seedIds: [], genDifficulty: "Medium", planned: ["Number of Islands", "Course Schedule", "Number of Provinces", "Rotting Oranges"] },
  { slug: "dp", title: "Dynamic Programming", blurb: "Overlapping subproblems, memoized or tabulated.", seedIds: ["maximum-subarray", "maximum-product-subarray"], genDifficulty: "Medium", planned: ["Climbing Stairs", "House Robber", "Longest Increasing Subsequence", "Coin Change", "Maximum Subarray"] },
  { slug: "trie", title: "Trie", blurb: "Prefix trees for string sets.", seedIds: [], genDifficulty: "Medium", planned: ["Implement Trie", "Longest Common Prefix", "Design Add and Search Words"] },
  { slug: "strings-advanced", title: "Strings (Advanced)", blurb: "Pattern matching algorithms.", seedIds: [], genDifficulty: "Medium", planned: ["Implement strStr", "Repeated Substring Pattern", "Longest Palindromic Substring"] },
  { slug: "maths", title: "Maths", blurb: "Number theory for interviews.", seedIds: ["find-missing-number"], genDifficulty: "Easy", planned: ["Count Primes", "Pow(x,n)", "Excel Column Number", "Palindrome Number"] },
];

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameMatches(q, name) {
  const n = norm(name);
  const t = norm(q.title);
  if (!n || !t) return false;
  return n === t || (n.length >= 6 && (t.includes(n) || n.includes(t)));
}

// Mirrors roadmap.html: 20 Striver A2Z steps, matched vs missing questions,
// per-step AI generation.
export default function RoadmapPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [statsMap, setStatsMap] = useState({});
  const [solvedSet, setSolvedSet] = useState(new Set());
  const [attemptedSet, setAttemptedSet] = useState(new Set());
  const [aiReady, setAiReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [qsRes, modelsRes, stRes] = await Promise.all([
          apiFetch("/api/questions"),
          apiFetch("/api/generate/models").catch(() => null),
          apiFetch("/api/questions/stats").catch(() => null),
        ]);
        if (!qsRes.ok) throw new Error("questions failed");
        const qs = await qsRes.json();
        let models = null;
        if (modelsRes && modelsRes.ok) {
          try {
            models = await modelsRes.json();
          } catch {
            models = null;
          }
        }
        let st = [];
        if (stRes && stRes.ok) {
          try {
            st = await stRes.json();
          } catch {
            st = [];
          }
        }
        const solved = new Set();
        const attempted = new Set();
        try {
          const r1 = await apiFetch("/api/questions/solved");
          if (r1.ok) (await r1.json()).forEach((id) => solved.add(id));
          const r2 = await apiFetch("/api/manual-solved");
          if (r2.ok) (await r2.json()).forEach((id) => solved.add(id));
          const r3 = await apiFetch("/api/submissions?limit=100");
          if (r3.ok) {
            (await r3.json()).forEach((s) => {
              if (!solved.has(s.questionId)) attempted.add(s.questionId);
            });
          }
        } catch {
          // anonymous
        }
        if (cancelled) return;
        setQuestions(qs);
        const sm = {};
        (st || []).forEach((s) => {
          sm[s.questionId] = { attempted: s.attempted || 0, submissions: s.submissions || 0, solved: s.solved || 0 };
        });
        setStatsMap(sm);
        setSolvedSet(solved);
        setAttemptedSet(attempted);
        setAiReady(!!(models && models.keyConfigured));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const perStep = useMemo(
    () =>
      STEPS.map((step) => {
        const tag = "roadmap:" + step.slug;
        const seen = new Set();
        const matched = questions.filter((q) => {
          if (seen.has(q.id)) return false;
          const hit =
            (q.tags || []).includes(tag) ||
            step.seedIds.includes(q.id) ||
            (step.planned || []).some((n) => nameMatches(q, n));
          if (hit) seen.add(q.id);
          return hit;
        });
        const missing = (step.planned || []).filter((n) => !matched.some((q) => nameMatches(q, n)));
        return { step, matched, missing };
      }),
    [questions]
  );

  const allIds = useMemo(() => {
    const s = new Set();
    perStep.forEach(({ matched }) => matched.forEach((q) => s.add(q.id)));
    return s;
  }, [perStep]);
  const solvedCount = [...allIds].filter((id) => solvedSet.has(id)).length;

  async function generateOne(topic, difficulty, tag, key) {
    if (!user) {
      setNotice("Login first to generate questions.");
      navigate("/login");
      return;
    }
    setGenerating(key);
    try {
      const d = await apiJson("/api/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, difficulty, tags: [tag] }),
      });
      setNotice(`Added: ${d.title}${d.attempts > 1 ? ` (took ${d.attempts} tries)` : ""}`);
      const qs = await (await apiFetch("/api/questions")).json();
      setQuestions(qs);
    } catch (e) {
      setNotice("Generate failed: " + e.message);
    } finally {
      setGenerating("");
    }
  }

  function toggleCollapse(slug) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function qRow(q) {
    const mark = solvedSet.has(q.id) ? (
      <span style={{ color: "#00b8a3", fontWeight: 700 }} title="Solved">✓</span>
    ) : attemptedSet.has(q.id) ? (
      <span style={{ color: "#ffa116", fontWeight: 700 }} title="Attempted">●</span>
    ) : (
      <span style={{ color: "var(--muted)" }} title="Todo">·</span>
    );
    const ai = (q.tags || []).includes("AI") ? (
      <span style={{ fontSize: 10, color: "var(--muted)" }} title="AI generated">AI</span>
    ) : null;
    const topics = (q.tags || []).filter((t) => t !== "AI" && !t.startsWith("roadmap:"));
    const s = statsMap[q.id] || { attempted: 0, submissions: 0, solved: 0 };
    const rate = s.attempted ? Math.round((s.solved / s.attempted) * 100) + "%" : "–";
    return (
      <div
        key={q.id}
        style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 13, flexWrap: "wrap" }}
      >
        {mark}
        <Link to={`/workspace#${q.id}`} style={{ fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>
          {q.title}
        </Link>
        {ai}
        <span className={`badge ${q.difficulty}`} style={{ fontSize: 11 }}>{q.difficulty}</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{topics.join(" · ") || "general"}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }} title={`${s.submissions} total tries`}>
          {s.attempted} attempted · {s.solved} solved · {rate}
        </span>
      </div>
    );
  }

  return (
    <div>
      <Topbar />
      <div className="lb-wrap" style={{ maxWidth: 1100 }}>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>Striver A2Z Roadmap</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>
          20 steps, basics to advanced — your questions slotted in, gaps fillable with AI.
        </p>
        <div id="overall" style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
          {loading ? (
            "Loading..."
          ) : (
            <>
              <strong>{solvedCount} / {allIds.size}</strong> roadmap questions solved
              {!user && (
                <>
                  {" — "}<Link to="/login" className="ghost-link">login</Link> to track progress
                </>
              )}
            </>
          )}
        </div>
        {!aiReady && !loading && (
          <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "var(--muted)" }}>
            AI generation is not configured on this server (GROQ_API_KEY missing) — Generate buttons are disabled.
          </div>
        )}
        {notice ? (
          <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>{notice}</div>
        ) : null}
        {loading ? (
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>Loading...</div>
        ) : error ? (
          <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>Error: {error}</div>
        ) : (
          <div id="steps">
            {perStep.map(({ step: s, matched: qs, missing }, i) => {
              const done = qs.filter((q) => solvedSet.has(q.id)).length;
              const pct = qs.length ? Math.round((done / qs.length) * 100) : 0;
              const isCollapsed = collapsed.has(s.slug);
              return (
                <div key={s.slug} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", cursor: "pointer" }}
                    onClick={() => toggleCollapse(s.slug)}
                  >
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>Step {i + 1}</span>
                    <strong style={{ fontSize: 15 }}>{s.title}</strong>
                    <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>
                      {done}/{qs.length} solved · {missing.length} missing {isCollapsed ? "▸" : "▾"}
                    </span>
                  </div>
                  {!isCollapsed && (
                    <>
                      <div style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 8px" }}>{s.blurb}</div>
                      <div className="diff-bar" style={{ marginBottom: 10 }}>
                        <span style={{ width: `${pct}%` }}></span>
                      </div>
                      <div>{qs.length ? qs.map(qRow) : <span style={{ color: "var(--muted)", fontSize: 12 }}>Nothing here yet.</span>}</div>
                      <div style={{ marginTop: 8 }}>
                        {missing.length ? (
                          missing.map((n) => {
                            const key = `${s.slug}:${n}`;
                            return (
                              <div
                                key={key}
                                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px dashed var(--border)", fontSize: 13, flexWrap: "wrap" }}
                              >
                                <span style={{ color: "var(--muted)" }}>○ {n}</span>
                                <span className={`badge ${s.genDifficulty}`} style={{ fontSize: 11 }}>{s.genDifficulty}</span>
                                <span style={{ fontSize: 11, color: "var(--muted)" }}>planned · {s.title} · missing</span>
                                <button
                                  className="btn ghost gen-one"
                                  style={{ padding: "4px 10px", fontSize: 12, marginLeft: "auto" }}
                                  disabled={!aiReady || generating === key}
                                  title={aiReady ? "" : "AI not configured"}
                                  onClick={() => generateOne(n, s.genDifficulty, `roadmap:${s.slug}`, key)}
                                >
                                  {generating === key ? "Generating… (up to ~2 min)" : "✨ Generate"}
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <div style={{ fontSize: 12, color: "#00b8a3", padding: "6px 0" }}>All planned questions present ✓</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
