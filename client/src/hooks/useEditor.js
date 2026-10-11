import { useCallback, useEffect, useRef, useState } from "react";
import { createOwnEditor } from "../editor/ownEditor.js";
import { apiFetch } from "../api/client.js";
import { formatCode } from "../editor/format.js";

function isCppCode(code) {
  return /#include|using namespace std|vector<|int\s+\w+\s*\(/.test(code);
}

function isJsCode(code) {
  return /^\s*function\s+\w+\s*\(/.test(code);
}

function readTextarea() {
  try {
    return document.getElementById("code-editor")?.value ?? "";
  } catch {
    return "";
  }
}

// Bridges the ported own-editor factory into React. Mirrors
// public/js/editor.js: adapter (get/set), starter load, local + DB autosave,
// formatting. Caller renders the #code-editor/#oe-* DOM, then this hook
// creates the editor once mounted and destroys it on unmount.
export function useEditor({ getLang, getQuestion, notify }) {
  const [editorApi, setEditorApi] = useState(null);
  const apiRef = useRef(null);
  const lastDbSavedCode = useRef("");
  const saveTimer = useRef(null);
  const cbRef = useRef({ getLang, getQuestion, notify });
  cbRef.current = { getLang, getQuestion, notify };

  const getCode = useCallback(() => {
    try {
      if (apiRef.current) return apiRef.current.getValue();
    } catch {
      // fall through to textarea
    }
    return readTextarea();
  }, []);

  const setCode = useCallback((v) => {
    try {
      const ta = document.getElementById("code-editor");
      if (ta) ta.value = v;
    } catch {
      // ignore
    }
    try {
      apiRef.current?.setValue(v);
    } catch {
      // editor not ready yet
    }
  }, []);

  const saveLocal = useCallback(() => {
    const q = cbRef.current.getQuestion();
    if (!q) return;
    try {
      localStorage.setItem(`code:${q.id}:${cbRef.current.getLang()}`, getCode());
    } catch {
      // storage unavailable
    }
  }, [getCode]);

  const saveToDb = useCallback(async () => {
    const q = cbRef.current.getQuestion();
    if (!q) return;
    const code = getCode();
    if (code === lastDbSavedCode.current) return;
    if (!code.trim()) return;
    try {
      const res = await apiFetch("/api/code/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: q.id, language: cbRef.current.getLang(), code }),
      });
      if (res.status === 401) {
        cbRef.current.notify("Login to autosave to DB");
        return;
      }
      lastDbSavedCode.current = code;
    } catch {
      // offline: local copy above is the fallback
    }
  }, [getCode]);

  const scheduleSave = useCallback(() => {
    try {
      clearTimeout(saveTimer.current);
    } catch {
      // ignore
    }
    saveTimer.current = setTimeout(() => {
      saveToDb();
    }, 4000);
  }, [saveToDb]);

  const loadStarter = useCallback(
    async (q, lang) => {
      if (!q) return;
      const starter = q.starterCode[lang] || q.starterCode.javascript || "";
      try {
        const res = await apiFetch(`/api/code/${encodeURIComponent(q.id)}/${encodeURIComponent(lang)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.code !== null && data.code !== undefined) {
            setCode(data.code);
            try {
              localStorage.setItem(`code:${q.id}:${lang}`, data.code);
            } catch {
              // ignore
            }
            return;
          }
        }
      } catch {
        // fall through to local/starter
      }
      let saved = null;
      try {
        saved = localStorage.getItem(`code:${q.id}:${lang}`);
      } catch {
        saved = null;
      }
      if (saved !== null) {
        if (lang === "cpp" && isJsCode(saved) && !isCppCode(saved)) {
          try {
            localStorage.removeItem(`code:${q.id}:${lang}`);
          } catch {
            // ignore
          }
          setCode(starter);
          return;
        }
        if (lang === "javascript" && isCppCode(saved) && !isJsCode(saved)) {
          try {
            localStorage.removeItem(`code:${q.id}:${lang}`);
          } catch {
            // ignore
          }
          setCode(starter);
          return;
        }
        setCode(saved);
      } else {
        setCode(starter);
      }
    },
    [setCode]
  );

  const format = useCallback(() => {
    setCode(formatCode(getCode()));
    saveLocal();
  }, [getCode, setCode, saveLocal]);

  const resetToStarter = useCallback(
    (q, lang) => {
      if (!q) return;
      try {
        localStorage.removeItem(`code:${q.id}:${lang}`);
      } catch {
        // ignore
      }
      setCode(q.starterCode[lang] || q.starterCode.javascript || "");
      saveLocal();
    },
    [setCode, saveLocal]
  );

  const saveToDbRef = useRef(null);
  saveToDbRef.current = saveToDb;

  useEffect(() => {
    let ed = null;
    try {
      window.__cmLang = cbRef.current.getLang();
      const q = cbRef.current.getQuestion();
      if (q) {
        window.__questionCtx = {
          functionName: q.cppFunctionName || q.functionName,
          params: q.params,
        };
      }
      ed = createOwnEditor();
    } catch {
      ed = null;
    }
    apiRef.current = ed;
    setEditorApi(ed);
    let off = null;
    try {
      off =
        ed &&
        ed.onDocChange(() => {
          // local save + debounced DB save (mirrors window.__onEditorInput)
          try {
            const qq = cbRef.current.getQuestion();
            if (qq) {
              try {
                localStorage.setItem(`code:${qq.id}:${cbRef.current.getLang()}`, ed.getValue());
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore
          }
          try {
            clearTimeout(saveTimer.current);
          } catch {
            // ignore
          }
          saveTimer.current = setTimeout(() => {
            saveToDbRef.current().catch(() => {});
          }, 4000);
        });
    } catch {
      off = null;
    }
    const iv = setInterval(() => {
      saveToDbRef.current().catch(() => {});
    }, 20000);
    return () => {
      try {
        off && off();
      } catch {
        // ignore
      }
      try {
        clearInterval(iv);
      } catch {
        // ignore
      }
      try {
        clearTimeout(saveTimer.current);
      } catch {
        // ignore
      }
      try {
        ed && ed.destroy && ed.destroy();
      } catch {
        // ignore
      }
      apiRef.current = null;
      setEditorApi(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready: !!editorApi, getCode, setCode, loadStarter, format, resetToStarter, saveToDb, editorApi };
}
