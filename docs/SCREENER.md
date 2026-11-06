# Screener: signals across the whole universe

Addendum to SPEC.md (2026-11-06). The Dashboard shows signals for the viewer's own tickers; the
Screener shows, for the latest trading day only, every ticker in the universe that fired, so a
viewer can look for VALLEY signals (and recoveries) on stocks they do not own yet. Everything
below is a contract between `fetch_data.py` (writes `site/data/screener.json`) and the page.
Nothing on the page may recommend buying or selling; it describes what the indicator did.

## universe.txt groups

Top-level groups are now marked with a double hash: a line starting with `## ` names the group
that every following ticker belongs to, until the next `## ` line. Single-hash lines stay
comments (sub-headings such as `# Broad market`, notes, inline `# ...` after a ticker). The
file is reorganised to exactly these groups, in this order, keeping every ticker and every
existing sub-heading comment:

    ## Indexes
    ## S&P 500
    # (from Wikipedia, 2026-10-29)
    ## Nasdaq-100
    # (only the companies that are not already in the S&P 500 list above)
    ## ETFs
    ## Other stocks
    # Large companies outside the S&P 500, big foreign ADRs, and popular names
    ## Added by the owner
    # Put one ticker per line below this note ...

(`# Dow 30` and its note are kept as plain comments under `## S&P 500`, since the Dow companies
are all in that list.) The header comment at the top of the file and README/SETUP's "Adding
tickers" steps say `## Added by the owner` instead of `# Added by the owner`.

`read_universe(path)` keeps returning the plain ticker list (callers and tests unchanged). A new
`read_universe_groups(path)` returns `{sym: group}` with the same parsing; a ticker before any
`## ` line gets the group `"Other stocks"`. A `## ` line with no text also means "Other stocks".

## site/data/screener.json

Written by `main()` after the fetch loop, before `index.json`, from the ticker files on disk
(fresh and stale alike: every `sym` in `tickers`), with `write_json`. Never written partially;
if building it raises, print the error and continue (index.json and the summary line still
matter more). `--only` runs write it too (over the subset). Exact shape:

```
{
  "generated": "2026-11-06T13:59:29Z",   // same string as index.json
  "last_bar":  "2026-11-05",             // same as index.json (most common last bar)
  "params":    {same object as index.json},
  "groups":    ["Indexes", "S&P 500", "Nasdaq-100", "ETFs", "Other stocks", "Added by the owner"],
               // the groups that occur, in universe.txt order
  "tickers": {
    "AAPL": {
      "name": "Apple Inc.",
      "group": "S&P 500",
      "last_bar": "2026-11-05",   // the ticker file's newest date
      "stale": false,             // true when last night's fetch failed and the file was kept
      "close": 343.83,
      "rsi": 61.39,               // null during warm-up (never in practice)
      "macd": 4.0591, "signal": 3.9, "hist": 0.1591,
      "pct_of_price": 1.18,       // |macd| / close * 100, 2 decimals
      "weak": false,              // unrounded |macd| / close * 100 < params.weak_pct, as the scanner
                                  // and the Dashboard compare it  (the page calls this "choppy")
      "pct_below_high": 1.4,      // (1 - close / max close of the whole file) * 100, 1 decimal
      "chg_1m": 2.3,              // close vs the close 21 bars earlier, percent, 1 decimal; null if too short
      "chg_3m": -4.1,             // same over 63 bars
      "side": "above",            // "above" if hist >= 0 else "below"   (MACD vs signal line)
      "trend": "rising",          // hist vs the previous bar: "rising" / "falling" / "flat"
      "macd_dir": "rising",       // macd line vs the previous bar: "rising" / "falling" / "flat"
      "today": [["VALLEY", 3], ["VALLEY", 2]],   // events on last_bar, [dir, stage], may be []
      "recent": {"2026-10-28": [["VALLEY", 1]], ...},
                                  // events on the last 21 bars INCLUDING last_bar, same [dir, stage] form,
                                  // only days that had an event (so `today` == recent[last_bar] or [])
      "cross": {"dir": "VALLEY", "date": "2026-11-03", "days": 2}
                                  // the most recent stage-3 event in the file, days = trading bars since
                                  // it (0 = on last_bar); null if none in the file
    }, ...
  }
}
```

Values come straight from the ticker file's arrays (already rounded), computed at the file's
last index; `pct_below_high` uses the whole file like the page's `row()` does for the latest
day. `[dir, stage]` pairs drop the `detail` text to keep the file small (~250 KB for 800
tickers); the page knows the stage names. Keys of `recent` are ISO dates. Only the last 21
bars are scanned for `recent`; `cross` scans the whole events map.

A ticker whose file cannot be read or has no MACD value on its last bar is left out of
`tickers` (and counted in one log line `screener: N tickers, M left out`).

## The page: Screener tab

Tab order becomes Dashboard, **Screener**, Charts, Info, My list (`TABS` gets `'screen'`,
`view-screen` in index.html, `macd-tab` may remember it). The tab loads
`data/screener.json?v=<index.generated>` the first time it is shown (not at start-up), with the
same validation discipline as the other files (`validScreener`: object with `tickers` object
and `last_bar` string); on failure it shows a notice in the same style as the Dashboard's
("The screener data has not been published yet; it appears after the next nightly run.") and
the rest of the page is unaffected. Its own status line while loading.

Header note under the tab heading: "Every ticker in the data set that fired on <last_bar>, the
last completed trading day. The day picker does not apply here." Under Recovering (whose rows
mostly did not fire on last_bar) the note reads instead: "Tickers whose confirmed valley
crossover was within the last N trading days and whose momentum is still rising, as of
<last_bar>, the last completed trading day. The day picker does not apply here." Count line:
"N of M tickers match" (M = tickers in the file).

Controls (a `.filters` row that wraps on phones; each a `<select>` or checkbox with a visible
label; the whole set is remembered in localStorage `macd-screen` as JSON and restored on load;
invalid stored values fall back to defaults):

- **Show**: `Valleys` (default) | `Peaks` | `Recovering` | `All signals`.
  - Valleys: `today` has a VALLEY event. Peaks: has a PEAK event. All signals: `today` non-empty.
  - Recovering: `cross` is a VALLEY, `cross.days` <= the "within" setting, `hist > 0` and
    `macd_dir === 'rising'` (momentum turned up recently and is still rising). The Stage and
    RSI filters below apply as usual (stage filter ignored for Recovering); a **Within** select
    (`5` | `10` (default) | `21` trading days) appears only for Recovering.
- **Stage at least**: `any` | `2 (MACD turned)` | `3 (confirmed)` (default `any`). Uses the
  highest stage of the chosen direction in `today` (for All signals: the highest of any).
- **RSI**: for Valleys/Recovering: `any` | `below 50` | `below 40` (default) | `below 30`;
  for Peaks: `any` | `above 60` (default) | `above 70`; for All signals: `any`. The labels change
  with the Show setting; only the number is stored, e.g. `{"rsi": 40}`; the side (below for
  Valleys and Recovering, above for Peaks) follows the Show setting and is never stored.
  A ticker with null RSI never matches an RSI limit.
- **Below 1-yr high at least**: `any` (default) | `5%` | `10%` | `20%` | `30%`.
- **Group**: `All groups` (default) plus one option per entry of `groups`.
- **Hide choppy** checkbox, default on (hides `weak` tickers).
- **Only tickers not on my list** checkbox, default off.

Table (sortable like the Dashboard tables: `<button class="sorth">` headers, `aria-sort`,
`SORT.screen`; default sort = stage of the shown direction descending, then RSI ascending for
valleys / descending for peaks, then `pct_below_high` descending; for Recovering default =
`cross.days` ascending then RSI ascending). Columns:

1. Ticker (the `symlink` button, plus `choppy` / `data from <date>` badges as the Dashboard;
   a `★` badge with title "On your list" when the ticker is in the viewer's lists)
2. Name
3. Group
4. Signal: the `today` badges (same `badge()` markup, stage names from `STAGE`); for Recovering
   also a chip "crossed up N days ago"
5. MACD vs signal: "above, rising" etc. (side + trend)
6. Close
7. RSI with the same bar as the Dashboard
8. % below 1-yr high with its bar
9. 1M change, 3M change (signed percent, `+2.3%`, green/red via classes `up`/`down`, `–` if null)
10. Recent: the 21-day strip built from `recent` (reuse `strip()` by giving it an
    `eventsOn`-compatible accessor: factor `strip()` to take a `(date) => sigs` function;
    `sigs` here are `{dir, stage}` objects made from the pairs)
11. an **Add to watch** button (`class="addwatch" data-sym`) that appends the ticker to the
    viewer's watch list (`applyLists` with the current lists plus it, note '' — but do NOT switch
    to the Dashboard tab: add a parameter to `applyLists` so the Screener stays visible), after
    which the row shows the ★ badge instead of the button. If the ticker is a holding, no button.

Clicking a ticker opens its chart: `S.chartSym = sym`, the file is loaded if needed
(`loadFiles([sym])`), and `chartSyms()` includes `S.chartSym` when it is loaded even if it is
not on the viewer's lists (the select shows it as "AAPL (screener)"). Everything else about the
Charts tab is unchanged.

Rows are capped at 400 with a line "Showing the first 400 of N matches; add a filter" (sorted
first, then capped). An empty result shows "No tickers match these filters on <last_bar>."

Style: reuse the existing tokens and table styles; `.filters` is a flex row with `gap: 10px`,
labels in `.note` style, selects styled like `#daysel`; the `up`/`down` classes use
`--hist-pos` / `--hist-neg`; the ★ badge uses the `flag` badge style. Phone width: the table
sits in a `.scroll` wrapper like the others; the filter row wraps.

## Info tab additions

In "The other numbers" add entries: **Screener** (what it is, latest day only, filters are
remembered in this browser), **Recovering** (a valley crossover within the last N trading days
with the histogram still positive and the MACD line still rising; a recovery can fail),
**Last crossover** (the most recent confirmed crossover, either direction, and how many trading
days ago), **1M / 3M change** (close vs 21 / 63 trading days earlier), **Group** (where the
ticker sits in the site's list: S&P 500, Nasdaq-100, ETFs, ...). Add one sentence to "Things to
keep in mind": a valley signal on a stock in a long decline is common on the way down; the
"% below 1-yr high" column shows how far it has fallen, not whether it has stopped.

## README / SETUP / SPEC

README: a short "Screener" paragraph under the feature description (latest day only, filters,
Add to watch, not advice); the "Adding tickers" steps and the file table mention
`## Added by the owner` and the `## ` group lines; `screener.json` in the "site/data" row.
SETUP step for adding tickers: `## Added by the owner`. SPEC.md: the universe.txt section
describes the `## ` groups and `read_universe_groups`; the data-file section lists
`screener.json` with a pointer to this file; the page section lists the Screener tab with a
pointer here. Nightly schedule: cron minute moves off the top of the hour (`37 5 * * 2-6`,
05:37 UTC) because GitHub starts top-of-the-hour schedules hours late; update.yml comment,
README "Timing" and SPEC say 05:37 UTC (1:37 am New York in summer, 12:37 am in winter).

## Verification expected

- fetch_data.py: `python -I fetch_data.py --only AAPL,VTR,BRK-B,SGOV,SPY,^GSPC --out <scratch>`
  writes `screener.json` matching the shape above; a script asserts every field against the
  ticker files (close/rsi/macd/signal/hist equal the last array values; `today` equals
  `events[last_bar]` pairs; `recent` has only the last 21 bars' event days; `cross` is the last
  stage-3 event; `pct_below_high`, `chg_1m`, `chg_3m` recomputed by hand). `read_universe` still
  returns 802 tickers from the reorganised universe.txt, no duplicates; `read_universe_groups`
  assigns every ticker one of the six groups and the S&P 500 group has 503. ema/macd/rsi/detect
  source text still identical to `D:\MACD_Alerts\macd_scan.py`.
- The page: `node --check`; served locally with the real 68 ticker files plus a screener.json
  made from them; every filter exercised, counts checked by an independent computation in the
  browser console or Python over the same JSON; sorting; Add to watch updates the hash and the
  Dashboard; a screener ticker opens on the Charts tab; the tab remembers filters after reload;
  no console errors; 375 px layout has no horizontal page scroll; dark mode.
