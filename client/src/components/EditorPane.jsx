import { memo } from "react";

// Static editor DOM: the ported own-editor factory binds these exact IDs on
// mount (see useEditor). Never re-rendered with different ids — the factory
// owns everything inside #oe-wrap after creation.
function EditorPane({ lang, onLangChange, onFormat, onReset, running, onRun, onShortcuts, topStyle }) {
  return (
    <>
      <div className="editor-header">
        <div className="editor-header-left">
          <label htmlFor="language-select">Language</label>
          <select id="language-select" value={lang} onChange={(e) => onLangChange(e.target.value)}>
            <option value="cpp">C++</option>
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
          </select>
          <button className="btn ghost" title="Auto-format (keeps indent)" onClick={onFormat}>
            Format
          </button>
          <button className="btn ghost" title="Reset to starter code" onClick={onReset}>
            Reset
          </button>
          <button id="shortcuts-btn" className="btn ghost" title="Keyboard shortcuts" onClick={onShortcuts}>
            ⌨
          </button>
        </div>
        <div className="editor-actions">
          <button id="run-btn" className="btn secondary" disabled={running} onClick={() => onRun("run")}>
            {running ? "Running..." : "Run"}
          </button>
          <button id="submit-btn" className="btn primary" disabled={running} onClick={() => onRun("submit")}>
            Submit
          </button>
        </div>
      </div>
      <div id="editor-top" className="editor-top" style={topStyle}>
        <div id="oe-wrap">
          <div id="oe-gutter" aria-hidden="true"></div>
          <div id="oe-stack">
            <pre id="oe-hl" aria-hidden="true"></pre>
            <textarea id="code-editor" spellCheck="false" placeholder="Select a problem to load starter code..."></textarea>
          </div>
          <div id="oe-suggest" className="hidden"></div>
          <div id="oe-hover" className="hidden"></div>
        </div>
      </div>
    </>
  );
}

export default memo(EditorPane);
