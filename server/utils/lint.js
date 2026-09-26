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
    const r = await runCmd(compiler, ['-std=c++17', '-fsyntax-only', tmpFile], 8000);
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

module.exports = { lint };
