import { useCallback, useRef, useState } from "react";
import { apiFetch } from "../api/client.js";

function deepEqual(a, b, qId) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (qId === "two-sum" && a.every((x) => typeof x === "number")) {
      const sa = [...a].sort((x, y) => x - y);
      const sb = [...b].sort((x, y) => x - y);
      return sa.every((v, i) => v === sb[i]);
    }
    return a.every((v, i) => deepEqual(v, b[i], qId));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k], qId));
  }
  return false;
}

// apiFetch with a timeout so a stalled backend surfaces as an error instead
// of hanging the console forever (fetch has no built-in timeout).
async function apiFetchTimeout(url, opts = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => {
    try {
      ctrl.abort();
    } catch {
      // ignore
    }
  }, ms);
  try {
    return await apiFetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("Request timed out — is the server running?");
    throw e;
  } finally {
    clearTimeout(t);
  }
}
export function useRun({ getQuestion, getLang, getCode, saveHistory, requestComplexity, notify }) {
  const [running, setRunning] = useState(false);
  const [payload, setPayload] = useState(null);
  const [live, setLive] = useState(null); // { mode, total, results } while streaming
  const cbRef = useRef({ getQuestion, getLang, getCode, saveHistory, requestComplexity, notify });
  cbRef.current = { getQuestion, getLang, getCode, saveHistory, requestComplexity, notify };

  const finish = useCallback(
    async (mode, code, result) => {
      const { getQuestion: gq, getLang: gl, saveHistory: sh, requestComplexity: rc } = cbRef.current;
      const q = gq();
      setPayload(result);
      try {
        window.__lastRun = result
          ? { questionId: q && q.id, mode, passed: result.passed, total: result.total, results: result.results, ts: Date.now() }
          : null;
      } catch {
        // ignore
      }
      if (mode === "submit" && result) {
        try {
          await rc(q, code, gl());
        } catch {
          // complexity is best-effort
        }
      }
      if (result && q) {
        try {
          await sh({
            id: Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            ts: Date.now(),
            questionId: q.id,
            title: q.title,
            language: gl(),
            mode,
            code,
            passed: result.passed,
            total: result.total,
            results: result.results,
          });
        } catch {
          // history is best-effort
        }
      }
    },
    []
  );

  const localRun = useCallback(
    async (mode, code) => {
      const q = cbRef.current.getQuestion();
      const lang = cbRef.current.getLang();
      if (lang !== "javascript") {
        cbRef.current.notify("Local fallback only supports JavaScript.");
        return null;
      }
      const testCases = mode === "run" ? q.visibleTestCases : [...q.visibleTestCases, ...q.hiddenTestCases];
      const results = [];
      let passed = 0;
      for (const tc of testCases) {
        const isHidden = mode === "submit" && q.hiddenTestCases.some((h) => h.id === tc.id);
        const start = Date.now();
        try {
          const fnName = q.functionName;
          const args = q.params.map((p) => JSON.stringify(tc.input[p]));
          const wrapped = `${code}\n; return (${fnName}).apply(null, [${args.join(",")}]);`;
          const fn = new Function(wrapped);
          let actual = fn();
          if (actual === undefined && q.params.length === 1) {
            const capture = `${code}\nlet _input = ${args[0]};\nlet _ret = (${fnName})(_input);\nif (_ret === undefined) _ret = _input;\nreturn _ret;`;
            actual = new Function(capture)();
          }
          const ok = deepEqual(actual, tc.expectedOutput, q.id);
          if (ok) passed++;
          results.push({ testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual, hidden: isHidden, timeMs: Date.now() - start, memKb: null });
        } catch (e) {
          results.push({ testCaseId: tc.id, passed: false, input: tc.input, expected: tc.expectedOutput, actual: null, error: String((e && e.message) || e), hidden: isHidden, timeMs: Date.now() - start, memKb: null });
        }
      }
      return { mode, results, total: testCases.length, passed };
    },
    []
  );

  const run = useCallback(
    async (mode) => {
      const { getQuestion: gq, getLang: gl, getCode: gc, notify: nt } = cbRef.current;
      const q = gq();
      if (!q) {
        nt("Select a problem first");
        return null;
      }
      const code = gc();
      if (!code.trim()) {
        nt("Write some code first");
        return null;
      }
      const lang = gl();
      setRunning(true);
      setPayload(null);
      let result = null;
      // Best: per-testcase API — render each case as it resolves.
      try {
        const total = q.visibleTestCases.length + (mode === "submit" ? q.hiddenTestCases.length : 0);
        const results = [];
        setLive({ mode, total, results: [] });
        for (let i = 0; i < total; i++) {
          let resCase = null;
          for (let attempt = 0; attempt < 6; attempt++) {
            resCase = await apiFetchTimeout("/api/execute/case", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ questionId: q.id, code, language: lang, mode, index: i }),
            });
            if (resCase.status !== 429 || attempt === 5) break;
            await new Promise((r) => setTimeout(r, 3000));
          }
          if (!resCase.ok) {
            const err = await resCase.json().catch(() => ({ error: resCase.statusText }));
            throw new Error(err.error || "case failed");
          }
          const r = await resCase.json();
          results.push(r);
          setLive({ mode, total, results: [...results] });
        }
        result = { mode, total, passed: results.filter((r) => r.passed).length, results };
        setLive(null);
        finish(mode, code, result);
        return result;
      } catch (e) {
        // per-case failed: fall back to batch
      }
      try {
        const res = await apiFetchTimeout("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: q.id, code, language: lang, mode }),
        }, 120000);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || "execution failed");
        }
        result = await res.json();
        setLive(null);
        finish(mode, code, result);
        return result;
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (msg.includes("Failed to fetch") || msg.includes("fetch") || msg.includes("timed out")) {
          result = await localRun(mode, code);
          setLive(null);
          finish(mode, code, result);
          return result;
        }
        setLive(null);
        nt(msg);
        finish(mode, code, null);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [finish, localRun]
  );

  const runCustom = useCallback(
    async (customInput) => {
      const { getQuestion: gq, getLang: gl, getCode: gc, notify: nt } = cbRef.current;
      const q = gq();
      if (!q) {
        nt("Select a problem first");
        return null;
      }
      const code = gc();
      if (!code.trim()) {
        nt("Write some code first");
        return null;
      }
      setRunning(true);
      setPayload(null);
      try {
        const res = await apiFetchTimeout("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: q.id, code, language: gl(), mode: "run", customInput, customOnly: true }),
        }, 120000);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "custom run failed");
        const result = { mode: "run", total: data.total ?? 0, passed: data.passed ?? 0, results: data.results || [] };
        finish("run", code, result);
        return result;
      } catch (e) {
        nt(String((e && e.message) || e));
        finish("run", code, null);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [finish]
  );

  return { running, payload, live, run, runCustom, clear: () => { setPayload(null); setLive(null); } };
}
