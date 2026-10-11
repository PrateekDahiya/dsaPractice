# CONTEXT — client/ (React frontend)

Read this before touching anything under `client/`.

## What it is

Vite + React 18 SPA — the only frontend (vanilla `*.html` + `public/`
deleted at cutover; the server serves `client/dist` + SPA fallback).
Backend API frozen — see root README.
Dev: `npm run dev` (port 5173, `/api` → 127.0.0.1:3000). Build: `npm run build`.

## Architecture rules (do not break)

1. **Classic data flow, no store lib**: `AuthContext` (auth only) + domain
   hooks (`useQuestions/useEditor/useRun/useHistory/useComplexity`) + local
   `useState` in pages. Cross-hook sharing goes through props or `window.__*`
   bridge keys already in use (`__oe`, `__cmLang`, `__questionCtx`,
   `__lastRun`, `__lastComplexity`, `__lastSubmissionId`).
2. **Editor is a singleton factory** (`editor/ownEditor.js` +
   `AbortController` destroy). Exactly one
   `<EditorPane>` mounted at a time; `useEditor` creates on mount, destroys
   on unmount. Element IDs are a contract (`code-editor`, `oe-hl`,
   `oe-gutter`, `oe-suggest`, `oe-hover`, `oe-wrap`, `status-text`,
   `shortcuts-*`) — never duplicate or rename them.
3. **Execution state machine** (`useRun`): per-case loop → batch fallback →
   local JS fallback; 429s retried ×5 with 3s backoff; fetch timeouts
   (60s/case, 120s batch); bookkeeping fire-and-forget so buttons always
   release. Custom cases run after stored ones via `runCustomOne`, merged
   client-side as `custom-N` rows (server scores stored only).
4. **Styling**: the 6 `src/styles/*.css` files are the only stylesheets.
   `#root > div` flex rule in `layout.css`
   is load-bearing for workspace pane constraints; `body.route-locked`
   (workspace) vs `body.route-scroll` (driven by `ScrollManager` in
   `App.jsx`) controls page scroll.
5. **XSS**: `esc()` on all user content. `dangerouslySetInnerHTML` only for
   server-authored `problemStatement` (contains HTML by design).

## Environment gotchas (learned the hard way)

- **Shells don't persist**: background servers die between tool calls; do
  start→poll→verify→kill in ONE command. Separate shells may run rival
  servers — always assert by port (`Get-NetTCPConnection`) and `/api/health`
  `uptimeSec`, never assume.
- **PowerShell quoting**: avoid inline `node -e` with quotes/regex/backticks;
  write temp `.js`/`.cjs` files via the Write tool instead. Beware: `.js`
  under `client/` parses as ESM — use `.cjs` for throwaway scripts, and keep
  them OUT of `client/` (temp dir) or delete before commit.
- **CRLF**: repo files are CRLF — script string surgery must match `\r\n`;
  prefer the Edit tool (handles it) over manual splicing.
- **Minification**: prod bundle renames identifiers — verify bundle contents
  via string literals/DOM ids, never function names.
- **HMR timing**: dev-server probes need settle waits; a missing element right
  after an action is usually timing, re-probe before concluding.
- **No browser ⇒ no certainty**: `vite build` green is necessary, not
  sufficient. For UI claims, drive headless Chromium (`playwright-core` is a
  devDependency) and screenshot — never ship on reasoning alone.
