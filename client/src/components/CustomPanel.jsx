import { useState } from "react";

// Custom-input panel (toggled by the Custom button): JSON object keyed by
// param name, run output-only via useRun().runCustom().
export default function CustomPanel({ question, running, onRun }) {
  const first = question?.visibleTestCases?.[0];
  const [value, setValue] = useState(() => (first && first.input ? JSON.stringify(first.input) : ""));
  const [error, setError] = useState("");

  // refresh the placeholder content when switching questions with an empty box
  const placeholder = first && first.input ? JSON.stringify(first.input) : '{"nums":[1,2,3],"target":3}';

  async function submit() {
    setError("");
    let parsed;
    try {
      parsed = JSON.parse(value || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("must be a JSON object keyed by param name");
      }
    } catch (e) {
      setError("Custom input is not valid JSON: " + e.message);
      return;
    }
    await onRun(parsed);
  }

  return (
    <div id="custom-panel" style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", background: "var(--panel)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>
        Custom input (JSON object keyed by param name) — runs <em>only</em> this input, output is not scored
      </div>
      <textarea
        spellCheck="false"
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          background: "var(--code)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "8px 10px",
          fontFamily: "var(--mono)",
          fontSize: 13,
          resize: "vertical",
        }}
      />
      {error ? <div style={{ fontSize: 12, color: "#ff8a9a", marginTop: 6 }}>{error}</div> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button className="btn secondary" disabled={running} onClick={submit}>
          {running ? "Running..." : "Run Custom"}
        </button>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Enter = run</span>
      </div>
    </div>
  );
}
