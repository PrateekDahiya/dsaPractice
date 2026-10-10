// performance.js — Performance tab + AI complexity. Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.

async function requestComplexity(question, code, lang){
  const line=document.getElementById("complexity-line");
  const leftLine=document.getElementById("complexity-line-left");
  window.__lastComplexity=null;
  if((!line && !leftLine) || !question) return;
  const setLines=(html)=>{ if(line) line.innerHTML=html; if(leftLine) leftLine.innerHTML=html; };
  const setText=(t)=>{ if(line) line.textContent=t; if(leftLine) leftLine.textContent=t; };
  setText("Analyzing complexity…");
  try{
    const res=await apiFetch("/api/complexity",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({questionId:question.id,language:lang,code})});
    const d=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(d.error||("status "+res.status));
    window.__lastComplexity={time:d.time,space:d.space};
    const norm=s=>String(s||"").replace(/\s+/g,"");
    const tOk=!d.expectedTime||norm(d.time)===norm(d.expectedTime);
    const sOk=!d.expectedSpace||norm(d.space)===norm(d.expectedSpace);
    const exp=(d.expectedTime||d.expectedSpace)?` · expected ${d.expectedTime||"?"} / ${d.expectedSpace||"?"}`:"";
    const mark=(d.expectedTime||d.expectedSpace)?(tOk&&sOk?" ✓":" ⚠"):"";
    setLines(`Complexity (AI): yours <strong>${esc(d.time)} time · ${esc(d.space)} space</strong>${esc(exp)}${mark}${d.note?` — <span style="color:var(--muted)">${esc(d.note)}</span>`:""}`);
    const sid=window.__lastSubmissionId;
    if(sid){
      try{ await apiFetch(`/api/submissions/${sid}/complexity`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({time:d.time,space:d.space})}); }catch{}
    }
    if(isPerfActive()) renderPerformance();
  }catch(e){ setText("Complexity unavailable ("+e.message+")"); if(isPerfActive()) renderPerformance(); }
}

function isPerfActive(){ const p=document.getElementById("ptab-perf"); return p&&p.classList.contains("active"); }

function renderPerformance(){
  const view=document.getElementById("perf-view");
  if(!view) return;
  const q=currentQuestion;
  if(!q){ view.innerHTML=`<div class="empty-state"><h2>Performance</h2><p>Select a problem first.</p></div>`; return; }
  const run=(window.__lastRun&&window.__lastRun.questionId===q.id)?window.__lastRun:null;
  let runHtml;
  if(!run){
    runHtml=`<div class="lc-card"><div style="color:var(--muted);font-size:13px">No run yet for <strong style="color:var(--text)">${esc(q.title)}</strong> — hit <strong>Run</strong> or <strong>Submit</strong> and your timing, memory and complexity will appear here.</div></div>`;
  } else {
    const v=verdictOf(run);
    const times=run.results.map(r=>r.timeMs||0);
    const mx=Math.max(1,...times);
    const avg=runtimeAvg(run.results);
    const mem=maxMemKb(run.results);
    const bars=run.results.map((r,i)=>{
      const pct=Math.round((r.timeMs||0)/mx*100);
      return `<div class="perf-bar-row"><span class="perf-bar-label">Case ${i+1}${r.hidden?" · hidden":""}</span><div class="diff-bar"><span class="${r.passed?"easy":"hard"}" style="width:${pct}%"></span></div><span class="perf-bar-val">${r.timeMs??0}ms${r.memKb!=null?` · ${fmtMemShort(r.memKb)}`:""}</span></div>`;
    }).join("");
    const cx=window.__lastComplexity;
    const cxLine=run.mode==="submit"
      ?(cx?`Complexity (AI): yours <strong>${esc(cx.time)} / ${esc(cx.space)}</strong>`:`Complexity: estimating… (submit triggers analysis)`)
      :`Complexity: estimated on Submit`;
    const exp=(q.timeComplexity||q.spaceComplexity)?` · expected ${esc(q.timeComplexity||"?")} / ${esc(q.spaceComplexity||"?")}`:"";
    runHtml=`<div class="perf-sec-title">This ${esc(run.mode)}</div>
    <div class="lc-card">
      <div class="lc-verdict-row"><span class="${v.cls} perf-verdict">${v.label}</span><span class="lc-count">${run.passed}/${run.total} passed</span></div>
      <div class="perf-grid">
        <div class="perf-tile"><div class="lc-card-label">⏱ Avg runtime</div><div class="lc-card-val">${avg} ms</div></div>
        <div class="perf-tile"><div class="lc-card-label">Max case</div><div class="lc-card-val">${Math.max(0,...times)} ms</div></div>
        <div class="perf-tile"><div class="lc-card-label">🧠 Max memory</div><div class="lc-card-val">${esc(fmtMemShort(mem))}</div></div>
      </div>
      ${bars}
      <div class="perf-cx">${cxLine}${exp}</div>
    </div>`;
  }
  view.innerHTML=`<h2 style="font-size:16px;margin:0 0 4px">Performance — ${esc(q.title)}</h2><div style="margin-bottom:12px"><span class="badge ${esc(q.difficulty)}">${esc(q.difficulty)}</span> <span style="color:var(--muted);font-size:12px">${(q.tags||[]).map(esc).join(" · ")}</span></div>${runHtml}<div id="perf-problem"><div class="loading">Loading problem stats…</div></div>`;
  try{
    apiFetch(`/api/questions/${encodeURIComponent(q.id)}/perf`).then(async (r)=>{
      if(!r.ok) throw new Error();
      const p=await r.json();
      const el=document.getElementById("perf-problem");
      if(!el||currentQuestion!==q) return;
      const o=p.overall, m=p.mine;
      const memLine=o.maxMemKb!=null?` · 🧠 max ${fmtMemShort(o.maxMemKb)}`:"";
      const everyone=`<div class="perf-sec-title">Everyone</div><div class="lc-card">
        <div class="perf-grid">
          <div class="perf-tile"><div class="lc-card-label">Submissions</div><div class="lc-card-val">${o.submissions}</div></div>
          <div class="perf-tile"><div class="lc-card-label">Attempted</div><div class="lc-card-val">${o.attempted}</div></div>
          <div class="perf-tile"><div class="lc-card-label">Solved</div><div class="lc-card-val">${o.solved}</div></div>
          <div class="perf-tile"><div class="lc-card-label">Solve rate</div><div class="lc-card-val">${o.solveRate==null?"–":o.solveRate+"%"}</div></div>
        </div>
        ${o.solveRate==null?"":`<div class="diff-bar perf-rate"><span style="width:${o.solveRate}%"></span></div>`}
        <div class="perf-note">⏱ community avg ${o.avgTimeMs==null?"–":o.avgTimeMs+"ms"}${memLine}</div>
      </div>`;
      let mineH="";
      if(!getToken()) mineH=`<div class="perf-sec-title">You</div><div class="lc-card"><div style="font-size:13px"><a href="login.html" class="ghost-link">Login</a> <span style="color:var(--muted)">to see your personal stats.</span></div></div>`;
      else if(!m||!m.submissions) mineH=`<div class="perf-sec-title">You</div><div class="lc-card"><div style="font-size:13px;color:var(--muted)">No submissions yet — your history will appear here.</div></div>`;
      else {
        const mr=m.submissions?Math.round(m.solves/m.submissions*100):0;
        const vsLine=(m.bestAvgMs!=null&&o.avgTimeMs!=null)?`<div class="perf-note perf-vs">You best avg ~${m.bestAvgMs}ms vs community avg ~${o.avgTimeMs}ms ${m.bestAvgMs<=o.avgTimeMs?"· faster ✓":"· slower"}</div>`:"";
        const rows=m.recent.map(s=>{
          const dt=s.createdAt?new Date(s.createdAt).toLocaleString():"—";
          const ok=s.passed===s.total;
          const tm=s.avgTimeMs!=null?` · ~${s.avgTimeMs}ms`:"";
          const cxS=(s.complexityTime||s.complexitySpace)?` · ${esc(s.complexityTime||"?")}/${esc(s.complexitySpace||"?")}`:"";
          return `<div class="perf-row"><span class="perf-dot ${ok?"ok":"bad"}">${ok?"✓":"●"}</span><span>${esc(dt)}</span><span class="perf-row-meta">${esc(s.mode)} · ${esc(s.language)} · ${s.passed}/${s.total}${tm}${cxS}</span></div>`;
        }).join("");
        mineH=`<div class="perf-sec-title">You</div><div class="lc-card">
          <div class="perf-grid">
            <div class="perf-tile"><div class="lc-card-label">Submissions</div><div class="lc-card-val">${m.submissions}</div></div>
            <div class="perf-tile"><div class="lc-card-label">Solved</div><div class="lc-card-val">${m.solves}</div></div>
            <div class="perf-tile"><div class="lc-card-label">Solve rate</div><div class="lc-card-val">${mr}%</div></div>
            <div class="perf-tile"><div class="lc-card-label">Best avg</div><div class="lc-card-val">${m.bestAvgMs!=null?m.bestAvgMs+"ms":"–"}</div></div>
          </div>
          ${vsLine}
          <div style="margin-top:8px">${rows}</div>
        </div>`;
      }
      el.innerHTML=everyone+mineH;
    }).catch(()=>{ const el=document.getElementById("perf-problem"); if(el) el.innerHTML=`<div class="lc-card"><div style="font-size:13px;color:var(--muted)">Problem stats unavailable.</div></div>`; });
  }catch{ const el=document.getElementById("perf-problem"); if(el) el.textContent="Problem stats unavailable."; }
}
