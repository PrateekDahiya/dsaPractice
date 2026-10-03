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
JSON keys (exactly): id (kebab-case slug), title, difficulty ("${difficulty}"), tags, problemStatement (plain text, <code> allowed), constraints (array of strings), examples ([{input:"human-readable, e.g. nums = [2,7], target = 9", output:"[0,1]", explanation}]), functionName (camelCase), pythonFunctionName (snake_case), params (non-empty string array), starterCode ({javascript:"function F(...) {\\n}", python:"def f(...):\\n    pass"} — skeletons only), testInputsVisible (exactly 3x {id,input}), testInputsHidden (exactly 5x {id,input}, include edge cases: empty, single, duplicates, extremes), referenceSolution (JS string defining functionName, must RETURN the answer, no console.log).
Rules: every test input must contain every param as JSON values. Keep inputs runnable in <1s. Do NOT include expectedOutputs — the server computes them.`,
    },
  ];
}

module.exports = { groqChat, extractJson, buildGenerationPrompt, ALLOWED_MODELS, DEFAULT_MODEL };
