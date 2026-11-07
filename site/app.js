/* MACD Signals page.
   Plain JavaScript, no libraries. It reads data/index.json and one data/<TICKER>.json per ticker
   (both written by the nightly job), plus data/screener.json for the Screener tab, keeps the
   viewer's lists in the page address and in this browser, keeps the viewer's optional holding
   details (shares, cost, dates, targets) in this browser only, and draws the dashboard, the
   screener, the charts (each with the ticker's track record) and the glossary. It also shows a
   few plain conditions (200-day average, recent RSI extremes, heavy volume, past-year strength)
   and lets the viewer highlight or filter by combinations of them with a confirmed signal; each
   combination shows its test result, which was no better than an ordinary day.
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
// The last four are the condition filters (docs/COMBOS.md): 200-day average, RSI lately, heavy volume, past year.
const SCREEN_DEFAULTS = {show: 'valley', stage: 0, rsi: 40, within: 10, below: 0, group: 'all', choppy: true, notmine: false,
  ma: 'any', rsil: 'any', heavy: false, year: 'any'};
// Holding details (localStorage "macd-holdings": shares, cost, purchase date, sell target and
// trailing stop per holding; all optional, never in the page address). Field key and column label.
const HOLD_FIELDS = [['shares', 'Shares'], ['cost', 'Avg cost'], ['date', 'Bought'], ['target', 'Sell target'], ['trail', 'Trailing stop %']];
const NEAR_PCT = 3;                               // "Your targets and stops" lists holdings within this percent of a level
const MONTH_BARS = 21;                            // trading days in "1M" (the vs SPY comparison)
const LONG_TERM_DAYS = 366;                       // held this many calendar days or more = more than one year
// Track record (Charts tab, and the holdings table's "Peak record (10d)" column): what the close
// did 5, 10 and 20 trading days after each past signal, next to what it did on an ordinary day.
const HORIZONS = [5, 10, 20];                     // trading days after a signal
const RECORD_GROUPS = [['PEAK', 1], ['PEAK', 2], ['PEAK', 3], ['VALLEY', 1], ['VALLEY', 2], ['VALLEY', 3]];
const RECORD_MIN = 5;                             // outcomes a group needs before its numbers are shown in full
const PEAK_RECORD_H = 10;                         // the horizon the holdings column uses
const TOO_FEW = 'Too few signals to judge';
// Conditions and combinations (docs/COMBOS.md). A condition describes where a stock stands on a
// day; it is not a signal. The rules are the same as fetch_data.py's conditions_at().
const LATELY = 10;                                // "lately" = on at least one of the last 10 trading days
const RSI_LO = 30, RSI_HI = 70, HEAVY_X = 2;      // RSI under 30 / over 70; volume at least twice its 50-day average
// The chips, in display order: [does the chip apply to conditions c, label, title text].
const COND_CHIPS = [
  [c => c.above200 === true, 'Above 200-day', 'Closed above its 200-day average'],
  [c => c.above200 === false, 'Below 200-day', 'Closed below its 200-day average'],
  [c => c.rsi_lo === true, 'RSI under 30 lately', 'RSI was under 30 on at least one of the last 10 trading days'],
  [c => c.rsi_hi === true, 'RSI over 70 lately', 'RSI was over 70 on at least one of the last 10 trading days'],
  [c => c.heavy === true, 'Heavy volume lately', 'Volume was at least twice its 50-day average on at least one of the last 10 trading days'],
  [c => c.year === 'strong', 'Strong past year', 'Its return over the past year, skipping the latest month, is in the top half of S&P 500 stocks on this day'],
  [c => c.year === 'weak', 'Weak past year', 'Its return over the past year, skipping the latest month, is in the bottom half of S&P 500 stocks on this day'],
];
// The header of the Conditions column in the Dashboard and Screener tables (not sortable).
const COND_TH = '<th class="nosort" title="Where the ticker stands on its day: hover a chip for its meaning. A description, not a signal.">Conditions</th>';
// A combination: a confirmed (stage 3) signal of one direction plus required conditions. dev and
// hold are the owner's test results on S&P 500 stocks (2017-2022 and 2023-2026): the average
// 20-trading-day return versus SPY, minus the same for an ordinary day in the same month, in
// percentage points. None of them did better than an ordinary day.
const COMBOS = [
  {id: 'V1', label: 'Valley + above 200-day average', dir: 'VALLEY', req: {above200: true}, dev: -0.14, hold: -0.30},
  {id: 'V2', label: 'Valley + RSI under 30 lately', dir: 'VALLEY', req: {rsi_lo: true}, dev: -0.04, hold: -0.21},
  {id: 'V3', label: 'Valley + heavy volume lately', dir: 'VALLEY', req: {heavy: true}, dev: -0.02, hold: 0.17},
  {id: 'V4', label: 'Valley + strong past year', dir: 'VALLEY', req: {year: 'strong'}, dev: -0.13, hold: -0.12},
  {id: 'V5', label: 'Valley + above 200-day + strong year', dir: 'VALLEY', req: {above200: true, year: 'strong'}, dev: -0.24, hold: -0.21},
  {id: 'P1', label: 'Peak + below 200-day average', dir: 'PEAK', req: {above200: false}, dev: 0.35, hold: 0.22},
  {id: 'P2', label: 'Peak + RSI over 70 lately', dir: 'PEAK', req: {rsi_hi: true}, dev: 0.24, hold: -0.38},
  {id: 'P3', label: 'Peak + heavy volume lately', dir: 'PEAK', req: {heavy: true}, dev: 0.06, hold: -0.07},
  {id: 'P4', label: 'Peak + weak past year', dir: 'PEAK', req: {year: 'weak'}, dev: 0.22, hold: -0.19},
  {id: 'P5', label: 'Peak + below 200-day + weak year', dir: 'PEAK', req: {above200: false, year: 'weak'}, dev: 0.40, hold: 0.17},
];
// The confirmed signals with no condition at all, for the Info tab's table only.
const COMBO_ALONE = [
  {id: 'V0', label: 'Confirmed valley alone', dir: 'VALLEY', dev: 0.00, hold: -0.10},
  {id: 'P0', label: 'Confirmed peak alone', dir: 'PEAK', dev: 0.05, hold: -0.10},
];

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
  holdDetails: {},         // ticker -> {shares, cost, date, target, trail} the viewer entered (validated; browser only)
  holdMsgs: [],            // messages about the last "Save details" ([kind, text]); shown under the details table
  backupMsgs: [],          // messages about the last "Restore from backup"
  combo: null,             // id of the combination the Dashboard highlights (localStorage "macd-combo"); null = None
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
// Money in the ticker's currency: USD as $1,234.56, anything else as 1,234.56 CAD. The result is
// HTML-safe (the currency code comes from a data file, so it is escaped here).
function fmtMoney(v, cur) {
  if (!isNum(v)) return '–';
  const n = Math.abs(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const sign = v < 0 ? '-' : '';
  return cur === 'USD' ? `${sign}$${n}` : `${sign}${n} ${esc(cur)}`;
}
function fmtMoneySigned(v, cur) { return isNum(v) ? (v > 0 ? '+' : '') + fmtMoney(v, cur) : '–'; }
function fmtPlain(v) { return isNum(v) ? String(+v.toFixed(4)) : ''; }  // a number as the viewer typed it, without trailing zeros
function upDown(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
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
  renderHoldForm();  // the details table has one row per holding, so it follows the list
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
// Put text on the clipboard and call done(true/false). The old execCommand way is the fallback
// for browsers without the clipboard API (or when it refuses).
function copyText(text, done) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-1000px';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) { done(false); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), fallback);
  else fallback();
}
// Show a short confirmation next to a copy button, then hide it again.
function flash(el, text, ms) {
  el.textContent = text; el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}
function copyLink(which) {
  copyText(location.href, ok => flash($(which === 2 ? 'copied2' : 'copied'),
    ok ? 'Link copied' : 'Could not copy. Copy the address from the address bar instead.', ok ? 2500 : 6000));
}

// ---- holding details: shares, cost, dates, targets and stops -------------
// Stored in localStorage "macd-holdings" as {TICKER: {shares, cost, date, target, trail}}. Every
// field is optional. The details never go into the page address or the shareable link; the
// Backup box on the My list tab is how they move between devices. Details for tickers that are
// not on the holdings list are kept (the viewer may re-add the ticker) but never shown.
function todayISO() { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
function isoDay(s) {  // a real calendar date written YYYY-MM-DD
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
// A number from stored JSON or from an input ("1,234.5", "$12", "10 %"); NaN if it is not one.
function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.replace(/[$,%\s]/g, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}
// One ticker's details from anything (stored JSON, the form, a pasted backup): {d: the valid
// fields, bad: a reason for each field that was ignored}. Empty means "not set", not an error.
function cleanDetail(o) {
  const d = {}, bad = [];
  if (!o || typeof o !== 'object') return {d, bad};
  const empty = v => v == null || (typeof v === 'string' && !v.trim());
  const num = (k, test, why) => {
    if (empty(o[k])) return;
    const n = toNum(o[k]);
    if (!isFinite(n)) bad.push(k + ' (not a number)'); else if (!test(n)) bad.push(k + ' (' + why + ')'); else d[k] = n;
  };
  num('shares', n => n >= 0, 'cannot be negative');
  num('cost', n => n > 0, 'must be above 0');
  num('target', n => n > 0, 'must be above 0');
  num('trail', n => n > 0 && n <= 100, 'must be above 0 and at most 100');
  if (!empty(o.date)) {
    const s = String(o.date).trim();
    if (!isoDay(s)) bad.push('date (not a date)'); else if (s > todayISO()) bad.push('date (in the future)'); else d.date = s;
  }
  return {d, bad};
}
// A whole holdings object: {details, notes, ok}. notes lists what was ignored, one line per
// ticker ("Ignored for AAPL: cost (not a number)"); ok is false when it is not an object at all.
function cleanHoldings(obj) {
  const details = {}, notes = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {details, notes, ok: false};
  Object.keys(obj).forEach(k => {
    const sym = norm(k);
    if (!SYM_RE.test(sym)) { notes.push(`Ignored "${k}": it does not look like a ticker`); return; }
    const {d, bad} = cleanDetail(obj[k]);
    if (bad.length) notes.push(`Ignored for ${sym}: ${bad.join(', ')}`);
    if (Object.keys(d).length) details[sym] = d;
  });
  return {details, notes, ok: true};
}
function readHoldings() { try { return cleanHoldings(JSON.parse(lsGet('macd-holdings') || 'null')).details; } catch (e) { return {}; } }
function storeHoldings() { lsSet('macd-holdings', JSON.stringify(S.holdDetails)); }
function detailOf(sym) { return hasOwn(S.holdDetails, sym) ? S.holdDetails[sym] : null; }
// The "Holding details" table on the My list tab: one row per holding, in list order. It is
// rebuilt only when the list changes or after a save, so typing in it is never wiped by a refresh.
function renderHoldForm() {
  const syms = S.lists.h;
  $('hold-sec').hidden = !syms.length;
  if (!syms.length) { $('hold-table').innerHTML = ''; return; }
  const rows = syms.map(sym => {
    const d = detailOf(sym) || {};
    const cells = HOLD_FIELDS.map(([k, label]) => {
      const v = k === 'date' ? (d.date || '') : fmtPlain(d[k]);
      const type = k === 'date' ? `type="date" max="${todayISO()}"` : 'type="text" inputmode="decimal"';
      return `<td><input ${type} class="hold-in" data-sym="${esc(sym)}" data-field="${k}" value="${esc(v)}" aria-label="${label} for ${esc(sym)}"></td>`;
    }).join('');
    return `<tr><td><b>${esc(sym)}</b></td>${cells}</tr>`;
  }).join('');
  $('hold-table').innerHTML = `<table class="plain"><thead><tr><th>Ticker</th>${HOLD_FIELDS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  renderHoldMsgs();
  $('bk-out').value = JSON.stringify(S.holdDetails, null, 2);
}
function msgsHTML(msgs) { return msgs.map(([kind, text]) => `<div class="msg ${kind}">${esc(text)}</div>`).join(''); }
function renderHoldMsgs() { $('hold-msgs').innerHTML = msgsHTML(S.holdMsgs); $('bk-msgs').innerHTML = msgsHTML(S.backupMsgs); }
// "Save details": validate every input, keep what is valid, say what was ignored, redraw the Dashboard.
function saveHoldForm() {
  const raw = {};
  document.querySelectorAll('#hold-table .hold-in').forEach(inp => { (raw[inp.dataset.sym] = raw[inp.dataset.sym] || {})[inp.dataset.field] = inp.value; });
  const msgs = [];
  let kept = 0;
  Object.keys(raw).forEach(sym => {
    const {d, bad} = cleanDetail(raw[sym]);
    if (bad.length) msgs.push(['warn', `Ignored for ${sym}: ${bad.join(', ')}`]);
    if (Object.keys(d).length) { S.holdDetails[sym] = d; kept++; } else delete S.holdDetails[sym];
  });
  storeHoldings();
  msgs.push(['ok', kept ? `Details saved for ${kept} holding${kept === 1 ? '' : 's'}. They stay in this browser only.` : 'No details set.']);
  S.holdMsgs = msgs; S.backupMsgs = [];
  renderHoldForm();
  render();
}
function copyBackup() {
  copyText($('bk-out').value, ok => flash($('bk-copied'), ok ? 'Backup copied' : 'Could not copy. Select the text in the box and copy it yourself.', ok ? 2500 : 6000));
}
// "Restore from backup": the pasted JSON goes through the same validation; its tickers replace
// the current details for those tickers, everything else stays.
function restoreBackup() {
  let j;
  try { j = JSON.parse($('bk-in').value); } catch (e) { S.backupMsgs = [['warn', 'That is not a backup this page can read. Paste the whole text, from the first { to the last }.']]; renderHoldMsgs(); return; }
  const {details, notes, ok} = cleanHoldings(j);
  if (!ok) { S.backupMsgs = [['warn', 'That is not a backup made by this page.']]; renderHoldMsgs(); return; }
  const syms = Object.keys(details);
  syms.forEach(s => { S.holdDetails[s] = details[s]; });
  if (syms.length) storeHoldings();
  const msgs = notes.map(t => ['warn', t]);
  msgs.push(['ok', syms.length ? `Restored details for ${syms.length} ticker${syms.length === 1 ? '' : 's'}: ${syms.join(', ')}.` : 'Nothing to restore: the backup has no valid details.']);
  S.backupMsgs = msgs; S.holdMsgs = [];
  renderHoldForm();
  render();
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
    // SPY comes along whenever the data set has it: the holdings table compares each holding's
    // one-month change with it. It is not a listed ticker unless the viewer lists it.
    const need = knownListed().concat(known('SPY') ? ['SPY'] : []).filter(s => !S.files[s]);
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
  // The listed tickers' days, plus the chart ticker's when it is not on the lists (opened from the
  // Screener), so the day picker and the Track record's date buttons can reach every day its chart can show.
  const syms = loadedListed();
  if (S.chartSym && S.files[S.chartSym] && !syms.includes(S.chartSym)) syms.push(S.chartSym);
  syms.forEach(sym => { const f = S.files[sym]; f.dates.forEach((d, i) => { if (isNum(f.macd[i])) set.add(d); }); });
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
    cond: condsAt(f, i, f.dates[i]),  // where the ticker stands on its bar (docs/COMBOS.md)
  };
}
function hasDir(r, dir) { return r.sigs.some(s => s.dir === dir); }
// ---- what the viewer's holding details add to a row ----------------------
function chg1m(f, i) {  // close vs the close 21 bars earlier, percent; null if the file is too short
  const k = i - MONTH_BARS;
  return k >= 0 && isNum(f.close[i]) && isNum(f.close[k]) && f.close[k] > 0 ? (f.close[i] / f.close[k] - 1) * 100 : null;
}
function spyChg1m(day) { const f = S.files.SPY; if (!f) return null; const i = barIndex(f, day); return i < 0 ? null : chg1m(f, i); }
// Everything the details for holding r add on the selected day. A field the viewer did not set
// leaves its derived values null. weight is filled in by renderDash once every value is known.
function position(r, day) {
  const d = detailOf(r.sym) || {}, f = r.f, i = r.i, close = r.close;
  const p = {any: Object.keys(d).length > 0, shares: d.shares, cost: d.cost, date: d.date, target: d.target, trail: d.trail,
    currency: typeof f.currency === 'string' && f.currency ? f.currency : 'USD',
    value: null, costTotal: null, gainPct: null, gainAbs: null, dayChg: null, prevValue: null, weight: null,
    toTarget: null, stopRef: null, stopFrom: null, stopPrice: null, toStop: null, heldDays: null, longTerm: false, vsSpy1m: null};
  const prev = i > 0 ? f.close[i - 1] : null;
  if (isNum(d.shares)) {
    p.value = d.shares * close;
    if (isNum(prev)) { p.dayChg = (close - prev) * d.shares; p.prevValue = prev * d.shares; }
    if (isNum(d.cost)) { p.costTotal = d.shares * d.cost; p.gainAbs = (close - d.cost) * d.shares; }
  }
  if (isNum(d.cost)) p.gainPct = (close / d.cost - 1) * 100;
  if (isNum(d.target)) p.toTarget = (d.target / close - 1) * 100;  // positive = still below the target
  if (d.date) {
    const held = (Date.parse(day + 'T00:00:00Z') - Date.parse(d.date + 'T00:00:00Z')) / 86400000;
    if (held >= 0) { p.heldDays = Math.round(held); p.longTerm = p.heldDays >= LONG_TERM_DAYS; }  // bought after this day: nothing to say
  }
  if (isNum(d.trail)) {
    // The stop trails the highest close since the purchase date when that date is set and inside
    // the file, otherwise since the start of the file, through the selected day.
    let start = 0;
    if (d.date && d.date >= f.dates[0]) while (start <= i && f.dates[start] < d.date) start++;
    let ref = -Infinity;
    for (let k = start; k <= i; k++) if (isNum(f.close[k]) && f.close[k] > ref) ref = f.close[k];
    if (ref > 0) {
      p.stopRef = ref; p.stopFrom = start > 0 ? d.date : null;
      p.stopPrice = ref * (1 - d.trail / 100);
      if (p.stopPrice > 0) p.toStop = (close / p.stopPrice - 1) * 100;  // positive = above the stop
    }
  }
  // Compare both 1-month windows ending on the same bar: the holding's own bar (r.date), which
  // is earlier than the selected day when its file is stale, rather than the selected day.
  const mine = chg1m(f, i), spy = spyChg1m(r.date);
  if (isNum(mine) && isNum(spy)) p.vsSpy1m = mine - spy;
  return p;
}
function fmtHeld(from, to, days) {  // "1y 3m", "5m" or "12d" from one date to another
  const a = from.split('-').map(Number), b = to.split('-').map(Number);
  const months = (b[0] - a[0]) * 12 + (b[1] - a[1]) - (b[2] < a[2] ? 1 : 0);
  if (months < 1) return days + 'd';
  const y = Math.floor(months / 12), m = months % 12;
  return (y ? y + 'y' : '') + (m ? (y ? ' ' : '') + m + 'm' : '');
}
function targetText(p) { return !isNum(p.toTarget) ? '–' : p.toTarget >= 0 ? `${fmt(p.toTarget, 1)}% below` : `${fmtPct(-p.toTarget)} above`; }
function stopText(p) { return !isNum(p.toStop) ? '–' : p.toStop >= 0 ? `${fmtPct(p.toStop)} above` : '<span class="down">BELOW</span>'; }
function stopTitle(p) {
  return `Stop ${fmtMoney(p.stopPrice, p.currency)}: the highest close ${p.stopFrom ? 'since ' + esc(p.stopFrom) : 'in the data'} (${fmtClose(p.stopRef)}) minus ${fmtPlain(p.trail)}%`;
}
function signedCell(v, unit) { return isNum(v) ? `<span class="${upDown(v)}">${fmt(v, 1)}${unit}</span>` : '–'; }
// The extra columns of the holdings table, each only when some holding has what it needs.
function holdCols(hold) {
  const any = k => hold.some(r => isNum(r.pos[k]));
  const cols = [];
  if (!hold.some(r => r.pos.any)) return cols;
  if (any('value')) cols.push(['value', 'Value'], ['weight', 'Weight']);
  if (any('gainPct')) cols.push(['gain', 'Gain']);
  if (any('target')) cols.push(['target', 'Target']);
  if (any('trail')) cols.push(['stop', 'Stop']);
  if (hold.some(r => r.pos.date)) cols.push(['held', 'Held']);
  cols.push(['spy', 'vs SPY (1M)']);
  return cols;
}
function holdCell(r, k, day) {
  const p = r.pos, cur = p.currency;
  switch (k) {
    case 'value': return `<td class="num">${fmtMoney(p.value, cur)}</td>`;
    case 'weight': return `<td class="num">${fmtPct(p.weight)}</td>`;
    case 'gain': return `<td class="num"${isNum(p.gainAbs) ? ` title="${fmtMoneySigned(p.gainAbs, cur)} on a cost of ${fmtMoney(p.costTotal, cur)}"` : ''}>${signedCell(p.gainPct, '%')}</td>`;
    case 'target': return `<td class="num"${isNum(p.target) ? ` title="Your target: ${fmtMoney(p.target, cur)}"` : ''}>${targetText(p)}</td>`;
    case 'stop': return `<td class="num"${isNum(p.stopPrice) ? ` title="${stopTitle(p)}"` : ''}>${stopText(p)}</td>`;
    case 'held': return `<td${p.date ? ` title="Bought ${esc(p.date)}${isNum(p.heldDays) ? ', ' + p.heldDays + ' days ago' : ''}"` : ''}>${isNum(p.heldDays) ? fmtHeld(p.date, day, p.heldDays) + (p.longTerm ? ' <span class="badge lt">long-term</span>' : '') : '–'}</td>`;
    case 'spy': return `<td class="num" title="This ticker's 1-month change minus SPY's, in percentage points">${signedCell(p.vsSpy1m, ' pts')}</td>`;
    case 'record': return recordCell(r);
  }
  return '<td>–</td>';
}
// The line under a card's name: only the parts the viewer's details make possible.
function posLine(r) {
  const p = r.pos;
  if (!p || !p.any) return '';
  const parts = [];
  if (isNum(p.value)) parts.push('Value ' + fmtMoney(p.value, p.currency));
  if (isNum(p.weight)) parts.push(fmtPct(p.weight) + ' of portfolio');
  if (isNum(p.gainPct)) parts.push(fmt(p.gainPct, 1) + '% since cost');
  if (isNum(p.toTarget)) parts.push(p.toTarget >= 0 ? `${fmtPct(p.toTarget)} below your target` : `${fmtPct(-p.toTarget)} above your target`);
  if (isNum(p.toStop)) parts.push(p.toStop >= 0 ? `${fmtPct(p.toStop)} above your stop` : 'below your stop');
  return parts.length ? `<div class="pos">${parts.join(' · ')}</div>` : '';
}
// The portfolio stats row: sums over the holdings that have shares. '' when none has.
function portfolioStats(hold) {
  const withShares = hold.filter(r => isNum(r.pos.value));
  if (!withShares.length) return '';
  const cur = withShares[0].pos.currency, mixed = withShares.some(r => r.pos.currency !== cur);
  const sum = (rows, k) => rows.reduce((s, r) => s + r.pos[k], 0);
  const value = sum(withShares, 'value');
  const dayRows = withShares.filter(r => isNum(r.pos.dayChg)), dayChg = sum(dayRows, 'dayChg'), prevValue = sum(dayRows, 'prevValue');
  const gainRows = withShares.filter(r => isNum(r.pos.gainAbs)), gainAbs = sum(gainRows, 'gainAbs'), costTotal = sum(gainRows, 'costTotal');
  const dated = hold.filter(r => r.pos.date), longTerm = dated.filter(r => r.pos.longTerm).length;
  const money = (v, pct) => `<span class="${upDown(v)}">${fmtMoneySigned(v, cur)}</span> <span class="small">${isNum(pct) ? fmt(pct, 1) + '%' : ''}</span>`;
  const items = [
    ['Portfolio value', fmtMoney(value, cur), `${withShares.length} of ${hold.length} holding${hold.length === 1 ? '' : 's'} have shares${mixed ? '; mixed currencies added as plain numbers' : ''}`],
    ['Day change', dayRows.length ? money(dayChg, prevValue > 0 ? dayChg / prevValue * 100 : null) : '–', 'vs the previous trading day'],
    ['Gain / loss since cost', gainRows.length ? money(gainAbs, costTotal > 0 ? gainAbs / costTotal * 100 : null) : '–', gainRows.length ? `${gainRows.length} of ${withShares.length} with a cost; close vs what you paid` : 'no average cost entered'],
  ];
  if (dated.length) items.push(['Long-term positions', String(longTerm), `of ${dated.length} with a purchase date; held more than one year`]);
  return items.map(([l, v, s]) => `<div class="stat"><div class="label">${l}</div><div class="value money">${v}</div><div class="sub">${s}</div></div>`).join('');
}
// Chips for "Your targets and stops": holdings at or past a level, or within NEAR_PCT of it.
function targetChips(hold) {
  const chips = [];
  const chip = (r, text) => {
    const peak = topSignal(r.sigs, 'PEAK');
    chips.push(`<div class="chip"><b>${symlink(r.sym)}</b>${staleBadge(r)} <span>${text}</span>${peak ? ' ' + badge(peak) : ''}</div>`);
  };
  hold.forEach(r => {
    const p = r.pos;
    if (isNum(p.toTarget) && p.toTarget <= NEAR_PCT) {
      const t = fmtMoney(p.target, p.currency);
      chip(r, p.toTarget > 0 ? `closed ${fmtPct(p.toTarget)} below your target of ${t}` : `closed above your target of ${t} (by ${fmtPct(-p.toTarget)})`);
    }
    if (isNum(p.toStop) && p.toStop <= NEAR_PCT) {
      const s = `its ${fmtPlain(p.trail)}% trailing stop (${fmtMoney(p.stopPrice, p.currency)})`;
      chip(r, p.toStop >= 0 ? `closed ${fmtPct(p.toStop)} above ${s}` : `closed below ${s}`);
    }
  });
  return chips;
}
// ---- track record: what the close did after past signals ------------------
// Everything here is computed from the ticker file up to the selected day's bar (i), so the
// record only ever uses closes the viewer can see on the chart. It describes the past.
function firstMacd(f) { return f.macd.findIndex(isNum); }  // the first bar with a MACD value; -1 if none
function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// The close h bars after bar k as a percent change; null when that bar is past the selected
// day's bar i, because the outcome is not known yet.
function moveAfter(f, k, h, i) {
  return k + h <= i && isNum(f.close[k]) && f.close[k] > 0 && isNum(f.close[k + h]) ? (f.close[k + h] / f.close[k] - 1) * 100 : null;
}
function isHit(dir, chg) { return dir === 'PEAK' ? chg < 0 : chg > 0; }  // an unchanged close is a miss either way
function tally(dir, moves) { return {outcomes: moves.length, hits: moves.filter(c => isHit(dir, c)).length, median: median(moves)}; }
// The whole record for one ticker up to bar i: one entry per (direction, stage) group, in
// RECORD_GROUPS order, with its signals and a tally per horizon, plus the base rates: over every
// bar from the first MACD value on, how often the close was lower / higher h bars later.
function trackRecord(f, i) {
  const groups = RECORD_GROUPS.map(([dir, stage]) => ({dir, stage, signals: [], hz: {}}));
  for (let k = 0; k <= i; k++) {
    const seen = new Set();  // each (direction, stage) counts once per day
    eventsOn(f, f.dates[k]).forEach(s => {
      const key = s.dir + s.stage;
      if (seen.has(key)) return;
      seen.add(key);
      const moves = {};
      HORIZONS.forEach(h => { moves[h] = moveAfter(f, k, h, i); });
      groups[RECORD_GROUPS.findIndex(([d, st]) => d === s.dir && st === s.stage)].signals.push({k, date: f.dates[k], close: f.close[k], moves});
    });
  }
  groups.forEach(g => HORIZONS.forEach(h => { g.hz[h] = tally(g.dir, g.signals.map(s => s.moves[h]).filter(isNum)); }));
  const first = firstMacd(f), base = {};
  HORIZONS.forEach(h => {
    const moves = [];
    if (first >= 0) for (let k = first; k + h <= i; k++) { const c = moveAfter(f, k, h, i); if (isNum(c)) moves.push(c); }
    base[h] = {days: moves.length, lower: moves.filter(c => c < 0).length, higher: moves.filter(c => c > 0).length, median: median(moves)};
  });
  return {groups, base, days: first >= 0 ? i - first + 1 : 0};
}
// The base rate a group is compared with: "lower" for peaks, "higher" for valleys, in percent.
function baseRate(base, dir, h) { const b = base[h]; return b.days ? (dir === 'PEAK' ? b.lower : b.higher) / b.days * 100 : null; }
function pctOf(n, d) { return d ? Math.round(n / d * 100) : 0; }
function moveText(v) { return !isNum(v) ? '–' : v === 0 ? '0.0%' : fmt(v, 1) + '%'; }  // a signed percent, one decimal
function fmtMove(v) { return isNum(v) ? `<span class="${upDown(v)}">${moveText(v)}</span>` : '–'; }  // the same in the up/down colors
// The "4 of 6" hit-rate cell for a group that has signals, at horizon h. No outcome yet (every
// signal is younger than h bars): a dash that says so. Under RECORD_MIN outcomes the numbers are
// muted and the only title is the warning; otherwise the title spells out hits, outcomes,
// percent and base rate.
function rateCell(hits, outcomes, base, h) {
  const text = `${hits} of ${outcomes}`;
  if (!outcomes) return `<td class="num" title="No outcome yet: every signal is less than ${h} trading days old"><span class="sub">–</span></td>`;
  if (outcomes < RECORD_MIN) return `<td class="num"><span class="sub" title="${TOO_FEW}">${text}</span></td>`;
  return `<td class="num" title="${hits} hits of ${outcomes} outcomes (${pctOf(hits, outcomes)}%); base rate ${isNum(base) ? Math.round(base) + '%' : '–'}">${text}</td>`;
}
function moveCell(med, outcomes) {
  if (!isNum(med)) return '<td class="num"><span class="sub">–</span></td>';
  if (outcomes < RECORD_MIN) return `<td class="num"><span class="sub" title="${TOO_FEW}">${moveText(med)}</span></td>`;
  return `<td class="num">${fmtMove(med)}</td>`;
}
// The two cells of a base-rate row for one horizon: "130 of 200" (days the close was lower or
// higher h bars later, out of the days that have an outcome) and the median move over those days.
function baseCells(b, which, h) {
  const n = b[which], text = `${n} of ${b.days}`;
  if (b.days < RECORD_MIN) return `<td class="num"><span class="sub" title="${TOO_FEW}">${text}</span></td>` + moveCell(b.median, b.days);
  return `<td class="num" title="The close was ${which} ${h} trading days later on ${n} of ${b.days} days (${pctOf(n, b.days)}%)">${text}</td>` + moveCell(b.median, b.days);
}
function recordTableHTML(rec) {
  const head = `<thead><tr><th rowspan="2">Signal</th><th rowspan="2" class="num">Count</th>${HORIZONS.map(h => `<th colspan="2" class="mid">${h} trading days later</th>`).join('')}</tr>
    <tr>${HORIZONS.map(() => '<th class="num">Hit rate</th><th class="num">Median move</th>').join('')}</tr></thead>`;
  const rows = rec.groups.map(g => {
    const n = g.signals.length;
    const cells = n ? HORIZONS.map(h => rateCell(g.hz[h].hits, g.hz[h].outcomes, baseRate(rec.base, g.dir, h), h) + moveCell(g.hz[h].median, g.hz[h].outcomes)).join('')
      : HORIZONS.map(() => '<td class="num">–</td><td class="num">–</td>').join('');
    return `<tr><td>${badge(g)}</td><td class="num">${n || '–'}</td>${cells}</tr>`;
  });
  [['lower', 'Any day, lower', 'peak'], ['higher', 'Any day, higher', 'valley']].forEach(([which, label, dir]) => {
    rows.push(`<tr class="base"><td title="Every trading day, signal or not: how often the close was ${which} that many days later. The base rate to compare the ${dir} rows with.">${label}</td>` +
      `<td class="num" title="Trading days with a MACD value, up to the selected day">${rec.days || '–'}</td>${HORIZONS.map(h => baseCells(rec.base[h], which, h)).join('')}</tr>`);
  });
  return `<table class="plain record">${head}<tbody>${rows.join('')}</tbody></table>`;
}
// Every signal in the record, newest first: the date (a button that moves the day picker there),
// the badge, that day's close and the move over each horizon, "–" where the horizon runs past
// the selected day.
function recordListHTML(rec) {
  const all = [];
  rec.groups.forEach((g, gi) => g.signals.forEach(s => all.push({g, gi, s})));
  if (!all.length) return '<div class="empty">No signals up to the selected day.</div>';
  all.sort((a, b) => b.s.k - a.s.k || a.gi - b.gi);
  const rows = all.map(({g, s}) => `<tr><td><button type="button" class="daylink" data-day="${esc(s.date)}" title="Show this day on the chart">${esc(s.date)}</button></td><td>${badge(g)}</td><td class="num">${fmtClose(s.close)}</td>` +
    HORIZONS.map(h => isNum(s.moves[h]) ? `<td class="num">${fmtMove(s.moves[h])}</td>` : `<td class="num" title="Not known yet: ${h} trading days after this signal is past the selected day"><span class="sub">–</span></td>`).join('') + '</tr>');
  return `<table class="plain record"><thead><tr><th>Date</th><th>Signal</th><th class="num">Close</th>${HORIZONS.map(h => `<th class="num">+${h} days</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
// The Track record section under the chart, for the chart's ticker and day (r = its row()).
function renderRecord(r) {
  const sec = $('record-sec');
  if (!r) { sec.hidden = true; return; }
  const rec = trackRecord(r.f, r.i);
  $('record-sym').innerHTML = esc(r.sym) + staleBadge(r);  // a stale ticker's record stops at its own last bar; the badge says so
  $('record-table').innerHTML = recordTableHTML(rec);
  $('record-list').innerHTML = recordListHTML(rec);
  sec.hidden = false;
}
// The holdings table's "Peak record (10d)": the confirmed-PEAK group's record over the next 10
// trading days for one holding; null when it has no confirmed peak up to the selected day.
function peakRecord(r) {
  const rec = trackRecord(r.f, r.i);
  const g = rec.groups.find(x => x.dir === 'PEAK' && x.stage === 3);
  if (!g.signals.length) return null;
  const t = g.hz[PEAK_RECORD_H];
  return {hits: t.hits, outcomes: t.outcomes, count: g.signals.length, base: baseRate(rec.base, 'PEAK', PEAK_RECORD_H)};
}
function recordCell(r) { return r.rec ? rateCell(r.rec.hits, r.rec.outcomes, r.rec.base, PEAK_RECORD_H) : '<td class="num">–</td>'; }
// Sorting that column: by hit rate, then by the number of confirmed peaks; nothing to sort on
// (no confirmed peak, or no outcome yet) is null and goes last. Records under RECORD_MIN outcomes
// (the muted ones) form a lower tier that stays below the full-sample ones whichever way the
// column is sorted, so a "2 of 2" never tops the list.
function recordSort(r) { return r.rec && r.rec.outcomes ? [r.rec.hits / r.rec.outcomes, r.rec.count] : null; }
function recordTier(r) { return r.rec && r.rec.outcomes >= RECORD_MIN ? 0 : 1; }

// ---- conditions and combinations (docs/COMBOS.md) ------------------------
// A condition says where a stock stands on a day (above its 200-day average, RSI under 30
// lately, ...). It is null ("unknown") when the data cannot answer it, for example in a file
// written before the condition arrays existed; an unknown condition never shows a chip and
// never matches a filter or a combination.
function emptyCond() { return {above200: null, rsi_lo: null, rsi_hi: null, heavy: null, year: null, mom: null, volx: null}; }
// One of the optional arrays of a ticker file (sma200, mom, volx); null when the file lacks it.
function arrOf(f, k) { return f && Array.isArray(f[k]) && f[k].length === f.dates.length ? f[k] : null; }
// The conditions of ticker file f at bar i. day is the date whose S&P 500 median past-year
// return (index.json's mom_median) the ticker is compared with: the bar's own date, f.dates[i].
function condsAt(f, i, day) {
  const c = emptyCond();
  if (!f || i < 0 || i >= f.dates.length) return c;
  const sma = arrOf(f, 'sma200'), mom = arrOf(f, 'mom'), volx = arrOf(f, 'volx');
  if (sma && isNum(sma[i]) && isNum(f.close[i])) c.above200 = f.close[i] > sma[i];
  // true when the test holds on at least one of the last LATELY bars; null when any of them has no value
  const lately = (a, test) => {
    if (!a || i < LATELY - 1) return null;
    const w = a.slice(i - LATELY + 1, i + 1);
    return w.every(isNum) ? w.some(test) : null;
  };
  c.rsi_lo = lately(f.rsi, v => v < RSI_LO);
  c.rsi_hi = lately(f.rsi, v => v > RSI_HI);
  c.heavy = lately(volx, v => v >= HEAVY_X);
  if (mom && isNum(mom[i])) c.mom = mom[i];
  if (volx && isNum(volx[i])) c.volx = volx[i];
  const mm = S.index && S.index.mom_median;
  const med = mm && typeof mm === 'object' && hasOwn(mm, day) ? mm[day] : null;
  if (isNum(c.mom) && isNum(med)) c.year = c.mom > med ? 'strong' : c.mom < med ? 'weak' : 'mid';
  return c;
}
// The same object from screener.json's "cond" (anything unexpected counts as unknown).
function condFromJSON(o) {
  const c = emptyCond();
  if (!o || typeof o !== 'object') return c;
  ['above200', 'rsi_lo', 'rsi_hi', 'heavy'].forEach(k => { if (typeof o[k] === 'boolean') c[k] = o[k]; });
  if (['strong', 'weak', 'mid'].includes(o.year)) c.year = o.year;
  if (isNum(o.mom)) c.mom = o.mom;
  if (isNum(o.volx)) c.volx = o.volx;
  return c;
}
// Small neutral chips for the conditions that are known: the 200-day chip whenever it is known,
// the others only when true (and the past year only when strong or weak). '' when none apply.
function condChips(c) {
  return c ? COND_CHIPS.filter(([test]) => test(c)).map(([, label, title]) => `<span class="chip cond" title="${esc(title)}">${esc(label)}</span>`).join('') : '';
}
function comboById(id) { return COMBOS.find(cb => cb.id === id) || null; }
function activeCombo() { return comboById(S.combo); }
// A row matches a combination when it has a confirmed (stage 3) signal of that direction on its
// day and every required condition is true (an unknown condition never matches).
function comboMatch(r, cb) {
  return !!cb && !!r.cond && r.sigs.some(s => s.dir === cb.dir && s.stage === 3) && Object.keys(cb.req).every(k => r.cond[k] === cb.req[k]);
}
// The sentence shown wherever a combination is offered; the numbers are signed, two decimals.
function testNote(cb) {
  return `Tested on S&P 500 stocks from 2017 to 2026: in the month after this combination, stocks did about the same as on an ordinary day (${fmt(cb.dev, 2)} and ${fmt(cb.hold, 2)} points versus an ordinary day). It describes today, not what comes next.`;
}
// The chips line of a Dashboard card or table row: a "Matches" chip first when the row matches
// the highlighted combination, then the condition chips. '' when there is nothing to show.
function condLine(r) {
  const cb = activeCombo();
  const match = r.hl && cb ? `<span class="chip cond match" title="${esc('Matches the highlighted combination: ' + cb.label)}">Matches</span>` : '';
  return match + condChips(r.cond);
}
function condCell(r) { const l = condLine(r); return `<td class="condcell">${l ? `<div class="conds">${l}</div>` : ''}</td>`; }
// The options of the Dashboard's Highlight select and the Screener's Combination select.
function comboOptionsHTML(first) {
  return first + [['VALLEY', 'Valleys'], ['PEAK', 'Peaks']].map(([dir, label]) =>
    `<optgroup label="${label}">${COMBOS.filter(cb => cb.dir === dir).map(cb => `<option value="${esc(cb.id)}">${esc(cb.label)}</option>`).join('')}</optgroup>`).join('');
}
// The Screener filters a combination stands for: its direction, stage 3, RSI / below-high any,
// choppy shown, and exactly its conditions (the others any/off). Group and "not on my list" stay.
function comboFilters(cb) {
  return {show: cb.dir === 'PEAK' ? 'peak' : 'valley', stage: 3, rsi: 0, below: 0, choppy: false,
    ma: cb.req.above200 === true ? 'above' : cb.req.above200 === false ? 'below' : 'any',
    rsil: cb.req.rsi_lo ? 'lo' : cb.req.rsi_hi ? 'hi' : 'any',
    heavy: cb.req.heavy === true, year: cb.req.year || 'any'};
}
// The combination whose settings the Screener's filters equal exactly, or null (= Custom).
function comboOfFilters(F) {
  return COMBOS.find(cb => { const s = comboFilters(cb); return Object.keys(s).every(k => F[k] === s[k]); }) || null;
}
// The Info tab's test table: every combination plus the confirmed signal alone, valleys then peaks.
function comboTableHTML() {
  const rows = [COMBO_ALONE[0]].concat(COMBOS.filter(cb => cb.dir === 'VALLEY'), [COMBO_ALONE[1]], COMBOS.filter(cb => cb.dir === 'PEAK'));
  return `<table class="plain combos"><thead><tr><th>Combination</th><th class="num">2017-2022</th><th class="num">2023-2026</th></tr></thead><tbody>${
    rows.map(cb => `<tr><td>${esc(cb.label)}</td><td class="num">${esc(fmt(cb.dev, 2))}</td><td class="num">${esc(fmt(cb.hold, 2))}</td></tr>`).join('')}</tbody></table>`;
}

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
  const conds = condLine(r);
  return `<div class="card ${dir.toLowerCase()} s${top.stage}${r.hl ? ' hl' : ''}">
    <div class="card-head">${symlink(r.sym, true)}${badges.join('')}${staleBadge(r)}<span class="price">close ${fmtClose(r.close)}</span></div>
    <div class="name">${esc(r.name)}</div>${posLine(r)}${conds ? `<div class="conds">${conds}</div>` : ''}
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
  const val = r => { const p = r.pos || {}; return ({
    symbol: r.sym, name: r.name.toLowerCase(), today: rank(r), rsi: r.rsi, off: r.pct,
    macd: (r.hist >= 0 ? 0 : 2) + (r.trend === 'rising' ? 0 : 1), hist: r.hist, close: r.close,
    recent: recentCount(r, days), default: rank(r),
    // the holding-details columns; a missing value ("–") sorts last whichever way the column goes
    value: p.value, weight: p.weight, gain: p.gainPct, target: p.toTarget, stop: p.toStop, held: p.heldDays, spy: p.vsSpy1m,
    record: recordSort(r)})[s.col]; };
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    if (s.col === 'record' && recordTier(a) !== recordTier(b)) return recordTier(a) - recordTier(b);  // small samples below full ones, either direction
    return (s.asc ? 1 : -1) * cmpVal(x, y) || a.sym.localeCompare(b.sym);
  });
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
function tableHTML(rows, key, days, extra) {
  // extra: the holding-details columns (holdCols), placed after "% below 1-yr high"; none for the watch table.
  extra = extra || [];
  const cols = [
    ['symbol', 'Ticker'], ['name', 'Name'], ['today', 'Signal'], ['macd', 'MACD vs signal'], ['hist', `Histogram (${rangeLabel()})`],
    ['close', 'Close'], ['rsi', 'RSI'], ['off', '% below 1-yr high']].concat(extra, [['recent', `Recent (${rangeLabel()})`]]);
  // The Conditions column (not sortable) sits right after Signal.
  const ths = sortHeaders(cols.slice(0, 3), key) + COND_TH + sortHeaders(cols.slice(3), key);
  const body = rows.map(r => {
    const t = r.sigs.length ? r.sigs.map(badge).join(' ') : '<span class="sub">–</span>';
    const rc = (hasDir(r, 'PEAK') ? 'has-peak' : hasDir(r, 'VALLEY') ? 'has-valley' : '') + (r.hl ? ' hl' : '');
    return `<tr class="${rc}">
      <td><b>${symlink(r.sym)}</b>${r.weak ? ' <span class="badge choppy">choppy</span>' : ''}${staleBadge(r)}</td>
      <td class="name" title="${esc(r.name)}">${esc(r.name)}</td>
      <td>${t}</td>
      ${condCell(r)}
      <td>${r.side}, ${r.trend}</td>
      <td>${spark(r, S.rangeN)}</td>
      <td class="num">${fmtClose(r.close)}</td>
      ${rsiCell(r)}
      ${pctCell(r)}
      ${extra.map(([k]) => holdCell(r, k, S.day)).join('')}
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
  // Highlight (docs/COMBOS.md): with a combination chosen, the rows that match it are marked and a
  // line under the stats says how many there are, with the combination's test result. With None
  // nothing is marked and the line is hidden.
  const cb = activeCombo();
  rows.forEach(r => { r.hl = comboMatch(r, cb); });
  if (cb) {
    const n = rows.filter(r => r.hl).length;
    $('hl-line').innerHTML = `<b>${esc(cb.label)}</b>: ${n} of your tickers ${n === 1 ? 'matches' : 'match'} on ${esc(day)}. <span class="sub">${esc(testNote(cb))}</span>`;
  }
  $('hl-line').hidden = !cb;
  // The viewer's holding details (shares, cost, ...) and what they add; weight needs the total first.
  // Each holding's confirmed-peak record, for the "Peak record (10d)" column.
  hold.forEach(r => { r.pos = position(r, day); r.rec = peakRecord(r); });
  const total = hold.reduce((s, r) => s + (isNum(r.pos.value) ? r.pos.value : 0), 0);
  hold.forEach(r => { if (isNum(r.pos.value) && total > 0) r.pos.weight = r.pos.value / total * 100; });
  const anyShares = hold.some(r => isNum(r.pos.value));

  // Card order: strongest stage first, then (when any holding has shares) larger position value,
  // then not choppy, then larger |MACD| as a percent of price.
  const valueOf = r => isNum(r.pos.value) ? r.pos.value : -1;
  const byStrength = dir => (a, b) => topSignal(b.sigs, dir).stage - topSignal(a.sigs, dir).stage || (anyShares ? valueOf(b) - valueOf(a) : 0) || (a.weak ? 1 : 0) - (b.weak ? 1 : 0) || b.pctOfPrice - a.pctOfPrice;
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
  // Portfolio stats (only when some holding has shares) and the targets/stops section (only when
  // some holding has a target or a trailing stop); both come from the viewer's own details.
  const pstats = portfolioStats(hold);
  $('pstats').innerHTML = pstats; $('pstats').hidden = !pstats;
  const anyLevel = hold.some(r => isNum(r.pos.target) || isNum(r.pos.trail));
  $('targets-sec').hidden = !anyLevel;
  if (anyLevel) {
    const chips = targetChips(hold);
    $('targets').innerHTML = chips.length ? `<div class="chips">${chips.join('')}</div>` : '<div class="empty">None close on this day.</div>';
  }

  $('peaks').innerHTML = peaks.length ? `<div class="cards">${peaks.map(r => card(r, 'PEAK')).join('')}</div>` : '<div class="empty">No new PEAK signals on your holdings on this day.</div>';
  $('nearhigh').innerHTML = near.length ? `<div class="chips">${near.map(r =>
    `<div class="chip"><b>${symlink(r.sym)}</b>${staleBadge(r)} <span>RSI ${isNum(r.rsi) ? r.rsi.toFixed(0) : '–'}, ${fmtPct(r.pct)} off high, histogram ${r.trend}</span></div>`).join('')}</div>`
    : '<div class="empty">None on this day.</div>';
  $('valleys').innerHTML = valleys.length ? `<div class="cards">${valleys.map(r => card(r, 'VALLEY')).join('')}</div>` : '<div class="empty">No new VALLEY signals on your holdings on this day.</div>';
  // The Peak record column appears once some holding has a confirmed peak to report on; the
  // holding-details columns follow it.
  const recordCol = hold.some(r => r.rec) ? [['record', 'Peak record (10d)']] : [];
  if (!recordCol.length && SORT.holdings.col === 'record') SORT.holdings = {col: 'off', asc: true};  // the sorted column went away: back to the default order
  $('holdings').innerHTML = hold.length ? tableHTML(sortRows(hold.slice(), 'holdings', days), 'holdings', days, recordCol.concat(holdCols(hold))) : '<div class="empty">No holdings with data. Add some on the My list tab.</div>';
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
  if (!need) { buildDays(); renderControls(); }  // a ticker off the lists: the day picker takes in its days
  showTab('chart'); window.scrollTo({top: 0});
  if (!need) return;
  await loadFiles([sym]);
  if (S.chartPending !== sym) return;  // the viewer opened something else meanwhile
  S.chartPending = null;
  buildDays(); renderControls();
  if (S.tab === 'chart') renderChart();
}
function renderChart() {
  const box = $('chartbox');
  // The Track record section follows the chart: renderRecord(null) hides it whenever no chart is
  // drawn. (It is not hidden while a chart is being redrawn: that would collapse the page for an
  // instant and lose the viewer's scroll position.)
  if (S.chartPending) {  // a Screener ticker whose file is still on its way
    $('chartsym').innerHTML = `<option>${esc(S.chartPending)}</option>`; $('chartmeta').textContent = '';
    box.innerHTML = `<div class="empty">Loading data for ${esc(S.chartPending)}…</div>`;
    renderRecord(null); return;
  }
  const syms = chartSyms();
  if (S.chartSym && !syms.includes(S.chartSym) && S.fileErrors[S.chartSym]) {  // a Screener ticker whose file failed
    $('chartsym').innerHTML = `<option>${esc(S.chartSym)}</option>`; $('chartmeta').textContent = '';
    box.innerHTML = `<div class="empty">Could not load the data file for ${esc(S.chartSym)} (${esc(S.fileErrors[S.chartSym])}). Try again in a minute.</div>`;
    renderRecord(null); return;
  }
  if (!syms.length) {
    $('chartsym').innerHTML = ''; $('chartmeta').textContent = '';
    box.innerHTML = `<div class="empty">${S.indexError ? esc(INDEX_ERROR) : 'No tickers with data yet. Add some on the My list tab.'}</div>`;
    renderRecord(null); return;
  }
  if (!S.chartSym || !syms.includes(S.chartSym)) S.chartSym = syms[0];
  $('chartsym').innerHTML = syms.map(s => `<option value="${esc(s)}"${s === S.chartSym ? ' selected' : ''}>${esc(s)}${chartLabel(s)}</option>`).join('');
  const f = S.files[S.chartSym];
  const day = S.day || f.dates[f.dates.length - 1];  // no lists yet (Screener only): the ticker's own newest day
  const r = row(S.chartSym, day);
  if (!r) { box.innerHTML = `<div class="empty">No data for ${esc(S.chartSym)} on or before ${esc(day)}.</div>`; $('chartmeta').textContent = ''; renderRecord(null); return; }
  const end = r.i + 1, start = Math.max(0, end - S.rangeN);
  const D = f.dates.slice(start, end), C = f.close.slice(start, end), M = f.macd.slice(start, end),
    Sg = f.signal.slice(start, end), Hs = f.hist.slice(start, end), Rs = f.rsi.slice(start, end);
  // The 200-day average of the close (docs/COMBOS.md); an empty list for a file without it.
  const Ma = arrOf(f, 'sma200') ? f.sma200.slice(start, end) : [];
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
  // Like the 1-yr high, the 200-day average joins the price scale where it is within 25% of the
  // closes shown; where it is further away it runs off the panel and is clipped there.
  const lo0 = cmin, hi0 = cmax;
  nums(Ma).forEach(v => { if (v >= lo0 / 1.25 && v <= hi0 * 1.25) { cmin = Math.min(cmin, v); cmax = Math.max(cmax, v); } });
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
  // The 200-day average as a thin dashed line, kept inside the price panel; drawn only where the file has it.
  const hasMa = nums(Ma).length > 0;
  const maLine = hasMa ? `<clipPath id="priceclip"><rect x="${L}" y="${T}" width="${plotW}" height="${H1}"/></clipPath><path class="ma" clip-path="url(#priceclip)" d="${path(Ma, y1)}"/>` : '';
  box.innerHTML = `<div class="chart-head"><span class="sym">${esc(S.chartSym)}</span><span class="meta">${esc(r.name)}${r.name ? ' · ' : ''}${rangeLabel()}, ${n} trading days, ${esc(D[0])} to ${esc(D[n - 1])}</span>
      <span class="chart-legend"><span><i style="background:var(--line-price)"></i>Close</span>${hasMa ? '<span><i class="dashed"></i>200-day avg</span>' : ''}<span><i style="background:var(--line-macd)"></i>MACD</span><span><i style="background:var(--line-signal)"></i>Signal</span><span><i style="background:var(--hist-pos)"></i><i style="background:var(--hist-neg);margin-left:-3px"></i>Histogram</span><span><i style="background:var(--line-rsi)"></i>RSI</span></span></div>
    <svg class="chart" viewBox="0 0 ${W} ${Htot}" width="${W}" height="${Htot}">
      <text x="${L}" y="${T - 4}" font-weight="600">Close</text>
      ${g}${hiLine}${maLine}
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
    tip.innerHTML = `<b>${esc(D[i])}</b><br>Close ${fmtClose(C[i])}` + (hasMa ? `<br>200-day avg ${fmtClose(Ma[i])}` : '') +
      `<br>MACD ${fmt(M[i])} &nbsp; Signal ${fmt(Sg[i])}<br>Histogram ${fmt(Hs[i])}<br>RSI ${isNum(Rs[i]) ? Rs[i].toFixed(1) : '–'}` + (s ? `<br>${s.map(badge).join(' ')}` : '');
    tip.style.display = 'block';
    const bx = box.getBoundingClientRect();
    const left = e.clientX - bx.left + 14, top = e.clientY - bx.top + 14;
    tip.style.left = Math.max(0, Math.min(left, box.clientWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.min(top, box.clientHeight - tip.offsetHeight - 8) + 'px';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { cross.style.display = 'none'; tip.style.display = 'none'; });
  renderRecord(r);  // same ticker and day as the chart; the range selector does not affect it
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
  // the condition filters (docs/COMBOS.md)
  if (['any', 'above', 'below'].includes(o.ma)) f.ma = o.ma;
  if (['any', 'lo', 'hi'].includes(o.rsil)) f.rsil = o.rsil;
  if (typeof o.heavy === 'boolean') f.heavy = o.heavy;
  if (['any', 'strong', 'weak'].includes(o.year)) f.year = o.year;
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
  $('sc-ma').value = F.ma;
  $('sc-rsil').value = F.rsil;
  $('sc-heavy').checked = F.heavy;
  $('sc-year').value = F.year;
  // The Combination select is not stored: it shows a combination whenever the filters equal its
  // settings exactly, Custom otherwise; with a combination shown, its test result sits under the filters.
  const cb = comboOfFilters(F);
  $('sc-combo').value = cb ? cb.id : 'custom';
  $('sc-combo-note').textContent = cb ? cb.label + ': ' + testNote(cb) : '';
  $('sc-combo-note').hidden = !cb;
}
function readScreenControls() {
  S.screenF = cleanScreenF({show: $('sc-show').value, stage: $('sc-stage').value, rsi: $('sc-rsi').value, within: $('sc-within').value,
    // Until screener.json is in, the Group select only has "All groups"; keep the remembered group then.
    below: $('sc-below').value, group: screenGroups().length ? $('sc-group').value : S.screenF.group,
    choppy: $('sc-choppy').checked, notmine: $('sc-mine').checked,
    ma: $('sc-ma').value, rsil: $('sc-rsil').value, heavy: $('sc-heavy').checked, year: $('sc-year').value});
  storeScreen();
  renderScreen();
}
// The Combination select: a combination sets the filters it stands for (comboFilters); Group and
// "Only tickers not on my list" stay as they are. Choosing Custom while a combination is shown
// clears the four condition filters, so the select can show Custom; the other filters stay.
function chooseScreenCombo(id) {
  const cb = comboById(id);
  if (cb) S.screenF = cleanScreenF(Object.assign({}, S.screenF, comboFilters(cb)));
  else if (comboOfFilters(S.screenF)) S.screenF = cleanScreenF(Object.assign({}, S.screenF, {ma: 'any', rsil: 'any', heavy: false, year: 'any'}));
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
    cond: condFromJSON(e.cond),  // conditions on the ticker's last bar (docs/COMBOS.md); all unknown in an older screener.json
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
  // Condition filters, under every Show setting: a setting other than any/off only lets through
  // tickers whose condition is known and equal to it.
  const c = r.cond;
  if (F.ma !== 'any' && c.above200 !== (F.ma === 'above')) return false;
  if (F.rsil === 'lo' && c.rsi_lo !== true) return false;
  if (F.rsil === 'hi' && c.rsi_hi !== true) return false;
  if (F.heavy && c.heavy !== true) return false;
  if (F.year !== 'any' && c.year !== F.year) return false;
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
  const ths = sortHeaders(cols.slice(0, 4), 'screen') + COND_TH + sortHeaders(cols.slice(4), 'screen') + '<th></th>';
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
      ${condCell(r)}
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
  $('combosel').value = S.combo || 'none';
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
  $('hl-wrap').hidden = t !== 'dash';  // the Highlight select only acts on the Dashboard
  if (t === 'screen') { renderScreen(); loadScreener(); }
  if (t === 'chart') renderChart();
  if (t === 'list') renderEditor();
  lsSet('macd-tab', t);
}
// Select a trading day; true when the day changed (false for an unknown day or the one already shown).
function setDay(d) { if (!d || !S.days.includes(d) || d === S.day) return false; S.day = d; render(); return true; }

['rangesel', 'rangesel2'].forEach(id => { $(id).innerHTML = RANGES.map(([l, n]) => `<button data-n="${n}">${l}</button>`).join(''); });
$('combosel').innerHTML = comboOptionsHTML('<option value="none">None</option>');
$('sc-combo').innerHTML = comboOptionsHTML('<option value="custom">Custom</option>');
$('combo-table').innerHTML = comboTableHTML();
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
  // A date in the Track record's signal list: show that day on the chart (and the day picker). The
  // list is rebuilt by the render, so keyboard focus goes back to the same date's button (focus()
  // keeps it in view if the list shifted); a mouse click also scrolls up to the chart, a keyboard
  // activation (e.detail is 0) stays with the list.
  const dl = e.target.closest('.daylink');
  if (dl) {
    const d = dl.dataset.day, changed = setDay(d);
    const again = [...document.querySelectorAll('#record-list .daylink')].find(b => b.dataset.day === d);
    if (again) again.focus();
    if (changed && e.detail !== 0) window.scrollTo({top: 0});
    return;
  }
  const cell = e.target.closest('th');
  const th = cell && cell.querySelector('.sorth');  // the sort button; a click anywhere in the cell counts
  if (th) {
    const s = SORT[th.dataset.key];
    // Numeric "more is more interesting" columns start descending, the rest ascending.
    if (s.col === th.dataset.col) s.asc = !s.asc; else { s.col = th.dataset.col; s.asc = !['rsi', 'close', 'recent', 'signal', 'chg1', 'chg3', 'value', 'weight', 'gain', 'held', 'spy', 'record'].includes(th.dataset.col); }
    render();
  }
});
['sc-show', 'sc-stage', 'sc-rsi', 'sc-within', 'sc-below', 'sc-group', 'sc-choppy', 'sc-mine',
  'sc-ma', 'sc-rsil', 'sc-heavy', 'sc-year'].forEach(id => $(id).addEventListener('change', readScreenControls));
$('sc-combo').addEventListener('change', e => chooseScreenCombo(e.target.value));
$('combosel').addEventListener('change', e => {
  S.combo = comboById(e.target.value) ? e.target.value : null;
  lsSet('macd-combo', S.combo || 'none');
  renderDash();
});
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
$('hold-save').addEventListener('click', saveHoldForm);
$('hold-table').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.closest('.hold-in')) { e.preventDefault(); saveHoldForm(); } });
$('bk-copy').addEventListener('click', copyBackup);
$('bk-restore').addEventListener('click', restoreBackup);
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
  const cb = lsGet('macd-combo'); S.combo = comboById(cb) ? cb : null;  // an unknown value means None
  S.screenF = readStoredScreen();
  S.holdDetails = readHoldings();
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
