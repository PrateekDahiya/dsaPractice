# DSA Practice Platform

LeetCode-like practice: write code, **Run** (visible tests) and **Submit** (visible + hidden), in JavaScript, Python, and C++.

## Run it

```bash
npm install          # bcryptjs, jsonwebtoken, mysql2
node server.js       # API + vanilla UI at http://localhost:3000
```

Requires Node 18+, MySQL (see `DB_*` env), and optionally `python`/`python3` + `g++` for those languages. Without a DB it falls back to `questions/*.json` files.

React frontend (in progress on `frontend-migration`):

```bash
cd client && npm install && npm run dev   # http://localhost:5173, /api proxied to :3000
```

## Features

- **Workspace** (`/workspace/:id`): problemSDL, resizable panes, C++/JS/Python editor with highlight + lint, run console with case pills + **custom test cases** (added via the `+` pill, run alongside), LeetCode-style Result tab, Performance tab with AI complexity, submission history with restore, per-question discussion-free notes via autosave.
- **Run modes**: visible-only Run, full Submit, custom-only debug runs (output-only, never scored).
- **AI**: question generation (Groq, oracle-verified), per-submit complexity estimates, originality guard, **daily challenge** (one generated Medium/Hard per UTC day).
- **Social**: auth with roles, leaderboard (cached, streak column), dashboards (incl. read-only `?id=`), profiles (avatar/bio), bookmarks (★ Saved filter), roadmap with AI gap-filling, XP-free streaks + heatmap.
- **Content mgmt**: add/edit/delete questions (owner-or-admin), admin page (users, roles, stale-AI prune), manual mark-as-done, account page (password, export, delete).
- **Ops**: single-flight C++ compiles with exe cache + lazy PCH, per-IP rate limits, request caps, `/api/health` with heap/RSS/counters.

## Add a Question — JSON

Drop a file into `questions/` e.g. `questions/my-question.json`, or use + Add Question (Raw JSON or guided form — the form merges losslessly over JSON).

See `questions/_schema.json` for full schema. Minimal example:

```json
{
  "id": "two-sum",
  "title": "Two Sum",
  "difficulty": "Easy",
  "tags": ["Array"],
  "problemStatement": "Given nums and target, return indices ...",
  "constraints": ["2 <= nums.length <= 10^4"],
  "examples": [
    { "input": "nums = [2,7,11,15], target = 9", "output": "[0,1]", "explanation": "Because ..." }
  ],
  "functionName": "twoSum",
  "pythonFunctionName": "two_sum",
  "params": ["nums", "target"],
  "starterCode": {
    "javascript": "function twoSum(nums, target) {\n  // write code\n}",
    "python": "def two_sum(nums, target):\n    pass"
  },
  "visibleTestCases": [
    { "id": "v1", "input": { "nums": [2,7,11,15], "target": 9 }, "expectedOutput": [0,1] }
  ],
  "hiddenTestCases": [
    { "id": "h1", "input": { "nums": [3,3], "target": 6 }, "expectedOutput": [0,1] }
  ]
}
```

**Rules**
- `id` must match filename (`two-sum.json` → `id: "two-sum"`, slug `[a-z0-9-]`).
- `params` order must match `input` keys order.
- `visibleTestCases` run on **Run**, `visible + hidden` run on **Submit** (hidden not shown until Submit).
- `functionName` is JS/C++ name, `pythonFunctionName` is Python name.
- AI-saved rows get tag `AI` (+ caller tags); daily questions get `daily:<UTC-date>`.

## API (selected)

- `GET /api/questions` → summaries (10s cache) · `GET /api/questions/:id` → full question
- `POST /api/questions` (auth) · `PUT/DELETE /api/questions/:id` (owner or admin)
- `POST /api/execute` `{questionId, code, language, mode}` → `{mode, total, passed, results[]}` — plus `customInput`/`customOnly` for debug runs; per-case `/api/execute/case`, streaming `/api/execute/stream`
- `POST /api/lint` `{code, language}` → diagnostics (cached, rate-limited, single-flight g++)
- `POST /api/complexity` `{questionId, language, code}` → `{time, space, note, expectedTime, expectedSpace}`
- `POST /api/questions/generate` (auth) · `GET /api/daily` · `POST /api/daily/ensure` (auth)
- Auth: `POST /api/auth/register|login` (rate-limited + honeypot), `GET/PUT/DELETE /api/me`, password/export endpoints
- Social: `/api/leaderboard?filter=&limit=&streak=1`, `/api/bookmarks`, `/api/manual-solved`, `/api/users/:id/{profile,stats,dashboard}`, `/api/admin/*` (admin only)
- `GET /api/health` → `{ok, heapMB, rssMB, uptimeSec, lint, exec}`

## Tests & execution

- JS: `vm` with 2s timeout; Python: `python`/`python3` spawn with 3s timeout; C++: `g++ -O0` with exe cache, 3–8s timeouts.
- `deepEqual` with special case for `two-sum` (order-insensitive numeric arrays).
- Custom-input rows (`expectedOutput: null`) are output-only and excluded from totals/solves.
