import { useEffect, useRef, useState } from "react";

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

// Live + final console built around TABS (LeetCode-style): stored cases and
// custom cases are all tabs. Pre-run, stored tabs show Input only; custom
// tabs are editable and run alongside on Run/Submit.
export default function Console({ payload, live, complexity, expectedTime, expectedSpace, statusText, lastRunMeta, visibleCases, customs, params, onAddCustom, onUpdateCustom, onRemoveCustom }) {
  const shown = payload || live;
  const hasResults = !!(shown && (shown.results || []).length);
  const [sel, setSel] = useState({ kind: "stored", idx: 0 });
  useEffect(() => {
    setSel({ kind: "stored", idx: 0 });
  }, [payload, live?.results?.length, (visibleCases || []).length]);
  const prevCustomLen = useRef((customs || []).length);
  useEffect(() => {
    const n = (customs || []).length;
    if (n > prevCustomLen.current) setSel({ kind: "custom", idx: n - 1 });
    prevCustomLen.current = n;
  }, [customs]);

  const isCustomId = (id) => id === "custom" || String(id || "").startsWith("custom-");
  const storedRows = hasResults ? (shown.results || []).filter((r) => !isCustomId(r.testCaseId)) : [];
  const customRows = hasResults ? (shown.results || []).filter((r) => isCustomId(r.testCaseId)) : [];
  const preRunCases = !hasResults ? (visibleCases || []) : [];
  const customsList = customs || [];

  const storedCount = hasResults ? storedRows.length : preRunCases.length;
  const sIdx = sel.kind === "stored" ? Math.min(sel.idx, Math.max(0, storedCount - 1)) : 0;
  const cIdx = sel.kind === "custom" ? Math.min(sel.idx, Math.max(0, customsList.length - 1)) : 0;

  if (!storedCount && !customsList.length) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        Hit <strong>Run</strong> to test visible cases, <strong>Submit</strong> for all.
      </div>
    );
  }

  const mode = hasResults ? shown.mode : "run";
  const { total, passed } = hasResults ? shown : { total: storedCount, passed: 0 };
  const v = hasResults ? verdictOf(shown) : null;
  const avg = hasResults ? runtimeAvg(shown.results) : 0;

  return (
    <>
      {hasResults ? (
        <div className="console-head">
          <span className={v.cls}>{v.label}</span>
          <span className="run-meta">Runtime: {avg} ms</span>
          <span className={`results-summary ${passed === total ? "pass" : "fail"}`} style={{ marginLeft: "auto" }}>
            {passed} / {total}
          </span>
        </div>
      ) : null}
      {hasResults && mode === "submit" ? (
        <div className="run-stats" style={{ fontSize: 12, color: "var(--muted)", margin: "-4px 0 10px" }}>
          {complexity ? (
            <ComplexityLine est={complexity} expectedTime={expectedTime} expectedSpace={expectedSpace} />
          ) : (
            "Analyzing complexity…"
          )}
        </div>
      ) : null}
      <div className="case-pills">
        {hasResults
          ? storedRows.map((r, i) => (
              <button
                key={r.testCaseId + i}
                className={`case-pill ${r.passed === true ? "pass" : r.passed === false ? "fail" : "custom"}${sel.kind === "stored" && i === sIdx ? " active" : ""}`}
                title={`Case ${i + 1}${r.hidden ? " (hidden)" : ""} — ${r.passed ? "Passed" : "Failed"}`}
                onClick={() => setSel({ kind: "stored", idx: i })}
              >
                <span className="pill-icon">{r.passed === true ? "✓" : r.passed === false ? "✕" : "•"}</span> Case {i + 1}
              </button>
            ))
          : preRunCases.map((tc, i) => (
              <button
                key={"pre" + i}
                className={`case-pill${sel.kind === "stored" && i === sIdx ? " active" : ""}`}
                title={`Case ${i + 1} — not run yet`}
                onClick={() => setSel({ kind: "stored", idx: i })}
              >
                <span className="pill-icon">•</span> Case {i + 1}
              </button>
            ))}
        {customsList.map((c, i) => (
          <button
            key={c.key}
            className={`case-pill custom${sel.kind === "custom" && i === cIdx ? " active" : ""}`}
            title={`Custom ${i + 1} — your input, output only`}
            onClick={() => setSel({ kind: "custom", idx: i })}
          >
            <span className="pill-icon">•</span> Custom {i + 1}
          </button>
        ))}
        {onAddCustom ? (
          <button className="case-pill custom" title="Add a custom test case" onClick={onAddCustom}>
            <span className="pill-icon">+</span>
          </button>
        ) : null}
      </div>
      {sel.kind === "custom" && customsList[cIdx] ? (
        <CustomDetail
          c={customsList[cIdx]}
          num={cIdx + 1}
          params={params}
          out={customRows[cIdx] || null}
          onUpdate={onUpdateCustom}
          onRemove={onRemoveCustom}
        />
      ) : hasResults ? (
        <CaseDetail r={storedRows[sIdx]} />
      ) : preRunCases[sIdx] ? (
        <>
          <div className="lc-label">Input</div>
          <div className="lc-card">{lcInputHtml(preRunCases[sIdx].input)}</div>
        </>
      ) : null}
      {statusText ? (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
          {statusText}
          {lastRunMeta ? ` · ${lastRunMeta}` : ""}
        </div>
      ) : null}
    </>
  );
}

function CustomDetail({ c, num, params, out, onUpdate, onRemove }) {
  return (
    <>
      <div className="lc-label">Custom {num} input {(params || []).length ? <span style={{ fontWeight: 400 }}>({(params || []).join(", ")})</span> : null}</div>
      <div className="lc-card">
        <textarea
          spellCheck="false"
          rows={2}
          value={c.text}
          onChange={(e) => onUpdate(c.key, e.target.value)}
          placeholder='{"nums":[1,2,3],"target":3}'
          style={{
            width: "100%", background: "var(--code)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px",
            fontFamily: "var(--mono)", fontSize: 12, resize: "vertical",
          }}
        />
        <div style={{ display: "flex", marginTop: 6 }}>
          <button className="btn ghost" style={{ padding: "2px 8px", fontSize: 11, marginLeft: "auto" }} onClick={() => onRemove(c.key)}>
            Remove
          </button>
        </div>
      </div>
      <div className="lc-label">Output</div>
      <div className="lc-card">
        {out ? <pre>{out.error ? out.error : fmtJson(out.actual)}</pre> : <pre style={{ color: "var(--muted)" }}>Run to see output</pre>}
      </div>
    </>
  );
}
