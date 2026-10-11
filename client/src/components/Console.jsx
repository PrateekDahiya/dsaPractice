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
  if (r.testCaseId === "custom" || String(r.testCaseId || "").startsWith("custom-")) {
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

export function CasePills({ results, sel, onSelect, onAdd }) {
  let customN = 0;
  return (
    <div className="case-pills">
      {(results || []).map((r, i) => {
        const isCustom = r.testCaseId === "custom" || String(r.testCaseId || "").startsWith("custom-");
        let label;
        if (isCustom) {
          customN++;
          label = `Custom ${customN}`;
        } else {
          label = `Case ${i + 1}`;
        }
        const state = r.passed === true ? "pass" : r.passed === false ? "fail" : "custom";
        const icon = r.passed === true ? "✓" : r.passed === false ? "✕" : "•";
        return (
          <button
            key={r.testCaseId + i}
            className={`case-pill ${state}${i === sel ? " active" : ""}`}
            data-idx={i}
            title={isCustom ? `${label} — custom input, output only` : `Case ${i + 1}${r.hidden ? " (hidden)" : ""} — ${r.passed ? "Passed" : "Failed"}`}
            onClick={() => onSelect(i)}
          >
            <span className="pill-icon">{icon}</span> {label}
          </button>
        );
      })}
      {onAdd ? (
        <button className="case-pill custom" title="Add a custom test case" onClick={onAdd}>
          <span className="pill-icon">+</span>
        </button>
      ) : null}
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
// the final result (takes over rendering when present). Custom cases are
// drafted below the pills (+ adds one) and run alongside on Run/Submit.
export default function Console({ payload, live, complexity, expectedTime, expectedSpace, statusText, lastRunMeta, customs, params, onAddCustom, onUpdateCustom, onRemoveCustom }) {
  const [sel, setSel] = useState(0);
  const shown = payload || live;
  useEffect(() => {
    setSel(0);
  }, [payload, live?.results?.length]);

  const editors = (customs || []).length ? (
    <div style={{ marginTop: 10 }}>
      <div className="lc-label">Custom test cases ({customs.length}) — run alongside on Run/Submit</div>
      {customs.map((c, i) => (
        <div className="lc-card" key={c.key}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Custom {i + 1}</span>
            {(params || []).length ? (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>params: {(params || []).join(", ")}</span>
            ) : null}
            <button className="btn ghost" style={{ padding: "2px 8px", fontSize: 11, marginLeft: "auto" }} onClick={() => onRemoveCustom(c.key)}>
              Remove
            </button>
          </div>
          <textarea
            spellCheck="false"
            rows={2}
            value={c.text}
            onChange={(e) => onUpdateCustom(c.key, e.target.value)}
            placeholder='{"nums":[1,2,3],"target":3}'
            style={{
              width: "100%", background: "var(--code)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px",
              fontFamily: "var(--mono)", fontSize: 12, resize: "vertical",
            }}
          />
        </div>
      ))}
    </div>
  ) : null;

  if (!shown || !(shown.results || []).length) {
    return (
      <>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          Hit <strong>Run</strong> to test visible cases, <strong>Submit</strong> for all.
        </div>
        {onAddCustom ? (
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onAddCustom} title="Add a custom test case">
              + Custom case
            </button>
          </div>
        ) : null}
        {editors}
      </>
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
      <CasePills results={results} sel={Math.min(sel, results.length - 1)} onSelect={setSel} onAdd={onAddCustom} />
      <CaseDetail r={current} />
      {editors}
      {statusText ? (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
          {statusText}
          {lastRunMeta ? ` · ${lastRunMeta}` : ""}
        </div>
      ) : null}
    </>
  );
}
