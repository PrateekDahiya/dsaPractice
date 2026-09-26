// Vanilla Node http server — MySQL + file fallback
const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");
const os = require("os");
let bcrypt = null;
let jwt = null;
try { bcrypt = require("bcryptjs"); } catch (e) { console.warn("bcryptjs not installed, auth will fallback"); }
try { jwt = require("jsonwebtoken"); } catch (e) { console.warn("jsonwebtoken not installed, auth will fallback"); }

// load .env if present (no dotenv dep)
(() => {
  try {
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      });
    }
  } catch {}
})();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const QUESTIONS_DIR = path.join(ROOT, "questions");
let db = null;
try { db = require("./db"); } catch { db = null; }
let dbReady = false;
let useDb = !!db;
let cache = { questions: null, questionsTs: 0, leaderboard: new Map() };
async function ensureDb() {
  if (!useDb || dbReady) return dbReady;
  try {
    await db.initDb();
    await db.migrateFromFiles(QUESTIONS_DIR);
    dbReady = true;
    console.log("DB: connected to", process.env.DB_HOST, "— using MySQL");
  } catch (e) {
    console.warn("DB: init failed, falling back to files:", e.message);
    useDb = false;
  }
  return dbReady;
}

// ---------- auth helpers ----------
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
function hashPassword(password) {
  if (!bcrypt) throw new Error("bcryptjs not available");
  return bcrypt.hashSync(password, 10);
}
function verifyPassword(password, hash) {
  if (!bcrypt) throw new Error("bcryptjs not available");
  return bcrypt.compareSync(password, hash);
}
function signToken(payload) {
  if (!jwt) throw new Error("jsonwebtoken not available");
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
function verifyToken(token) {
  if (!jwt) throw new Error("jsonwebtoken not available");
  return jwt.verify(token, JWT_SECRET);
}
function authenticate(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  if (!h || !h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (!token) return null;
  try {
    const decoded = verifyToken(token);
    req.user = { id: decoded.id, username: decoded.username, role: decoded.role };
    return req.user;
  } catch (e) {
    return null;
  }
}
function tryAuthenticate(req) {
  // optional auth: attach user if token present, else leave null (for backward compat scoping)
  const u = authenticate(req);
  if (u) req.user = u;
  else req.user = null;
  return req.user;
}
function requireAuth(req, res) {
  const u = authenticate(req);
  if (!u) {
    sendJson(res, { error: "Unauthorized" }, 401);
    return null;
  }
  return u;
}

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".txt": "text/plain",
  ".ico": "image/x-icon",
};

// ---------- question loader ----------
function loadQuestionsSync() {
  const files = fs.readdirSync(QUESTIONS_DIR).filter(f => f.endsWith(".json") && !f.startsWith("_"));
  const questions = [];
  for (const file of files) {
    try {
      const full = path.join(QUESTIONS_DIR, file);
      const raw = fs.readFileSync(full, "utf8");
      const q = JSON.parse(raw);
      if (!q.id || !q.title || !q.functionName || !q.params || !q.visibleTestCases) {
        console.warn(`Skipping ${file}: missing required fields`);
        continue;
      }
      const stat = fs.statSync(full);
      q._createdAt = q.createdAt ? new Date(q.createdAt).getTime() : stat.mtimeMs;
      q._file = file;
      questions.push(q);
    } catch (e) {
      console.warn(`Failed to load ${file}: ${e.message}`);
    }
  }
  return questions;
}
async function loadQuestions() {
  if (useDb) {
    await ensureDb();
    if (dbReady) {
      const dbQs = await db.dbLoadQuestions();
      if (dbQs && dbQs.length >= 0) return dbQs;
    }
  }
  return loadQuestionsSync();
}
async function getQuestionById(id) {
  if (useDb) {
    await ensureDb();
    if (dbReady) {
      const q = await db.dbGetQuestion(id);
      if (q) return q;
    }
  }
  return loadQuestionsSync().find(x => x.id === id) || null;
}

function deepEqual(a, b, qId) {
  if (a === b) return true;
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (qId === "two-sum" && a.every(x=>typeof x==="number")) {
      const sa = [...a].sort((x,y)=>x-y);
      const sb = [...b].sort((x,y)=>x-y);
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

// ---------- runners ----------
function runJS(code, question, input, expectedOutput) {
  const fnName = question.functionName;
  const params = question.params;
  const args = params.map(p => JSON.stringify(input[p]));
  const isComposite = expectedOutput && typeof expectedOutput === "object" && !Array.isArray(expectedOutput) && ("k" in expectedOutput);
  const needsMutationFallback = question.id === "reverse-string" || question.id === "move-zeroes" || isComposite;
  let scriptCode;
  if (isComposite) {
    const mutatedParam = params[0];
    scriptCode = `
      ${code}
      let _args = [${args.join(",")}];
      let _ret = ${fnName}.apply(null, _args);
      let _actual = { k: _ret, ${mutatedParam}: _args[0] };
      _actual;
    `;
  } else if (needsMutationFallback) {
    scriptCode = `
      ${code}
      let _args = [${args.join(",")}];
      let _ret = ${fnName}.apply(null, _args);
      if (_ret === undefined) _ret = _args[0];
      _ret;
    `;
  } else {
    scriptCode = `
      ${code}
      ; ${fnName}.apply(null, [${args.join(",")}])
    `;
  }
  const context = vm.createContext({});
  const script = new vm.Script(scriptCode);
  const result = script.runInContext(context, { timeout: 2000 });
  return result;
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
    if (isComposite) {
      driver = `
import json
_ret = ${fnName}(${inputArgs})
_actual = {"k": _ret, "${params[0]}": ${params[0]}}
print(json.dumps(_actual))
`;
    } else if (isReverse) {
      driver = `
import json
_ret = ${fnName}(${inputArgs})
if _ret is None:
    _ret = ${params[0]}
print(json.dumps(_ret))
`;
    } else {
      driver = `
import json
_ret = ${fnName}(${inputArgs})
print(json.dumps(_ret))
`;
    }
    const fileContent = code + "\n" + driver;
    fs.writeFileSync(tmpFile, fileContent, "utf8");
    const py = spawn("python", [tmpFile], { timeout: 3000 });
    let stdout = "", stderr = "";
    py.stdout.on("data", d => stdout += d);
    py.stderr.on("data", d => stderr += d);
    py.on("error", (err) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err.code === "ENOENT") {
        const py3 = spawn("python3", [tmpFile], { timeout: 3000 });
        let s2="", e2="";
        py3.stdout.on("data", d=>s2+=d);
        py3.stderr.on("data", d=>e2+=d);
        py3.on("close", (code2) => {
          try { fs.unlinkSync(tmpFile); } catch {}
          if (code2 !== 0) return reject(new Error(e2 || `python3 exit ${code2}`));
          try { resolve(JSON.parse(s2.trim())); } catch(parseErr){ reject(new Error("Invalid python output: "+s2)) }
        });
        py3.on("error", (e3)=> reject(new Error("python not found: install python3 and ensure 'python' or 'python3' in PATH")));
      } else {
        reject(err);
      }
    });
    py.on("close", (code) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `python exit ${code}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (e) {
        reject(new Error("Invalid python output: " + stdout + " err: " + e.message));
      }
    });
    setTimeout(() => {
      try { py.kill(); } catch {}
      reject(new Error("Time Limit Exceeded (python >3s)"));
    }, 3500);
  });
}

// ---------- C++ runner ----------
function jsonToCppLiteral(val) {
  if (typeof val === "number") {
    return Number.isInteger(val) ? String(val) : String(val);
  }
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "string") return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  if (Array.isArray(val)) {
    if (val.length === 0) return "{}";
    const first = val[0];
    if (typeof first === "number") return "{" + val.join(",") + "}";
    if (typeof first === "string") {
      const allSingle = val.every(s => typeof s === "string" && s.length === 1);
      if (allSingle) return "{" + val.map(s => "'" + s.replace(/'/g, "\\'") + "'").join(",") + "}";
      return "{" + val.map(s => '"' + String(s).replace(/"/g, '\\"') + '"').join(",") + "}";
    }
    if (typeof first === "boolean") return "{" + val.map(b => b ? "true" : "false").join(",") + "}";
    if (Array.isArray(first)) return "{" + val.map(v => jsonToCppLiteral(v)).join(",") + "}";
  }
  if (val === null) return "0";
  return "0";
}
function cppTypeFor(val) {
  if (typeof val === "number") return Number.isInteger(val) ? "int" : "double";
  if (typeof val === "boolean") return "bool";
  if (typeof val === "string") return "string";
  if (Array.isArray(val)) {
    if (val.length === 0) return "vector<int>";
    const f = val[0];
    if (typeof f === "number") return "vector<int>";
    if (typeof f === "string") return f.length === 1 ? "vector<char>" : "vector<string>";
    if (typeof f === "boolean") return "vector<bool>";
    if (Array.isArray(f)) return "vector<" + cppTypeFor(f) + ">";
  }
  return "auto";
}
function runCpp(code, question, input, expectedOutput) {
  return new Promise((resolve, reject) => {
    const fnName = question.cppFunctionName || question.functionName;
    const params = question.params;
    const isReverse = question.id === "reverse-string";
    const isComposite = expectedOutput && typeof expectedOutput === "object" && !Array.isArray(expectedOutput) && ("k" in expectedOutput);
    const decls = params.map(p => {
      const v = input[p];
      const type = cppTypeFor(v);
      const lit = jsonToCppLiteral(v);
      return `${type} ${p} = ${lit};`;
    }).join("\n  ");
    const callArgs = params.join(", ");
    const tmpCpp = path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.cpp`);
    const exe = tmpCpp.replace(/\.cpp$/, os.platform() === "win32" ? ".exe" : ".out");
    const hasInclude = code.includes("#include");
    const header = hasInclude ? "" : '#include <bits/stdc++.h>\nusing namespace std;\n';
    const printHelpers = `
template<typename T> void printJsonVal(const T& v);
void printJsonVal(int v){ cout << v; }
void printJsonVal(double v){ cout << v; }
void printJsonVal(bool v){ cout << (v?"true":"false"); }
void printJsonVal(const string& v){ cout << '"' << v << '"'; }
void printJsonVal(char v){ cout << '"' << v << '"'; }
template<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }
`;
    const isInPlaceVoid = isReverse || question.id === "move-zeroes" || question.id === "move-zero";
    let driver;
    if (isComposite) {
      driver = `
int main(){
  ${decls}
  int _k = ${fnName}(${callArgs});
  cout << "{\\"k\\":" << _k << ",\\"${params[0]}\\":";
  printJsonVal(${params[0]});
  cout << "}" << endl;
  return 0;
}
`;
    } else if (isInPlaceVoid) {
      driver = `
int main(){
  ${decls}
  ${fnName}(${callArgs});
  printJsonVal(${params[0]});
  cout << endl;
  return 0;
}
`;
    } else {
      driver = `
int main(){
  ${decls}
  auto _ret = ${fnName}(${callArgs});
  printJsonVal(_ret);
  cout << endl;
  return 0;
}
`;
    }
    const fileContent = header + "\n" + code + "\n" + printHelpers + "\n" + driver;
    fs.writeFileSync(tmpCpp, fileContent, "utf8");
    const localGpps = [
      path.join(ROOT, "tools", "mingw64", "bin", "g++.exe"),
      path.join(ROOT, "tools", "w64devkit", "bin", "g++.exe"),
      path.join(ROOT, "tools", "gcc", "bin", "g++.exe"),
      "C:\\mingw64\\bin\\g++.exe",
      "C:\\tools\\mingw64\\bin\\g++.exe",
      "C:\\tools\\w64devkit\\bin\\g++.exe",
    ];
    let compiler = "g++";
    for (const p of localGpps) if (fs.existsSync(p)) { compiler = p; break; }
    const compile = spawn(compiler, ["-std=c++17", "-O2", tmpCpp, "-o", exe]);
    let cErr = "";
    compile.stderr.on("data", d => cErr += d);
    compile.on("error", err => {
      try { fs.unlinkSync(tmpCpp); } catch {}
      if (err.code === "ENOENT") return reject(new Error("g++ not found. No bundled compiler at tools/w64devkit/bin/g++.exe and no system g++. Run setup-cpp.ps1 to bundle it (downloads portable w64devkit into project, no admin/PATH needed) OR install MinGW system-wide: https://code.visualstudio.com/docs/cpp/config-mingw"));
      reject(new Error("Compile spawn error: " + err.message));
    });
    compile.on("close", cCode => {
      if (cCode !== 0) {
        try { fs.unlinkSync(tmpCpp); } catch {}
        return reject(new Error("Compile Error:\\n" + cErr));
      }
      const binDir = path.dirname(compiler);
      const runEnv = { ...process.env, PATH: binDir + path.delimiter + process.env.PATH };
      const run = spawn(exe, [], { timeout: 3000, env: runEnv });
      let out = "", rErr = "";
      run.stdout.on("data", d => out += d);
      run.stderr.on("data", d => rErr += d);
      const killTimer = setTimeout(() => { try { run.kill(); } catch {}; reject(new Error("Time Limit Exceeded (C++ >3s)")); }, 3500);
      run.on("close", rCode => {
        clearTimeout(killTimer);
        try { fs.unlinkSync(tmpCpp); } catch {}
        try { fs.unlinkSync(exe); } catch {}
        if (rCode !== 0) return reject(new Error(rErr.trim() || `Runtime exit ${rCode}: ${out}`));
        const trimmed = out.trim();
        try {
          const parsed = JSON.parse(trimmed);
          resolve(parsed);
        } catch {
          reject(new Error("Invalid C++ output (not JSON): " + trimmed));
        }
      });
      run.on("error", e => {
        clearTimeout(killTimer);
        reject(new Error("Run error: " + e.message));
      });
    });
  });
}

async function runPythonBatch(code, question, testCases) {
  const fnName = question.pythonFunctionName || question.functionName;
  const tmpFile = path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const isComposite = testCases[0] && testCases[0].expectedOutput && typeof testCases[0].expectedOutput === "object" && !Array.isArray(testCases[0].expectedOutput) && ("k" in testCases[0].expectedOutput);
  const isReverse = question.id === "reverse-string";
  const casesJson = JSON.stringify(testCases.map(tc => ({ input: tc.input, expected: tc.expectedOutput, id: tc.id })));
  let driver;
  if (isComposite) {
    driver = `
import json, sys
cases = json.loads('''${casesJson.replace(/'/g, "\\'")}''')
for tc in cases:
    inp = tc["input"]
    _ret = ${fnName}(**inp)
    _actual = {"k": _ret, "${question.params[0]}": inp["${question.params[0]}"] if "_ret" is not None else inp["${question.params[0]}"]}
    # handle in-place where _ret is k and inp mutated
    if isinstance(inp["${question.params[0]}"], list) and _ret is not None:
        # for removeDuplicates, inp is mutated by call, need to use the same list object
        pass
    print(json.dumps(_actual))
`;
    // Actually for in-place we need to capture mutated list: we passed inp dict, but function may mutate the list object inside inp
    // So we need to keep reference
    driver = `
import json
cases = json.loads('''${casesJson.replace(/'/g, "\\'")}''')
for tc in cases:
    inp = {k: list(v) if isinstance(v, list) else v for k,v in tc["input"].items()}
    _ret = ${fnName}(**inp)
    _actual = {"k": _ret, "${question.params[0]}": inp["${question.params[0]}"]}
    print(json.dumps(_actual))
`;
  } else if (isReverse) {
    driver = `
import json
cases = json.loads('''${casesJson.replace(/'/g, "\\'")}''')
for tc in cases:
    inp = {k: list(v) if isinstance(v, list) else v for k,v in tc["input"].items()}
    _ret = ${fnName}(**inp)
    if _ret is None:
        _ret = inp["${question.params[0]}"]
    print(json.dumps(_ret))
`;
  } else {
    driver = `
import json
cases = json.loads('''${casesJson.replace(/'/g, "\\'")}''')
for tc in cases:
    _ret = ${fnName}(**tc["input"])
    print(json.dumps(_ret))
`;
  }
  const fileContent = code + "\n" + driver;
  fs.writeFileSync(tmpFile, fileContent, "utf8");
  return new Promise((resolve, reject) => {
    const py = spawn("python", [tmpFile], { timeout: 8000 });
    let stdout="", stderr="";
    py.stdout.on("data", d=> stdout+=d); py.stderr.on("data", d=> stderr+=d);
    py.on("error", err => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err.code === "ENOENT") {
        const py3 = spawn("python3", [tmpFile], { timeout: 8000 });
        let s2="", e2=""; py3.stdout.on("data", d=>s2+=d); py3.stderr.on("data", d=>e2+=d);
        py3.on("close", code2 => { try{fs.unlinkSync(tmpFile);}catch{}; if(code2!==0) return reject(new Error(e2||`python3 exit ${code2}`)); const lines=s2.trim().split("\n").filter(Boolean); try{ resolve(lines.map(l=>JSON.parse(l))); }catch{ reject(new Error("Invalid python batch output: "+s2)) }});
        py3.on("error", ()=> reject(new Error("python not found")));
      } else reject(err);
    });
    py.on("close", code => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code!==0) return reject(new Error(stderr.trim()||`python exit ${code}`));
      const lines = stdout.trim().split("\n").filter(Boolean);
      try { resolve(lines.map(l=>JSON.parse(l))); } catch(e){ reject(new Error("Invalid python batch output: "+stdout)) }
    });
    setTimeout(()=>{ try{py.kill();}catch{}; reject(new Error("Time Limit Exceeded (python >8s)")); },8500);
  });
}

async function runCppBatch(code, question, testCases) {
  const fnName = question.cppFunctionName || question.functionName;
  const params = question.params;
  const isReverse = question.id === "reverse-string";
  const isComposite = testCases[0] && testCases[0].expectedOutput && typeof testCases[0].expectedOutput === "object" && !Array.isArray(testCases[0].expectedOutput) && ("k" in testCases[0].expectedOutput);
  const isInPlaceVoid = isReverse || question.id === "move-zeroes" || question.id === "move-zero";
  // Build batch vectors per param
  const batchDecls = params.map(p => {
    const firstVal = testCases[0].input[p];
    const baseType = cppTypeFor(firstVal);
    const batchType = `vector<${baseType}>`;
    // for vector<int> nums, batch is vector<vector<int>>
    // for int target, batch is vector<int>
    const lits = testCases.map(tc => jsonToCppLiteral(tc.input[p])).join(", ");
    return `${batchType} _batch_${p} = {${lits}};`;
  }).join("\n  ");
  const n = testCases.length;
  const tmpCpp = path.join(os.tmpdir(), `dsa_${Date.now()}_${Math.random().toString(36).slice(2)}.cpp`);
  const exe = tmpCpp.replace(/\.cpp$/, os.platform()==="win32"?".exe":".out");
  const hasInclude = code.includes("#include");
  const header = hasInclude ? "" : '#include <bits/stdc++.h>\nusing namespace std;\n';
  const printHelpers = `\ntemplate<typename T> void printJsonVal(const T& v);\nvoid printJsonVal(int v){ cout << v; }\nvoid printJsonVal(double v){ cout << v; }\nvoid printJsonVal(bool v){ cout << (v?"true":"false"); }\nvoid printJsonVal(const string& v){ cout << '"' << v << '"'; }\nvoid printJsonVal(char v){ cout << '"' << v << '"'; }\ntemplate<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }\n`;
  let driver;
  if (isComposite) {
    driver = `
int main(){
  ${batchDecls}
  for(int i=0;i<${n};i++){
    auto _k = ${fnName}(_batch_${params[0]}[i]${params.length>1 ? ", " + params.slice(1).map(p=>`_batch_${p}[i]`).join(", ") : ""});
    cout << "{\\"k\\":" << _k << ",\\"${params[0]}\\":";
    printJsonVal(_batch_${params[0]}[i]);
    cout << "}";
    if(i+1<${n}) cout << "\\n";
  }
  cout << endl;
  return 0;
}
`;
  } else if (isInPlaceVoid) {
    driver = `
int main(){
  ${batchDecls}
  for(int i=0;i<${n};i++){
    ${fnName}(_batch_${params[0]}[i]${params.length>1 ? ", " + params.slice(1).map(p=>`_batch_${p}[i]`).join(", ") : ""});
    printJsonVal(_batch_${params[0]}[i]);
    if(i+1<${n}) cout << "\\n";
  }
  cout << endl;
  return 0;
}
`;
  } else {
    // generic with multiple params
    const callArgs = params.map(p=>`_batch_${p}[i]`).join(", ");
    driver = `
int main(){
  ${batchDecls}
  for(int i=0;i<${n};i++){
    auto _ret = ${fnName}(${callArgs});
    printJsonVal(_ret);
    if(i+1<${n}) cout << "\\n";
  }
  cout << endl;
  return 0;
}
`;
  }
  const fileContent = header + "\n" + code + "\n" + printHelpers + "\n" + driver;
  fs.writeFileSync(tmpCpp, fileContent, "utf8");
  const localGpps = [path.join(ROOT,"tools","mingw64","bin","g++.exe"),path.join(ROOT,"tools","w64devkit","bin","g++.exe"),path.join(ROOT,"tools","gcc","bin","g++.exe"),"C:\\mingw64\\bin\\g++.exe","C:\\tools\\mingw64\\bin\\g++.exe","C:\\tools\\w64devkit\\bin\\g++.exe"];
  let compiler="g++"; for(const p of localGpps) if(fs.existsSync(p)){compiler=p;break;}
  return new Promise((resolve, reject) => {
    const compile = spawn(compiler, ["-std=c++17","-O0",tmpCpp,"-o",exe]);
    let cErr=""; compile.stderr.on("data",d=>cErr+=d);
    compile.on("error", err=>{ try{fs.unlinkSync(tmpCpp);}catch{}; if(err.code==="ENOENT") return reject(new Error("g++ not found")); reject(new Error("Compile spawn error: "+err.message)); });
    compile.on("close", cCode=>{ if(cCode!==0){ try{fs.unlinkSync(tmpCpp);}catch{}; return reject(new Error("Compile Error:\\n"+cErr)); }
      const binDir=path.dirname(compiler); const runEnv={...process.env, PATH: binDir+path.delimiter+process.env.PATH};
      const run=spawn(exe, [], {timeout:8000, env: runEnv});
      let out="", rErr=""; run.stdout.on("data",d=>out+=d); run.stderr.on("data",d=>rErr+=d);
      const killTimer=setTimeout(()=>{try{run.kill();}catch{}; reject(new Error("Time Limit Exceeded (C++ >8s)"));},8500);
      run.on("close", rCode=>{ clearTimeout(killTimer); try{fs.unlinkSync(tmpCpp);}catch{}; try{fs.unlinkSync(exe);}catch{}; if(rCode!==0) return reject(new Error(rErr.trim()||`Runtime exit ${rCode}: ${out}`)); const lines=out.trim().split("\n").filter(Boolean); try{ resolve(lines.map(l=>JSON.parse(l))); }catch{ reject(new Error("Invalid C++ batch output (not JSON): "+out.trim())) } });
      run.on("error", e=>{ clearTimeout(killTimer); reject(new Error("Run error: "+e.message)); });
    });
  });
}

async function executeQuestion(question, code, language) {
  const testCases = question._testCasesForMode;
  const results = [];
  let passed = 0;
  // batch for cpp/python (compile once), js keep per-case (fast vm)
  if (language === "cpp" && testCases.length > 1) {
    const startAll = Date.now();
    try {
      const actuals = await runCppBatch(code, question, testCases);
      for (let i=0;i<testCases.length;i++) {
        const tc=testCases[i];
        const actual=actuals[i];
        const ok=deepEqual(actual, tc.expectedOutput, question.id);
        if(ok) passed++;
        results.push({testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual, error: null, hidden: !!tc._hidden, timeMs: Math.round((Date.now()-startAll)/testCases.length)});
      }
    } catch (e) {
      const msg=e.message;
      for (const tc of testCases) results.push({testCaseId: tc.id, passed:false, input: tc.input, expected: tc.expectedOutput, actual:null, error: msg, hidden: !!tc._hidden, timeMs: 0});
    }
    return { total: testCases.length, passed, results };
  }
  if (language === "python" && testCases.length > 1) {
    const startAll = Date.now();
    try {
      const actuals = await runPythonBatch(code, question, testCases);
      for (let i=0;i<testCases.length;i++) {
        const tc=testCases[i];
        const actual=actuals[i];
        const ok=deepEqual(actual, tc.expectedOutput, question.id);
        if(ok) passed++;
        results.push({testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual, error: null, hidden: !!tc._hidden, timeMs: Math.round((Date.now()-startAll)/testCases.length)});
      }
    } catch (e) {
      const msg=e.message;
      for (const tc of testCases) results.push({testCaseId: tc.id, passed:false, input: tc.input, expected: tc.expectedOutput, actual:null, error: msg, hidden: !!tc._hidden, timeMs: 0});
    }
    return { total: testCases.length, passed, results };
  }
  for (const tc of testCases) {
    const start = Date.now();
    let actual, error = null;
    let ok = false;
    try {
      if (language === "javascript") {
        actual = runJS(code, question, tc.input, tc.expectedOutput);
      } else if (language === "python") {
        actual = await runPython(code, question, tc.input, tc.expectedOutput);
      } else if (language === "cpp") {
        actual = await runCpp(code, question, tc.input, tc.expectedOutput);
      } else {
        throw new Error(`Unsupported language: ${language}`);
      }
      ok = deepEqual(actual, tc.expectedOutput, question.id);
    } catch (e) {
      error = e.message;
      if (String(e.message).includes("Script execution timed out")) error = "Time Limit Exceeded (JS >2s)";
    }
    if (ok) passed++;
    results.push({
      testCaseId: tc.id,
      passed: ok,
      input: tc.input,
      expected: tc.expectedOutput,
      actual: error ? null : actual,
      error,
      hidden: !!tc._hidden,
      timeMs: Date.now() - start
    });
  }
  return { total: testCases.length, passed, results };
}

// ---------- http helpers ----------
function sendJson(res, obj, status=200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" });
  res.end(body);
}
function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ---------- Auth APIs ----------
  if (pathname === "/api/auth/register" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { username, email, password } = JSON.parse(body || "{}");
        // validation
        if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
          return sendJson(res, { error: "Invalid username: must match ^[a-z0-9_]{3,20}$" }, 400);
        }
        if (email !== undefined && email !== null && String(email).trim() !== "") {
          const em = String(email).trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return sendJson(res, { error: "Invalid email" }, 400);
        }
        if (!password || typeof password !== "string" || password.length < 6) {
          return sendJson(res, { error: "Password must be at least 6 characters" }, 400);
        }
        if (!db) return sendJson(res, { error: "DB not available" }, 500);
        await ensureDb();
        if (!dbReady) return sendJson(res, { error: "DB not ready" }, 500);
        // check existing username
        const existing = await db.findUserByUsername(username);
        if (existing) return sendJson(res, { error: "Username already exists" }, 409);
        if (email) {
          const existingEmail = await db.findUserByEmail(String(email).trim().toLowerCase());
          if (existingEmail) return sendJson(res, { error: "Email already exists" }, 409);
        }
        const hash = hashPassword(password);
        const finalEmail = email && String(email).trim() ? String(email).trim().toLowerCase() : `${username}@placeholder.local`;
        const id = await db.createUser({ username, email: finalEmail, password_hash: hash, role: "user" });
        const user = { id, username, email: finalEmail, role: "user" };
        const token = signToken({ id, username, role: "user" });
        return sendJson(res, { ok: true, token, user }, 201);
      } catch (e) {
        console.error("register error", e);
        if (String(e.message).toLowerCase().includes("duplicate")) return sendJson(res, { error: "Username or email already exists" }, 409);
        return sendJson(res, { error: e.message }, 500);
      }
    });
    return;
  }
  if (pathname === "/api/auth/login" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { username, password } = JSON.parse(body || "{}");
        if (!username || !password) return sendJson(res, { error: "Missing username or password" }, 400);
        if (!db) return sendJson(res, { error: "DB not available" }, 500);
        await ensureDb();
        if (!dbReady) return sendJson(res, { error: "DB not ready" }, 500);
        const userRow = await db.findUserByUsername(username);
        if (!userRow) return sendJson(res, { error: "Invalid credentials" }, 401);
        const ok = verifyPassword(password, userRow.password_hash);
        if (!ok) return sendJson(res, { error: "Invalid credentials" }, 401);
        const user = { id: userRow.id, username: userRow.username, email: userRow.email, role: userRow.role };
        const token = signToken({ id: user.id, username: user.username, role: user.role });
        return sendJson(res, { token, user }, 200);
      } catch (e) {
        console.error("login error", e);
        return sendJson(res, { error: e.message }, 500);
      }
    });
    return;
  }
  if (pathname === "/api/me" && req.method === "GET") {
    const u = requireAuth(req, res);
    if (!u) return;
    try {
      await ensureDb();
      if (dbReady) {
        const row = await db.findUserById(u.id);
        if (!row) return sendJson(res, { error: "User not found" }, 404);
        return sendJson(res, { id: row.id, username: row.username, email: row.email, role: row.role }, 200);
      } else {
        return sendJson(res, u, 200);
      }
    } catch (e) {
      return sendJson(res, { error: e.message }, 500);
    }
  }

  // ---------- Stats / Streaks / Leaderboard APIs ----------
  if (pathname === "/api/questions/solved" && req.method === "GET") {
    tryAuthenticate(req);
    const userId = req.user ? req.user.id : null;
    if (!userId) return sendJson(res, [], 200);
    await ensureDb();
    if (!dbReady || !db.getSolvedIds) return sendJson(res, [], 200);
    try {
      const ids = await db.getSolvedIds(userId);
      return sendJson(res, ids, 200);
    } catch (e) {
      return sendJson(res, { error: e.message }, 500);
    }
  }
  if (pathname === "/api/leaderboard" && req.method === "GET") {
    const filterParam = (url.searchParams.get("filter") || "all").toLowerCase().trim();
    let filter = "all";
    if (["weekly","week","7d","last7"].includes(filterParam)) filter = "weekly";
    else if (["monthly","month","30d","last30"].includes(filterParam)) filter = "monthly";
    else if (filterParam === "all-time" || filterParam === "alltime" || filterParam === "all") filter = "all";
    else filter = filterParam;
    const rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
    const cacheKey = `${filter}:${limit}`;
    const now = Date.now();
    const cached = cache.leaderboard.get(cacheKey);
    if (cached && now - cached.ts < 30000) return sendJson(res, cached.data, 200);
    await ensureDb();
    if (!dbReady || !db.getLeaderboard) return sendJson(res, [], 200);
    try {
      const rows = await db.getLeaderboard(filter, limit);
      cache.leaderboard.set(cacheKey, { data: rows, ts: now });
      return sendJson(res, rows, 200);
    } catch (e) {
      return sendJson(res, { error: e.message }, 500);
    }
  }
  if (pathname.startsWith("/api/users/") && req.method === "GET") {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 4 && (parts[3] === "stats" || parts[3] === "dashboard")) {
      const idPart = decodeURIComponent(parts[2]);
      const action = parts[3];
      tryAuthenticate(req);
      let userId = null;
      if (idPart === "me") {
        if (!req.user) return sendJson(res, { error: "Unauthorized" }, 401);
        userId = req.user.id;
      } else if (/^\d+$/.test(idPart)) {
        userId = parseInt(idPart, 10);
      } else {
        // allow username lookup fallback (optional auth)
        if (req.user) userId = req.user.id;
        else return sendJson(res, { error: "Invalid user id" }, 400);
      }
      await ensureDb();
      if (!dbReady) return sendJson(res, { error: "DB not ready" }, 500);
      try {
        if (action === "stats") {
          const stats = await db.getStats(userId);
          return sendJson(res, stats, 200);
        } else {
          const dash = await db.getUserDashboard(userId);
          return sendJson(res, dash, 200);
        }
      } catch (e) {
        return sendJson(res, { error: e.message }, 500);
      }
    }
  }

  // API — cached 10s for questions
  if (pathname === "/api/questions" && req.method === "GET") {
    const now = Date.now();
    if (cache.questions && now - cache.questionsTs < 10000) {
      return sendJson(res, cache.questions);
    }
    const qs = await loadQuestions();
    qs.sort((a,b)=> (b._createdAt||0) - (a._createdAt||0));
    const summaries = qs.map(q => ({ id: q.id, title: q.title, difficulty: q.difficulty, tags: q.tags || [], createdAt: q.createdAt || new Date(q._createdAt).toISOString(), _createdAt: q._createdAt, addedBy: q.addedBy || null, addedByUsername: q.addedByUsername || null }));
    cache.questions = summaries;
    cache.questionsTs = now;
    return sendJson(res, summaries);
  }
  if (pathname.startsWith("/api/questions/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/questions/".length));
    const q = await getQuestionById(id);
    if (!q) return sendJson(res, { error: "Question not found" }, 404);
    return sendJson(res, q);
  }
  if (pathname === "/api/questions" && req.method === "POST") {
    const u = requireAuth(req, res);
    if (!u) return;
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const q = JSON.parse(body || "{}");
        const errs = [];
        if (!q.id || !/^[a-z0-9-]+$/.test(q.id)) errs.push("id must match ^[a-z0-9-]+$");
        if (!q.title) errs.push("title required");
        if (!["Easy","Medium","Hard"].includes(q.difficulty)) errs.push("difficulty must be Easy/Medium/Hard");
        if (!q.problemStatement) errs.push("problemStatement required");
        if (!q.functionName) errs.push("functionName required");
        if (!Array.isArray(q.params) || q.params.length===0) errs.push("params required");
        if (!q.starterCode || !q.starterCode.javascript) errs.push("starterCode.javascript required");
        if (!Array.isArray(q.visibleTestCases) || q.visibleTestCases.length===0) errs.push("visibleTestCases required");
        if (!Array.isArray(q.hiddenTestCases)) errs.push("hiddenTestCases must be array");
        if (errs.length) return sendJson(res, { error: errs.join("; ") }, 400);
        const allCases = [...q.visibleTestCases, ...q.hiddenTestCases];
        for (const tc of allCases) {
          if (!tc.input) return sendJson(res, { error: `test case ${tc.id} missing input` }, 400);
          for (const p of q.params) if (!(p in tc.input)) return sendJson(res, { error: `test case ${tc.id}: missing param "${p}"` }, 400);
        }
        if (!q.createdAt) q.createdAt = new Date().toISOString();
        q.updatedAt = new Date().toISOString();
        let savedToDb = false;
        if (useDb) {
          await ensureDb();
          if (dbReady) {
            try {
              await db.dbCreateQuestion(q, u.id, u.username);
              savedToDb = true;
              console.log(`DB: Created ${q.id} by ${u.username}`);
            } catch (e) {
              if (String(e.message).includes("Duplicate")) return sendJson(res, { error: `Question id "${q.id}" already exists.` }, 409);
              console.warn("DB save failed, falling back to file:", e.message);
            }
          }
        }
        // also store addedBy in file for backup
        q.addedBy = u.id;
        q.addedByUsername = u.username;
        const filePath = path.join(QUESTIONS_DIR, `${q.id}.json`);
        if (!savedToDb && fs.existsSync(filePath)) return sendJson(res, { error: `Question id "${q.id}" already exists (${q.id}.json). Use different id or delete old file.` }, 409);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, JSON.stringify(q, null, 2), "utf8");
          console.log(`Created ${filePath}`);
        }
        cache.questions = null; // invalidate
        cache.leaderboard.clear();
        return sendJson(res, { ok: true, id: q.id }, 201);
      } catch (e) {
        console.error(e);
        return sendJson(res, { error: "Invalid JSON: " + e.message }, 400);
      }
    });
    return;
  }

  // code autosave (every 10s from frontend) — scoped by user if authenticated
  if (pathname === "/api/code/save" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { questionId, language, code } = JSON.parse(body || "{}");
        if (!questionId || !language || code===undefined) return sendJson(res, { error: "Missing fields" }, 400);
        if (!["cpp","javascript","python"].includes(language)) return sendJson(res, { error: "bad language" }, 400);
        if (code.length > 50000) return sendJson(res, { error: "Too large" }, 400);
        // try optional auth
        tryAuthenticate(req);
        const userId = req.user ? req.user.id : null;
        if (useDb) { await ensureDb(); if (dbReady) await db.dbSaveCode(questionId, language, code, userId); }
        return sendJson(res, { ok: true }, 200);
      } catch (e) { return sendJson(res, { error: e.message }, 500); }
    });
    return;
  }
  if (pathname.startsWith("/api/code/") && req.method === "GET") {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length===4) {
      const qid = decodeURIComponent(parts[2]);
      const lang = decodeURIComponent(parts[3]);
      let code = null;
      tryAuthenticate(req);
      const userId = req.user ? req.user.id : null;
      if (useDb) { await ensureDb(); if (dbReady) code = await db.dbGetCode(qid, lang, userId); }
      if (code !== null) return sendJson(res, { code }, 200);
      return sendJson(res, { code: null }, 200);
    }
    return sendJson(res, { error: "bad path" }, 400);
  }
  // submissions / history — scoped by user if authenticated
  if (pathname === "/api/submissions" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { questionId, language, mode, code, passed, total, results, title } = JSON.parse(body || "{}");
        if (!questionId || !language || !mode || code===undefined) return sendJson(res, { error: "Missing fields" }, 400);
        tryAuthenticate(req);
        const userId = req.user ? req.user.id : null;
        let id=null;
        if (useDb) { await ensureDb(); if (dbReady) id = await db.dbCreateSubmission({questionId, title, language, mode, code, passed, total, results: results||[], userId}); }
        cache.leaderboard.clear();
        if (userId && db.clearStatsCache) db.clearStatsCache(userId);
        return sendJson(res, { ok:true, id }, 201);
      } catch (e) { return sendJson(res, { error: e.message }, 500); }
    });
    return;
  }
  if (pathname === "/api/submissions" && req.method === "GET") {
    const qid = url.searchParams.get("questionId");
    const limit = parseInt(url.searchParams.get("limit")||"50",10);
    let rows=[];
    tryAuthenticate(req);
    const userId = req.user ? req.user.id : null;
    if (useDb) { await ensureDb(); if (dbReady) rows = await db.dbGetSubmissions(qid||null, Math.min(limit,100), userId); }
    return sendJson(res, rows, 200);
  }
  // Manual mark-as-done (override for wrong test cases)
  if (pathname === "/api/manual-solved" && req.method === "GET") {
    const u = requireAuth(req, res);
    if (!u) return;
    try {
      await ensureDb();
      const ids = db.getManualSolvedIds ? await db.getManualSolvedIds(u.id) : [];
      return sendJson(res, ids, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  if (pathname.match(/^\/api\/questions\/[^/]+\/mark-done$/) && (req.method === "POST" || req.method === "DELETE")) {
    const u = requireAuth(req, res);
    if (!u) return;
    const parts = pathname.split("/").filter(Boolean);
    const qid = decodeURIComponent(parts[2]);
    try {
      await ensureDb();
      if (!dbReady) return sendJson(res, { error: "DB not ready" }, 500);
      const q = await getQuestionById(qid);
      if (!q) return sendJson(res, { error: "Question not found" }, 404);
      if (req.method === "POST") {
        await db.markDone(u.id, qid);
        cache.leaderboard.clear();
        if (db.clearStatsCache) db.clearStatsCache(u.id);
        return sendJson(res, { ok: true, marked: true }, 200);
      } else {
        await db.unmarkDone(u.id, qid);
        cache.leaderboard.clear();
        if (db.clearStatsCache) db.clearStatsCache(u.id);
        return sendJson(res, { ok: true, marked: false }, 200);
      }
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  // Streaming execute — sends each test case as it finishes (SSE-like NDJSON)
  if (pathname === "/api/execute/stream" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { questionId, code, language, mode } = JSON.parse(body || "{}");
        if (!questionId || !code || !language || !mode) { res.writeHead(400, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"Missing fields"})); }
        if (!["run","submit"].includes(mode) || !["javascript","python","cpp"].includes(language) || code.length>50000) { res.writeHead(400, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"bad request"})); }
        const q = await getQuestionById(questionId);
        if (!q) { res.writeHead(404, {"Content-Type":"application/json"}); return res.end(JSON.stringify({error:"Question not found"})); }
        const visible = q.visibleTestCases.map(tc=>({...tc,_hidden:false}));
        const hidden = q.hiddenTestCases.map(tc=>({...tc,_hidden:true}));
        q._testCasesForMode = mode==="run"?visible:[...visible,...hidden];
        const testCases = q._testCasesForMode;
        res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","Access-Control-Allow-Origin":"*"});
        res.write(`event: start\ndata: ${JSON.stringify({mode, total:testCases.length})}\n\n`);
        // Use batch for cpp/python but stream per case after batch returns? For true streaming, run per-case and flush each.
        // For JS, per-case is already fast. For cpp/python batch, we still get all at once, so we simulate streaming by iterating after batch.
        // To keep streaming granular, we run per-case sequentially and flush each.
        let passed=0;
        const sendOne = (tc, actual, error, timeMs) => {
          const ok = !error && deepEqual(actual, tc.expectedOutput, q.id);
          if(ok) passed++;
          const payload = { testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual: error?null:actual, error, hidden: !!tc._hidden, timeMs };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          return ok;
        };
        if (language==="javascript") {
          for(const tc of testCases){
            const start=Date.now(); let actual, err=null;
            try{ actual=runJS(code,q,tc.input,tc.expectedOutput); }catch(e){ err=e.message; if(String(e.message).includes("Script execution timed out")) err="Time Limit Exceeded (JS >2s)"; }
            sendOne(tc, actual, err, Date.now()-start);
          }
        } else if (language==="python") {
          // Stream Python per-case with flush for true streaming
          try{
            const tmpFile = path.join(os.tmpdir(), `dsa_stream_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
            const fnName = q.pythonFunctionName || q.functionName;
            const casesJson = JSON.stringify(testCases.map(tc=>({input:tc.input})));
            const isComposite = testCases[0] && testCases[0].expectedOutput && typeof testCases[0].expectedOutput==="object" && !Array.isArray(testCases[0].expectedOutput) && ("k" in testCases[0].expectedOutput);
            const isReverse = q.id==="reverse-string";
            let driver;
            if(isComposite) driver = `\nimport json,sys\ncases=json.loads('''${casesJson.replace(/'/g,"\\'")}''')\nfor tc in cases:\n    inp={k: list(v) if isinstance(v,list) else v for k,v in tc["input"].items()}\n    _ret=${fnName}(**inp)\n    print(json.dumps({"k":_ret,"${q.params[0]}": inp["${q.params[0]}"]}), flush=True)\n`;
            else if(isReverse) driver = `\nimport json\ncases=json.loads('''${casesJson.replace(/'/g,"\\'")}''')\nfor tc in cases:\n    inp={k: list(v) if isinstance(v,list) else v for k,v in tc["input"].items()}\n    _ret=${fnName}(**inp)\n    if _ret is None: _ret=inp["${q.params[0]}"]\n    print(json.dumps(_ret), flush=True)\n`;
            else driver = `\nimport json\ncases=json.loads('''${casesJson.replace(/'/g,"\\'")}''')\nfor tc in cases:\n    _ret=${fnName}(**tc["input"])\n    print(json.dumps(_ret), flush=True)\n`;
            fs.writeFileSync(tmpFile, code+"\n"+driver, "utf8");
            const py = spawn("python", [tmpFile]);
            let stderr=""; py.stderr.on("data",d=>stderr+=d);
            py.on("error", async()=>{ try{ const py3=spawn("python3",[tmpFile]); let out=""; py3.stdout.on("data",d=>{ const lines=d.toString().split("\n").filter(Boolean); for(const line of lines){ try{ const actual=JSON.parse(line); const tc=testCases.shift(); if(tc) sendOne(tc, actual, null, 0); }catch{} } }); py3.on("close",c=>{ try{fs.unlinkSync(tmpFile);}catch{}; if(c!==0) for(const tc of testCases) sendOne(tc,null,"python3 error "+c,0); }); }catch{} });
            let outBuf=""; py.stdout.on("data", d=>{
              outBuf+=d.toString();
              let lines=outBuf.split("\n");
              outBuf=lines.pop();
              for(const line of lines){ if(!line.trim()) continue; try{ const actual=JSON.parse(line); const tc=testCases.shift(); if(tc) sendOne(tc, actual, null, 0); }catch(e){} }
            });
            await new Promise((res,rej)=>{ py.on("close", c=>{ try{fs.unlinkSync(tmpFile);}catch{}; if(outBuf.trim()){ try{ const actual=JSON.parse(outBuf.trim()); const tc=testCases.shift(); if(tc) sendOne(tc, actual, null, 0); }catch{} } if(c!==0 && c!==null) { /* already handled */ } res(); }); py.on("error", rej); });
          }catch(e){ for(const tc of testCases) sendOne(tc, null, e.message, 0); }
        } else if (language==="cpp") {
          // Compile once, then stream each case as exe prints (endl flushes)
          try{
            const fnName = q.cppFunctionName || q.functionName;
            const params = q.params;
            const isReverse = q.id==="reverse-string";
            const isCompositeSample = testCases[0] && testCases[0].expectedOutput && typeof testCases[0].expectedOutput==="object" && !Array.isArray(testCases[0].expectedOutput) && ("k" in testCases[0].expectedOutput);
            const isInPlaceVoid = isReverse || q.id==="move-zeroes";
            const batchDecls = params.map(p=>{
              const firstVal = testCases[0].input[p];
              const baseType = cppTypeFor(firstVal);
              return `vector<${baseType}> _batch_${p} = {${testCases.map(tc=>jsonToCppLiteral(tc.input[p])).join(", ")}};`;
            }).join("\n  ");
            const n = testCases.length;
            const hasInclude = code.includes("#include");
            const header = hasInclude ? "" : '#include <bits/stdc++.h>\nusing namespace std;\n';
            const printHelpers = `\ntemplate<typename T> void printJsonVal(const T& v);\nvoid printJsonVal(int v){ cout << v; }\nvoid printJsonVal(double v){ cout << v; }\nvoid printJsonVal(bool v){ cout << (v?"true":"false"); }\nvoid printJsonVal(const string& v){ cout << '"' << v << '"'; }\nvoid printJsonVal(char v){ cout << '"' << v << '"'; }\ntemplate<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }\n`;
            let driver;
            const idxSupport = `int _s=0,_e=${n}; if(argc>1){_s=atoi(argv[1]); _e=_s+1; if(_s<0||_s>=${n}) return 0;}`;
            if(isCompositeSample){
              driver=`\nint main(int argc, char** argv){\n  ${batchDecls}\n  ${idxSupport}\n  for(int i=_s;i<_e;i++){\n    auto _k = ${fnName}(_batch_${params[0]}[i]${params.length>1?", "+params.slice(1).map(p=>`_batch_${p}[i]`).join(", "):""});\n    cout << "{\\"k\\":" << _k << ",\\"${params[0]}\\" :"; printJsonVal(_batch_${params[0]}[i]); cout << "}" << endl;\n  }\n  return 0;\n}\n`;
            } else if(isInPlaceVoid){
              driver=`\nint main(int argc, char** argv){\n  ${batchDecls}\n  ${idxSupport}\n  for(int i=_s;i<_e;i++){\n    ${fnName}(_batch_${params[0]}[i]${params.length>1?", "+params.slice(1).map(p=>`_batch_${p}[i]`).join(", "):""});\n    printJsonVal(_batch_${params[0]}[i]); cout << endl;\n  }\n  return 0;\n}\n`;
            } else {
              const callArgs=params.map(p=>`_batch_${p}[i]`).join(", ");
              driver=`\nint main(int argc, char** argv){\n  ${batchDecls}\n  ${idxSupport}\n  for(int i=_s;i<_e;i++){\n    auto _ret = ${fnName}(${callArgs});\n    printJsonVal(_ret); cout << endl;\n  }\n  return 0;\n}\n`;
            }
            const crypto = require("crypto");
            const hash = crypto.createHash("sha256").update(code+"|"+q.id+"|"+mode+"|v2-index").digest("hex").slice(0,16);
            const cacheDir = path.join(os.tmpdir(), "dsa_cache");
            try{fs.mkdirSync(cacheDir,{recursive:true});}catch{}
            const exe=path.join(cacheDir, `dsa_${hash}.exe`);
            const tmpCpp=path.join(os.tmpdir(), `dsa_stream_${Date.now()}_${Math.random().toString(36).slice(2)}.cpp`);
            const localGpps=[path.join(ROOT,"tools","mingw64","bin","g++.exe"),"C:\\mingw64\\bin\\g++.exe","C:\\tools\\mingw64\\bin\\g++.exe","g++"];
            let compiler="g++"; for(const p of localGpps) if(fs.existsSync(p)){compiler=p;break;}
            let cacheHit = fs.existsSync(exe);
            if(!cacheHit){
              fs.writeFileSync(tmpCpp, header+"\n"+code+"\n"+printHelpers+"\n"+driver, "utf8");
              let cErr="";
              await new Promise((res,rej)=>{
                const comp=spawn(compiler, ["-std=c++17","-O0",tmpCpp,"-o",exe]);
                comp.stderr.on("data",d=>cErr+=d);
                comp.on("close",c=>c===0?res():rej(new Error("Compile Error:\\n"+cErr)));
                comp.on("error",e=>rej(new Error("Compile spawn error: "+e.message)));
              });
              try{fs.unlinkSync(tmpCpp);}catch{}
            } else {
              try{fs.unlinkSync(tmpCpp);}catch{}
            }
            const binDir=path.dirname(compiler);
            const runEnv={...process.env, PATH: binDir+path.delimiter+process.env.PATH};
            const run=spawn(exe, [], {env: runEnv});
            let outBuf="", rErr="";
            let idx=0;
            const t0=Date.now();
            run.stdout.on("data", d=>{
              outBuf+=d.toString();
              let lines=outBuf.split("\n");
              outBuf=lines.pop();
              for(const line of lines){
                if(!line.trim()) continue;
                try{
                  const actual=JSON.parse(line);
                  const tc=testCases[idx++];
                  if(tc) sendOne(tc, actual, null, Date.now()-t0);
                }catch{}
              }
            });
            run.stderr.on("data",d=>rErr+=d);
            await new Promise((res,rej)=>{
              const kill=setTimeout(()=>{try{run.kill();}catch{}; rej(new Error("Time Limit Exceeded"));},8000);
              run.on("close",c=>{
                clearTimeout(kill);
                if(outBuf.trim() && idx<testCases.length){
                  try{ const actual=JSON.parse(outBuf.trim()); const tc=testCases[idx++]; if(tc) sendOne(tc, actual, null, Date.now()-t0); }catch{}
                }
                // keep cached exe for reruns (do NOT delete)
                if(c!==0 && idx<testCases.length){
                  // remaining cases failed
                  for(let j=idx;j<testCases.length;j++) sendOne(testCases[j], null, rErr||`exit ${c}`, 0);
                }
                res();
              });
              run.on("error",rej);
            });
          }catch(e){
            for(const tc of testCases) sendOne(tc, null, e.message, 0);
          }
        }
        res.write(`event: done\ndata: ${JSON.stringify({passed, total:testCases.length})}\n\n`);
        res.end();
      } catch(e){ try{ res.writeHead(500, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); }catch{} }
    });
    return;
  }
  // Per-testcase API — UI calls once per case, renders immediately without waiting for all
  if (pathname === "/api/execute/case" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { questionId, code, language, mode, index } = JSON.parse(body || "{}");
        if (!questionId || !code || !language || !mode || index===undefined) return sendJson(res, { error: "Missing fields: questionId, code, language, mode, index" }, 400);
        if (!["run","submit"].includes(mode) || !["javascript","python","cpp"].includes(language) || code.length>50000) return sendJson(res, { error: "bad request" }, 400);
        const q = await getQuestionById(questionId);
        if (!q) return sendJson(res, { error: "Question not found" }, 404);
        const visible = q.visibleTestCases.map(tc=>({...tc,_hidden:false}));
        const hidden = (q.hiddenTestCases||[]).map(tc=>({...tc,_hidden:true}));
        const all = mode==="run"?visible:[...visible,...hidden];
        const tc = all[index];
        if (!tc) return sendJson(res, { error: "bad index" }, 400);
        const start = Date.now();
        let actual=null, error=null, ok=false;
        try{
          if(language==="javascript") actual=runJS(code,q,tc.input,tc.expectedOutput);
          else if(language==="python") actual=await runPython(code,q,tc.input,tc.expectedOutput);
          else if(language==="cpp"){
            // reuse cached batch exe with index arg (compile once, run single)
            const crypto=require("crypto");
            const hash=crypto.createHash("sha256").update(code+"|"+q.id+"|"+mode+"|v2-index").digest("hex").slice(0,16);
            const cacheDir=path.join(os.tmpdir(),"dsa_cache");
            try{fs.mkdirSync(cacheDir,{recursive:true});}catch{}
            const exe=path.join(cacheDir,`dsa_${hash}.exe`);
            if(!fs.existsSync(exe)){
              // compile batch exe on-demand (same driver as stream, with index support)
              const fnName=q.cppFunctionName||q.functionName;
              const params=q.params;
              const batchDecls=params.map(p=>{ const v=all[0].input[p]; return `vector<${cppTypeFor(v)}> _batch_${p} = {${all.map(t=>jsonToCppLiteral(t.input[p])).join(", ")}};`; }).join("\n  ");
              const n=all.length;
              const hasInclude=code.includes("#include");
              const header=hasInclude?"":'#include <bits/stdc++.h>\nusing namespace std;\n';
              const printHelpers=`\ntemplate<typename T> void printJsonVal(const T& v);\nvoid printJsonVal(int v){ cout << v; }\nvoid printJsonVal(double v){ cout << v; }\nvoid printJsonVal(bool v){ cout << (v?"true":"false"); }\nvoid printJsonVal(const string& v){ cout << '"' << v << '"'; }\nvoid printJsonVal(char v){ cout << '"' << v << '"'; }\ntemplate<typename T> void printJsonVal(const vector<T>& v){ cout << "["; for(size_t i=0;i<v.size();++i){ if(i) cout << ","; printJsonVal(v[i]); } cout << "]"; }\n`;
              const isComp=all[0].expectedOutput && typeof all[0].expectedOutput==="object" && !Array.isArray(all[0].expectedOutput) && ("k" in all[0].expectedOutput);
              const isInP=q.id==="reverse-string"||q.id==="move-zeroes";
              const idxSup=`int _s=0,_e=${n}; if(argc>1){_s=atoi(argv[1]); _e=_s+1; if(_s<0||_s>=${n}) return 0;}`;
              let driver;
              if(isComp) driver=`\nint main(int argc,char**argv){\n ${batchDecls}\n ${idxSup}\n for(int i=_s;i<_e;i++){ auto _k=${fnName}(_batch_${params[0]}[i]); cout<<"{\\"k\\":"<<_k<<",\\"${params[0]}\\":"; printJsonVal(_batch_${params[0]}[i]); cout<<"}"<<endl; } return 0;}\n`;
              else if(isInP) driver=`\nint main(int argc,char**argv){\n ${batchDecls}\n ${idxSup}\n for(int i=_s;i<_e;i++){ ${fnName}(_batch_${params[0]}[i]); printJsonVal(_batch_${params[0]}[i]); cout<<endl; } return 0;}\n`;
              else driver=`\nint main(int argc,char**argv){\n ${batchDecls}\n ${idxSup}\n for(int i=_s;i<_e;i++){ auto _ret=${fnName}(${params.map(p=>`_batch_${p}[i]`).join(", ")}); printJsonVal(_ret); cout<<endl; } return 0;}\n`;
              const tmpCpp=path.join(os.tmpdir(),`dsa_case_${Date.now()}.cpp`);
              fs.writeFileSync(tmpCpp, header+"\n"+code+"\n"+printHelpers+"\n"+driver, "utf8");
              const localGpps=[path.join(ROOT,"tools","mingw64","bin","g++.exe"),"C:\\mingw64\\bin\\g++.exe","g++"];
              let compiler="g++"; for(const p of localGpps) if(fs.existsSync(p)){compiler=p;break;}
              let cErr="";
              await new Promise((rs,rj)=>{ const c=spawn(compiler,["-std=c++17","-O0",tmpCpp,"-o",exe]); c.stderr.on("data",d=>cErr+=d); c.on("close",cc=>cc===0?rs():rj(new Error("Compile Error:\\n"+cErr))); c.on("error",e=>rj(new Error("Compile spawn: "+e.message))); });
              try{fs.unlinkSync(tmpCpp);}catch{}
            }
            const binDir=path.dirname(fs.existsSync("C:\\mingw64\\bin\\g++.exe")?"C:\\mingw64\\bin\\g++.exe":"g++");
            // find actual compiler dir for DLLs
            let cdir="C:\\mingw64\\bin"; try{ if(!fs.existsSync(exe)) throw 0; }catch{}
            const runEnv={...process.env, PATH: cdir+path.delimiter+process.env.PATH};
            const out=await new Promise((rs,rj)=>{
              const r=spawn(exe,[String(index)],{env:runEnv});
              let o="",e=""; r.stdout.on("data",d=>o+=d); r.stderr.on("data",d=>e+=d);
              const t=setTimeout(()=>{try{r.kill();}catch{}; rj(new Error("Time Limit Exceeded"));},3000);
              r.on("close",c=>{clearTimeout(t); if(c!==0) return rj(new Error(e||`exit ${c}`)); try{rs(JSON.parse(o.trim().split("\n")[0]));}catch{ rj(new Error("Invalid output: "+o)); }});
              r.on("error",rj);
            });
            actual=out;
          } else throw new Error("bad lang");
          ok=deepEqual(actual, tc.expectedOutput, q.id);
        }catch(e){ error=e.message; if(String(e.message).includes("Script execution timed out")) error="Time Limit Exceeded (JS >2s)"; }
        return sendJson(res, { testCaseId: tc.id, passed: ok, input: tc.input, expected: tc.expectedOutput, actual: error?null:actual, error, hidden: !!tc._hidden, timeMs: Date.now()-start, index }, 200);
      }catch(e){ return sendJson(res, { error: e.message }, 500); }
    });
    return;
  }
  if (pathname === "/api/lint" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { code, language } = JSON.parse(body || "{}");
        if (code === undefined || !language) return sendJson(res, { error: "Missing fields: code, language" }, 400);
        if (!["javascript", "python", "cpp"].includes(language)) return sendJson(res, { error: "bad language" }, 400);
        if (code.length > 50000) return sendJson(res, { error: "Code too large (max 50k)" }, 400);
        const { lint } = require("./server/utils/lint");
        const diagnostics = await lint(code, language, ROOT);
        return sendJson(res, { diagnostics }, 200);
      } catch (e) {
        return sendJson(res, { error: e.message }, 500);
      }
    });
    return;
  }
  if (pathname === "/api/methods" && req.method === "GET") {
    const language = (url.searchParams.get("language") || "").toLowerCase();
    const q = (url.searchParams.get("q") || "").trim();
    const lim = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "10", 10) || 10, 1), 200);
    if (!["cpp", "javascript", "python"].includes(language)) return sendJson(res, { error: "bad language" }, 400);
    try {
      await ensureDb();
      if (!dbReady) return sendJson(res, [], 200);
      const rows = await db.searchMethods(language, q, lim);
      return sendJson(res, rows, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  if (pathname.match(/^\/api\/methods\/[^/]+\/[^/]+$/) && req.method === "GET") {
    const parts = pathname.split("/").filter(Boolean);
    const language = decodeURIComponent(parts[2]).toLowerCase();
    const name = decodeURIComponent(parts[3]);
    try {
      await ensureDb();
      if (!dbReady) return sendJson(res, null, 200);
      const row = await db.getMethodDoc(language, name);
      return sendJson(res, row, 200);
    } catch (e) { return sendJson(res, { error: e.message }, 500); }
  }
  if (pathname === "/api/execute" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { questionId, code, language, mode } = JSON.parse(body || "{}");
        if (!questionId || !code || !language || !mode) return sendJson(res, { error: "Missing fields: questionId, code, language, mode" }, 400);
        if (!["run","submit"].includes(mode)) return sendJson(res, { error: "mode must be run or submit" }, 400);
        if (!["javascript","python","cpp"].includes(language)) return sendJson(res, { error: "language must be javascript, python or cpp" }, 400);
        if (code.length > 50000) return sendJson(res, { error: "Code too large (max 50k)" }, 400);
        const q = await getQuestionById(questionId);
        if (!q) return sendJson(res, { error: "Question not found" }, 404);
        const visible = q.visibleTestCases.map(tc => ({ ...tc, _hidden: false }));
        const hidden = (q.hiddenTestCases||[]).map(tc => ({ ...tc, _hidden: true }));
        q._testCasesForMode = mode === "run" ? visible : [...visible, ...hidden];
        const result = await executeQuestion(q, code, language);
        return sendJson(res, { mode, ...result });
      } catch (e) {
        console.error(e);
        return sendJson(res, { error: e.message }, 500);
      }
    });
    return;
  }

  // Default route → dashboard (app must open on dashboard)
  if (pathname === "/" ) {
    return sendFile(res, path.join(ROOT, "dashboard.html"));
  }
  // Static
  let filePath = path.join(ROOT, pathname === "/" ? "dashboard.html" : pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {}
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendFile(res, filePath);
  }
  if (!pathname.startsWith("/api/")) {
    return sendFile(res, path.join(ROOT, "index.html"));
  }
  res.writeHead(404); res.end("Not found");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} already in use. Kill old process or run: PORT=3001 node server.js`);
    console.error(`On Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F`);
    process.exit(1);
  } else {
    console.error(err);
    process.exit(1);
  }
});
server.listen(PORT, async () => {
  await ensureDb();
  const qs = await loadQuestions();
  console.log(`DSA Practice running at http://localhost:${PORT}`);
  console.log(`Questions: ${qs.length} loaded from ${useDb && dbReady ? "MySQL "+process.env.DB_HOST : QUESTIONS_DIR}`);
  // warm g++ (Hikari-like: keep compiler ready, 2 workers conceptually)
  try{
    const { spawn: _sp } = require("child_process");
    const _c = _sp("C:\\mingw64\\bin\\g++.exe", ["--version"]);
    _c.on("close",()=>console.log("g++ warmed (C:\\mingw64)"));
    _c.on("error",()=>{ const _c2=_sp("g++",["--version"]); _c2.on("close",()=>console.log("g++ warmed (PATH)")); });
  }catch{}
  try{ const { getCompilePool } = require("./server/utils/compilePool"); getCompilePool(); }catch(e){ console.warn("compile pool warmup skipped", e.message); }
});
