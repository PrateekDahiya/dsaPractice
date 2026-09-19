// api.js — fetch wrappers with auth
function getToken(){ return localStorage.getItem('token'); }
function authHeaders(){ const t=getToken(); return t?{Authorization:'Bearer '+t}:{}; }
async function apiFetch(url, opts={}){
  opts.headers = {...(opts.headers||{}), ...authHeaders()};
  const res = await fetch(url, opts);
  if(res.status===401) { /* handle unauth */ }
  return res;
}
