// core.js — utils, auth, API cache/fetch, topbar, toast, DOM refs. Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.
// Vanilla JS — no framework, no bundler
const $ = (s) => document.querySelector(s);

const questionListEl = $("#question-list");

const problemViewEl = $("#problem-view");

const codeEditor = $("#code-editor");

const langSelect = $("#language-select");

const runBtn = $("#run-btn");

const submitBtn = $("#submit-btn");

const resetBtn = $("#reset-btn");

const resultsEl = $("#test-results");

const statusText = $("#status-text");

const lastRunMeta = $("#last-run-meta");

const toastEl = $("#toast");

const filterEl = $("#difficulty-filter");

const countEl = $("#question-count");


// ---------- Auth helpers ----------
function getToken(){ return localStorage.getItem("token"); }

function getUser(){ try{ return JSON.parse(localStorage.getItem("user")||"null"); } catch{ return null; } }

function setAuth(token, user){ if(token) localStorage.setItem("token", token); if(user) localStorage.setItem("user", JSON.stringify(user)); }

function clearAuth(){ localStorage.removeItem("token"); localStorage.removeItem("user"); }

function authHeaders(headers={}){
  const t = getToken();
  const h = { ...headers };
  if(t) h["Authorization"] = "Bearer " + t;
  return h;
}

const _apiCache = new Map();
 // url -> {data, ts}
async function apiFetch(url, opts={}){
  const headers = authHeaders(opts.headers||{});
  const res = await fetch(url, { ...opts, headers });
  if(res.status===401){
    if(url.includes("/api/me")) clearAuth();
  }
  return res;
}

async function cachedApiFetch(url, ttl=15000){
  const key = url;
  const now = Date.now();
  const entry = _apiCache.get(key);
  if(entry && now - entry.ts < ttl && entry.data){
    // return clone
    return { ok: true, status: 200, json: async()=> JSON.parse(JSON.stringify(entry.data)), clone: true };
  }
  const res = await apiFetch(url);
  if(!res.ok) throw new Error(`fetch ${url} failed ${res.status}`);
  const data = await res.json();
  _apiCache.set(key, { data: JSON.parse(JSON.stringify(data)), ts: now });
  return { ok: true, status: 200, json: async()=> data };
}

function invalidateCache(prefix){
  for(const k of _apiCache.keys()) if(k.startsWith(prefix)) _apiCache.delete(k);
}

function showLoader(){ const el=document.getElementById("top-loader"); if(el){ el.classList.remove("done"); el.classList.add("active"); void el.offsetWidth; el.style.width="70%"; } }

function hideLoader(){ const el=document.getElementById("top-loader"); if(el){ el.style.width="100%"; el.classList.add("done"); setTimeout(()=>{ el.classList.remove("active","done"); el.style.width="0%"; },300); } }

function setLoading(el, isLoading, msg="Loading..."){
  if(!el) return;
  if(isLoading){
    el.dataset.prev = el.innerHTML;
    el.innerHTML = `<div class="loading">${msg}</div>`;
  } else if(el.dataset.prev !== undefined){
    // keep for skeleton case, caller will overwrite
  }
}

function updateTopbar(user){
  const authArea = document.getElementById("auth-area");
  if(!authArea) return;
  const navDash = document.getElementById("nav-dashboard");
  if(user){
    if(navDash) navDash.classList.remove("hidden");
    authArea.innerHTML = `
      <a href="settings.html" style="color:var(--text);text-decoration:none;font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px" title="Account settings">
        <span style="width:26px;height:26px;border-radius:50%;background:var(--panel2);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:11px">${esc(user.username.slice(0,2).toUpperCase())}</span>
        ${esc(user.username)}
      </a>
      <button id="logout-btn" class="btn ghost" style="padding:6px 10px;font-size:12px">Logout</button>
    `;
    const lb = document.getElementById("logout-btn");
    if(lb) lb.addEventListener("click", ()=>{
      clearAuth();
      updateTopbar(null);
      toast("Logged out");
      solvedSet.clear(); attemptedSet.clear(); manualSet.clear();
      renderList();
      renderHistory();
      if(currentQuestion) renderProblem();
    });
  } else {
    if(navDash) navDash.classList.add("hidden");
    authArea.innerHTML = `
      <a href="login.html" class="ghost-link" style="padding:6px 10px;font-size:12px">Login</a>
      <a href="register.html" class="btn primary" style="padding:6px 12px;font-size:12px">Register</a>
    `;
  }
}

async function checkAuth(){
  const t = getToken();
  if(!t){ updateTopbar(null); return null; }
  try{
    const res = await fetch("/api/me", { headers:{ Authorization:"Bearer "+t } });
    if(res.ok){
      const user = await res.json();
      localStorage.setItem("user", JSON.stringify(user));
      updateTopbar(user);
      return user;
    } else {
      clearAuth();
      updateTopbar(null);
      return null;
    }
  }catch{
    const u = getUser();
    updateTopbar(u);
    return u;
  }
}


function toast(msg, ms = 2500) {
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), ms);
}


function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (currentQuestion && currentQuestion.id === "two-sum" && a.every(x=>typeof x==="number")) {
      const sa = [...a].sort((x,y)=>x-y);
      const sb = [...b].sort((x,y)=>x-y);
      return sa.every((v,i)=>v===sb[i]);
    }
    return a.every((v,i)=>deepEqual(v,b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}


function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
