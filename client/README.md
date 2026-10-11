# DSA Practice — React Client

React 18 + Vite + react-router-dom port of the vanilla frontend. Same API, same behavior, componentized code. Backend untouched (`../server.js`).

## Run

```bash
npm install
npm run dev      # http://localhost:5173, /api proxied to 127.0.0.1:3000
npm run build    # -> dist/ (preview with npm run preview)
```

Backend must run separately (`node server.js` from repo root).

## Routes

`/dashboard` · `/workspace/:id?` (editor) · `/problems` (browse) · `/roadmap` · `/leaderboard` · `/login` · `/register` · `/add-question` · `/admin` (role-gated) · `/settings`. Unknown paths redirect to `/dashboard`.

## Structure

```
src/
  api/client.js        fetch + auth + esc (mirrors vanilla apiFetch)
  context/AuthContext.jsx  token revalidation, login/logout/refresh, isAdmin
  hooks/               useQuestions · useEditor · useRun · useHistory · useComplexity
  components/          Topbar · Toast · ProblemList · ProblemView · EditorPane ·
                       Console · ResultTab · PerfTab · SubmissionView ·
                       AddQuestionModal · ShortcutsModal
  editor/              ownEditor.js (ported factory, AbortController destroy) ·
                       format.js (verbatim formatter)
  pages/               10 route pages
  styles/              base/layout/editor/components/pages/responsive.css
                       (copied from ../public/css; evolves HERE, not there)
```

## Conventions

- Plain CSS only, no Tailwind. Global classes stay global; new markup reuses them.
- `esc()` (via `api/client.js`) anywhere user content renders — especially bio, titles, code output.
- Honeypot `website` field on auth forms; 429s retried with backoff, never surfaced as crashes.
- Admin gate is cosmetic client-side; the server enforces every call.
- Editor DOM uses fixed IDs (`code-editor`, `oe-*`, `status-text`) — the own-editor factory binds them on mount and `destroy()`s on unmount. Never render two editors at once.
- Workspace URL is canonical (`/workspace/:id`); never use hashes for navigation.
- `localStorage` keys shared with vanilla (`token`, `user`, `code:<qid>:<lang>`, `dsa_history_v1`).
- See `MIGRATION.md` for the vanilla→React source map and phase plan.
