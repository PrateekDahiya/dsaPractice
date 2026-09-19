const vm = require('vm');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function deepEqual(a, b, qId) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (qId === "two-sum" && a.every(x=>typeof x==="number")) {
      const sa = [...a].sort((x,y)=>x-y); const sb = [...b].sort((x,y)=>x-y);
      return sa.every((v,i)=>v===sb[i]);
    }
    return a.every((v,i)=>deepEqual(v,b[i], qId));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k], qId));
  }
  return false;
}

function runJS(code, question, input, expectedOutput) {
  const fnName = question.functionName;
  const params = question.params;
  const args = params.map(p => JSON.stringify(input[p]));
  const isComposite = expectedOutput && typeof expectedOutput === "object" && !Array.isArray(expectedOutput) && ("k" in expectedOutput);
  const needsMutationFallback = question.id === "reverse-string" || question.id === "move-zeroes" || isComposite;
  let scriptCode;
  if (isComposite) {
    const mutatedParam = params[0];
    scriptCode = `${code}\nlet _args = [${args.join(",")}];\nlet _ret = ${fnName}.apply(null, _args);\nlet _actual = { k: _ret, ${mutatedParam}: _args[0] };\n_actual;`;
  } else if (needsMutationFallback) {
    scriptCode = `${code}\nlet _args = [${args.join(",")}];\nlet _ret = ${fnName}.apply(null, _args);\nif (_ret === undefined) _ret = _args[0];\n_ret;`;
  } else {
    scriptCode = `${code}\n; ${fnName}.apply(null, [${args.join(",")}])`;
  }
  const context = vm.createContext({});
  const script = new vm.Script(scriptCode);
  return script.runInContext(context, { timeout: 2000 });
}

function runPython(code, question, input, expectedOutput) {
  return new Promise((resolve, reject) => {
    const fnName = question.pythonFunctionName || question.functionName;
    const params = question.params;
    const tmpFile = path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    const inputArgs = params.map(p => JSON.stringify(input[p])).join(", ");
    const isComposite = expectedOutput && typeof expectedOutput === "object" && !Array.isArray(expectedOutput) && ("k" in expectedOutput);
    const isReverse = question.id === "reverse-string";
    let driver;
    if (isComposite) driver = `\nimport json\n_ret = ${fnName}(${inputArgs})\n_actual = {"k": _ret, "${params[0]}": ${params[0]}}\nprint(json.dumps(_actual))\n`;
    else if (isReverse) driver = `\nimport json\n_ret = ${fnName}(${inputArgs})\nif _ret is None:\n    _ret = ${params[0]}\nprint(json.dumps(_ret))\n`;
    else driver = `\nimport json\n_ret = ${fnName}(${inputArgs})\nprint(json.dumps(_ret))\n`;
    fs.writeFileSync(tmpFile, code + "\n" + driver, "utf8");
    const py = spawn("python", [tmpFile], { timeout: 3000 });
    let stdout="", stderr="";
    py.stdout.on("data", d=> stdout+=d); py.stderr.on("data", d=> stderr+=d);
    py.on("error", err => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err.code === "ENOENT") {
        const py3 = spawn("python3", [tmpFile], { timeout: 3000 });
        let s2="", e2=""; py3.stdout.on("data", d=>s2+=d); py3.stderr.on("data", d=>e2+=d);
        py3.on("close", code2 => { try { fs.unlinkSync(tmpFile); } catch {}; if (code2!==0) return reject(new Error(e2 || `python3 exit ${code2}`)); try { resolve(JSON.parse(s2.trim())); } catch { reject(new Error("Invalid python output: "+s2)) }});
        py3.on("error", ()=> reject(new Error("python not found: install python3")));
      } else reject(err);
    });
    py.on("close", code => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code!==0) return reject(new Error(stderr.trim() || `python exit ${code}`));
      try { resolve(JSON.parse(stdout.trim())); } catch(e){ reject(new Error("Invalid python output: "+stdout)) }
    });
    setTimeout(()=>{ try{py.kill();}catch{}; reject(new Error("Time Limit Exceeded (python >3s)")); },3500);
  });
}

function jsonToCppLiteral(val) {
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "string") return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  if (Array.isArray(val)) {
    if (val.length===0) return "{}";
    const first=val[0];
    if (typeof first==="number") return "{"+val.join(",")+"}";
    if (typeof first==="string") { const allSingle=val.every(s=>typeof s==="string"&&s.length===1); if(allSingle) return "{"+val.map(s=>"'"+s.replace(/'/g,"\\'")+"'").join(",")+"}"; return "{"+val.map(s=>'"'+String(s).replace(/"/g,'\\"')+'"').join(",")+"}"; }
    if (typeof first==="boolean") return "{"+val.map(b=>b?"true":"false").join(",")+"}";
    if (Array.isArray(first)) return "{"+val.map(v=>jsonToCppLiteral(v)).join(",")+"}";
  }
  return "0";
}
function cppTypeFor(val) {
  if (typeof val==="number") return Number.isInteger(val)?"int":"double";
  if (typeof val==="boolean") return "bool";
  if (typeof val==="string") return "string";
  if (Array.isArray(val)) {
    if(val.length===0) return "vector<int>";
    const f=val[0]; if(typeof f==="number") return "vector<int>"; if(typeof f==="string") return f.length===1?"vector<char>":"vector<string>"; if(typeof f==="boolean") return "vector<bool>"; if(Array.isArray(f)) return "vector<"+cppTypeFor(f)+">";
  }
  return "auto";
}
function runCpp(code, question, input, expectedOutput) {
  return new Promise((resolve, reject) => {
    const fnName = question.cppFunctionName || question.functionName;
    const params = question.params;
    const isReverse = question.id === "reverse-string";
    const isComposite = expectedOutput && typeof expectedOutput==="object" && !Array.isArray(expectedOutput) && ("k" in expectedOutput);
    const decls = params.map(p=>{ const v=input[p]; return `${cppTypeFor(v)} ${p} = ${jsonToCppLiteral(v)};`; }).join("\n  ");
    const callArgs=params.join(", ");
    const tmpCpp=path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.cpp`);
    const exe=tmpCpp.replace(/\.cpp$/, os.platform()==="win32"?".exe":".out");
    const hasInclude=code.includes("#include");
    const header=hasInclude?"":'#include <bits/stdc++.h>\nusing namespace std;\n';
    const printHelpers=`\ntemplate<typename T> void printJsonVal(const T& v);\nvoid printJsonVal(int v){ cout << v; }\nvoid printJsonVal(double v){ cout << v; }\nvoid printJsonVal(bool v){ cout << (v?"true":"false"); }\nvoid printJsonVal(const string& v){ cout << '"' << v << '"'; }\nvoid printJsonVal(char v){ cout << '"' << v << '"'; }\ntemplate<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }\n`;
    const isInPlaceVoid=isReverse || question.id==="move-zeroes";
    let driver;
    if(isComposite) driver=`\nint main(){\n  ${decls}\n  int _k = ${fnName}(${callArgs});\n  cout << "{\\"k\\":" << _k << ",\\"${params[0]}\\":"; printJsonVal(${params[0]}); cout << "}" << endl;\n  return 0;\n}\n`;
    else if(isInPlaceVoid) driver=`\nint main(){\n  ${decls}\n  ${fnName}(${callArgs});\n  printJsonVal(${params[0]});\n  cout << endl;\n  return 0;\n}\n`;
    else driver=`\nint main(){\n  ${decls}\n  auto _ret = ${fnName}(${callArgs});\n  printJsonVal(_ret);\n  cout << endl;\n  return 0;\n}\n`;
    fs.writeFileSync(tmpCpp, header+"\n"+code+"\n"+printHelpers+"\n"+driver, "utf8");
    const ROOT=path.join(__dirname, "../..");
    const localGpps=[path.join(ROOT,"tools","mingw64","bin","g++.exe"),path.join(ROOT,"tools","w64devkit","bin","g++.exe"),path.join(ROOT,"tools","gcc","bin","g++.exe"),"C:\\mingw64\\bin\\g++.exe","C:\\tools\\mingw64\\bin\\g++.exe","C:\\tools\\w64devkit\\bin\\g++.exe"];
    let compiler="g++"; for(const p of localGpps) if(fs.existsSync(p)){compiler=p;break;}
    const compile=spawn(compiler, ["-std=c++17","-O2",tmpCpp,"-o",exe]);
    let cErr=""; compile.stderr.on("data",d=>cErr+=d);
    compile.on("error", err=>{ try{fs.unlinkSync(tmpCpp);}catch{}; if(err.code==="ENOENT") return reject(new Error("g++ not found")); reject(new Error("Compile spawn error: "+err.message)); });
    compile.on("close", cCode=>{ if(cCode!==0){ try{fs.unlinkSync(tmpCpp);}catch{}; return reject(new Error("Compile Error:\\n"+cErr)); }
      const binDir=path.dirname(compiler); const runEnv={...process.env, PATH: binDir+path.delimiter+process.env.PATH};
      const run=spawn(exe, [], {timeout:3000, env:runEnv}); let out="", rErr=""; run.stdout.on("data",d=>out+=d); run.stderr.on("data",d=>rErr+=d);
      const killTimer=setTimeout(()=>{try{run.kill();}catch{}; reject(new Error("Time Limit Exceeded (C++ >3s)"));},3500);
      run.on("close", rCode=>{ clearTimeout(killTimer); try{fs.unlinkSync(tmpCpp);}catch{}; try{fs.unlinkSync(exe);}catch{}; if(rCode!==0) return reject(new Error(rErr.trim()||`Runtime exit ${rCode}: ${out}`)); try{ resolve(JSON.parse(out.trim())); }catch{ reject(new Error("Invalid C++ output (not JSON): "+out.trim())) } });
      run.on("error", e=>{ clearTimeout(killTimer); reject(new Error("Run error: "+e.message)); });
    });
  });
}
async function executeQuestion(question, code, language) {
  const testCases=question._testCasesForMode; const results=[]; let passed=0;
  for(const tc of testCases){
    const start=Date.now(); let actual, error=null, ok=false;
    try{
      if(language==="javascript") actual=runJS(code, question, tc.input, tc.expectedOutput);
      else if(language==="python") actual=await runPython(code, question, tc.input, tc.expectedOutput);
      else if(language==="cpp") actual=await runCpp(code, question, tc.input, tc.expectedOutput);
      else throw new Error(`Unsupported language: ${language}`);
      ok=deepEqual(actual, tc.expectedOutput, question.id);
    }catch(e){ error=e.message; if(String(e.message).includes("Script execution timed out")) error="Time Limit Exceeded (JS >2s)"; }
    if(ok) passed++;
    results.push({testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual: error?null:actual, error, hidden: !!tc._hidden, timeMs: Date.now()-start});
  }
  return {total: testCases.length, passed, results};
}
module.exports = { deepEqual, runJS, runPython, runCpp, executeQuestion };
