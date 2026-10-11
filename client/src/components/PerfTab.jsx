import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

function fmtMemShort(kb) {
  if (kb == null) return "n/a";
  return kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
}

// Mirrors renderPerformance() from public/js/performance.js: this-run card,
// community aggregates, personal aggregates.
export default function PerfTab({ question, run, complexity }) {
  const { user } = useAuth();
  const [perf, setPerf] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!question) return;
    let cancelled = false;
    setPerf(null);
    setFailed(false);
    (async () => {
      try {
        const r = await apiFetch(`/api/questions/${encodeURIComponent(question.id)}/perf`);
        if (!r.ok) throw new Error();
        const p = await r.json();
        if (!cancelled) setPerf(p);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [question?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!question) {
    return (
      <div className="empty-state">
        <h2>Performance</h2>
        <p>Select a problem first.</p>
      </div>
    );
  }
  const q = question;
  const times = (run?.results || []).map((r) => r.timeMs || 0);
  const mx = Math.max(1, ...times);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const mems = (run?.results || []).map((r) => r.memKb).filter((m) => m != null);
  const mem = mems.length ? Math.max(...mems) : null;
  const exp = q.timeComplexity || q.spaceComplexity ? ` · expected ${q.timeComplexity || "?"} / ${q.spaceComplexity || "?"}` : "";

  return (
    <>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Performance — {q.title}</h2>
      <div style={{ marginBottom: 12 }}>
        <span className={`badge ${q.difficulty}`}>{q.difficulty}</span>{" "}
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{(q.tags || []).join(" · ")}</span>
      </div>
      {!run ? (
        <div className="lc-card">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            No run yet for <strong style={{ color: "var(--text)" }}>{q.title}</strong> — hit <strong>Run</strong> or{" "}
            <strong>Submit</strong> and your timing, memory and complexity will appear here.
          </div>
        </div>
      ) : (
        <>
          <div className="perf-sec-title">This {run.mode}</div>
          <div className="lc-card">
            <div className="lc-verdict-row">
              <span className={run.passed === run.total ? "verdict-accepted perf-verdict" : "verdict-wrong perf-verdict"}>
                {run.passed === run.total ? "Accepted" : "Wrong Answer"}
              </span>
              <span className="lc-count">{run.passed}/{run.total} passed</span>
            </div>
            <div className="perf-grid">
              <div className="perf-tile"><div className="lc-card-label">⏱ Avg runtime</div><div className="lc-card-val">{avg} ms</div></div>
              <div className="perf-tile"><div className="lc-card-label">Max case</div><div className="lc-card-val">{Math.max(0, ...times)} ms</div></div>
              <div className="perf-tile"><div className="lc-card-label">🧠 Max memory</div><div className="lc-card-val">{fmtMemShort(mem)}</div></div>
            </div>
            {run.results.map((r, i) => {
              const pct = Math.round(((r.timeMs || 0) / mx) * 100);
              return (
                <div className="perf-bar-row" key={r.testCaseId + i}>
                  <span className="perf-bar-label">Case {i + 1}{r.hidden ? " · hidden" : ""}</span>
                  <div className="diff-bar"><span className={r.passed ? "easy" : "hard"} style={{ width: `${pct}%` }}></span></div>
                  <span className="perf-bar-val">{r.timeMs ?? 0}ms{r.memKb != null ? ` · ${fmtMemShort(r.memKb)}` : ""}</span>
                </div>
              );
            })}
            <div className="perf-cx">
              {run.mode === "submit"
                ? complexity
                  ? <>Complexity (AI): yours <strong>{complexity.time} / {complexity.space}</strong></>
                  : "Complexity: estimating… (submit triggers analysis)"
                : "Complexity: estimated on Submit"}
              {exp}
            </div>
          </div>
        </>
      )}
      {!perf && !failed ? (
        <div id="perf-problem"><div className="loading">Loading problem stats…</div></div>
      ) : null}
      {failed ? (
        <div className="lc-card"><div style={{ fontSize: 13, color: "var(--muted)" }}>Problem stats unavailable.</div></div>
      ) : null}
      {perf ? <PerfProblem overall={perf.overall} mine={perf.mine} user={user} /> : null}
    </>
  );
}

function PerfProblem({ overall: o, mine: m, user }) {
  const memLine = o.maxMemKb != null ? ` · 🧠 max ${fmtMemShort(o.maxMemKb)}` : "";
  return (
    <>
      <div className="perf-sec-title">Everyone</div>
      <div className="lc-card">
        <div className="perf-grid">
          <div className="perf-tile"><div className="lc-card-label">Submissions</div><div className="lc-card-val">{o.submissions}</div></div>
          <div className="perf-tile"><div className="lc-card-label">Attempted</div><div className="lc-card-val">{o.attempted}</div></div>
          <div className="perf-tile"><div className="lc-card-label">Solved</div><div className="lc-card-val">{o.solved}</div></div>
          <div className="perf-tile"><div className="lc-card-label">Solve rate</div><div className="lc-card-val">{o.solveRate == null ? "–" : o.solveRate + "%"}</div></div>
        </div>
        {o.solveRate == null ? null : (
          <div className="diff-bar perf-rate"><span style={{ width: `${o.solveRate}%` }}></span></div>
        )}
        <div className="perf-note">⏱ community avg {o.avgTimeMs == null ? "–" : o.avgTimeMs + "ms"}{memLine}</div>
      </div>
      <div className="perf-sec-title">You</div>
      {!user ? (
        <div className="lc-card">
          <div style={{ fontSize: 13 }}><a href="/login" className="ghost-link">Login</a> <span style={{ color: "var(--muted)" }}>to see your personal stats.</span></div>
        </div>
      ) : !m || !m.submissions ? (
        <div className="lc-card"><div style={{ fontSize: 13, color: "var(--muted)" }}>No submissions yet — your history will appear here.</div></div>
      ) : (
        <div className="lc-card">
          <div className="perf-grid">
            <div className="perf-tile"><div className="lc-card-label">Submissions</div><div className="lc-card-val">{m.submissions}</div></div>
            <div className="perf-tile"><div className="lc-card-label">Solved</div><div className="lc-card-val">{m.solves}</div></div>
            <div className="perf-tile"><div className="lc-card-label">Solve rate</div><div className="lc-card-val">{m.submissions ? Math.round((m.solves / m.submissions) * 100) : 0}%</div></div>
            <div className="perf-tile"><div className="lc-card-label">Best avg</div><div className="lc-card-val">{m.bestAvgMs != null ? m.bestAvgMs + "ms" : "–"}</div></div>
          </div>
          {m.bestAvgMs != null && o.avgTimeMs != null ? (
            <div className="perf-note perf-vs">
              You best avg ~{m.bestAvgMs}ms vs community avg ~{o.avgTimeMs}ms {m.bestAvgMs <= o.avgTimeMs ? "· faster ✓" : "· slower"}
            </div>
          ) : null}
          <div style={{ marginTop: 8 }}>
            {m.recent.map((s) => {
              const ok = s.passed === s.total;
              return (
                <div className="perf-row" key={s.id}>
                  <span className={`perf-dot ${ok ? "ok" : "bad"}`}>{ok ? "✓" : "●"}</span>
                  <span>{s.createdAt ? new Date(s.createdAt).toLocaleString() : "—"}</span>
                  <span className="perf-row-meta">
                    {s.mode} · {s.language} · {s.passed}/{s.total}
                    {s.avgTimeMs != null ? ` · ~${s.avgTimeMs}ms` : ""}
                    {s.complexityTime || s.complexitySpace ? ` · ${s.complexityTime || "?"}/${s.complexitySpace || "?"}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
