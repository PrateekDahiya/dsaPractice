// format.js — verbatim port of fixSpacing()/formatCode() from public/js/editor.js.
export function fixSpacing(s) {
  const placeholders = [];
  s = s.replace(/("[^"]*"|'[^']*')/g, (m) => { placeholders.push(m); return `__STR${placeholders.length-1}__`; });
  const ops = ["==","!=","<=",">=","&&","||","<<",">>","++","--","+=","-=","*=","/=","%="];
  const opPlace = [];
  ops.forEach(op => {
    const esc2 = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(esc2, 'g'), (m) => { opPlace.push(m); return `__OP${opPlace.length-1}__`; });
  });
  s = s.replace(/,\s*/g, ', ');
  s = s.replace(/;\s*/g, '; ');
  s = s.replace(/; $/, ';');
  s = s.replace(/\s*=\s*/g, ' = ');
  s = s.replace(/\s*\+\s*/g, ' + ');
  s = s.replace(/\s*-\s*/g, ' - ');
  s = s.replace(/\s*\*\s*/g, ' * ');
  s = s.replace(/\s*\/\s*/g, ' / ');
  s = s.replace(/\s*%\s*/g, ' % ');
  s = s.replace(/\b(for|if|while|switch|catch)\s*\(/g, '$1 (');
  s = s.replace(/\)\s*\{/g, ') {');
  s = s.replace(/\}\s*else/g, '} else');
  s = s.replace(/else\s*\{/g, 'else {');
  opPlace.forEach((op, i) => {
    const spaced = (op === "++" || op === "--") ? op : ` ${op} `;
    s = s.replace(`__OP${i}__`, spaced);
  });
  placeholders.forEach((ph, i) => { s = s.replace(`__STR${i}__`, ph); });
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\(\s+/g, '(');
  s = s.replace(/\s+\)/g, ')');
  s = s.replace(/\[\s+/g, '[');
  s = s.replace(/\s+\]/g, ']');
  s = s.replace(/\s+,/g, ',');
  s = s.replace(/\s+;/g, ';');
  return s.trim();
}

export function formatCode(code) {
  const size = 4;
  let indent = 0;
  const lines = code.split("\n");
  const out = [];
  for (let raw of lines) {
    let trimmed = raw.trim();
    if (!trimmed) { out.push(""); continue; }
    if (trimmed.startsWith("#")) { out.push(trimmed); continue; }
    trimmed = fixSpacing(trimmed);
    const leadingCloses = (() => {
      const m = trimmed.match(/^[}\]\)]+/);
      return m ? m[0].length : 0;
    })();
    if (leadingCloses) indent = Math.max(0, indent - leadingCloses);
    out.push(" ".repeat(indent * size) + trimmed);
    const rest = trimmed.slice(leadingCloses);
    const opens = (rest.match(/\{/g) || []).length;
    const closes = (rest.match(/\}/g) || []).length;
    let delta = opens - closes;
    if (trimmed.endsWith(":") && !trimmed.includes("?") && !trimmed.startsWith("case")) delta += 1;
    indent = Math.max(0, indent + delta);
    if (/[\(\[]\s*$/.test(trimmed) && !/[\]\)]\s*$/.test(trimmed)) indent++;
  }
  return out.join("\n");
}
