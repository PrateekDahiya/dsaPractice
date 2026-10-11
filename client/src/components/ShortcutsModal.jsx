// Mirrors the #shortcuts-modal in index.html (also targeted by the
// own-editor factory via the same element IDs — hence always mounted,
// visibility toggled with .hidden).
export default function ShortcutsModal({ open, onClose }) {
  return (
    <div className={`modal${open ? "" : " hidden"}`} id="shortcuts-modal">
      <div className="modal-backdrop" id="shortcuts-backdrop" onClick={onClose}></div>
      <div className="modal-panel" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Keyboard shortcuts</h2>
          <button className="btn ghost" style={{ padding: "4px 8px" }} id="shortcuts-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "14px 16px", overflowY: "auto" }}>
          <table className="shortcuts-table">
            <tbody>
              <tr><td><span className="kbd">Tab</span> / <span className="kbd">Shift+Tab</span></td><td>Indent / unindent (accept suggestion when open)</td></tr>
              <tr><td><span className="kbd">Enter</span></td><td>New line (never accepts suggestions)</td></tr>
              <tr><td><span className="kbd">Ctrl+Z</span> / <span className="kbd">Ctrl+Shift+Z</span>, <span className="kbd">Ctrl+Y</span></td><td>Undo / redo</td></tr>
              <tr><td><span className="kbd">Ctrl+S</span></td><td>Save now</td></tr>
              <tr><td><span className="kbd">Ctrl+Shift+F</span></td><td>Format code</td></tr>
              <tr><td><span className="kbd">Ctrl+/</span></td><td>Toggle line comment</td></tr>
              <tr><td><span className="kbd">Ctrl+D</span></td><td>Duplicate line(s)</td></tr>
              <tr><td><span className="kbd">Alt+↑</span> / <span className="kbd">Alt+↓</span></td><td>Move line(s) up / down</td></tr>
              <tr><td><span className="kbd">Ctrl+Space</span></td><td>Show suggestions</td></tr>
              <tr><td><span className="kbd">Esc</span></td><td>Close popup</td></tr>
              <tr><td><span className="kbd">Ctrl+Enter</span> / <span className="kbd">Ctrl+Shift+Enter</span></td><td>Run / Submit</td></tr>
            </tbody>
          </table>
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>Ctrl works as ⌘ on macOS.</p>
        </div>
      </div>
    </div>
  );
}
