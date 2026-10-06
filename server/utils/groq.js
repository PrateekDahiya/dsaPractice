// Groq LLM client for AI question generation.
// Contract: the model proposes a question draft + test INPUTS + a JS
// referenceSolution. The server (never the model) computes expectedOutputs
// by running the reference through the runJS oracle.
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const ALLOWED_MODELS = {
  "openai/gpt-oss-120b": { label: "GPT-OSS 120B (best quality)", maxTokens: 3000 },
  "openai/gpt-oss-20b": { label: "GPT-OSS 20B (fast)", maxTokens: 3000 },
};
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const GROQ_TIMEOUT_MS = 90000;

function getApiKey() {
  return process.env.GROQ_API_KEY || "";
}

async function groqChat(messages, model, maxTokensOverride) {
  const key = getApiKey();
  if (!key) {
    const e = new Error("GROQ_API_KEY not configured on server");
    e.status = 503;
    throw e;
  }
  const chosen = ALLOWED_MODELS[model] ? model : DEFAULT_MODEL;
  const budget = Math.min(maxTokensOverride || ALLOWED_MODELS[chosen].maxTokens, ALLOWED_MODELS[chosen].maxTokens);
  try {
    return await groqChatOnce(messages, chosen, budget, key);
  } catch (e) {
    // free-tier TPM is small: on "request too large", retry once with a halved budget
    if (e && e.status === 502 && /413/.test(e.message) && budget > 1500) {
      return await groqChatOnce(messages, chosen, Math.floor(budget / 2), key);
    }
    throw e;
  }
}

async function groqChatOnce(messages, chosen, maxTokens, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, GROQ_TIMEOUT_MS);
  try {
    const r = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chosen,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let t = "";
      try { t = await r.text(); } catch {}
      // surface Groq's own retry hint ("try again in Ns") when present
      let hint = "";
      try {
        const m = String(t).match(/try again in ([\d.]+)s/i);
        if (m) hint = ` (Groq asks to retry in ~${m[1]}s)`;
      } catch {}
      const e = new Error(`Groq error ${r.status}${hint}: ${String(t).slice(0, 200)}`);
      e.status = 502;
      throw e;
    }
    const data = await r.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      && data.choices[0].message.content;
    if (!content || !content.trim()) {
      const e = new Error("Groq returned empty content");
      e.status = 502;
      throw e;
    }
    return { content, model: chosen };
  } catch (e) {
    if (e && e.name === "AbortError") {
      const t = new Error("Groq request timed out");
      t.status = 502;
      throw t;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Pull a JSON object out of model output (handles ```json fences + trailing
// prose via balanced-brace scan that respects strings/escapes).
function extractJson(text) {
  const s = String(text || "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cand = fence ? fence[1] : s;
  const start = cand.indexOf("{");
  if (start < 0) throw new Error("No JSON object found in model output");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cand.length; i++) {
    const ch = cand[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(cand.slice(start, i + 1));
      }
    }
  }
  throw new Error("Model JSON was truncated — try again");
}

function buildComplexityPrompt(title, language, code) {
  return [
    { role: "system", content: "You analyze code complexity. Respond with ONLY a single JSON object — no prose, no fences." },
    {
      role: "user",
      content: `Analyze the time and space complexity of this ${language} solution for "${title}":\n${String(code).slice(0, 6000)}\nReturn {"time":"O(?)","space":"O(?)","note":"one short sentence"}. Use standard Big-O like O(1), O(log n), O(n), O(n log n), O(n^2).`,
    },
  ];
}

function isBigO(s) { return typeof s === "string" && /^O\(.+\)$/.test(s.trim()); }

function buildGenerationPrompt(topic, difficulty, extraTags) {
  const tagHint = Array.isArray(extraTags) && extraTags.length
    ? ` Include these tags verbatim in "tags": ${JSON.stringify(extraTags)}.`
    : "";
  return [
    {
      role: "system",
      content: "You are a DSA question author. Respond with ONLY a single JSON object — no prose, no fences, no comments.",
    },
    {
      role: "user",
      content:
`Write one ${difficulty} LeetCode-style question about: ${topic}.${tagHint}
JSON keys (exactly): id (kebab-case slug), title, difficulty ("${difficulty}"), tags, problemStatement (plain text, >=40 chars, <code> allowed), constraints (non-empty string array), timeComplexity (expected optimal, e.g. "O(n)"), spaceComplexity (expected optimal, e.g. "O(1)"), examples (>0, [{input:"human-readable, e.g. nums = [2,7], target = 9", output:"[0,1]", explanation}]), functionName (camelCase JS), pythonFunctionName (snake_case), cppFunctionName (usually same as functionName), params (non-empty unique string array), starterCode ({javascript:"function F(...) {\\n}", python:"def f(...):\\n    pass", cpp: full skeleton, see below}), testInputsVisible (2-4x {id,input}), testInputsHidden (3-6x {id,input}, include edge cases: empty, single, duplicates, extremes), referenceSolution (JS string defining functionName, must RETURN the answer, no console.log).
C++ skeleton (REQUIRED, infer types from example values: integer->int, float->double, true/false->bool, text->string, [1,2]->vector<int>, ["a"]->vector<string>, single chars->vector<char>): "#include <bits/stdc++.h>\\nusing namespace std;\\n\\n<Ret> <cppFunctionName>(<T1> <p1>, ...) {\\n    // write code here\\n    \\n}" where <Ret> matches what the reference returns (vector<int>, int, bool, string; void only for in-place + mutate first param).
Rules: every test input must contain every param as JSON values (each input JSON <=2000 chars, no duplicate inputs). Keep inputs runnable in <1s. Do NOT include expectedOutputs — the server computes them.`,
    },
  ];
}

// Deep validation of a model draft (pure: no I/O). Returns error strings, [] = valid.
// The oracle run + constant-output guard live server-side (need runJS).
function validateDraft(draft, difficulty) {
  const errs = [];
  if (!draft || typeof draft !== "object") return ["draft is not an object"];
  const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  if (!draft.id || !/^[a-z0-9-]+$/.test(draft.id)) errs.push("id must match ^[a-z0-9-]+$");
  if (!draft.title || String(draft.title).length < 3) errs.push("title required (min 3 chars)");
  if (draft.difficulty !== difficulty) errs.push(`difficulty must be "${difficulty}"`);
  if (!draft.problemStatement || String(draft.problemStatement).length < 40) errs.push("problemStatement required (min 40 chars)");
  if (!draft.functionName || !ident.test(draft.functionName)) errs.push("functionName must be a valid identifier");
  if (!Array.isArray(draft.params) || draft.params.length === 0 || !draft.params.every(p => typeof p === "string" && ident.test(p))) errs.push("params must be a non-empty array of valid identifiers");
  if (new Set(draft.params || []).size !== (draft.params || []).length) errs.push("params must be unique");
  const sc = draft.starterCode || {};
  if (!sc.javascript || !sc.javascript.includes(draft.functionName)) errs.push("starterCode.javascript must contain functionName");
  const pyFn = draft.pythonFunctionName || draft.functionName;
  if (sc.python && !sc.python.includes(pyFn)) errs.push("starterCode.python must contain pythonFunctionName");
  const cppFn = draft.cppFunctionName || draft.functionName;
  if (!sc.cpp || !sc.cpp.includes(cppFn)) errs.push("starterCode.cpp must contain cppFunctionName");
  if (sc.cpp && !sc.cpp.includes("bits")) errs.push("starterCode.cpp must include <bits/stdc++.h>");
  if (draft.cppFunctionName && !ident.test(draft.cppFunctionName)) errs.push("cppFunctionName must be a valid identifier");
  if (!Array.isArray(draft.constraints) || draft.constraints.length === 0) errs.push("constraints must be a non-empty array");
  for (const k of ["timeComplexity", "spaceComplexity"]) {
    if (draft[k] !== undefined && !isBigO(draft[k])) errs.push(`${k} must look like O(n)`);
  }
  if (!Array.isArray(draft.examples) || draft.examples.length === 0) errs.push("examples must be a non-empty array");
  else for (const ex of draft.examples) {
    if (!ex || ex.input === undefined || ex.output === undefined) { errs.push("every example needs input and output"); break; }
  }
  const vis = draft.testInputsVisible, hid = draft.testInputsHidden;
  if (!Array.isArray(vis) || vis.length < 2 || vis.length > 4) errs.push("testInputsVisible must have 2-4 items");
  if (!Array.isArray(hid) || hid.length < 3 || hid.length > 6) errs.push("testInputsHidden must have 3-6 items");
  const all = [...(Array.isArray(vis) ? vis : []), ...(Array.isArray(hid) ? hid : [])];
  const ids = all.map(tc => tc && tc.id);
  if (new Set(ids).size !== ids.length) errs.push("test input ids must be unique");
  const seenInputs = new Set();
  for (const tc of all) {
    if (!tc || typeof tc.input !== "object" || tc.input === null) { errs.push(`test input ${tc && tc.id} must have an input object`); break; }
    for (const p of (draft.params || [])) {
      if (!(p in tc.input)) { errs.push(`test input ${tc.id}: missing param "${p}"`); break; }
    }
    const key = JSON.stringify(tc.input);
    if (key.length > 2000) { errs.push(`test input ${tc.id} too large (keep runnable in <1s)`); break; }
    if (seenInputs.has(key)) { errs.push(`duplicate test input ${tc.id}`); break; }
    seenInputs.add(key);
  }
  if (typeof draft.referenceSolution !== "string" || !draft.referenceSolution.includes(draft.functionName)) {
    errs.push("referenceSolution must define functionName");
  } else if (draft.functionName && Array.isArray(draft.params)) {
    const m = draft.referenceSolution.match(new RegExp("function\\s+" + draft.functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\(([^)]*)\\)"));
    if (m) {
      const arity = m[1].trim() === "" ? 0 : m[1].split(",").length;
      if (arity !== draft.params.length) errs.push(`referenceSolution arity (${arity}) must match params (${draft.params.length})`);
    }
  }
  return errs;
}

module.exports = { groqChat, extractJson, buildGenerationPrompt, buildComplexityPrompt, isBigO, validateDraft, ALLOWED_MODELS, DEFAULT_MODEL };
