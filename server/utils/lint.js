const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { spawn } = require('child_process');

function resolveCompiler(ROOT) {
  const localGpps = [
    path.join(ROOT, 'tools', 'mingw64', 'bin', 'g++.exe'),
    path.join(ROOT, 'tools', 'w64devkit', 'bin', 'g++.exe'),
    path.join(ROOT, 'tools', 'gcc', 'bin', 'g++.exe'),
    'C:\\mingw64\\bin\\g++.exe',
    'C:\\tools\\mingw64\\bin\\g++.exe',
    'C:\\tools\\w64devkit\\bin\\g++.exe',
  ];
  for (const p of localGpps) { try { if (fs.existsSync(p)) return p; } catch {} }
  return 'g++';
}

function getPchPath() {
  return path.join(os.tmpdir(), 'dsa_pch_v2', 'bits', 'stdc++.h.gch');
}

function pchDir() {
  return path.join(os.tmpdir(), 'dsa_pch_v2');
}

// Returns ['-I', <pchDir>] when a usable PCH exists and PCH is enabled,
// else null. (-I is the GCC mechanism: #include <bits/stdc++.h> then finds
// the .gch first. -include-pch is Clang-only and fatals under GCC.)
function pchArgsUsable() {
  if (process.env.ENABLE_PCH !== '1') return null;
  try { if (!fs.existsSync(getPchPath())) return null; } catch { return null; }
  return ['-I', pchDir()];
}

function isPchAvailable() {
  try { return fs.existsSync(getPchPath()); } catch { return false; }
}

// Generate bits precompiled header once (called non-blocking at server startup).
// Output: <os.tmpdir()>/dsa_pch_v2/bits/stdc++.h.gch via
//   g++ -std=c++17 -x c++-header <bits/stdc++.h> -o <gch>
// bits path resolved via `g++ -print-file-name=bits/stdc++.h` with fallback
// to a temp header containing `#include <bits/stdc++.h>`. Failures swallowed (null).
async function ensureBitsPch(ROOT) {
  try {
    const gchPath = getPchPath();
    try { if (fs.existsSync(gchPath)) return gchPath; } catch {}
    const compiler = resolveCompiler(ROOT);
    try { fs.mkdirSync(path.dirname(gchPath), { recursive: true }); } catch {}
    // 1) resolve real bits header path
    let bitsPath = null;
    try {
      const r = await runCmd(compiler, ['-print-file-name=bits/stdc++.h'], 8000);
      const out = String((r && r.out) || '').trim().split('\n')[0].trim();
      if (out) {
        let candidate = out;
        // some mingw builds print with CR; already trimmed
        try {
          if (path.isAbsolute(candidate) && fs.existsSync(candidate)) bitsPath = candidate;
          else if (!path.isAbsolute(candidate)) bitsPath = null; // not found -> fallback
          else bitsPath = null;
        } catch { bitsPath = null; }
      }
    } catch { bitsPath = null; }
    if (bitsPath) {
      try {
        // NOTE: -O0 matches the flags used at compile time (GCC requires the
        // PCH to be built with compatible options to be picked up).
        const r2 = await runCmd(compiler, ['-std=c++17', '-O0', '-x', 'c++-header', bitsPath, '-o', gchPath], 120000);
        if (r2 && r2.code === 0) {
          try { if (fs.existsSync(gchPath)) return verifyFreshPch(compiler, gchPath); } catch {}
        }
      } catch {}
      // fall through to fallback header on failure
    }
    // 2) fallback: temp header with #include <bits/stdc++.h>
    const tmpH = path.join(os.tmpdir(), `dsa_pch_fallback_${Date.now()}.h`);
    try {
      fs.writeFileSync(tmpH, '#include <bits/stdc++.h>\n', 'utf8');
      const r3 = await runCmd(compiler, ['-std=c++17', '-O0', '-x', 'c++-header', tmpH, '-o', gchPath], 120000);
      if (r3 && r3.code === 0) {
        try { if (fs.existsSync(gchPath)) return verifyFreshPch(compiler, gchPath); } catch {}
      }
    } catch {} finally {
      try { fs.unlinkSync(tmpH); } catch {}
    }
    try { if (fs.existsSync(gchPath)) return gchPath; } catch {}
    return null;
  } catch {
    return null;
  }
}

// Sanity-check a freshly built GCH with a trivial TU using the same flags as
// real compiles. On failure the GCH is deleted: a poisoned .gch sitting in the
// -I path would otherwise break every future compile that auto-picks it.
// Returns the path on success, null on failure.
async function verifyFreshPch(compiler, gchPath) {
  const t0 = Date.now();
  try {
    if (!fs.existsSync(gchPath)) return null;
    const dir = path.dirname(path.dirname(gchPath));
    const tmp = path.join(os.tmpdir(), `dsa_pchtest_${Date.now()}.cpp`);
    fs.writeFileSync(tmp, '#include <bits/stdc++.h>\nint main(){std::vector<int> v;return (int)v.size();}\n', 'utf8');
    const r = await runCmd(compiler, ['-std=c++17', '-O0', '-I', dir, '-fsyntax-only', tmp], 60000);
    try { fs.unlinkSync(tmp); } catch {}
    if (!r || r.code !== 0) {
      try { fs.unlinkSync(gchPath); } catch {}
      console.warn('PCH self-test failed, .gch discarded:', String((r && (r.err || r.out)) || 'no output').split('\n')[0].slice(0, 200));
      return null;
    }
    console.log(`PCH self-test passed in ${Date.now() - t0}ms`);
    return gchPath;
  } catch (e) {
    try { fs.unlinkSync(gchPath); } catch {}
    return null;
  }
}

// Lightweight static hints for wrong-method usage (no execution)
function staticHints(code, language) {
  const out = [];
  const lines = code.split('\n');
  lines.forEach((raw, i) => {
    const line = raw;
    if (language === 'cpp') {
      if (/\.length\s*(\(|\b)/.test(line) && /vector|nums|s\b/.test(line)) {
        out.push({ line: i + 1, col: line.indexOf('.length') + 1, message: "Did you mean .size()? C++ vector has no .length (that's JS).", severity: 'warning' });
      }
      if (/\bmap\[.*\]\s*=\s*[^;]*$/.test(line.trim()) && !line.trim().endsWith(';') && !line.trim().endsWith('{') && !line.trim().endsWith('}')) {
        // missing semicolon heuristic
        out.push({ line: i + 1, col: line.length, message: 'Missing semicolon?', severity: 'warning' });
      }
    }
    if (language === 'javascript') {
      const m = line.match(/\.size\s*(\(\)|\b)/);
      if (m && /nums|arr|s\b/.test(line)) {
        out.push({ line: i + 1, col: line.indexOf('.size') + 1, message: 'Did you mean .length? JS arrays have no .size() (use .length).', severity: 'warning' });
      }
    }
    if (language === 'python') {
      if (/\.push_back\s*\(/.test(line)) {
        out.push({ line: i + 1, col: line.indexOf('.push_back') + 1, message: 'Did you mean .append()? .push_back is C++.', severity: 'warning' });
      }
    }
  });
  return out;
}

function lintJS(code) {
  const diags = staticHints(code, 'javascript');
  try {
    // eslint-disable-next-line no-new
    new vm.Script(code, { filename: 'editor.js' });
  } catch (e) {
    const msg = String((e && e.stack) || e.message || e);
    // V8 format: "editor.js:3\n ..." — extract line
    let line = 1, col = 1;
    const m = msg.match(/editor\.js:(\d+)(?::(\d+))?/) || msg.match(/<anonymous>:(\d+)(?::(\d+))?/);
    if (m) { line = parseInt(m[1], 10) || 1; col = parseInt(m[2], 10) || 1; }
    const firstLine = String(e.message || msg).split('\n')[0];
    diags.unshift({ line, col, message: firstLine, severity: 'error' });
  }
  return diags.slice(0, 20);
}

function runCmd(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let proc;
    try {
      proc = spawn(bin, args, { timeout: timeoutMs });
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e.message || e) });
    }
    proc.stdout && proc.stdout.on('data', (d) => { out += d; });
    proc.stderr && proc.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => { try { proc.kill(); } catch {} }, timeoutMs + 500);
    proc.on('close', (c) => { clearTimeout(kill); resolve({ code: c, out, err }); });
    proc.on('error', (e) => { clearTimeout(kill); resolve({ code: -1, out, err: String(e.message || e) }); });
  });
}

function parseGccLine(line, tmpBase) {
  // formats: file:line:col: error: msg  |  file:line: error: msg
  const m = line.match(/^(.*?):(\d+)(?::(\d+))?:\s*(error|warning|note):\s*(.*)$/);
  if (!m) return null;
  return { line: parseInt(m[2], 10) || 1, col: parseInt(m[3], 10) || 1, message: `${m[4]}: ${m[5]}`.slice(0, 500), severity: m[4] === 'error' ? 'error' : 'warning' };
}

async function lintCpp(code, ROOT) {
  const diags = staticHints(code, 'cpp');
  const compiler = resolveCompiler(ROOT);
  const tmpFile = path.join(os.tmpdir(), `lint_${Date.now()}_${Math.random().toString(36).slice(2)}.cpp`);
  const hasInclude = code.includes('#include');
  const header = hasInclude ? '' : '#include <bits/stdc++.h>\nusing namespace std;\n';
  // NOTE: when user code already has #include, prepend nothing (no line shift).
  // Otherwise prepend header + blank line (3 file lines before user code).
  const prefix = hasInclude ? '' : header + '\n';
  // number of file lines before user code starts (for mapping g++ lines back)
  const prefixLines = hasInclude ? 0 : prefix.split('\n').length - 1;
  const userLines = code.split('\n');
  fs.writeFileSync(tmpFile, prefix + code, 'utf8');
  try {
    // Use precompiled bits header when available (faster, far less RAM).
    // If the compile errors mention pch, retry once without the flag (identical to old behavior).
    let r;
    const pchArgs = pchArgsUsable();
    if (pchArgs) {
      r = await runCmd(compiler, ['-std=c++17', '-fsyntax-only', ...pchArgs, tmpFile], 15000);
      const combined = String((r && r.err) || '') + '\n' + String((r && r.out) || '');
      if (r.code !== 0 && /pch|precompiled|\.gch|different GCC|mismatch|unrecognized.*include/i.test(combined)) {
        r = await runCmd(compiler, ['-std=c++17', '-fsyntax-only', tmpFile], 8000);
      }
    } else {
      r = await runCmd(compiler, ['-std=c++17', '-fsyntax-only', tmpFile], 8000);
    }
    if (r.code !== 0 && r.err) {
      for (const rawLine of String(r.err).split('\n').slice(0, 30)) {
        const d = parseGccLine(rawLine.trim(), tmpFile);
        if (d) {
          if (!hasInclude) d.line = Math.max(1, d.line - prefixLines);
          // g++ reports "expected ';' before X" at X; point at end of the
          // previous non-empty user line instead (where ';' belongs).
          // Covers both "expected ';' before" and "expected ',' or ';' before".
          if (/expected\s+['"]?[;,]['"]?(\s+or\s+['"]?[;,]['"]?)?\s+before/i.test(d.message)) {
            for (let L = Math.min(d.line - 1, userLines.length); L >= 1; L--) {
              const t = (userLines[L - 1] || '');
              if (t.trim() !== '') {
                d.line = L;
                d.col = t.length + 1; // end of line (frontend clamps to last char)
                break;
              }
            }
          }
          diags.push(d);
        }
        if (diags.length >= 20) break;
      }
      if (!diags.length && r.err.trim()) diags.push({ line: 1, col: 1, message: String(r.err).split('\n')[0].slice(0, 500), severity: 'error' });
    }
  } catch (e) {
    diags.push({ line: 1, col: 1, message: String(e.message || e).slice(0, 300), severity: 'error' });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
  return diags.slice(0, 20);
}

async function lintPython(code) {
  const diags = staticHints(code, 'python');
  const tmpFile = path.join(os.tmpdir(), `lint_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  fs.writeFileSync(tmpFile, code, 'utf8');
  const tryBins = ['python', 'python3'];
  for (const bin of tryBins) {
    const r = await runCmd(bin, ['-m', 'py_compile', tmpFile], 8000);
    if (r.code === -1 && /not found|ENOENT/i.test(r.err)) continue; // try next bin
    if (r.code !== 0 && (r.err || r.out)) {
      const text = String(r.err || r.out);
      // format: File "f", line 3\n    ...\nSyntaxError: msg
      const lm = text.match(/[Ll]ine (\d+)/);
      const line = lm ? parseInt(lm[1], 10) : 1;
      const lastLine = text.trim().split('\n').filter(Boolean).pop() || 'Syntax error';
      diags.unshift({ line, col: 1, message: lastLine.slice(0, 500), severity: 'error' });
    }
    break;
  }
  try { fs.unlinkSync(tmpFile); } catch {}
  // __pycache__ cleanup
  try { fs.rmSync(path.join(os.tmpdir(), '__pycache__'), { recursive: true, force: true }); } catch {}
  return diags.slice(0, 20);
}

async function lint(code, language, ROOT) {
  if (!code || code.length > 50000) throw new Error('Code too large (max 50k)');
  if (language === 'javascript') return lintJS(code);
  if (language === 'python') return lintPython(code);
  if (language === 'cpp') return lintCpp(code, ROOT);
  throw new Error('Unsupported language');
}

module.exports = { lint, ensureBitsPch, getPchPath, isPchAvailable, resolveCompiler };
