/* MACD Signals page.
   Plain JavaScript, no libraries. It reads data/index.json and one data/<TICKER>.json per ticker
   (both written by the nightly job), plus data/screener.json for the Screener tab, keeps the
   viewer's lists in the page address and in this browser, and draws the dashboard, the screener,
   the charts and the glossary.
   Nothing here is advice: the page only describes what an indicator is doing. */
'use strict';
(function () {

// ---- constants -----------------------------------------------------------
const $ = id => document.getElementById(id);
// Every piece of text that comes from the viewer (tickers) or from a data file (names) goes
// through esc() before it is put into HTML.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const SYM_RE = /^[A-Z0-9^=.-]{1,12}$/;           // what a ticker may look like
const RANGES = [['5D', 5], ['1M', 21], ['3M', 63], ['6M', 126], ['1Y', 250]];
const STAGE = {1: 'early warning', 2: 'MACD turned', 3: 'CONFIRMED'};
const TABS = ['dash', 'screen', 'chart', 'info', 'list'];
const EXAMPLE = {h: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'], w: ['SPY', 'QQQ', 'DIA', 'BRK-B', 'JPM', 'VOO']};
const MAX_INFLIGHT = 8;                           // data files fetched at the same time
const INDEX_ERROR = 'The data has not been published yet, or the nightly job has not run. See SETUP.md.';
// Screener (data/screener.json: every ticker's latest day, written by the nightly job)
const SCREEN_ERROR = 'The screener data has not been published yet; it appears after the next nightly run.';
const SCREEN_CAP = 400;                           // rows shown at most; past that the viewer is asked to add a filter
const SCREEN_BARS = 21;                           // trading days the Screener's Recent strip covers (what screener.json holds)
const SHOWS = ['valley', 'peak', 'recover', 'all'];
// RSI choices for each Show setting, as [value, label]; 0 means "any". The side (below for
// valleys and recoveries, above for peaks) follows the Show setting, so only the number is stored.
const RSI_OPTS = {
  valley: [[0, 'any'], [50, 'below 50'], [40, 'below 40'], [30, 'below 30']],
  recover: [[0, 'any'], [50, 'below 50'], [40, 'below 40'], [30, 'below 30']],
  peak: [[0, 'any'], [60, 'above 60'], [70, 'above 70']],
  all: [[0, 'any']],
};
const RSI_DEFAULT = {valley: 40, recover: 40, peak: 60, all: 0};
const SCREEN_DEFAULTS = {show: 'valley', stage: 0, rsi: 40, within: 10, below: 0, group: 'all', choppy: true, notmine: false};

// ---- state ---------------------------------------------------------------
const S = {
  lists: {h: [], w: []},   // the viewer's holdings and watch tickers (validated, normalised)
  listSource: 'none',      // where the lists came from: hash, storage, edit or none
  index: null,             // parsed data/index.json
  indexError: null,        // why index.json could not be loaded
  files: {},               // ticker -> parsed data/<ticker>.json
  fileErrors: {},          // ticker -> why its file could not be loaded
  days: [],                // trading days with MACD values, ascending, over the loaded tickers
  day: null,               // selected trading day (YYYY-MM-DD)
  rangeN: 21,              // bars shown by sparklines, strips, timeline and charts
  chartSym: null,
  chartPending: null,      // a ticker opened from the Screener whose file is still being fetched
  tab: 'dash',
  editorNote: '',          // message about the last save (tickers that were ignored)
  loadToken: 0,
  indexDone: false,        // true once data/index.json has been tried (loaded or failed)
  screen: null,            // parsed data/screener.json (fetched the first time the Screener tab is shown)
  screenError: null,       // why screener.json could not be loaded
  screenLoading: false,
  screenF: Object.assign({}, SCREEN_DEFAULTS),   // the Screener's filter settings (remembered in localStorage)
};
const SORT = {holdings: {col: 'off', asc: true}, watch: {col: 'default', asc: true}, screen: {col: 'default', asc: true}};

// ---- small helpers -------------------------------------------------------
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window or storage off */ } }
function norm(t) { return String(t).trim().toUpperCase().replace(/\./g, '-'); }
function isNum(v) { return typeof v === 'number' && isFinite(v); }
function fmt(v, d) { return isNum(v) ? (v >= 0 ? '+' : '') + v.toFixed(d === undefined ? 3 : d) : '–'; }
function fmtClose(v) { return isNum(v) ? v.toFixed(Math.abs(v) >= 1 ? 2 : 4) : '–'; }
function fmtPct(v, d) { return isNum(v) ? v.toFixed(d === undefined ? 1 : d) + '%' : '–'; }
function rangeLabel() { return (RANGES.find(x => x[1] === S.rangeN) || [''])[0]; }
function weakPct() { const p = S.index && S.index.params; return p && isNum(p.weak_pct) ? p.weak_pct : 0.25; }
function hasOwn(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
function known(sym) { return !!(S.index && hasOwn(S.index.tickers, sym)); }
function listed() { return S.lists.h.concat(S.lists.w); }
function knownListed() { return listed().filter(known); }
function unknownListed() { return S.index ? listed().filter(s => !known(s)) : []; }
function loadedListed() { return knownListed().filter(s => S.files[s]); }
function isHolding(sym) { return S.lists.h.includes(sym); }
function indexStale(sym) {
  const t = S.index && S.index.tickers && S.index.tickers[sym];
  return !!(t && (t.stale || (t.last_bar && S.index.last_bar && t.last_bar < S.index.last_bar)));
}
function validSig(s) { return s && (s.dir === 'PEAK' || s.dir === 'VALLEY') && [1, 2, 3].includes(s.stage); }
function eventsOn(f, date) { const e = f.events && hasOwn(f.events, date) ? f.events[date] : null; return Array.isArray(e) ? e.filter(validSig) : []; }
function cls(sig) { return (sig.dir === 'PEAK' ? 'p' : 'v') + sig.stage; }
function badge(sig) { return `<span class="badge ${cls(sig)}">${sig.dir} ${STAGE[sig.stage]}</span>`; }
function sigText(sigs) { return sigs.map(s => `${s.dir} ${STAGE[s.stage]}`).join('; '); }
function staleBadge(r) { return r.stale ? ` <span class="badge stale" title="This ticker's newest data is from ${esc(r.date)}">data from ${esc(r.date)}</span>` : ''; }
// A ticker is a real button (not a bare <a>) so it can be reached with Tab and opened with Enter.
function symlink(sym, big) { return `<button type="button" class="symlink${big ? ' sym' : ''}" data-sym="${esc(sym)}" title="Open chart">${esc(sym)}</button>`; }
function topSignal(sigs, dir) {
  const s = sigs.filter(x => !dir || x.dir === dir);
  return s.length ? s.reduce((a, b) => (b.stage > a.stage ? b : a)) : null;
}
function topAny(sigs) {  // peaks beat valleys, then the higher stage
  return sigs.reduce((a, b) => (b.dir === 'PEAK') !== (a.dir === 'PEAK') ? (b.dir === 'PEAK' ? b : a) : (b.stage > a.stage ? b : a));
}
function maxStage(sigs) { return sigs.reduce((m, s) => Math.max(m, s.stage), 0); }  // highest stage of any direction, 0 if none
function rsiClass(v) { return v >= 70 ? 'hot' : v <= 30 ? 'cold' : ''; }
function meter(pct, fillCls, ticks) {
  const t = (ticks || []).map(x => `<span class="tick" style="left:${x}%"></span>`).join('');
  const w = isNum(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return `<div class="meter"><span class="fill ${fillCls || ''}" style="width:${w.toFixed(1)}%"></span>${t}</div>`;
}

// ---- the viewer's lists: URL hash, localStorage, editor ------------------
function parseTokens(text) {
  const ok = [], bad = [];
  String(text || '').split(/[\s,;]+/).forEach(t => {
    if (!t) return;
    const s = norm(t);
    if (SYM_RE.test(s)) { if (!ok.includes(s)) ok.push(s); } else bad.push(t.trim());
  });
  return {ok, bad};
}
function dedupe(h, w) {  // a ticker in both lists is a holding only
  const hs = [...new Set(h)];
  return {h: hs, w: [...new Set(w)].filter(x => !hs.includes(x))};
}
function readHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return null;
  let p;
  try { p = new URLSearchParams(raw); } catch (e) { return null; }
  if (!p.has('h') && !p.has('w')) return null;
  const parse = s => parseTokens(String(s || '').replace(/,/g, ' ')).ok;
  const l = dedupe(parse(p.get('h')), parse(p.get('w')));
  return (l.h.length || l.w.length) ? l : null;
}
function hashFor(l) {
  if (!l.h.length && !l.w.length) return '';
  const enc = a => a.filter(s => SYM_RE.test(s)).map(encodeURIComponent).join(',');
  return '#h=' + enc(l.h) + '&w=' + enc(l.w);
}
function writeHash() {
  try { history.replaceState(null, '', location.pathname + location.search + hashFor(S.lists)); } catch (e) { /* not allowed here */ }
}
function readStored() {
  try {
    const j = JSON.parse(lsGet('macd-lists') || 'null');
    if (!j || typeof j !== 'object') return null;
    const clean = a => (Array.isArray(a) ? a : []).map(norm).filter(x => SYM_RE.test(x));
    const l = dedupe(clean(j.h), clean(j.w));
    return (l.h.length || l.w.length) ? l : null;
  } catch (e) { return null; }
}
function storeLists() { lsSet('macd-lists', JSON.stringify({h: S.lists.h, w: S.lists.w})); }
function initLists() {
  const fromHash = readHash();
  if (fromHash) { S.lists = fromHash; S.listSource = 'hash'; return; }
  const stored = readStored();
  if (stored) { S.lists = stored; S.listSource = 'storage'; return; }
  S.lists = {h: [], w: []}; S.listSource = 'none';
}
function sameLists(a, b) { return a.h.join(',') === b.h.join(',') && a.w.join(',') === b.w.join(','); }
function fillEditor() {
  $('ed-h').value = S.lists.h.join(' ');
  $('ed-w').value = S.lists.w.join(' ');
}
function applyLists(l, note, stay) {
  // stay: keep the current tab (the Screener's "Add to watch" uses this); otherwise go to the Dashboard.
  S.lists = dedupe(l.h, l.w);
  S.listSource = 'edit';
  S.editorNote = note || '';
  storeLists();
  writeHash();
  fillEditor();
  refresh();
  if (!stay && (S.lists.h.length || S.lists.w.length)) showTab('dash');
}
function saveFromEditor() {
  const h = parseTokens($('ed-h').value), w = parseTokens($('ed-w').value);
  const bad = h.bad.concat(w.bad);
  applyLists({h: h.ok, w: w.ok}, bad.length ? 'Ignored because it does not look like a ticker: ' + bad.join(', ') : '');
}
function copyLink(which) {
  const url = location.href;
  const done = ok => {
    const el = $(which === 2 ? 'copied2' : 'copied');
    el.textContent = ok ? 'Link copied' : 'Could not copy. Copy the address from the address bar instead.';
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, ok ? 2500 : 6000);
  };
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-1000px';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) { done(false); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => done(true), fallback);
  else fallback();
}

// ---- data loading --------------------------------------------------------
async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function validIndex(d) { return d && typeof d === 'object' && d.tickers && typeof d.tickers === 'object'; }
function validFile(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.dates) || !d.dates.length) return false;
  return ['close', 'macd', 'signal', 'hist', 'rsi'].every(k => Array.isArray(d[k]) && d[k].length === d.dates.length);
}
async function loadIndex() {
  setStatus('Loading the data index…');
  try {
    const d = await fetchJSON('data/index.json', {cache: 'no-cache'});
    if (!validIndex(d)) throw new Error('index.json has an unexpected format');
    S.index = d; S.indexError = null;
  } catch (e) {
    S.index = null; S.indexError = String(e && e.message || e);
  }
  setStatus('');
}
async function loadFiles(syms) {
  const todo = syms.filter(s => SYM_RE.test(s) && !S.files[s]);
  if (!todo.length) return;
  const v = encodeURIComponent(S.index && S.index.generated ? S.index.generated : '');
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const sym = todo[next++];
      try {
        const d = await fetchJSON('data/' + encodeURIComponent(sym) + '.json?v=' + v);
        if (!validFile(d)) throw new Error('unexpected file format');
        S.files[sym] = d; delete S.fileErrors[sym];
      } catch (e) { S.fileErrors[sym] = String(e && e.message || e); }
    }
  }
  await Promise.all(Array.from({length: Math.min(MAX_INFLIGHT, todo.length)}, worker));
}
function setStatus(msg) { const el = $('status'); el.textContent = msg; el.hidden = !msg; }
async function refresh() {
  // Fetch whatever the lists need that is not loaded yet, then redraw.
  const token = ++S.loadToken;
  renderControls(); renderEditor(); renderFooter(); renderBanner();
  if (S.index) {
    const need = knownListed().filter(s => !S.files[s]);
    if (need.length) {
      setStatus(`Loading data for ${need.length} ticker${need.length > 1 ? 's' : ''}…`);
      $('dash-msg').hidden = true; $('dash-body').hidden = true;
      await loadFiles(need);
      if (token !== S.loadToken) return;  // a newer refresh took over
    }
  }
  setStatus('');  // always: a newer refresh with nothing to fetch must clear an older "Loading…"
  buildDays();
  render();
}

// ---- trading days and derived values -------------------------------------
function buildDays() {
  const set = new Set();
  loadedListed().forEach(sym => { const f = S.files[sym]; f.dates.forEach((d, i) => { if (isNum(f.macd[i])) set.add(d); }); });
  S.days = [...set].sort();
  if (!S.days.length) { S.day = null; return; }
  if (!S.day || !set.has(S.day)) S.day = (S.index && set.has(S.index.last_bar)) ? S.index.last_bar : S.days[S.days.length - 1];
}
function barIndex(f, day) {  // index of the ticker's last bar on or before the day, with MACD; -1 if none
  let lo = 0, hi = f.dates.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (f.dates[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 && isNum(f.macd[ans]) ? ans : -1;
}
function row(sym, day) {  // everything the page shows for one ticker on one day
  const f = S.files[sym];
  if (!f || !day) return null;
  const i = barIndex(f, day);
  if (i < 0) return null;
  let high = -Infinity;
  for (let k = 0; k <= i; k++) if (isNum(f.close[k]) && f.close[k] > high) high = f.close[k];
  const close = f.close[i], macd = f.macd[i], signal = f.signal[i], hist = f.hist[i], rsi = isNum(f.rsi[i]) ? f.rsi[i] : NaN;
  const pctOfPrice = isNum(close) && close > 0 ? Math.abs(macd) / close * 100 : 0;
  const prev = i > 0 ? f.hist[i - 1] : null;
  const name = f.name || (S.index.tickers[sym] && S.index.tickers[sym].name) || '';
  return {
    sym, name: String(name), f, i, date: f.dates[i], close, macd, signal, hist, rsi,
    pctOfPrice, weak: pctOfPrice < weakPct(),
    high, pct: high > 0 ? (1 - close / high) * 100 : 0,
    sigs: eventsOn(f, f.dates[i]),
    side: hist >= 0 ? 'above' : 'below',
    trend: isNum(prev) ? (hist > prev ? 'rising' : 'falling') : 'flat',
    stale: f.dates[i] !== day || indexStale(sym),
    group: isHolding(sym) ? 'holdings' : 'watch',
  };
}
function hasDir(r, dir) { return r.sigs.some(s => s.dir === dir); }
function rank(r) {  // peaks first, then valleys, then higher stage, then closeness to the high
  const p = topSignal(r.sigs, 'PEAK'), v = topSignal(r.sigs, 'VALLEY');
  if (p) return [0, -p.stage, r.pct];
  if (v) return [1, -v.stage, r.pct];
  return [2, 0, r.pct];
}
function windowDays() {  // the trading days in the selected range, ending at the selected day
  const end = S.days.indexOf(S.day) + 1;
  return end > 0 ? S.days.slice(Math.max(0, end - S.rangeN), end) : [];
}
function recentCount(r, days) { return days.reduce((n, d) => n + (eventsOn(r.f, d).length ? 1 : 0), 0); }
// Listed tickers whose data file could not be loaded (a Screener ticker that failed is not the list's problem).
function failedListed() { return Object.keys(S.fileErrors).filter(s => known(s) && listed().includes(s)); }

// ---- sparkline, strip, cards, tables ------------------------------------
function spark(r, n) {
  const f = r.f, start = Math.max(0, r.i - n + 1);
  const vals = [], dates = [];
  for (let k = start; k <= r.i; k++) if (isNum(f.hist[k])) { vals.push(f.hist[k]); dates.push(f.dates[k]); }
  if (!vals.length) return '';
  const W = n <= 10 ? 60 : 120, H = 24, mid = H / 2;
  const max = Math.max(...vals.map(Math.abs), 1e-9);
  const slot = W / vals.length, bw = Math.max(1, slot - (slot > 3 ? 1.5 : 0.3));
  const bars = vals.map((v, i) => {
    const h = Math.max(0.5, Math.abs(v) / max * (mid - 1));
    const y = v >= 0 ? mid - h : mid;
    return `<rect class="${v >= 0 ? 'pos' : 'neg'}" x="${(i * slot).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(dates[i])} ${v.toFixed(3)}</title></rect>`;
  }).join('');
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><line class="zero" x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke-width="1"/>${bars}</svg>`;
}
function strip(sigsOn, days, n) {
  // sigsOn(date) returns that day's signals ({dir, stage} objects); the Dashboard reads them from
  // the ticker file, the Screener from screener.json's "recent" map.
  const W = 120, H = 14, slot = W / n, mw = Math.max(3, Math.min(10, slot - 2));
  const off = n - days.length;  // right-align: newest on the right
  const marks = days.map((d, j) => {
    const x = (off + j) * slot + slot / 2;
    const sigs = sigsOn(d);
    if (!sigs.length) return n <= 21 ? `<circle cx="${x.toFixed(1)}" cy="${H / 2}" r="1.5" fill="var(--border)"><title>${esc(d)}: no new signal</title></circle>` : '';
    return `<rect class="${cls(topAny(sigs))}f" x="${(x - mw / 2).toFixed(1)}" y="2" width="${mw.toFixed(1)}" height="${H - 4}" rx="2"><title>${esc(d)}: ${esc(sigText(sigs))}</title></rect>`;
  }).join('');
  return `<svg class="strip" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><line class="track" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke-width="1"/>${marks}</svg>`;
}
function stagesSeen(r, dir) {  // stages of this direction seen in the last 10 trading days of the ticker
  const seen = new Set();
  for (let k = Math.max(0, r.i - 9); k <= r.i; k++) eventsOn(r.f, r.f.dates[k]).forEach(s => { if (s.dir === dir) seen.add(s.stage); });
  return seen;
}
function card(r, dir) {
  const mine = r.sigs.filter(s => s.dir === dir);
  const top = topSignal(mine);
  const seen = stagesSeen(r, dir);
  const today = new Set(mine.map(s => s.stage));
  const pfx = dir === 'PEAK' ? 'p' : 'v';
  const steps = [1, 2, 3].map(st => `<div class="step ${seen.has(st) ? 'on ' + pfx + st : ''} ${today.has(st) ? 'today' : ''}">${STAGE[st]}</div>`).join('');
  const badges = mine.slice().sort((a, b) => a.stage - b.stage).map(badge);
  if (dir === 'PEAK' && r.pct <= 2) badges.push('<span class="badge flag">near 1-yr high</span>');
  if (r.rsi >= 70) badges.push('<span class="badge flag">RSI 70+</span>');
  if (r.weak) badges.push('<span class="badge choppy">choppy</span>');
  const detail = mine.map(s => s.detail).filter(Boolean).join('; ');
  return `<div class="card ${dir.toLowerCase()} s${top.stage}">
    <div class="card-head">${symlink(r.sym, true)}${badges.join('')}${staleBadge(r)}<span class="price">close ${fmtClose(r.close)}</span></div>
    <div class="name">${esc(r.name)}</div>
    <div class="stepper">${steps}</div>
    <div class="metrics">
      <div class="metric"><div class="label"><span>RSI (14)</span><b>${isNum(r.rsi) ? r.rsi.toFixed(0) : '–'}</b></div>${meter(r.rsi, rsiClass(r.rsi), [30, 70])}</div>
      <div class="metric"><div class="label"><span>Below 1-yr high</span><b>${fmtPct(r.pct)}</b></div>${meter(100 - r.pct, '', [98])}</div>
    </div>
    <div class="detail"><span class="mono">MACD ${fmt(r.macd)}, signal ${fmt(r.signal)}, histogram ${fmt(r.hist)}</span> (${r.pctOfPrice.toFixed(2)}% of price), ${r.side} signal by ${Math.abs(r.hist).toFixed(3)}, histogram ${r.trend}.${detail ? ' ' + esc(detail) + '.' : ''}</div>
  </div>`;
}
// Compare two sort values: arrays element by element (a rank), anything else directly.
function cmpVal(x, y) {
  if (Array.isArray(x)) { for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1; return 0; }
  return x < y ? -1 : x > y ? 1 : 0;
}
function sortRows(rows, key, days) {
  const s = SORT[key];
  const val = r => ({
    symbol: r.sym, name: r.name.toLowerCase(), today: rank(r), rsi: r.rsi, off: r.pct,
    macd: (r.hist >= 0 ? 0 : 2) + (r.trend === 'rising' ? 0 : 1), hist: r.hist, close: r.close,
    recent: recentCount(r, days), default: rank(r)})[s.col];
  rows.sort((a, b) => (s.asc ? 1 : -1) * cmpVal(val(a), val(b)) || a.sym.localeCompare(b.sym));
  return rows;
}
// Table header cells for a sortable table: cols is [[column key, label], ...], key names the SORT entry.
// The label is a real button so the header can be sorted from the keyboard as well as by mouse.
function sortHeaders(cols, key) {
  const sort = SORT[key];
  return cols.map(([k, label]) => `<th class="${sort.col === k ? 'sorted ' + (sort.asc ? 'asc' : '') : ''}"${sort.col === k ? ` aria-sort="${sort.asc ? 'ascending' : 'descending'}"` : ''}><button type="button" class="sorth" data-key="${key}" data-col="${k}" title="Sort by ${label}">${label}</button></th>`).join('');
}
function rsiCell(r) { return `<td class="num">${isNum(r.rsi) ? r.rsi.toFixed(0) : '–'}<span class="bar"><i class="${rsiClass(r.rsi)}" style="width:${isNum(r.rsi) ? r.rsi.toFixed(1) : 0}%"></i></span></td>`; }
function pctCell(r) { return `<td class="num">${fmtPct(r.pct)}<span class="bar"><i style="width:${Math.max(0, 100 - r.pct).toFixed(1)}%"></i></span></td>`; }
function tableHTML(rows, key, days) {
  const cols = [
    ['symbol', 'Ticker'], ['name', 'Name'], ['today', 'Signal'], ['macd', 'MACD vs signal'], ['hist', `Histogram (${rangeLabel()})`],
    ['close', 'Close'], ['rsi', 'RSI'], ['off', '% below 1-yr high'], ['recent', `Recent (${rangeLabel()})`]];
  const ths = sortHeaders(cols, key);
  const body = rows.map(r => {
    const t = r.sigs.length ? r.sigs.map(badge).join(' ') : '<span class="sub">–</span>';
    const rc = hasDir(r, 'PEAK') ? 'has-peak' : hasDir(r, 'VALLEY') ? 'has-valley' : '';
    return `<tr class="${rc}">
      <td><b>${symlink(r.sym)}</b>${r.weak ? ' <span class="badge choppy">choppy</span>' : ''}${staleBadge(r)}</td>
      <td class="name" title="${esc(r.name)}">${esc(r.name)}</td>
      <td>${t}</td>
      <td>${r.side}, ${r.trend}</td>
      <td>${spark(r, S.rangeN)}</td>
      <td class="num">${fmtClose(r.close)}</td>
      ${rsiCell(r)}
      ${pctCell(r)}
      <td>${strip(d => eventsOn(r.f, d), days, S.rangeN)}</td>
    </tr>`;
  }).join('');
  return `<table><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---- dashboard -----------------------------------------------------------
function dashMessage(html) {
  $('dash-msg').innerHTML = html; $('dash-msg').hidden = false; $('dash-body').hidden = true;
}
function renderDash() {
  if (S.indexError) { dashMessage(`<div class="notice error"><p>${esc(INDEX_ERROR)}</p><p class="sub">Technical detail: ${esc(S.indexError)}</p></div>`); return; }
  if (!listed().length) { dashMessage('<div class="notice"><p>No tickers yet. Open <b>My list</b> to enter the tickers you own and the ones you are watching, or load an example list.</p><p><button class="primary" data-goto="list">Open My list</button></p></div>'); return; }
  if (!S.day) {
    const unknown = unknownListed(), failed = failedListed();
    if (S.loadToken && !knownListed().length) dashMessage(`<div class="notice"><p>None of the tickers on your list are in the data set yet.</p><p>Not in the data set: ${esc(unknown.join(', '))}. Ask the site owner to add it to universe.txt.</p><p><button data-goto="list">Open My list</button></p></div>`);
    else if (failed.length) dashMessage(`<div class="notice error"><p>The data files for your tickers could not be loaded (${esc(failed.join(', '))}). Try again in a minute; if it keeps happening, the nightly job may have a problem.</p></div>`);
    else dashMessage('<div class="notice"><p>Loading…</p></div>');
    return;
  }
  $('dash-msg').hidden = true; $('dash-body').hidden = false;
  const day = S.day, days = windowDays();
  const rows = loadedListed().map(s => row(s, day)).filter(Boolean);
  const hold = rows.filter(r => r.group === 'holdings'), watch = rows.filter(r => r.group !== 'holdings');
  $('rangenote').textContent = rangeLabel();

  // Card order: strongest stage first, then not choppy, then larger |MACD| as a percent of price.
  const byStrength = dir => (a, b) => topSignal(b.sigs, dir).stage - topSignal(a.sigs, dir).stage || (a.weak ? 1 : 0) - (b.weak ? 1 : 0) || b.pctOfPrice - a.pctOfPrice;
  const peaks = hold.filter(r => hasDir(r, 'PEAK')).sort(byStrength('PEAK'));
  const valleys = hold.filter(r => hasDir(r, 'VALLEY') && !hasDir(r, 'PEAK')).sort(byStrength('VALLEY'));
  // Choppy tickers (money-market and short Treasury funds) sit at their high with a flat MACD; not a "near high" worth a chip.
  const near = hold.filter(r => !r.sigs.length && !r.weak && r.pct <= 2 && r.rsi >= 65).sort((a, b) => a.pct - b.pct);
  const whits = watch.filter(r => r.sigs.length);

  $('stats').innerHTML = [
    ['Holdings with PEAK signals', peaks.length, 'peak'],
    ['Holdings with VALLEY signals', valleys.length, 'valley'],
    ['Watch tickers with signals', whits.length, ''],
    ['Data as of', `<span class="small">${esc(day)}</span>`, ''],
  ].map(([l, v, c]) => `<div class="stat ${c}"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

  $('peaks').innerHTML = peaks.length ? `<div class="cards">${peaks.map(r => card(r, 'PEAK')).join('')}</div>` : '<div class="empty">No new PEAK signals on your holdings on this day.</div>';
  $('nearhigh').innerHTML = near.length ? `<div class="chips">${near.map(r =>
    `<div class="chip"><b>${symlink(r.sym)}</b>${staleBadge(r)} <span>RSI ${isNum(r.rsi) ? r.rsi.toFixed(0) : '–'}, ${fmtPct(r.pct)} off high, histogram ${r.trend}</span></div>`).join('')}</div>`
    : '<div class="empty">None on this day.</div>';
  $('valleys').innerHTML = valleys.length ? `<div class="cards">${valleys.map(r => card(r, 'VALLEY')).join('')}</div>` : '<div class="empty">No new VALLEY signals on your holdings on this day.</div>';
  $('holdings').innerHTML = hold.length ? tableHTML(sortRows(hold.slice(), 'holdings', days), 'holdings', days) : '<div class="empty">No holdings with data. Add some on the My list tab.</div>';
  const wrows = $('allwatch').checked ? watch.slice() : whits.slice();
  $('watch').innerHTML = wrows.length ? tableHTML(sortRows(wrows, 'watch', days), 'watch', days)
    : (watch.length ? '<div class="empty">No watchlist signals on this day.</div>' : '<div class="empty">No watch tickers with data.</div>');
  // A ticker whose history starts after the selected day has no row; say so under its own table.
  const missing = rows.length < loadedListed().length ? loadedListed().filter(s => !rows.some(r => r.sym === s)) : [];
  [['holdings', missing.filter(isHolding)], ['watch', missing.filter(s => !isHolding(s))]].forEach(([id, m]) => {
    if (m.length) $(id).insertAdjacentHTML('beforeend', `<p class="sub">No data on or before this day for: ${esc(m.join(', '))}.</p>`);
  });
  const failed = failedListed();
  if (failed.length) $('watch').insertAdjacentHTML('beforeend', `<p class="err">Could not load the data file for: ${esc(failed.join(', '))}. These tickers are left out until the page is reloaded.</p>`);

  // Timeline: every listed ticker that fired within the range, newest day on the right.
  const n = days.length;
  const size = S.rangeN <= 30 ? 20 : S.rangeN <= 63 ? 14 : 10;
  const firing = loadedListed().map(sym => ({sym, f: S.files[sym], cells: days.map(d => eventsOn(S.files[sym], d))})).filter(o => o.cells.some(c => c.length));
  if (!n || !firing.length) { $('timeline').innerHTML = '<div class="empty">No signals in this window.</div>'; }
  else {
    firing.sort((a, b) => (isHolding(a.sym) ? 0 : 1) - (isHolding(b.sym) ? 0 : 1) || a.sym.localeCompare(b.sym));
    const every = n <= 30 ? 1 : n <= 63 ? 5 : 10;
    const head = `<tr><th></th>${days.map((d, j) => `<th>${(j % every === 0 || j === n - 1) ? esc(d.slice(5)) : ''}</th>`).join('')}</tr>`;
    const trs = firing.map(o => `<tr><td>${symlink(o.sym)}${isHolding(o.sym) ? '' : ' <span class="sub">(watch)</span>'}${staleBadge(row(o.sym, day) || {stale: false})}</td>${o.cells.map((sigs, j) => {
      const st = `style="width:${size}px;height:${size}px"`;
      if (!sigs.length) return `<td><div class="cell" ${st}></div></td>`;
      const top = topAny(sigs);
      return `<td><div class="cell ${cls(top)}" ${st} title="${esc(days[j])}: ${esc(sigText(sigs))}">${size >= 14 ? top.dir[0] + top.stage : ''}</div></td>`;
    }).join('')}</tr>`).join('');
    $('timeline').innerHTML = `<table class="tl">${head}${trs}</table>` +
      (n < S.rangeN ? `<div class="sub" style="margin-top:6px">Only ${n} trading day${n > 1 ? 's' : ''} of history are available before the selected day.</div>` : '');
  }
}

// ---- chart ---------------------------------------------------------------
function chartSyms() {
  const all = loadedListed();
  const syms = S.lists.h.filter(s => all.includes(s)).concat(S.lists.w.filter(s => all.includes(s)));
  // A ticker opened from the Screener is shown too, even though it is not on the viewer's lists.
  if (S.chartSym && S.files[S.chartSym] && !syms.includes(S.chartSym)) syms.push(S.chartSym);
  return syms;
}
function chartLabel(s) { return isHolding(s) ? '' : S.lists.w.includes(s) ? ' (watch)' : ' (screener)'; }
// Open a ticker on the Charts tab; a Screener ticker's file is fetched first if it is not loaded yet.
async function openChart(sym) {
  S.chartSym = sym;
  const need = !S.files[sym] && known(sym);
  S.chartPending = need ? sym : null;  // a loaded ticker shows at once, even if another one is still being fetched
  showTab('chart'); window.scrollTo({top: 0});
  if (!need) return;
  await loadFiles([sym]);
  if (S.chartPending !== sym) return;  // the viewer opened something else meanwhile
  S.chartPending = null;
  if (S.tab === 'chart') renderChart();
}
function renderChart() {
  const box = $('chartbox');
  if (S.chartPending) {  // a Screener ticker whose file is still on its way
    $('chartsym').innerHTML = `<option>${esc(S.chartPending)}</option>`; $('chartmeta').textContent = '';
    box.innerHTML = `<div class="empty">Loading data for ${esc(S.chartPending)}…</div>`;
    return;
  }
  const syms = chartSyms();
  if (S.chartSym && !syms.includes(S.chartSym) && S.fileErrors[S.chartSym]) {  // a Screener ticker whose file failed
    $('chartsym').innerHTML = `<option>${esc(S.chartSym)}</option>`; $('chartmeta').textContent = '';
    box.innerHTML = `<div class="empty">Could not load the data file for ${esc(S.chartSym)} (${esc(S.fileErrors[S.chartSym])}). Try again in a minute.</div>`;
    return;
  }
  if (!syms.length) {
    $('chartsym').innerHTML = ''; $('chartmeta').textContent = '';
    box.innerHTML = `<div class="empty">${S.indexError ? esc(INDEX_ERROR) : 'No tickers with data yet. Add some on the My list tab.'}</div>`;
    return;
  }
  if (!S.chartSym || !syms.includes(S.chartSym)) S.chartSym = syms[0];
  $('chartsym').innerHTML = syms.map(s => `<option value="${esc(s)}"${s === S.chartSym ? ' selected' : ''}>${esc(s)}${chartLabel(s)}</option>`).join('');
  const f = S.files[S.chartSym];
  const day = S.day || f.dates[f.dates.length - 1];  // no lists yet (Screener only): the ticker's own newest day
  const r = row(S.chartSym, day);
  if (!r) { box.innerHTML = `<div class="empty">No data for ${esc(S.chartSym)} on or before ${esc(day)}.</div>`; $('chartmeta').textContent = ''; return; }
  const end = r.i + 1, start = Math.max(0, end - S.rangeN);
  const D = f.dates.slice(start, end), C = f.close.slice(start, end), M = f.macd.slice(start, end),
    Sg = f.signal.slice(start, end), Hs = f.hist.slice(start, end), Rs = f.rsi.slice(start, end);
  const n = D.length;
  $('chartmeta').innerHTML = `Close ${fmtClose(r.close)}, RSI ${isNum(r.rsi) ? r.rsi.toFixed(1) : '–'}, ${fmtPct(r.pct)} below 1-yr high, MACD ${fmt(r.macd)} / signal ${fmt(r.signal)} / histogram ${fmt(r.hist)}${r.weak ? ' (choppy)' : ''}${staleBadge(r)}`;

  const marks = {};
  D.forEach(d => { const e = eventsOn(f, d); if (e.length) marks[d] = e; });

  const W = Math.max(320, box.clientWidth - 28), L = 58, R = 14, T = 16, GAP = 28, H1 = 170, H2 = 150, H3 = 80, B = 24;
  const top2 = T + H1 + GAP, top3 = top2 + H2 + GAP, Htot = top3 + H3 + B;
  const plotW = W - L - R, slot = plotW / n, bw = Math.max(1, Math.min(14, slot * 0.7));
  const xs = i => L + slot * (i + 0.5);
  const nums = a => a.filter(isNum);
  let cmin = Math.min(...nums(C)), cmax = Math.max(...nums(C));
  if (isNum(r.high) && r.high <= cmax * 1.25) cmax = Math.max(cmax, r.high);
  const pad = (cmax - cmin) * 0.08 || cmax * 0.02 || 1; cmin -= pad; cmax += pad;
  const y1 = v => T + H1 - (v - cmin) / (cmax - cmin) * H1;
  const mall = nums(M.concat(Sg, Hs, [0])); let mmin = Math.min(...mall), mmax = Math.max(...mall);
  const mpad = (mmax - mmin) * 0.1 || 1; mmin -= mpad; mmax += mpad;
  const y2 = v => top2 + H2 - (v - mmin) / (mmax - mmin) * H2;
  const y3 = v => top3 + H3 - v / 100 * H3;
  const path = (arr, y) => { let d = '', pen = false; arr.forEach((v, i) => { if (!isNum(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + xs(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }); return d; };
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  // Grid labels get as many decimals as the tick step needs (a flat price such as a T-bill fund
  // moves by cents, so "100 / 100 / 100" would tell the viewer nothing), capped at 6.
  const ticks = (lo, hi, k) => {
    const step = niceStep((hi - lo) / k), dec = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(6));
    return out.map(v => [v, v.toFixed(dec)]);
  };
  let g = '';
  ticks(cmin, cmax, 4).forEach(([v, label]) => { g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y1(v).toFixed(1)}" y2="${y1(v).toFixed(1)}"/><text x="${L - 6}" y="${(y1(v) + 4).toFixed(1)}" text-anchor="end">${label}</text>`; });
  ticks(mmin, mmax, 3).forEach(([v, label]) => { g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y2(v).toFixed(1)}" y2="${y2(v).toFixed(1)}"/><text x="${L - 6}" y="${(y2(v) + 4).toFixed(1)}" text-anchor="end">${label}</text>`; });
  [0, 30, 50, 70, 100].forEach(v => { g += `<line class="${v === 30 || v === 70 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y3(v).toFixed(1)}" y2="${y3(v).toFixed(1)}"/>` + (v === 30 || v === 70 ? `<text x="${L - 6}" y="${(y3(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>` : ''); });
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))));
  let xt = '';
  D.forEach((d, i) => { if (i % every === 0 || i === n - 1) xt += `<text x="${xs(i).toFixed(1)}" y="${Htot - 6}" text-anchor="middle">${esc(d.slice(5))}</text>`; });
  const bars = Hs.map((v, i) => { if (!isNum(v)) return ''; const y0 = y2(0), y = y2(v); return `<rect class="${v >= 0 ? 'hpos' : 'hneg'}" x="${(xs(i) - bw / 2).toFixed(1)}" y="${Math.min(y0, y).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(y0 - y)).toFixed(1)}"/>`; }).join('');
  const mk = D.map((d, i) => { const s = marks[d]; if (!s || !isNum(M[i])) return ''; const top = topAny(s); return `<circle class="mark ${cls(top)}f" cx="${xs(i).toFixed(1)}" cy="${y2(M[i]).toFixed(1)}" r="5"><title>${esc(d)}: ${esc(sigText(s))}</title></circle>`; }).join('');
  const hiLine = isNum(r.high) && r.high <= cmax ? `<line class="hi" x1="${L}" x2="${W - R}" y1="${y1(r.high).toFixed(1)}" y2="${y1(r.high).toFixed(1)}"/><text x="${W - R}" y="${(y1(r.high) - 4).toFixed(1)}" text-anchor="end">1-yr high ${fmtClose(r.high)}</text>` : '';
  const last = C[n - 1];
  const closeY = isNum(last) ? (isNum(r.high) && Math.abs(y1(last) - y1(r.high)) < 16 ? y1(last) + 14 : y1(last) - 6) : 0;
  const closeLabel = isNum(last) ? `<text x="${W - R}" y="${closeY.toFixed(1)}" text-anchor="end" font-weight="600">close ${fmtClose(last)}</text>` : '';
  box.innerHTML = `<div class="chart-head"><span class="sym">${esc(S.chartSym)}</span><span class="meta">${esc(r.name)}${r.name ? ' · ' : ''}${rangeLabel()}, ${n} trading days, ${esc(D[0])} to ${esc(D[n - 1])}</span>
      <span class="chart-legend"><span><i style="background:var(--line-price)"></i>Close</span><span><i style="background:var(--line-macd)"></i>MACD</span><span><i style="background:var(--line-signal)"></i>Signal</span><span><i style="background:var(--hist-pos)"></i><i style="background:var(--hist-neg);margin-left:-3px"></i>Histogram</span><span><i style="background:var(--line-rsi)"></i>RSI</span></span></div>
    <svg class="chart" viewBox="0 0 ${W} ${Htot}" width="${W}" height="${Htot}">
      <text x="${L}" y="${T - 4}" font-weight="600">Close</text>
      ${g}${hiLine}
      <path class="price" d="${path(C, y1)}"/>${closeLabel}
      <text x="${L}" y="${top2 - 6}" font-weight="600">MACD ${macdLabel()}</text>
      <line class="zero" x1="${L}" x2="${W - R}" y1="${y2(0).toFixed(1)}" y2="${y2(0).toFixed(1)}"/>
      ${bars}
      <path class="sig" d="${path(Sg, y2)}"/><path class="macd" d="${path(M, y2)}"/>
      ${mk}
      <text x="${L}" y="${top3 - 6}" font-weight="600">RSI ${rsiLabel()}</text>
      <path class="rsi" d="${path(Rs, y3)}"/>
      ${xt}
      <line id="cross" class="cross" y1="${T}" y2="${Htot - B}" style="display:none"/>
      <rect id="hit" x="${L}" y="${T}" width="${plotW}" height="${Htot - B - T}" fill="transparent"/>
    </svg><div class="tip" id="tip"></div>`;
  const svg = box.querySelector('svg'), cross = $('cross'), tip = $('tip');
  const move = e => {
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) * W / rect.width;
    const i = Math.max(0, Math.min(n - 1, Math.floor((px - L) / slot)));
    cross.setAttribute('x1', xs(i)); cross.setAttribute('x2', xs(i)); cross.style.display = '';
    const s = marks[D[i]];
    tip.innerHTML = `<b>${esc(D[i])}</b><br>Close ${fmtClose(C[i])}<br>MACD ${fmt(M[i])} &nbsp; Signal ${fmt(Sg[i])}<br>Histogram ${fmt(Hs[i])}<br>RSI ${isNum(Rs[i]) ? Rs[i].toFixed(1) : '–'}` + (s ? `<br>${s.map(badge).join(' ')}` : '');
    tip.style.display = 'block';
    const bx = box.getBoundingClientRect();
    const left = e.clientX - bx.left + 14, top = e.clientY - bx.top + 14;
    tip.style.left = Math.max(0, Math.min(left, box.clientWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.min(top, box.clientHeight - tip.offsetHeight - 8) + 'px';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { cross.style.display = 'none'; tip.style.display = 'none'; });
}
function macdLabel() { const p = S.index && S.index.params || {}; return `${p.fast || 12}/${p.slow || 26}/${p.signal || 9}`; }
function rsiLabel() { const p = S.index && S.index.params || {}; return `(${p.rsi || 14})`; }

// ---- screener: every ticker that fired on the latest day ------------------
// The filters live in S.screenF and in localStorage "macd-screen". The controls are static
// HTML; syncScreenControls() writes the settings into them and readScreenControls() reads
// them back after a change. The table is rebuilt from S.screen (screener.json) each time.
function validScreener(d) { return !!(d && typeof d === 'object' && d.tickers && typeof d.tickers === 'object' && typeof d.last_bar === 'string'); }
function screenGroups() { return S.screen && Array.isArray(S.screen.groups) ? S.screen.groups.filter(g => typeof g === 'string') : []; }
function dirOf(F) { return F.show === 'peak' ? 'PEAK' : 'VALLEY'; }
// A valid filter set from anything (stored JSON, the controls); unknown or missing values fall
// back to the defaults. The RSI value must be one of the choices for the current Show setting.
function cleanScreenF(o) {
  const f = Object.assign({}, SCREEN_DEFAULTS);
  if (!o || typeof o !== 'object') return f;
  if (SHOWS.includes(o.show)) f.show = o.show;
  if ([0, 2, 3].includes(+o.stage)) f.stage = +o.stage;
  f.rsi = RSI_OPTS[f.show].some(x => x[0] === +o.rsi) ? +o.rsi : RSI_DEFAULT[f.show];
  if ([5, 10, 21].includes(+o.within)) f.within = +o.within;
  if ([0, 5, 10, 20, 30].includes(+o.below)) f.below = +o.below;
  // The group is kept as text: screener.json (which lists the groups) may not be loaded yet.
  if (typeof o.group === 'string' && o.group.length <= 60) f.group = o.group;
  if (typeof o.choppy === 'boolean') f.choppy = o.choppy;
  if (typeof o.notmine === 'boolean') f.notmine = o.notmine;
  return f;
}
function readStoredScreen() { try { return cleanScreenF(JSON.parse(lsGet('macd-screen') || 'null')); } catch (e) { return cleanScreenF(null); } }
function storeScreen() { lsSet('macd-screen', JSON.stringify(S.screenF)); }
function activeGroup(F) { return screenGroups().includes(F.group) ? F.group : 'all'; }
function syncScreenControls() {
  const F = S.screenF, groups = screenGroups(), g = activeGroup(F);
  $('sc-show').value = F.show;
  $('sc-within-wrap').hidden = F.show !== 'recover';
  $('sc-within').value = String(F.within);
  $('sc-stage').value = String(F.stage);
  $('sc-stage').disabled = F.show === 'recover';  // a recovery is a stage-3 event by definition
  $('sc-rsi').innerHTML = RSI_OPTS[F.show].map(([v, label]) => `<option value="${v}"${v === F.rsi ? ' selected' : ''}>${label}</option>`).join('');
  $('sc-below').value = String(F.below);
  $('sc-group').innerHTML = ['all'].concat(groups).map(x => `<option value="${esc(x)}"${x === g ? ' selected' : ''}>${x === 'all' ? 'All groups' : esc(x)}</option>`).join('');
  $('sc-choppy').checked = F.choppy;
  $('sc-mine').checked = F.notmine;
}
function readScreenControls() {
  S.screenF = cleanScreenF({show: $('sc-show').value, stage: $('sc-stage').value, rsi: $('sc-rsi').value, within: $('sc-within').value,
    // Until screener.json is in, the Group select only has "All groups"; keep the remembered group then.
    below: $('sc-below').value, group: screenGroups().length ? $('sc-group').value : S.screenF.group,
    choppy: $('sc-choppy').checked, notmine: $('sc-mine').checked});
  storeScreen();
  renderScreen();
}
async function loadScreener() {
  if (S.screen || S.screenLoading || !S.indexDone) return;  // init() calls again once index.json is in
  S.screenLoading = true;
  renderScreen();
  try {
    const v = encodeURIComponent(S.index && S.index.generated ? S.index.generated : '');
    const d = await fetchJSON('data/screener.json?v=' + v);
    if (!validScreener(d)) throw new Error('screener.json has an unexpected format');
    S.screen = d; S.screenError = null;
  } catch (e) { S.screenError = String(e && e.message || e); }
  S.screenLoading = false;
  if (S.tab === 'screen') renderScreen();
}
// One screener.json entry as a row object (same field names as row() where they overlap, so the
// badge, bar and strip helpers work on it). Bad values are made harmless rather than trusted.
function screenRow(sym, e) {
  if (!e || typeof e !== 'object') return null;
  const sigsOf = a => (Array.isArray(a) ? a.map(p => Array.isArray(p) ? {dir: p[0], stage: p[1]} : null) : []).filter(validSig);
  const recent = {};
  if (e.recent && typeof e.recent === 'object') Object.keys(e.recent).forEach(d => { recent[d] = sigsOf(e.recent[d]); });
  const c = e.cross;
  const cross = c && typeof c === 'object' && (c.dir === 'PEAK' || c.dir === 'VALLEY') && isNum(c.days) ? {dir: c.dir, date: String(c.date || ''), days: c.days} : null;
  const date = typeof e.last_bar === 'string' ? e.last_bar : '';
  return {
    sym, name: String(e.name || ''), group: typeof e.group === 'string' ? e.group : 'Other stocks',
    date, stale: !!e.stale || (!!date && date < S.screen.last_bar),
    close: e.close, rsi: isNum(e.rsi) ? e.rsi : NaN, hist: isNum(e.hist) ? e.hist : NaN,
    weak: !!e.weak, pct: isNum(e.pct_below_high) ? e.pct_below_high : 0, chg1: e.chg_1m, chg3: e.chg_3m,
    side: e.side === 'below' ? 'below' : 'above', trend: ['rising', 'falling', 'flat'].includes(e.trend) ? e.trend : 'flat',
    macdDir: e.macd_dir, sigs: sigsOf(e.today), recent, cross,
    listed: listed().includes(sym), holding: isHolding(sym),
  };
}
function screenMatch(r, F) {
  if (F.show === 'recover') {
    // Momentum crossed up recently and is still going: a confirmed valley within the window,
    // histogram still positive, MACD line still rising. The stage setting does not apply.
    if (!r.cross || r.cross.dir !== 'VALLEY' || r.cross.days > F.within || !(r.hist > 0) || r.macdDir !== 'rising') return false;
  } else {
    const stage = F.show === 'all' ? maxStage(r.sigs) : (topSignal(r.sigs, dirOf(F)) || {stage: 0}).stage;
    if (!stage || stage < F.stage) return false;
  }
  if (F.rsi) {  // "below 40" for valleys and recoveries, "above 60" for peaks; no RSI never matches
    if (!isNum(r.rsi)) return false;
    if (F.show === 'peak' ? r.rsi <= F.rsi : r.rsi >= F.rsi) return false;
  }
  if (F.below && !(r.pct >= F.below)) return false;
  const g = activeGroup(F);
  if (g !== 'all' && r.group !== g) return false;
  if (F.choppy && r.weak) return false;
  if (F.notmine && r.listed) return false;
  return true;
}
// Default order: strongest stage first, then RSI (lowest first for valleys, highest first for
// peaks), then furthest below the high; for Recovering the most recent crossover first, then RSI.
function screenRank(r, F) {
  if (F.show === 'recover') return [r.cross ? r.cross.days : 99, isNum(r.rsi) ? r.rsi : 101];
  const stage = F.show === 'all' ? maxStage(r.sigs) : (topSignal(r.sigs, dirOf(F)) || {stage: 0}).stage;
  const rsi = isNum(r.rsi) ? r.rsi : (F.show === 'peak' ? -1 : 101);
  return [-stage, F.show === 'peak' ? -rsi : rsi, -r.pct];
}
function sortScreen(rows, F) {
  const s = SORT.screen;
  const val = r => ({
    symbol: r.sym, name: r.name.toLowerCase(), group: r.group,
    // Signal: the stage shown; for Recovering the crossover's age (more recent = "stronger")
    signal: F.show === 'recover' ? (r.cross ? -r.cross.days : -99) : F.show === 'all' ? maxStage(r.sigs) : (topSignal(r.sigs, dirOf(F)) || {stage: 0}).stage,
    macd: (r.side === 'above' ? 0 : 2) + (r.trend === 'rising' ? 0 : 1),
    close: isNum(r.close) ? r.close : -1, rsi: isNum(r.rsi) ? r.rsi : -1, off: r.pct,
    chg1: isNum(r.chg1) ? r.chg1 : -Infinity, chg3: isNum(r.chg3) ? r.chg3 : -Infinity,
    recent: Object.keys(r.recent).filter(d => r.recent[d].length).length, default: screenRank(r, F)})[s.col];
  rows.sort((a, b) => (s.asc ? 1 : -1) * cmpVal(val(a), val(b)) || a.sym.localeCompare(b.sym));
  return rows;
}
// The last 21 trading days ending on the screener's last bar. screener.json carries no calendar,
// so the days are the loaded tickers' days plus every day any screened ticker fired, which with
// ~800 tickers is every trading day.
function screenDays() {
  const sc = S.screen, set = new Set(S.days);
  Object.keys(sc.tickers).forEach(s => { const rc = sc.tickers[s] && sc.tickers[s].recent; if (rc && typeof rc === 'object') Object.keys(rc).forEach(d => set.add(d)); });
  set.add(sc.last_bar);
  return [...set].filter(d => typeof d === 'string' && d <= sc.last_bar).sort().slice(-SCREEN_BARS);
}
function fmtChg(v) { return isNum(v) ? `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${fmt(v, 1)}%</span>` : '–'; }
function crossChip(c) {
  const when = c.days === 0 ? 'on the latest day' : c.days === 1 ? '1 day ago' : `${c.days} days ago`;
  return ` <span class="badge days" title="Confirmed valley crossover on ${esc(c.date)}">crossed up ${when}</span>`;
}
function screenTableHTML(rows, days, F) {
  const cols = [['symbol', 'Ticker'], ['name', 'Name'], ['group', 'Group'], ['signal', 'Signal'], ['macd', 'MACD vs signal'],
    ['close', 'Close'], ['rsi', 'RSI'], ['off', '% below 1-yr high'], ['chg1', '1M change'], ['chg3', '3M change'], ['recent', `Recent (${SCREEN_BARS}D)`]];
  const ths = sortHeaders(cols, 'screen') + '<th></th>';
  const body = rows.map(r => {
    const t = r.sigs.length ? r.sigs.slice().sort((a, b) => a.stage - b.stage).map(badge).join(' ') : '<span class="sub">–</span>';
    const chip = F.show === 'recover' && r.cross ? crossChip(r.cross) : '';
    const rc = hasDir(r, 'PEAK') ? 'has-peak' : hasDir(r, 'VALLEY') ? 'has-valley' : '';
    const star = r.listed ? ' <span class="badge flag" title="On your list">★</span>' : '';
    const add = r.listed ? '' : `<button type="button" class="addwatch" data-sym="${esc(r.sym)}" title="Add ${esc(r.sym)} to your watch list">Add to watch</button>`;
    return `<tr class="${rc}">
      <td><b>${symlink(r.sym)}</b>${r.weak ? ' <span class="badge choppy">choppy</span>' : ''}${staleBadge(r)}${star}</td>
      <td class="name" title="${esc(r.name)}">${esc(r.name)}</td>
      <td>${esc(r.group)}</td>
      <td>${t}${chip}</td>
      <td>${r.side}, ${r.trend}</td>
      <td class="num">${fmtClose(r.close)}</td>
      ${rsiCell(r)}
      ${pctCell(r)}
      <td class="num">${fmtChg(r.chg1)}</td>
      <td class="num">${fmtChg(r.chg3)}</td>
      <td>${strip(d => r.recent[d] || [], days, SCREEN_BARS)}</td>
      <td>${add}</td>
    </tr>`;
  }).join('');
  return `<table><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table>`;
}
function renderScreen() {
  const box = $('screen-body'), st = $('screen-status'), sc = S.screen;
  syncScreenControls();
  st.textContent = S.screenLoading ? 'Loading the screener data…' : ''; st.hidden = !S.screenLoading;
  // The note says what the rows are: under Recovering most rows did not fire on the last day
  // (their crossover was up to N days earlier), so that mode gets its own sentence.
  const asOf = sc ? sc.last_bar + ', the last completed trading day' : 'the last completed trading day';
  $('screen-note').textContent = S.screenF.show === 'recover'
    ? `Tickers whose confirmed valley crossover was within the last ${S.screenF.within} trading days and whose momentum is still rising, as of ${asOf}. The day picker does not apply here.`
    : `Every ticker in the data set that fired on ${asOf}. The day picker does not apply here.`;
  if (!sc) {
    $('screen-count').textContent = '';
    box.innerHTML = S.screenError ? `<div class="notice error"><p>${esc(SCREEN_ERROR)}</p><p class="sub">Technical detail: ${esc(S.screenError)}</p></div>` : '';
    return;
  }
  const F = S.screenF;
  const all = Object.keys(sc.tickers).map(s => screenRow(s, sc.tickers[s])).filter(Boolean);
  const rows = sortScreen(all.filter(r => screenMatch(r, F)), F);
  $('screen-count').textContent = `${rows.length} of ${Object.keys(sc.tickers).length} tickers match`;
  if (!rows.length) { box.innerHTML = `<div class="empty">No tickers match these filters on ${esc(sc.last_bar)}.</div>`; return; }
  box.innerHTML = screenTableHTML(rows.slice(0, SCREEN_CAP), screenDays(), F) +
    (rows.length > SCREEN_CAP ? `<p class="sub">Showing the first ${SCREEN_CAP} of ${rows.length} matches; add a filter.</p>` : '');
}
function addToWatch(sym) {
  if (!SYM_RE.test(sym) || listed().includes(sym)) return;
  applyLists({h: S.lists.h, w: S.lists.w.concat([sym])}, '', true);  // stay on the Screener
}

// ---- header, editor, footer, banner --------------------------------------
function renderControls() {
  const sel = $('daysel');
  const idx = S.days.indexOf(S.day);
  sel.innerHTML = S.days.slice().reverse().map(d => `<option value="${esc(d)}"${d === S.day ? ' selected' : ''}>${esc(d)}</option>`).join('');
  sel.disabled = !S.days.length;
  $('prev').disabled = idx <= 0;
  $('next').disabled = idx < 0 || idx >= S.days.length - 1;
  document.querySelectorAll('.seg[id^=rangesel] button').forEach(b => b.classList.toggle('on', +b.dataset.n === S.rangeN));
  const nl = listed().length;
  const dayText = S.day ? `Showing ${S.day}${S.index && S.day === S.index.last_bar ? ', the last completed trading day' : ''}.` : '';
  $('subtitle').textContent = S.indexError ? 'Data not available.' : nl ? `${S.lists.h.length} holding${S.lists.h.length === 1 ? '' : 's'}, ${S.lists.w.length} on watch. ${dayText}` : 'No tickers on your list yet.';
}
function renderEditor() {
  $('ed-intro').hidden = !!listed().length;
  const msgs = [];
  if (S.editorNote) msgs.push(`<div class="msg warn">${esc(S.editorNote)}</div>`);
  const unknown = unknownListed();
  if (unknown.length) msgs.push(`<div class="msg warn">Not in the data set: ${esc(unknown.join(', '))}. Ask the site owner to add it to universe.txt.</div>`);
  const failed = failedListed();
  if (failed.length) msgs.push(`<div class="msg warn">Could not load the data file for: ${esc(failed.map(s => `${s} (${S.fileErrors[s]})`).join(', '))}. Reload the page to try again.</div>`);
  const stale = knownListed().filter(indexStale);
  if (stale.length) msgs.push(`<div class="msg ok">Data from an earlier night for: ${esc(stale.map(s => `${s} (${S.index.tickers[s].last_bar || 'unknown date'})`).join(', '))}. Last night's download for these failed, so the previous file was kept.</div>`);
  if (S.indexError) msgs.push(`<div class="msg warn">${esc(INDEX_ERROR)} Tickers cannot be checked against the data set until it loads.</div>`);
  else if (listed().length) msgs.push(`<div class="msg ok">${knownListed().length} of ${listed().length} tickers are in the data set.</div>`);
  $('ed-msgs').innerHTML = msgs.join('');
}
function fmtGenerated(s) { return String(s || '').replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1 UTC'); }
function renderFooter() {
  const tail = 'This page describes what an indicator is doing. It is not financial advice.';
  if (!S.index) { $('footer').innerHTML = `<p>Prices from Yahoo Finance, updated nightly. ${tail}</p>`; return; }
  const ix = S.index;
  const failed = ix.failed && typeof ix.failed === 'object' ? Object.keys(ix.failed).length : 0;
  const stale = Object.keys(ix.tickers).filter(s => ix.tickers[s] && ix.tickers[s].stale).length;
  const count = isNum(ix.count) ? ix.count : Object.keys(ix.tickers).length;
  $('footer').innerHTML = `<p>Prices from Yahoo Finance, updated nightly. Data as of ${esc(ix.last_bar || '?')}, generated ${esc(fmtGenerated(ix.generated))}. ${count} tickers; ${failed} failed, ${stale} stale tonight. ${tail}</p>`;
  const p = ix.params || {};
  $('params-note').textContent = `Settings: MACD ${p.fast || 12}/${p.slow || 26}/${p.signal || 9}, RSI ${p.rsi || 14}, "choppy" below ${isNum(p.weak_pct) ? p.weak_pct : 0.25}% of price.`;
}
function renderBanner() {
  const b = $('banner');
  b.hidden = true;
  if (!S.index || !S.index.generated) return;
  const gen = new Date(S.index.generated);
  if (isNaN(gen.getTime())) return;
  const now = new Date();
  let limit = 3;  // allow one more day when a weekend sits between the last run and now
  for (const d = new Date(gen); d <= now; d.setDate(d.getDate() + 1)) if (d.getDay() === 0) { limit = 4; break; }
  if ((now - gen) / 86400000 > limit) {
    b.textContent = `Data last updated ${String(S.index.generated).slice(0, 10)}. The nightly job may have stopped; see the troubleshooting section of README.md.`;
    b.hidden = false;
  }
}

// ---- wiring --------------------------------------------------------------
function render() {
  renderControls();
  renderDash();
  if (S.tab === 'screen') renderScreen();
  if (S.tab === 'chart') renderChart();
  renderEditor();
  renderFooter();
  renderBanner();
}
function showTab(t) {
  if (!TABS.includes(t)) t = 'dash';
  S.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  TABS.forEach(k => { $('view-' + k).hidden = k !== t; });
  if (t === 'screen') { renderScreen(); loadScreener(); }
  if (t === 'chart') renderChart();
  if (t === 'list') renderEditor();
  lsSet('macd-tab', t);
}
function setDay(d) { if (d && S.days.includes(d)) { S.day = d; render(); } }

['rangesel', 'rangesel2'].forEach(id => { $(id).innerHTML = RANGES.map(([l, n]) => `<button data-n="${n}">${l}</button>`).join(''); });
document.addEventListener('click', e => {
  const rb = e.target.closest('.seg[id^=rangesel] button');
  if (rb) { S.rangeN = +rb.dataset.n; lsSet('macd-range', String(S.rangeN)); render(); return; }
  const tb = e.target.closest('.tabs button');
  if (tb) { showTab(tb.dataset.tab); return; }
  const go = e.target.closest('button[data-goto]');
  if (go) { showTab(go.dataset.goto); return; }
  const sl = e.target.closest('.symlink');
  if (sl) { openChart(sl.dataset.sym); return; }
  const aw = e.target.closest('.addwatch');
  if (aw) { addToWatch(aw.dataset.sym); return; }
  const cell = e.target.closest('th');
  const th = cell && cell.querySelector('.sorth');  // the sort button; a click anywhere in the cell counts
  if (th) {
    const s = SORT[th.dataset.key];
    // Numeric "more is more interesting" columns start descending, the rest ascending.
    if (s.col === th.dataset.col) s.asc = !s.asc; else { s.col = th.dataset.col; s.asc = !['rsi', 'close', 'recent', 'signal', 'chg1', 'chg3'].includes(th.dataset.col); }
    render();
  }
});
['sc-show', 'sc-stage', 'sc-rsi', 'sc-within', 'sc-below', 'sc-group', 'sc-choppy', 'sc-mine'].forEach(id => $(id).addEventListener('change', readScreenControls));
$('daysel').addEventListener('change', e => setDay(e.target.value));
$('prev').addEventListener('click', () => { const i = S.days.indexOf(S.day); if (i > 0) setDay(S.days[i - 1]); });
$('next').addEventListener('click', () => { const i = S.days.indexOf(S.day); if (i >= 0 && i < S.days.length - 1) setDay(S.days[i + 1]); });
$('allwatch').addEventListener('change', render);
$('chartsym').addEventListener('change', e => { S.chartSym = e.target.value; renderChart(); });
$('editbtn').addEventListener('click', () => showTab('list'));
$('copybtn').addEventListener('click', () => copyLink(1));
$('copybtn2').addEventListener('click', () => copyLink(2));
$('save').addEventListener('click', saveFromEditor);
$('example').addEventListener('click', () => applyLists(EXAMPLE, ''));
$('example2').addEventListener('click', () => applyLists(EXAMPLE, ''));
['ed-h', 'ed-w'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveFromEditor(); } }));
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.tab === 'chart') renderChart(); }, 150); });
window.addEventListener('hashchange', () => {
  const l = readHash();
  if (l && !sameLists(l, S.lists)) { S.lists = l; S.listSource = 'hash'; S.editorNote = ''; fillEditor(); refresh(); }
});
$('theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  lsSet('macd-theme', next);
});

// ---- start ---------------------------------------------------------------
async function init() {
  const t = lsGet('macd-theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  const r = +lsGet('macd-range'); if (RANGES.some(x => x[1] === r)) S.rangeN = r;
  S.screenF = readStoredScreen();
  initLists();
  fillEditor();
  writeHash();  // the address bar always holds the shareable link
  const tab = lsGet('macd-tab');
  showTab(listed().length ? (TABS.includes(tab) ? tab : 'dash') : 'list');
  renderControls(); renderEditor(); renderFooter();
  await loadIndex();
  S.indexDone = true;
  if (S.tab === 'screen') loadScreener();  // the Screener was the remembered tab: it waited for index.json
  await refresh();
}
init();

})();
