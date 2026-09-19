# DSA Practice Platform — Vanilla HTML/CSS/JS

LeetCode-like local practice: write code, **Run** (visible tests) and **Submit** (visible + hidden).

## Run
```bash
node server.js
# open http://localhost:3000
```
No `npm install` needed. Requires Node 16+ and optionally `python`/`python3` in PATH for Python questions.

Pure frontend fallback: you can also just open `index.html` via a static server (`npx serve .`) — JS execution will happen locally in browser (Python needs `node server.js`).

## Add a Question — JSON Only

Drop a file into `questions/` e.g. `questions/my-question.json`. Refresh.

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
- `functionName` is JS name, `pythonFunctionName` is Python name.

## API
- `GET /api/questions` → summaries
- `GET /api/questions/:id` → full question
- `POST /api/execute` `{questionId, code, language: "javascript"|"python", mode: "run"|"submit"}` → `{mode, total, passed, results: [{testCaseId, passed, input, expected, actual, error, hidden, timeMs}]}`

## Tests
- JS: `vm` with 2s timeout; Python: `python`/`python3` spawn with 3s timeout.
- `deepEqual` with special case for `two-sum` (order-insensitive numeric arrays).
