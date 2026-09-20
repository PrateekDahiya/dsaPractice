const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

// Hikari-like pool for g++: 2 always-ready workers
class CompilePool {
  constructor(size = 2) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.init();
  }
  init() {
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(`
        const { parentPort } = require('worker_threads');
        const { spawn } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        parentPort.on('message', async (task) => {
          const { id, code, args } = task;
          try {
            const tmpCpp = path.join(os.tmpdir(), \`dsa_w_\${id}.cpp\`);
            const exe = tmpCpp.replace(/\\.cpp$/, os.platform()==="win32"?".exe":".out");
            fs.writeFileSync(tmpCpp, code, 'utf8');
            const localGpps = [path.join(process.cwd(),"tools","mingw64","bin","g++.exe"),"C:\\\\mingw64\\\\bin\\\\g++.exe", "g++"];
            let compiler="g++"; for(const p of localGpps) if(fs.existsSync(p)){compiler=p;break;}
            const { spawn } = require('child_process');
            await new Promise((res,rej)=>{
              const c=spawn(compiler, ["-std=c++17","-O0",tmpCpp,"-o",exe]);
              let e=""; c.stderr.on("data",d=>e+=d);
              c.on("close", cc=> cc===0?res():rej(new Error(e)));
              c.on("error",rej);
            });
            parentPort.postMessage({ id, ok: true, exe });
          } catch (e) {
            parentPort.postMessage({ id, ok: false, error: e.message });
          }
        });
      `, { eval: true });
      w.busy = false;
      this.workers.push(w);
    }
    console.log(`Compile pool warmed: ${this.size} workers ready (Hikari-like for g++)`);
  }
  async compile(code) {
    const worker = this.workers.find(w => !w.busy) || await this.waitForFree();
    worker.busy = true;
    const id = Date.now() + Math.random();
    return new Promise((res, rej) => {
      const handler = (msg) => {
        if (msg.id !== id) return;
        worker.off('message', handler);
        worker.busy = false;
        this.drainQueue();
        if (msg.ok) res(msg.exe); else rej(new Error(msg.error));
      };
      worker.on('message', handler);
      worker.postMessage({ id, code });
    });
  }
  waitForFree() {
    return new Promise(res => this.queue.push(res));
  }
  drainQueue() {
    if (this.queue.length) {
      const next = this.queue.shift();
      const w = this.workers.find(x => !x.busy);
      if (w) next(w);
    }
  }
}

let pool = null;
function getCompilePool() {
  if (!pool) pool = new CompilePool(2);
  return pool;
}

module.exports = { getCompilePool };
