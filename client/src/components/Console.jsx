import { useEffect, useState } from "react";

// LeetCode-style run console: verdict + runtime header, case pills,
// single-case Input/Output/Expected cards. Mirrors renderResults() from
// public/js/results.js (incl. fmtJson compact-unless-long rule).
function fmtJson(v) {
  try {
    const compact = JSON.stringify(v);
    if (compact === undefined) return "undefined";
    if (compact.length <= 160) return compact;
    return JSON.stringify(v, null, 2);
  } catch {
    try {
      return String(v);
    } catch {
      return "?";
    }
  }
}

function verdictOf(payload) {
  const { results, total, passed } = payload;
  if (results && results.length && results.every((r) => r.error)) {
    const msg = results[0].error || "";
    return {
      label: /compile/i.test(msg) ? "Compile Error" : "Runtime Error",
      cls: "verdict-error",
      allPass: false,
      allError: true,
    };
  }
  if (total === 0 && results && results.length) {
    return { label: "Custom Output", cls: "verdict-custom", allPass: false, allError: false };
  }
  if (passed === total) return { label: "Accepted", cls: "verdict-accepted", allPass: true, allError: false };
  return { label: "Wrong Answer", cls: "verdict-wrong", allPass: false, allError: false };
}

function lcInputHtml(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const keys = Object.keys(input);
    if (keys.length)
      return keys.map((k) => (
        <div className="lc-param" key={k}>
          <span className="lc-param-name">{k} =</span>
          <pre className="lc-param-val">{fmtJson(input[k])}</pre>
        </div>
      ));
  }
  return <pre className="lc-param-val">{fmtJson(input)}</pre>;
}

export function CaseDetail({ r }) {
  if (!r) return null;
  if (r.error && r.actual == null) {
    return (
      <>
        <div className="lc-label">Error</div>
        <div className="lc-card lc-error-card">
          <pre>{r.error}</pre>
        </div>
      </>
    );
  }
  if (r.testCaseId === "custom") {
    return (
      <>
        <div className="lc-label">
          Input <span style={{ color: "var(--muted)", fontWeight: 400 }}>(custom — output only, not scored)</span>
        </div>
        <div className="lc-card">{lcInputHtml(r.input)}</div>
        <div className="lc-label">Output</div>
        <div className="lc-card">
          <pre>{r.error ? r.error : fmtJson(r.actual)}</pre>
        </div>
      </>
    );
  }
  const failed = !r.passed;
  return (
    <>
      <div className="lc-label">Input</div>
      <div className="lc-card">{lcInputHtml(r.input)}</div>
      <div className="lc-label">Output</div>
      <div className="lc-card">
        <pre className={failed ? "lc-out-fail" : ""}>{r.error ? r.error : fmtJson(r.actual)}</pre>
      </div>
      <div className="lc-label">Expected</div>
      <div className="lc-card">
        <pre className={failed ? "lc-exp-fail" : ""}>{fmtJson(r.expected)}</pre>
      </div>
    </>
  );
}

export function CasePills({ results, sel, onSelect }) {
  return (
    <div className="case-pills">
      {(results || []).map((r, i) => {
        const isCustom = r.testCaseId === "custom";
        const state = r.passed === true ? "pass" : r.passed === false ? "fail" : "custom";
        const icon = r.passed === true ? "✓" : r.passed === false ? "✕" : "•";
        return (
          <button
            key={r.testCaseId + i}
            className={`case-pill ${state}${i === sel ? " active" : ""}`}
            data-idx={i}
            title={isCustom ? "Custom input — output only" : `Case ${i + 1}${r.hidden ? " (hidden)" : ""} — ${r.passed ? "Passed" : "Failed"}`}
            onClick={() => onSelect(i)}
          >
            <span className="pill-icon">{icon}</span> {isCustom ? "Custom" : `Case ${i + 1}`}
          </button>
        );
      })}
    </div>
  );
}

function runtimeAvg(results) {
  if (!results || !results.length) return 0;
  return Math.round(results.reduce((a, r) => a + (r.timeMs || 0), 0) / results.length);
}

export function ComplexityLine({ est, expectedTime, expectedSpace }) {
  if (!est) return null;
  const norm = (s) => String(s || "").replace(/\s+/g, "");
  const tOk = !expectedTime || norm(est.time) === norm(expectedTime);
  const sOk = !expectedSpace || norm(est.space) === norm(expectedSpace);
  const exp = expectedTime || expectedSpace ? ` · expected ${expectedTime || "?"} / ${expectedSpace || "?"}` : "";
  const mark = expectedTime || expectedSpace ? (tOk && sOk ? " ✓" : " ⚠") : "";
  return (
    <>
      Complexity (AI): yours <strong>{est.time} time · {est.space} space</strong>
      {exp}
      {mark}
      {est.note ? (
        <>
          {" "}— <span style={{ color: "var(--muted)" }}>{est.note}</span>
        </>
      ) : null}
    </>
  );
}

// Live + final console. `live` streams cases as they resolve; `payload` is
// the final result (takes over rendering when present).
export default function Console({ payload, live, complexity, expectedTime, expectedSpace, statusText, lastRunMeta }) {
  const [sel, setSel] = useState(0);
  const shown = payload || live;
  useEffect(() => {
    setSel(0);
  }, [payload, live?.results?.length]);

  if (!shown || !(shown.results || []).length) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        Hit <strong>Run</strong> to test visible cases, <strong>Submit</strong> for all.
      </div>
    );
  }
  const { mode, results, total, passed } = shown;
  const v = verdictOf(shown);
  const avg = runtimeAvg(results);
  const current = results[Math.min(sel, results.length - 1)];
  return (
    <>
      <div className="console-head">
        <span className={v.cls}>{v.label}</span>
        <span className="run-meta">
          Runtime: {current ? `${current.timeMs ?? 0} ms` : `${avg} ms`}
        </span>
        <span className={`results-summary ${passed === total ? "pass" : "fail"}`} style={{ marginLeft: "auto" }}>
          {passed} / {total}
        </span>
      </div>
      {mode === "submit" ? (
        <div className="run-stats" style={{ fontSize: 12, color: "var(--muted)", margin: "-4px 0 10px" }}>
          {complexity ? (
            <ComplexityLine est={complexity} expectedTime={expectedTime} expectedSpace={expectedSpace} />
          ) : (
            "Analyzing complexity…"
          )}
        </div>
      ) : null}
      <CasePills results={results} sel={Math.min(sel, results.length - 1)} onSelect={setSel} />
      <CaseDetail r={current} />
      {statusText ? (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
          {statusText}
          {lastRunMeta ? ` · ${lastRunMeta}` : ""}
        </div>
      ) : null}
    </>
  );
}
