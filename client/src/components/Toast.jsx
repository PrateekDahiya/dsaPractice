import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(() => {});

// Replaces the global #toast div: notify(msg) shows a transient message.
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState("");
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  const notify = useCallback((m, ms = 2500) => {
    setMsg(m);
    setVisible(true);
    try {
      clearTimeout(timer.current);
    } catch {
      // ignore
    }
    timer.current = setTimeout(() => setVisible(false), ms);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      {visible ? <div className="toast">{msg}</div> : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
