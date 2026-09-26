/* own-editor.js — dependency-free textarea overlay editor (plain script, no imports).
 *
 * Contract with app.js:
 *   window.__oe = { getValue(), setValue(v), setLanguage(lang), onDocChange(cb) }
 *   window.__oeActive = true when ready; document.body.dataset.editor = 'own'.
 *   window.__cmActive stays false (CodeMirror gone).
 *   Reads initial language from window.__cmLang and question context from
 *   window.__questionCtx = { functionName, params } (read live).
 *   window.__oeView = { show(code, lang), hide() } for read-only submission view.
 *
 * Expected DOM ids (all optional except code-editor; missing pieces fail silently):
 *   textarea#code-editor, pre#oe-hl, div#oe-gutter, div#oe-suggest,
 *   div#oe-hover, div#oe-wrap.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : (c === '<' ? '&lt;' : '&gt;');
    });
  }
  function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

  var LANGS = { cpp: 1, javascript: 1, python: 1 };
  function normLang(l) {
    l = String(l == null ? '' : l).toLowerCase();
    if (l === 'js') return 'javascript';
    if (l === 'py') return 'python';
    if (l === 'c++' || l === 'cxx' || l === 'c') return 'cpp';
    return LANGS[l] ? l : 'cpp';
  }

  var ta = $('code-editor');

  /* If even the textarea is missing, expose harmless stubs and stop. */
  if (!ta) {
    try {
      window.__cmActive = false;
      window.__oeActive = false;
      window.__oe = {
        getValue: function () { return ''; },
        setValue: function () {},
        setLanguage: function () {},
        onDocChange: function () { return function () {}; }
      };
      window.__oeView = { show: function () {}, hide: function () {} };
    } catch (e) {}
    return;
  }

  var hl = $('oe-hl');           /* pre highlight layer (optional) */
  var gutter = $('oe-gutter');   /* gutter line numbers (optional) */
  var wrap = $('oe-wrap');       /* editor stack wrapper (optional) */
  var suggestEl = $('oe-suggest');
  var hoverEl = $('oe-hover');

  /* Self-contained popups may be auto-created; highlight/gutter layers may not. */
  try {
    if (!suggestEl) {
      suggestEl = document.createElement('div');
      suggestEl.id = 'oe-suggest';
      suggestEl.style.display = 'none';
      document.body.appendChild(suggestEl);
    }
  } catch (e) { suggestEl = null; }
  try {
    if (!hoverEl) {
      hoverEl = document.createElement('div');
      hoverEl.id = 'oe-hover';
      hoverEl.style.display = 'none';
      document.body.appendChild(hoverEl);
    }
  } catch (e) { hoverEl = null; }

  var state = {
    lang: normLang(typeof window.__cmLang !== 'undefined' ? window.__cmLang : 'cpp')
  };
  function questionCtx() {
    try { return window.__questionCtx || {}; } catch (e) { return {}; }
  }

  var MAX_LINES = 2000;
  var MAX_DIAGS = 20;
  var MAX_BYTES = 200 * 1024;

  /* ================= 1. Regex lexer + highlight ================= */

  var CPP_KW = ('alignas alignof and and_eq asm auto bitand bitor break case catch class compl ' +
    'concept const consteval constexpr constinit const_cast continue co_await co_return co_yield ' +
    'decltype default delete do dynamic_cast else enum explicit export extern false for friend goto ' +
    'if inline long mutable namespace new noexcept not not_eq nullptr operator or or_eq private ' +
    'protected public register reinterpret_cast return short signed sizeof static static_assert ' +
    'static_cast struct switch template this thread_local throw true try typedef typeid typename ' +
    'union unsigned using virtual void volatile wchar_t while xor xor_eq requires final override ' +
    'bool char char8_t char16_t char32_t double float int').split(' ');
  var CPP_TYPES = ('string vector map set unordered_map unordered_set multiset multimap queue stack ' +
    'deque list array pair tuple optional variant function stringstream istringstream ostringstream ' +
    'istream ostream ifstream ofstream fstream iterator const_iterator size_t int8_t int16_t int32_t ' +
    'int64_t uint8_t uint16_t uint32_t uint64_t').split(' ');
  var JS_KW = ('break case catch class const continue debugger default delete do else export extends ' +
    'false finally for function if import in instanceof let new null return super switch this throw ' +
    'true try typeof var void while with yield async await static get set of from as').split(' ');
  var JS_TYPES = ('Array Object String Number Boolean Promise Map Set WeakMap WeakSet Date RegExp ' +
    'Error JSON Math console window document undefined NaN Infinity parseInt parseFloat').split(' ');
  var PY_KW = ('False None True and as assert async await break class continue def del elif else except ' +
    'finally for from global if import in is lambda nonlocal not or pass raise return try while with ' +
    'yield match case').split(' ');
  var PY_TYPES = ('int str float bool list dict tuple set frozenset bytes len range print enumerate zip ' +
    'map filter sorted sum min max abs open type isinstance Exception ValueError KeyError IndexError ' +
    'self cls').split(' ');

  function alt(words) {
    var esc = words.map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    /* longest-first so e.g. unordered_map wins over map-ish prefixes (word boundary anyway) */
    esc.sort(function (a, b) { return b.length - a.length; });
    return '(?:' + esc.join('|') + ')';
  }

  var NUM_SRC = '\\b0[xX][0-9a-fA-F_]+\\b|\\b0[oO][0-7_]+\\b|\\b0[bB][01_]+\\b' +
    '|\\b\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d[\\d_]*)?[jJ]?(?:[uUlLfF]+)?\\b';
  var FN_SRC = '[A-Za-z_]\\w*(?=\\s*\\()';
  var COM_CPP_SRC = '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)';
  var STR_CPP_SRC = '"(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?';
  var PP_SRC = '#[^\\n]*';
  var STR_JS_SRC = '"(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?|`(?:[^`\\\\]|\\\\.)*`?';
  var COM_PY_SRC = '#[^\\n]*';
  var STR_PY_SRC = '[rRbBfFuU]{0,2}(?:"""[\\s\\S]*?(?:"""|$)|' +
    '\'\'\'[\\s\\S]*?(?:\'\'\'|$)|"(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?)';

  /* NOTE: every inner group must be non-capturing (?:...) — the builder relies on it. */
  function buildLexer(lang) {
    var spec;
    if (lang === 'cpp') {
      spec = [
        { cls: 'oe-com', re: COM_CPP_SRC },
        { cls: 'oe-str', re: STR_CPP_SRC },
        { cls: 'oe-pp', re: PP_SRC },
        { cls: 'oe-kw', re: '\\b' + alt(CPP_KW) + '\\b' },
        { cls: 'oe-type', re: '\\b' + alt(CPP_TYPES) + '\\b' },
        { cls: 'oe-num', re: NUM_SRC },
        { cls: 'oe-fn', re: FN_SRC }
      ];
    } else if (lang === 'python') {
      spec = [
        { cls: 'oe-com', re: COM_PY_SRC },
        { cls: 'oe-str', re: STR_PY_SRC },
        { cls: 'oe-kw', re: '\\b' + alt(PY_KW) + '\\b' },
        { cls: 'oe-type', re: '\\b' + alt(PY_TYPES) + '\\b' },
        { cls: 'oe-num', re: NUM_SRC },
        { cls: 'oe-fn', re: FN_SRC }
      ];
    } else {
      spec = [
        { cls: 'oe-com', re: COM_CPP_SRC },
        { cls: 'oe-str', re: STR_JS_SRC },
        { cls: 'oe-kw', re: '\\b' + alt(JS_KW) + '\\b' },
        { cls: 'oe-type', re: '\\b' + alt(JS_TYPES) + '\\b' },
        { cls: 'oe-num', re: NUM_SRC },
        { cls: 'oe-fn', re: FN_SRC }
      ];
    }
    var parts = spec.map(function (s) { return '(' + s.re + ')'; });
    var classes = spec.map(function (s) { return s.cls; });
    var re = new RegExp(parts.join('|'), 'g');
    return { re: re, classes: classes };
  }

  var lexers = {};
  function getLexer(lang) {
    if (!lexers[lang]) lexers[lang] = buildLexer(lang);
    return lexers[lang];
  }

  function tokenize(text, lang) {
    var lx = getLexer(lang);
    var re = lx.re;
    var classes = lx.classes;
    var toks = [];
    var m, i;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      for (i = 0; i < classes.length; i++) {
        if (m[i + 1] !== undefined) {
          toks.push({ s: m.index, e: m.index + m[0].length, cls: classes[i] });
          break;
        }
      }
      /* safety against zero-length loops */
      if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
    }
    return toks;
  }

  function lineStartsOf(text) {
    var starts = [0];
    for (var i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
  }

  /* Map server diagnostics {line(1-based), col(1-based), severity, message} to offsets. */
  function diagsToIntervals(list, text, starts) {
    var lines = text.split('\n');
    var n = lines.length;
    var out = [];
    var arr = (list || []).slice(0, MAX_DIAGS);
    for (var k = 0; k < arr.length; k++) {
      var d = arr[k] || {};
      var ln = Math.max(1, Math.min(n, (d.line | 0) || 1));
      var lineText = lines[ln - 1];
      var col = Math.max(0, Math.min(lineText.length, ((d.col | 0) || 1) - 1));
      var from = starts[ln - 1] + col;
      var lineEnd = starts[ln - 1] + lineText.length;
      /* EOL / blank-line positions (e.g. adjusted end-of-line diagnostics)
       * would land on a newline and render invisibly — back up to the last
       * meaningful char so the squiggle is always visible. */
      if (from >= lineEnd) {
        var b = ln;
        while (b > 1 && lines[b - 1].trim() === '') b--;
        var bt2 = lines[b - 1];
        if (!bt2 || bt2.trim() === '') continue;
        ln = b; lineText = bt2;
        lineEnd = starts[b - 1] + bt2.length;
        from = lineEnd - 1;
        if (from < starts[b - 1]) continue;
      }
      var j = from;
      while (j < starts[ln - 1] + lineText.length && /[A-Za-z0-9_]/.test(text.charAt(j))) j++;
      var to = j > from ? j : Math.min(from + 1, starts[ln - 1] + lineText.length);
      if (to <= from) to = Math.min(from + 1, text.length);
      if (from >= text.length) continue;
      out.push({
        from: from, to: Math.min(to, text.length),
        sev: d.severity === 'warning' ? 'warn' : 'err',
        msg: String(d.message || (d.severity === 'warning' ? 'Warning' : 'Error'))
      });
    }
    out.sort(function (a, b) { return a.from - b.from || a.to - b.to; });
    var res = [];
    for (var q = 0; q < out.length; q++) {
      if (res.length && out[q].from < res[res.length - 1].to) continue; /* skip overlaps */
      res.push(out[q]);
    }
    return res;
  }

  /* Indent guides: one low-opacity leader per 4-space/tab unit of leading
   * whitespace. Spans wrap the real whitespace (background only) so the
   * caret overlay stays pixel-aligned. Leftover 1-3 spaces stay plain. */
  function guidesHtml(ws) {
    var out = [], buf = '', i = 0;
    while (i < ws.length) {
      if (ws[i] === '\t') {
        if (buf) { out.push(escHtml(buf)); buf = ''; }
        out.push('<span class="oe-indent">\t</span>');
        i++;
      } else if (ws.substr(i, 4) === '    ') {
        if (buf) { out.push(escHtml(buf)); buf = ''; }
        out.push('<span class="oe-indent">    </span>');
        i += 4;
      } else { buf += ws[i]; i++; }
    }
    if (buf) out.push(escHtml(buf));
    return out.join('');
  }

  /* Highlight text; intervals = [{from,to,sev,msg}] (already clipped to text).
   * Emitted per line so indent guides can be injected at line starts without
   * disturbing token spans (spans never cross a line boundary in output;
   * multi-line tokens are re-emitted per line with the same class). */
  function highlightWithDiags(text, lang, intervals) {
    intervals = intervals || [];
    if (!text) return '';
    var starts = lineStartsOf(text);
    var lines = text.split('\n');
    var toks = tokenize(text, lang);
    var cuts = [];
    var i, d;
    for (i = 0; i < intervals.length; i++) {
      d = intervals[i];
      if (d.to > d.from && d.from < text.length) {
        cuts.push({
          from: Math.max(0, d.from), to: Math.min(text.length, d.to),
          sev: d.sev, msg: d.msg
        });
      }
    }
    cuts.sort(function (a, b) { return a.from - b.from || a.to - b.to; });
    var ded = [];
    for (i = 0; i < cuts.length; i++) {
      if (ded.length && cuts[i].from < ded[ded.length - 1].to) continue; /* skip overlaps */
      ded.push(cuts[i]);
    }
    cuts = ded;
    var html = [];
    var ti = 0, ci = 0, li, pos, segEnd;
    for (li = 0; li < lines.length; li++) {
      if (li > 0) html.push('\n');
      var ls = starts[li], le = ls + lines[li].length;
      pos = ls;
      while (ti < toks.length && toks[ti].e <= pos) ti++;
      while (ci < cuts.length && cuts[ci].to <= pos) ci++;
      /* indent guides for leading whitespace not overlapped by a token/cut */
      var m = /^[ \t]+/.exec(lines[li]);
      if (m) {
        var wlen = m[0].length, blocked = false, k;
        for (k = ti; k < toks.length && toks[k].s < ls + wlen; k++) {
          if (toks[k].e > ls) { blocked = true; break; }
        }
        if (!blocked) {
          for (k = ci; k < cuts.length && cuts[k].from < ls + wlen; k++) {
            if (cuts[k].to > ls) { blocked = true; break; }
          }
        }
        if (!blocked) { html.push(guidesHtml(m[0])); pos = ls + wlen; }
      }
      while (pos < le) {
        while (ti < toks.length && toks[ti].e <= pos) ti++;
        while (ci < cuts.length && cuts[ci].to <= pos) ci++;
        if (ci < cuts.length && cuts[ci].from <= pos && pos < cuts[ci].to) {
          d = cuts[ci];
          segEnd = Math.min(d.to, le);
          html.push('<span class="' + (d.sev === 'warn' ? 'oe-warn' : 'oe-err') +
            '" data-msg="' + escAttr(d.msg) + '">');
          var p2 = pos, t, ts, te;
          while (p2 < segEnd) {
            while (ti < toks.length && toks[ti].e <= p2) ti++;
            t = (ti < toks.length && toks[ti].s < segEnd && toks[ti].e > p2) ? toks[ti] : null;
            if (t) {
              ts = Math.max(t.s, p2); te = Math.min(t.e, segEnd);
              if (ts > p2) html.push(escHtml(text.slice(p2, ts)));
              html.push('<span class="' + t.cls + '">' + escHtml(text.slice(ts, te)) + '</span>');
              p2 = te;
              if (te >= t.e) ti++;
            } else {
              var nx = segEnd;
              if (ti < toks.length && toks[ti].s >= p2) nx = Math.min(nx, toks[ti].s);
              if (nx <= p2) nx = p2 + 1;
              html.push(escHtml(text.slice(p2, nx)));
              p2 = nx;
            }
          }
          html.push('</span>');
          pos = segEnd;
          continue;
        }
        var tt = (ti < toks.length && toks[ti].s <= pos && pos < toks[ti].e) ? toks[ti] : null;
        if (tt) {
          segEnd = Math.min(tt.e, le);
          html.push('<span class="' + tt.cls + '">' + escHtml(text.slice(pos, segEnd)) + '</span>');
          pos = segEnd;
          if (pos >= tt.e) ti++;
          continue;
        }
        segEnd = le;
        if (ti < toks.length && toks[ti].s >= pos) segEnd = Math.min(segEnd, toks[ti].s);
        if (ci < cuts.length && cuts[ci].from >= pos) segEnd = Math.min(segEnd, cuts[ci].from);
        if (segEnd <= pos) segEnd = pos + 1;
        html.push(escHtml(text.slice(pos, segEnd)));
        pos = segEnd;
      }
    }
    return html.join('');
  }

  function capDisplay(code) {
    if (code.length > MAX_BYTES || code.split('\n').length > MAX_LINES) {
      return code.split('\n').slice(0, MAX_LINES).join('\n');
    }
    return code;
  }

  /* ================= lint (debounced) ================= */
  var diags = []; /* intervals against lintSnapshot */
  var lintSnapshot = '';
  var lintTimer = null;
  var lintSeq = 0;

  function scheduleLint() {
    try { clearTimeout(lintTimer); } catch (e) {}
    lintTimer = setTimeout(runLint, 400);
  }

  function runLint() {
    var code = ta.value;
    if (!code || !code.trim() || code.length > 50000) {
      diags = [];
      lintSnapshot = code;
      scheduleRender();
      return;
    }
    var my = ++lintSeq;
    var lang = state.lang;
    var snapshot = code;
    try {
      fetch('/api/lint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: snapshot, language: lang })
      }).then(function (res) {
        if (!res.ok) throw new Error('lint ' + res.status);
        return res.json();
      }).then(function (data) {
        if (my !== lintSeq || ta.value !== snapshot) return; /* stale */
        var list = (data && data.diagnostics) || [];
        var starts = lineStartsOf(snapshot);
        diags = diagsToIntervals(list, snapshot, starts);
        lintSnapshot = snapshot;
        scheduleRender();
      }).catch(function () { /* silent: highlight still works */ });
    } catch (e) { /* fetch unavailable */ }
  }

  /* ================= 2. gutter + scroll sync + rAF render ================= */
  var displayText = '';
  var renderQueued = false;

  function syncOverlayMetrics() {
    if (!hl) return;
    try {
      var cs = getComputedStyle(ta);
      var hs = hl.style;
      hs.margin = '0';
      hs.whiteSpace = 'pre';
      hs.overflow = 'hidden';
      hs.overflowWrap = 'normal';
      hs.wordWrap = 'normal';
      hs.pointerEvents = 'none';
      hl.setAttribute('aria-hidden', 'true');
      var font = cs.fontFamily || 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      hs.fontFamily = font;
      hs.fontSize = cs.fontSize || '13px';
      hs.lineHeight = cs.lineHeight || '1.5';
      hs.letterSpacing = cs.letterSpacing || 'normal';
      hs.tabSize = cs.tabSize || '4';
      hs.paddingTop = cs.paddingTop;
      hs.paddingRight = cs.paddingRight;
      hs.paddingBottom = cs.paddingBottom;
      hs.paddingLeft = cs.paddingLeft;
      hs.borderTopWidth = '0px'; hs.borderBottomWidth = '0px';
      hs.borderLeftWidth = '0px'; hs.borderRightWidth = '0px';
      ta.style.whiteSpace = 'pre';
      ta.style.overflowWrap = 'normal';
      ta.style.wordWrap = 'normal';
      if (!ta.style.caretColor) ta.style.caretColor = '#e8e8e8';
      /* overlay mode: real glyphs come from the pre behind */
      ta.style.background = 'transparent';
      ta.style.color = 'transparent';
      if (wrap) {
        try {
          var wcs = getComputedStyle(wrap);
          if (wcs.position === 'static') wrap.style.position = 'relative';
        } catch (e2) {}
      }
      if (gutter) {
        try {
          var gs = gutter.style;
          gs.lineHeight = cs.lineHeight || '1.5';
          gs.fontSize = cs.fontSize || '13px';
          gs.fontFamily = font;
          gs.overflow = 'hidden';
        } catch (e3) {}
      }
    } catch (e) {}
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    function go() {
      renderQueued = false;
      try { doRender(); } catch (e) {}
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    else setTimeout(go, 0);
  }

  function diagAt(off) {
    for (var i = 0; i < diags.length; i++) {
      if (off >= diags[i].from && off < diags[i].to) return diags[i];
    }
    return null;
  }

  function doRender() {
    var code = ta.value;
    displayText = capDisplay(code);
    /* show squiggles only while the text still matches what was linted */
    var ivs = [];
    if (ta.value === lintSnapshot) {
      for (var i = 0; i < diags.length; i++) {
        var d = diags[i];
        if (d.from < displayText.length) {
          ivs.push({ from: d.from, to: Math.min(d.to, displayText.length), sev: d.sev, msg: d.msg });
        }
      }
    }
    if (hl) {
      syncOverlayMetrics();
      hl.innerHTML = highlightWithDiags(displayText, state.lang, ivs);
    }
    if (gutter) {
      var n = displayText === '' ? 1 : displayText.split('\n').length;
      var s = '';
      for (var g = 1; g <= n; g++) s += g + (g < n ? '\n' : '');
      gutter.textContent = s;
    }
    syncScroll();
  }

  function syncScroll() {
    try {
      if (hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
      if (gutter) { gutter.scrollTop = ta.scrollTop; }
    } catch (e) {}
  }

  /* ================= doc-change callbacks ================= */
  var docCbs = [];
  function notifyDocChange() {
    for (var i = 0; i < docCbs.length; i++) {
      try { docCbs[i](); } catch (e) {}
    }
  }
  function fireEditorInput() {
    try {
      if (typeof window.__onEditorInput === 'function') window.__onEditorInput();
    } catch (e) {}
    try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {}
  }

  /* ================= 3. suggestions (DB-backed, no hardcoded lists) ================= */
  var methodListCache = {}; /* lang -> [{label, detail}] from /api/methods */
  var methodListPending = {}; /* lang -> promise */
  function shortDetail(row) {
    var s = String((row && row.signature) || '');
    if (s.length > 42) s = s.slice(0, 41) + '…';
    return s || 'method';
  }
  function ensureMethodList(lang) {
    if (methodListCache[lang]) return Promise.resolve(methodListCache[lang]);
    if (methodListPending[lang]) return methodListPending[lang];
    var p = fetch('/api/methods?language=' + encodeURIComponent(lang) + '&limit=200')
      .then(function (res) { if (!res.ok) throw new Error('methods ' + res.status); return res.json(); })
      .then(function (rows) {
        var list = (rows || []).map(function (r) {
          return { label: String(r.name), detail: shortDetail(r) };
        });
        methodListCache[lang] = list;
        try { delete methodListPending[lang]; } catch (e) {}
        return list;
      })
      .catch(function () {
        try { delete methodListPending[lang]; } catch (e) {}
        return null; /* offline/DB down: question fn only */
      });
    methodListPending[lang] = p;
    return p;
  }

  var composing = false;
  var sugItems = [];   /* {label, detail} */
  var sugIndex = 0;
  var sugOpen = false;
  var sugAnchor = null; /* {start,end} word range being completed, or caret pos */
  var suppressSuggestOnce = false;
  var mirror = null;

  /* Identifiers from the CURRENT code: locals, params, defined functions.
   * Strings/comments are blanked via the lexer first so they can't pollute.
   * Returns [{label, detail}] with detail 'local var' | 'local fn' | 'param'. */
  function excludeWords(lang) {
    var s = {};
    var arrs = lang === 'cpp' ? [CPP_KW, CPP_TYPES]
      : (lang === 'python' ? [PY_KW, PY_TYPES] : [JS_KW, JS_TYPES]);
    for (var i = 0; i < arrs.length; i++) {
      for (var j = 0; j < arrs[i].length; j++) s[arrs[i][j]] = 1;
    }
    var extra = ['if', 'for', 'while', 'switch', 'catch', 'return', 'else',
      'include', 'using', 'namespace', 'std', 'new', 'true', 'false'];
    for (var k = 0; k < extra.length; k++) s[extra[k]] = 1;
    return s;
  }
  function localsFor(lang) {
    var code = '';
    try { code = ta.value || ''; } catch (e) { return []; }
    if (code.length > 100000) code = code.slice(0, 100000);
    try {
      var toks = tokenize(code, lang);
      var chars = code.split('');
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (t.cls === 'oe-str' || t.cls === 'oe-com' || t.cls === 'oe-pp') {
          for (var j = t.s; j < t.e; j++) chars[j] = ' ';
        }
      }
      code = chars.join('');
    } catch (e) {}
    var seen = {}, vars = [], fns = [];
    function add(arr, name, detail) {
      if (!name || seen[name]) return;
      seen[name] = 1;
      arr.push({ label: name, detail: detail });
    }
    var m, re;
    var TYPE_ALT = lang === 'cpp'
      ? '(?:int|long|short|double|float|char|bool|string|auto|vector|unordered_map|unordered_set|map|set|multiset|stack|queue|deque|priority_queue|pair)'
      : (lang === 'python' ? '(?:int|str|float|bool|list|dict|tuple|set)' : '(?:let|const|var)');
    /* declarations: <type...> name */
    re = new RegExp('\\b' + TYPE_ALT + '(?:\\s*<[^;()\\n]*>)?\\s*\\*?&?\\s*([A-Za-z_]\\w*)', 'g');
    while ((m = re.exec(code))) add(vars, m[1], 'local var');
    /* assignments: name = (not ==, =>) */
    re = /(^|[;{}\s])\s*([A-Za-z_]\w*)\s*=(?![=>])/gm;
    while ((m = re.exec(code))) add(vars, m[2], 'local var');
    /* for-loop variables */
    re = lang === 'python' ? /\bfor\s+([A-Za-z_]\w*)\s+in/g : /\bfor\s*\(\s*(?:int|auto|let|const|var)?\s*([A-Za-z_]\w*)/g;
    while ((m = re.exec(code))) add(vars, m[1], 'local var');
    /* function definitions */
    if (lang === 'javascript') {
      re = /\bfunction\s+([A-Za-z_$\w]+)/g;
      while ((m = re.exec(code))) add(fns, m[1], 'local fn');
      re = /(?:const|let|var)\s+([A-Za-z_$\w]+)\s*=\s*(?:async\s*)?(\([^)]*\)|[A-Za-z_$\w]+\s*=>)/g;
      while ((m = re.exec(code))) add(fns, m[1], 'local fn');
    } else if (lang === 'python') {
      re = /\bdef\s+([A-Za-z_]\w*)/g;
      while ((m = re.exec(code))) add(fns, m[1], 'local fn');
    } else {
      re = /^[\t ]*(?:[\w:<>*&]+\s+)+([A-Za-z_]\w*)\s*\(/gm;
      while ((m = re.exec(code))) add(fns, m[1], 'local fn');
    }
    /* question params are always relevant */
    var out = [];
    try {
      var ctxp = questionCtx();
      (ctxp.params || []).forEach(function (p) { add(vars, String(p), 'param'); });
    } catch (e) {}
    var ex = excludeWords(lang);
    function clean(arr) {
      return arr.filter(function (it) { return !ex[it.label] && it.label.length <= 40; });
    }
    out = clean(vars).concat(clean(fns));
    return out.slice(0, 30);
  }
  function filterCandidates(list, prefix) {
    var out, p = (prefix || '').toLowerCase();
    if (!p) return list.slice(0, 8);
    var starts = [], incl = [];
    for (var j = 0; j < list.length; j++) {
      var lb = list[j].label.toLowerCase();
      if (lb.indexOf(p) === 0) starts.push(list[j]);
      else if (lb.indexOf(p) !== -1) incl.push(list[j]);
    }
    out = starts.concat(incl);
    return out.slice(0, 10);
  }
  var sugToken = 0;
  function candidates(prefix, done) {
    /* async: question fn + locals from current code + DB list; stale dropped */
    var my = ++sugToken;
    var ctx = questionCtx();
    var head = [];
    if (ctx && ctx.functionName) {
      head.push({ label: String(ctx.functionName), detail: 'question fn' });
    }
    var local = [];
    try { local = localsFor(state.lang); } catch (e) {}
    ensureMethodList(state.lang).then(function (base) {
      if (my !== sugToken) return;
      var seen = {};
      head.concat(local).forEach(function (it) { seen[it.label] = 1; });
      var list = head.concat(local);
      (base || []).forEach(function (it) { if (!seen[it.label]) list.push(it); });
      done(filterCandidates(list, prefix));
    });
  }

  function wordRangeBeforeCaret() {
    try {
      var pos = ta.selectionStart;
      if (ta.selectionStart !== ta.selectionEnd) return null;
      var left = ta.value.slice(0, pos);
      var m = left.match(/[A-Za-z_]\w*$/);
      if (!m) return { start: pos, end: pos, prefix: '' };
      return { start: pos - m[0].length, end: pos, prefix: m[0] };
    } catch (e) { return null; }
  }

  function caretCoords() {
    try {
      var pos = ta.selectionStart;
      if (!mirror) {
        mirror = document.createElement('div');
        mirror.setAttribute('aria-hidden', 'true');
        var ms = mirror.style;
        ms.position = 'absolute';
        ms.top = '-9999px';
        ms.left = '-9999px';
        ms.visibility = 'hidden';
        ms.whiteSpace = 'pre';
        ms.overflowWrap = 'normal';
        ms.wordWrap = 'normal';
        ms.overflow = 'hidden';
        document.body.appendChild(mirror);
      }
      var cs = getComputedStyle(ta);
      var props = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
        'textTransform', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'boxSizing', 'tabSize', 'lineHeight'];
      for (var i = 0; i < props.length; i++) {
        try { mirror.style[props[i]] = cs[props[i]]; } catch (e) {}
      }
      mirror.style.width = ta.offsetWidth + 'px';
      mirror.textContent = ta.value.substring(0, pos);
      var mk = document.createElement('span');
      mk.textContent = '|';
      mirror.appendChild(mk);
      var lh = parseFloat(cs.lineHeight);
      if (!isFinite(lh) || lh <= 0) lh = (parseFloat(cs.fontSize) || 13) * 1.5;
      var r = ta.getBoundingClientRect();
      return {
        x: r.left + (mk.offsetLeft - ta.scrollLeft),
        y: r.top + (mk.offsetTop - ta.scrollTop),
        lineHeight: lh
      };
    } catch (e) { return null; }
  }

  function isSugVisible() { return sugOpen && !!suggestEl && suggestEl.style.display !== 'none'; }

  function showSuggest(items, anchor) {
    if (!suggestEl || !items.length) { hideSuggest(); return; }
    sugItems = items;
    sugIndex = 0;
    sugAnchor = anchor;
    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += '<div class="oe-sug-item' + (i === 0 ? ' selected' : '') + '" data-i="' + i + '">' +
        '<span class="oe-sug-label">' + escHtml(items[i].label) + '</span>' +
        '<span class="oe-sug-detail">' + escHtml(items[i].detail || '') + '</span></div>';
    }
    suggestEl.innerHTML = html;
    try { suggestEl.classList.remove('hidden'); } catch (e) {}
    suggestEl.style.display = 'block';
    suggestEl.style.position = 'fixed';
    suggestEl.style.zIndex = '9999';
    var c = caretCoords();
    if (c) {
      var x = Math.max(4, Math.min(c.x, window.innerWidth - 220));
      var h = Math.min(items.length, 10) * 26 + 8;
      var y = c.y + c.lineHeight + 4;
      if (y + h > window.innerHeight - 4) y = Math.max(4, c.y - h - 4);
      suggestEl.style.left = x + 'px';
      suggestEl.style.top = y + 'px';
    }
    sugOpen = true;
  }

  function hideSuggest() {
    sugOpen = false;
    sugItems = [];
    sugIndex = 0;
    try { if (suggestEl) { suggestEl.style.display = 'none'; suggestEl.classList.add('hidden'); } } catch (e) {}
  }

  function paintSugSel() {
    if (!suggestEl) return;
    var kids = suggestEl.children;
    for (var i = 0; i < kids.length; i++) {
      if (i === sugIndex) {
        if (kids[i].className.indexOf('selected') === -1) kids[i].className += ' selected';
        try {
          if (typeof kids[i].scrollIntoView === 'function') {
            kids[i].scrollIntoView({ block: 'nearest' });
          }
        } catch (e) {}
      } else {
        kids[i].className = kids[i].className.replace(/\s?selected/g, '');
      }
    }
  }

  function acceptSuggest() {
    if (!sugOpen || !sugItems.length) return false;
    var it = sugItems[Math.max(0, Math.min(sugIndex, sugItems.length - 1))];
    if (!it) return false;
    try {
      var pos = ta.selectionStart;
      var start = (sugAnchor && typeof sugAnchor.start === 'number') ? sugAnchor.start : pos;
      var end = (sugAnchor && typeof sugAnchor.end === 'number') ? sugAnchor.end : pos;
      var v = ta.value;
      ta.value = v.slice(0, start) + it.label + v.slice(end);
      var np = start + it.label.length;
      ta.selectionStart = ta.selectionEnd = np;
    } catch (e) { return false; }
    suppressSuggestOnce = true;
    hideSuggest();
    hideHover();
    scheduleRender();
    scheduleLint();
    notifyDocChange();
    fireEditorInput();
    return true;
  }

  function refreshSuggest(triggerCh) {
    if (composing || !suggestEl) return;
    var r = wordRangeBeforeCaret();
    if (!r) { hideSuggest(); return; }
    if (!r.prefix && triggerCh !== '.' && triggerCh !== '(') {
      if (!sugOpen) return; /* keep closed */
      hideSuggest();
      return;
    }
    var anchor = { start: r.start, end: r.end };
    var caretNow = null;
    try { caretNow = ta.selectionStart; } catch (e) {}
    candidates(r.prefix, function (items) {
      /* drop stale: caret moved since request */
      try {
        if (ta.selectionStart !== caretNow || ta.selectionStart !== ta.selectionEnd) return;
      } catch (e) {}
      if (!items.length) { hideSuggest(); return; }
      showSuggest(items, anchor);
    });
  }

  if (suggestEl) {
    suggestEl.addEventListener('mousedown', function (e) {
      try {
        var t = e.target;
        while (t && t !== suggestEl && !(t.getAttribute && t.getAttribute('data-i') != null)) t = t.parentNode;
        var idx = t && t.getAttribute ? parseInt(t.getAttribute('data-i'), 10) : NaN;
        if (!isNaN(idx)) {
          e.preventDefault();
          sugIndex = idx;
          acceptSuggest();
          try { ta.focus(); } catch (e2) {}
        }
      } catch (err) {}
    });
  }

  /* Capture on window so we run before app.js's textarea handlers; only act
   * when the popup is open and the editor textarea is the target. */
  window.addEventListener('keydown', function (e) {
    try {
      if (e.target !== ta) return;
      if (composing) return;
      if (!isSugVisible()) return;
      var k = e.key;
      if (k === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        sugIndex = (sugIndex + 1) % Math.max(1, sugItems.length);
        paintSugSel();
      } else if (k === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        sugIndex = (sugIndex - 1 + sugItems.length) % Math.max(1, sugItems.length);
        paintSugSel();
      } else if (k === 'Enter') {
        /* accept ONLY when popup open with a selection; else let newline happen */
        if (sugOpen && sugItems.length) {
          e.preventDefault(); e.stopPropagation();
          acceptSuggest();
        }
      } else if (k === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        acceptSuggest();
      } else if (k === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        hideSuggest();
      }
    } catch (err) {}
  }, true);

  /* Tab / Shift+Tab / smart Enter live on the textarea (target phase).
   * The suggestion handler above runs on window capture first and stops
   * propagation while the popup is open, so Enter/Tab accept there and
   * never reach here in that state. app.js's legacy handler returns early
   * while window.__oeActive is set, so there is no double handling. */
  ta.addEventListener('keydown', function (e) {
    if (composing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      var start = ta.selectionStart, end = ta.selectionEnd;
      var v = ta.value;
      if (e.shiftKey) {
        var before = v.substring(0, start);
        var lineStart = before.lastIndexOf('\n') + 1;
        var block = v.substring(lineStart, end);
        var out = block.split('\n').map(function (l) { return l.replace(/^ {1,4}|\t/, ''); }).join('\n');
        ta.value = v.substring(0, lineStart) + out + v.substring(end);
        var removed = block.length - out.length;
        ta.selectionStart = Math.max(lineStart, start - 4);
        ta.selectionEnd = end - removed;
      } else if (start !== end) {
        var before2 = v.substring(0, start);
        var ls2 = before2.lastIndexOf('\n') + 1;
        var sel = v.substring(ls2, end);
        var ind = sel.split('\n').map(function (l) { return '    ' + l; }).join('\n');
        ta.value = v.substring(0, ls2) + ind + v.substring(end);
        ta.selectionStart = start + 4;
        ta.selectionEnd = end + (ind.length - sel.length);
      } else {
        ta.value = v.substring(0, start) + '    ' + v.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 4;
      }
      scheduleRender();
      scheduleLint();
      notifyDocChange();
      fireEditorInput();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      var s = ta.selectionStart, en = ta.selectionEnd;
      var vv = ta.value;
      var bef = vv.substring(0, s);
      var aft = vv.substring(en);
      var ls = bef.lastIndexOf('\n') + 1;
      var line = bef.substring(ls);
      var im = line.match(/^(\s*)/);
      var indent = im ? im[1] : '';
      var trimmed = line.trim();
      var lastCh = trimmed.charAt(trimmed.length - 1);
      var extra = (lastCh === '{' || lastCh === '(' || lastCh === '[') ? '    ' : '';
      var next = aft.charAt(0);
      if ((lastCh === '{' && next === '}') || (lastCh === '(' && next === ')')) {
        ta.value = bef + '\n' + indent + extra + '\n' + indent + aft;
        ta.selectionStart = ta.selectionEnd = bef.length + 1 + indent.length + extra.length;
      } else {
        var ins = '\n' + indent + extra;
        ta.value = bef + ins + aft;
        ta.selectionStart = ta.selectionEnd = bef.length + ins.length;
      }
      scheduleRender();
      scheduleLint();
      notifyDocChange();
      fireEditorInput();
    }
  });

  /* ================= 4. hover / docs ================= */
  var docCache = new Map();
  function cacheSet(k, v) {
    docCache.set(k, v);
    if (docCache.size > 200) {
      try { docCache.delete(docCache.keys().next().value); } catch (e) {}
    }
  }
  function fetchDoc(word) {
    var key = state.lang + ':' + word;
    if (docCache.has(key)) {
      return Promise.resolve(docCache.get(key));
    }
    var url = '/api/methods/' + encodeURIComponent(state.lang) + '/' + encodeURIComponent(word);
    try {
      return fetch(url).then(function (res) {
        if (!res.ok) return null;
        return res.json();
      }).then(function (data) {
        cacheSet(key, data || null);
        return data || null;
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function wordAt(text, off) {
    if (off < 0 || off >= text.length) return null;
    if (!/[A-Za-z0-9_]/.test(text.charAt(off))) return null;
    var s = off, e = off;
    while (s > 0 && /[A-Za-z0-9_]/.test(text.charAt(s - 1))) s--;
    while (e < text.length && /[A-Za-z0-9_]/.test(text.charAt(e))) e++;
    var w = text.slice(s, e);
    if (!/^[A-Za-z_]/.test(w)) return null;
    return { word: w, start: s, end: e };
  }

  var charWCache = { font: '', w: 8 };
  function measureChar() {
    try {
      var cs = getComputedStyle(ta);
      var font = (cs.fontSize || '') + ' ' + (cs.fontFamily || 'monospace');
      if (charWCache.font === font) return charWCache.w;
      var cv = document.createElement('canvas');
      var ctx = cv.getContext('2d');
      ctx.font = (cs.fontStyle || '') + ' ' + (cs.fontWeight || '') + ' ' +
        (cs.fontSize || '13px') + ' ' + (cs.fontFamily || 'monospace');
      var w = ctx.measureText('M').width || 8;
      charWCache = { font: font, w: w };
      return w;
    } catch (e) { return 8; }
  }

  function offsetFromPoint(x, y) {
    /* primary: real hit testing against the highlight layer */
    try {
      if (hl && typeof document.caretRangeFromPoint === 'function') {
        var r = document.caretRangeFromPoint(x, y);
        if (r && hl.contains(r.startContainer)) {
          var tmp = document.createRange();
          tmp.selectNodeContents(hl);
          tmp.setEnd(r.startContainer, r.startOffset);
          return Math.min(tmp.toString().length, displayText.length);
        }
      } else if (hl && typeof document.caretPositionFromPoint === 'function') {
        var p = document.caretPositionFromPoint(x, y);
        if (p && p.offsetNode && hl.contains(p.offsetNode)) {
          var tmp2 = document.createRange();
          tmp2.selectNodeContents(hl);
          tmp2.setEnd(p.offsetNode, p.offset);
          return Math.min(tmp2.toString().length, displayText.length);
        }
      }
    } catch (e) {}
    /* fallback: monospace geometry against the textarea (tab-stop aware) */
    try {
      var cs = getComputedStyle(ta);
      var lh = parseFloat(cs.lineHeight);
      if (!isFinite(lh) || lh <= 0) lh = (parseFloat(cs.fontSize) || 13) * 1.5;
      var r2 = ta.getBoundingClientRect();
      var padL = parseFloat(cs.paddingLeft) || 0;
      var padT = parseFloat(cs.paddingTop) || 0;
      var lines = displayText.split('\n');
      var row = Math.floor((y - r2.top - padT + ta.scrollTop) / lh);
      if (row < 0 || row >= lines.length) return null;
      var line = lines[row];
      var fx = (x - r2.left - padL + ta.scrollLeft) / measureChar();
      if (fx < 0) return null;
      var tab = parseInt(cs.tabSize, 10);
      if (!isFinite(tab) || tab <= 0) tab = 4;
      var acc = 0, col = 0;
      while (col < line.length && acc < fx) {
        acc += (line.charAt(col) === '\t') ? (tab - (acc % tab)) : 1;
        col++;
      }
      var starts = lineStartsOf(displayText);
      return Math.min(starts[row] + col, starts[row] + line.length);
    } catch (e2) { return null; }
  }

  var hoverToken = 0;
  var lastHoverOff = -1;
  var hoverRaf = false;

  function placeHover(x, y) {
    if (!hoverEl) return;
    try { hoverEl.classList.remove('hidden'); } catch (e) {}
    hoverEl.style.display = 'block';
    hoverEl.style.position = 'fixed';
    hoverEl.style.zIndex = '10000';
    hoverEl.style.maxWidth = '340px';
    var w = hoverEl.offsetWidth || 300;
    var h = hoverEl.offsetHeight || 80;
    var lx = Math.min(x + 12, window.innerWidth - w - 8);
    var ly = Math.min(y + 14, window.innerHeight - h - 8);
    if (lx < 4) lx = 4;
    if (ly < 4) ly = 4;
    hoverEl.style.left = lx + 'px';
    hoverEl.style.top = ly + 'px';
  }

  function showHoverMsg(msg, x, y) {
    if (!hoverEl) return;
    hoverEl.innerHTML = '<div class="oe-hover-msg">' + escHtml(msg) + '</div>';
    placeHover(x, y);
  }

  function showHoverDoc(doc, x, y) {
    if (!hoverEl || !doc) return;
    var html = '<div class="oe-hover-title">' + escHtml(doc.name || '') + '</div>' +
      (doc.signature ? '<div class="oe-hover-sig">' + escHtml(doc.signature) + '</div>' : '') +
      (doc.description ? '<div class="oe-hover-desc">' + escHtml(doc.description) + '</div>' : '') +
      (doc.usecase ? '<div class="oe-hover-use"><b>Use:</b> ' + escHtml(doc.usecase) + '</div>' : '') +
      (doc.example ? '<pre class="oe-hover-ex">' + escHtml(doc.example) + '</pre>' : '');
    hoverEl.innerHTML = html;
    placeHover(x, y);
  }

  function hideHover() {
    lastHoverOff = -1;
    hoverToken++;
    try { if (hoverEl) { hoverEl.style.display = 'none'; hoverEl.classList.add('hidden'); } } catch (e) {}
  }

  function lookupAt(x, y) {
    var off = offsetFromPoint(x, y);
    if (off == null) { hideHover(); return; }
    lastHoverOff = off;
    var my = ++hoverToken;
    var d = diagAt(off);
    if (d) { showHoverMsg(d.msg, x, y); return; }
    var w = wordAt(displayText, off);
    if (!w || w.word.length < 2 || w.word.length > 40) { hideHover(); return; }
    fetchDoc(w.word).then(function (doc) {
      if (my !== hoverToken || off !== lastHoverOff) return; /* stale */
      if (!doc) return;
      showHoverDoc(doc, x, y);
    });
  }

  function onMouseMove(e) {
    if (composing) return;
    var x = e.clientX, y = e.clientY;
    if (hoverRaf) return;
    hoverRaf = true;
    function go() {
      hoverRaf = false;
      try {
        var off = offsetFromPoint(x, y);
        if (off == null || off === lastHoverOff) {
          /* same spot: keep current tooltip, but reposition not needed */
          if (off == null) hideHover();
          return;
        }
        lookupAt(x, y);
      } catch (err) {}
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    else setTimeout(go, 30);
  }

  var hoverHost = wrap || hl || ta;
  try {
    if (hoverHost) hoverHost.addEventListener('mousemove', onMouseMove);
    ta.addEventListener('mousemove', onMouseMove);
  } catch (e) {}
  /* touch: tap shows docs (desktop keeps click clean) */
  try {
    var isTouch = ('ontouchstart' in window) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    if (isTouch) {
      ta.addEventListener('click', function (e) {
        try {
          if (ta.selectionStart !== ta.selectionEnd) return;
          lookupAt(e.clientX, e.clientY);
        } catch (err) {}
      });
    }
  } catch (e2) {}

  /* ================= 5. read-only submission view ================= */
  var lastViewEl = null;
  var lastViewWasHl = false;
  window.__oeView = {
    show: function (code, lang) {
      try {
        var text = String(code == null ? '' : code);
        var l = normLang(lang || state.lang);
        var hl2 = $('submission-view-hl');
        var codeEl = $('submission-view-code');
        if (hl2) {
          hl2.innerHTML = highlightWithDiags(capDisplay(text), l, []);
          /* highlighted host active: show it, hide plain <pre> fallback */
          try {
            hl2.classList.remove('hidden');
            hl2.style.display = '';
          } catch (e0) {}
          if (codeEl) {
            try { codeEl.style.display = 'none'; } catch (e1) {}
          }
          lastViewEl = hl2;
          lastViewWasHl = true;
        } else if (codeEl) {
          codeEl.textContent = text;
          try { codeEl.style.display = ''; } catch (e2) {}
          lastViewEl = codeEl;
          lastViewWasHl = false;
        }
      } catch (e) {
        try {
          var ce = $('submission-view-code');
          if (ce) ce.textContent = String(code == null ? '' : code);
        } catch (e2) {}
      }
    },
    hide: function () {
      try {
        if (lastViewEl && lastViewWasHl) lastViewEl.innerHTML = '';
        var hl3 = $('submission-view-hl');
        var pre3 = $('submission-view-code');
        /* restore fallback visibility: hide hl host, show pre */
        if (hl3) {
          try { hl3.classList.add('hidden'); } catch (e0) {}
          try { hl3.style.display = 'none'; } catch (e1) {}
        }
        if (pre3) {
          try { pre3.style.display = ''; } catch (e2) {}
        }
        lastViewEl = null;
      } catch (e) {}
    }
  };

  /* ================= editor events ================= */
  ta.addEventListener('input', function (e) {
    hideHover();
    scheduleRender();
    scheduleLint();
    notifyDocChange();
    if (composing) return;
    if (suppressSuggestOnce) { suppressSuggestOnce = false; return; }
    try {
      var ch = (e && e.data) || '';
      var type = (e && e.inputType) || '';
      if (type.indexOf('delete') === 0) {
        if (sugOpen) refreshSuggest('');
        return;
      }
      if (ch && (ch === '.' || ch === '(' || /[\w]/.test(ch))) {
        /* NOTE: '(' is never blocked — the char inserts normally; we only show the popup */
        refreshSuggest(ch);
      } else if (sugOpen && (!ch || ch === '')) {
        refreshSuggest('');
      } else if (!ch) {
        hideSuggest();
      }
    } catch (err) {}
  });

  ta.addEventListener('scroll', function () {
    syncScroll();
    hideHover();
    hideSuggest();
  });

  ta.addEventListener('compositionstart', function () {
    composing = true;
    hideSuggest();
  });
  ta.addEventListener('compositionend', function () {
    composing = false;
  });
  ta.addEventListener('blur', function () {
    setTimeout(hideSuggest, 150);
  });
  try {
    ta.addEventListener('mouseleave', hideHover);
  } catch (e) {}
  try {
    document.addEventListener('scroll', hideHover, true);
    window.addEventListener('resize', function () { hideHover(); hideSuggest(); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { hideHover(); }
    }, true);
  } catch (e2) {}

  /* ================= public API ================= */
  window.__oe = {
    getValue: function () { return ta.value; },
    setValue: function (v) {
      var s = String(v == null ? '' : v);
      if (ta.value === s) { scheduleRender(); return; }
      ta.value = s;
      diags = [];
      lintSnapshot = '';
      hideSuggest();
      hideHover();
      scheduleRender();
      scheduleLint();
    },
    setLanguage: function (lang) {
      var l = normLang(lang);
      if (l === state.lang) { scheduleRender(); return; }
      state.lang = l;
      diags = [];
      lintSnapshot = '';
      hideSuggest();
      hideHover();
      scheduleRender();
      scheduleLint();
    },
    onDocChange: function (cb) {
      if (typeof cb !== 'function') return function () {};
      docCbs.push(cb);
      return function () {
        var i = docCbs.indexOf(cb);
        if (i !== -1) docCbs.splice(i, 1);
      };
    }
  };

  /* CodeMirror is gone: keep the flag falsy, publish own-editor status. */
  try { window.__cmActive = false; } catch (e) {}
  try { window.__oeActive = true; } catch (e2) {}
  try { document.body.dataset.editor = 'own'; } catch (e3) {}
  try {
    var st = $('status-text');
    if (st) st.textContent = 'Editor: own \u2713 (' + state.lang + ')';
  } catch (e4) {}

  try { lintSnapshot = ''; } catch (e5) {}
  scheduleRender();
  scheduleLint();
})();
