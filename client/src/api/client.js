// API client — mirrors public/js/core.js apiFetch semantics:
// same-origin fetch, Bearer token from localStorage, 401 passes through
// (callers decide: AuthContext clears, pages show login prompts).
export function getToken() {
  return localStorage.getItem("token");
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export function setAuth(token, user) {
  if (token) localStorage.setItem("token", token);
  if (user) localStorage.setItem("user", JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

function authHeaders(headers = {}) {
  const t = getToken();
  const h = { ...headers };
  if (t) h["Authorization"] = "Bearer " + t;
  return h;
}

export async function apiFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: authHeaders(opts.headers || {}) });
  return res;
}

export async function apiJson(url, opts = {}) {
  const res = await apiFetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
