import { useState } from "react";
import { CaseDetail, CasePills, ComplexityLine } from "./Console.jsx";

function runtimeAvg(results) {
  if (!results || !results.length) return 0;
  return Math.round(results.reduce((a, r) => a + (r.timeMs || 0), 0) / results.length);
}

function maxMemKb(results) {
  const ms = (results || []).map((r) => r.memKb).filter((m) => m != null);
  return ms.length ? Math.max(...ms) : null;
}

function fmtMemShort(kb) {
  if (kb == null) return "n/a";
  return kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
}

function verdictOf(payload) {
  const { results, total, passed } = payload;
  if (results && results.length && results.every((r) => r.error)) {
    const msg = results[0].error || "";
    return { label: /compile/i.test(msg) ? "Compile Error" : "Runtime Error", cls: "verdict-error", allPass: false, allError: true };
  }
  if (total === 0 && results && results.length) {
    return { label: "Custom Output", cls: "verdict-custom", allPass: false, allError: false };
  }
  if (passed === total) return { label: "Accepted", cls: "verdict-accepted", allPass: true, allError: false };
  return { label: "Wrong Answer", cls: "verdict-wrong", allPass: false, allError: false };
}

// Left-panel verdict view shared by live submits (code from editor,
// complexity filled later) and stored submissions (static complexity).
// Mirrors resultViewInner()/showSubmitResult()/showSubmissionInResult().
export default function ResultTab({ payload, code, langLabel, lang, sub, complexity, expectedTime, expectedSpace }) {
  const results = payload?.results || [];
  const failedIdx = results.findIndex((r) => r.passed === false);
  const [sel, setSel] = useState(failedIdx >= 0 ? failedIdx : 0);
  if (!payload || !payload.results) {
    return (
      <div className="empty-state">
        <h2>No submission yet</h2>
        <p>
          Hit <strong>Submit</strong> to see your verdict here, LeetCode-style.
        </p>
      </div>
    );
  }
  const { total, passed } = payload;
  const v = verdictOf(payload);
  const failed = results.filter((r) => r.passed === false).length;
  const shown = Math.min(sel, results.length - 1);
  return (
    <>
      <div className="lc-verdict-row">
        <span className={v.cls}>{v.label}</span>
      </div>
      <div className="lc-count">
        {passed} / {total} testcases passed{failed ? ` · ${failed} failed` : ""}
      </div>
      <div className="lc-sub">{sub}</div>
      {v.allPass ? (
        <div className="lc-cards">
          <div className="lc-card lc-stat">
            <div className="lc-card-label">⏱ Runtime</div>
            <div className="lc-card-val">{runtimeAvg(results)} ms</div>
          </div>
          <div className="lc-card lc-stat">
            <div className="lc-card-label">🧠 Memory</div>
            <div className="lc-card-val">{fmtMemShort(maxMemKb(results))}</div>
          </div>
        </div>
      ) : null}
      {v.allError ? (
        <>
          <div className="lc-label">Error</div>
          <div className="lc-card lc-error-card">
            <pre>{results[0].error || "Unknown error"}</pre>
          </div>
        </>
      ) : (
        <>
          <div className="lc-complexity">
            {complexity ? (
              <ComplexityLine est={complexity} expectedTime={expectedTime} expectedSpace={expectedSpace} />
            ) : null}
          </div>
          <CasePills results={results} sel={shown} onSelect={setSel} />
          <CaseDetail r={results[shown]} />
        </>
      )}
      <div className="lc-code-head">
        Code <span style={{ color: "var(--muted)" }}>|</span> {langLabel || lang}
      </div>
      <pre className="lc-code">{(code || "").slice(0, 8000)}</pre>
    </>
  );
}
