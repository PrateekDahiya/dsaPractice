# Vanilla → React migration map — COMPLETE (cutover done, vanilla deleted)

Source of truth was the repo root (`*.html`, `public/js/*.js`,
`public/css/*.css`) — deleted at cutover. API is frozen.

## Conventions (decided)

- React Router (`/dashboard /workspace /problems /roadmap /leaderboard
  /login /register /add-question /admin /settings`), Context + hooks, plain
  CSS (the 6 files under `src/styles/`).
- `esc()` stays mandatory anywhere user content renders (see `api/client.js`).
- Honeypot (`website` field), 429-retry, and admin-gate semantics must be
  preserved 1:1 (server enforces; client mirrors messages).
- No Tailwind. Component-scoped CSS only for genuinely new markup.

## Source mapping (page → port from)

| Route | Port from | Hooks to create |
|---|---|---|
| `/dashboard` | `dashboard.html` | `useDashboard` (stats+daily+profile card data) |
| `/workspace` | `index.html` + `questions/editor/run/results/history/performance/add-question.js` | `useQuestions`, `useEditor` (own-editor wrapper), `useRun` (execute state machine incl. per-case 429 retries), `useLint`, `useHistory`, `useComplexity` |
| `/problems` | `problems.html` | reuse `useQuestions` + stats |
| `/roadmap` | `roadmap.html` (STEPS table, generate flow) | `useRoadmap`, `useGenerate` |
| `/leaderboard` | `leaderboard.html` (filter cache + Refresh) | `useLeaderboard` |
| `/login`, `/register` | `login/register.html` (incl. honeypot) | AuthContext only |
| `/add-question` | `add-question.html` + modal logic | reuse workspace modal component |
| `/admin` | `admin.html` (role-gated) | `useAdmin` |
| `/settings` | `settings.html` (profile + account cards) | reuse `useAuth().refresh()` |

## Shared components (`src/components/`)

Topbar (+AuthArea) ✅ done · Toast · Loader · Badge · EmptyState ·
ConfirmModal · Pagination · StatCard · DiffBar · Calendar/Heatmap · Ring ·
ProblemList · QuestionRow · EditorPane · Console (verdict+pills+detail) ·
CustomPanel · SubmissionView · ResultTab · PerfTab · AddQuestionModal ·
ProfileCard · AccountCard · DailyCard · StepCard · UsersTable.

## Order (strangler, each shippable)

1. Scaffold ✅ (this commit): router, AuthContext, api client, Topbar, 10
   placeholder pages, global CSS, dev proxy.
2. Leaf pages: login/register → leaderboard → problems → roadmap → admin →
   settings → dashboard.
3. Workspace (hardest, last): list → problem → editor (verbatim own-editor
   port) → console → tabs → modal.
4. Cutover ✅ done: server serves `client/dist` + SPA fallback; vanilla
   files deleted; Docker build runs `npm --prefix client` install + build.

## Validation per phase

- `npm run build` clean, zero eslint errors (when added).
- Click-compare against vanilla on the same backend; DevTools console clean.
- Re-run the live API test scripts for touched flows (run/submit/lint/
  history/generate/rate-limits).
- `React.lazy` for the workspace route so leaf pages stay light.
