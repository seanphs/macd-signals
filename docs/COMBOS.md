# Conditions and combinations

Addendum to SPEC.md (2026-11-07). The owner tested twelve combinations of the confirmed MACD
signal with one more condition (200-day average, recent RSI extremes, heavy volume, past-year
strength) on ten years of S&P 500 data, with the combinations fixed in advance, a 2017-2022
development period and a 2023-2026 confirmation period. None of them predicted what the stock did
over the next month better than an ordinary day did. This feature shows those conditions on the
page and lets a viewer highlight or filter stocks by them, **as descriptions of where a stock
stands today**. Every place a combination is offered shows its test result next to it. Nothing
may read as a recommendation or a prediction.

## fetch_data.py

### Two years in, one year out
- `--range` default becomes `2y` (help text says why: the 200-day average and the past-year
  return need more than a year of bars). `fetch_chart`'s default argument can stay `1y`; main
  passes `args.range`.
- After the completed bars are selected exactly as today, the **published window** is the bars
  whose date is later than the same calendar day one year before the last bar
  (`last.replace(year=last.year - 1)`, with 29 Feb becoming 28 Feb). This is the window a `1y`
  fetch returns, so `dates`, `close`, `macd`, `signal`, `hist`, `rsi` and `events` are computed
  on the published window exactly as now and do not change. The ema/macd/rsi/detect source text
  stays byte-identical to `D:\MACD_Alerts\macd_scan.py`.
- The completed-bar selection also yields, aligned with the same bars, Yahoo's `adjclose`
  (`indicators.adjclose[0].adjclose`; null where absent) and `volume`
  (`indicators.quote[0].volume`; null where absent). The quote-filled last bar keeps whatever
  adjclose and volume Yahoo sent for it (often null). `QUOTE_FILLS` is still appended once per
  ticker at most.

### New arrays in site/data/<SYM>.json
Same length as `dates`. Each is computed over the **whole fetched series** (two years) and then
cut to the published window, so the first days of the window have values.

- `sma200`: the mean of the raw `close` over the 200 bars ending at that bar; null when fewer
  than 200 bars exist up to it. 4 decimals.
- `mom`: past-year return skipping the latest month, in percent:
  `(adj[k-21] / adj[k-252] - 1) * 100` with `adj` = adjclose and `k` the index in the whole
  series; null when `k < 252` or either value is null or not positive. 2 decimals.
- `volx`: volume compared with normal: `volume[k] / mean(volume[k-50 .. k-1])`, null volumes
  counting as 0 in the mean; null when `k < 50`, when that mean is 0, or when `volume[k]` is
  null. 2 decimals.

With `--range 1y` the arrays are mostly null; that is acceptable (it is a testing option).
A two-year download is a couple of bars short of 252 + the published year, so `mom` is null on
the first two days of the published year; those days simply show no Strong/Weak chip.
Files written before this change (kept from the cache when a fetch fails) do not have these
arrays; everything below treats a missing array as all null ("unknown"). Such files still have
`rsi`, so their RSI chips still show; that is correct, not a fallback.

### site/data/index.json: `mom_median`
`"mom_median": {"2026-11-06": 14.27, ...}`: for each date, the median of `mom` over the tickers
whose universe group is `"S&P 500"` and whose file (fresh or stale) has a numeric `mom` on that
date, computed from the values as written in the files (2 decimals) with
`statistics.median`, rounded to 2 decimals. Only dates with at least 100 such values get a key.
Computed in `main()` after the fetch loop and before `build_screener`; if it raises, log one line
`mom_median was not computed: <error>`, use `{}` and carry on. `--only` runs compute it too (so a
small `--only` run has an empty or thin map; that is fine).

### site/data/screener.json: `cond`
Each ticker entry gets `"cond"`, the conditions at the file's last index, built with the same
rules as the page (below):
`{"above200": true|false|null, "rsi_lo": true|false|null, "rsi_hi": true|false|null,
  "heavy": true|false|null, "year": "strong"|"weak"|"mid"|null,
  "mom": 12.34|null, "volx": 1.85|null}`.
`build_screener` receives the `mom_median` map (new parameter with a default of `{}` so old
callers work).

## The conditions (identical rules in Python and in app.js)
For a ticker file `f` at index `i` (the page's `row().i`; the screener's last index):

| key | true when | null when |
|---|---|---|
| `above200` | `close[i] > sma200[i]` (false when `close[i] <= sma200[i]`) | `sma200[i]` missing |
| `rsi_lo` | some `rsi[i-9 .. i]` is below 30 | `i < 9` or any of those 10 RSI values missing |
| `rsi_hi` | some `rsi[i-9 .. i]` is above 70 | same |
| `heavy` | some `volx[i-9 .. i]` is 2 or more | `i < 9` or any of those 10 values missing |
| `year` | `"strong"` if `mom[i]` > `mom_median[dates[i]]`, `"weak"` if below, `"mid"` if equal | either missing |

Viewer-facing names: **Above 200-day** / **Below 200-day**, **RSI under 30 lately**, **RSI over
70 lately**, **Heavy volume lately**, **Strong past year** / **Weak past year**. Title texts:
- "Closed above (below) its 200-day average"
- "RSI was under 30 (over 70) on at least one of the last 10 trading days"
- "Volume was at least twice its 50-day average on at least one of the last 10 trading days"
- "Its return over the past year, skipping the latest month, is in the top (bottom) half of S&P
  500 stocks on this day"

## The combinations (a fixed constant `COMBOS` in app.js)
A ticker **matches** a combination on a day when it has a stage-3 (confirmed) event of that
direction on that day and every required condition is true; an unknown (null) condition never
matches. The test results are the average 20-trading-day return versus SPY, minus the same for an
ordinary day in the same month, in percentage points, for S&P 500 stocks.

| id | label | direction | requires | 2017-2022 | 2023-2026 |
|---|---|---|---|---|---|
| V1 | Valley + above 200-day average | VALLEY | above200 | -0.14 | -0.30 |
| V2 | Valley + RSI under 30 lately | VALLEY | rsi_lo | -0.04 | -0.21 |
| V3 | Valley + heavy volume lately | VALLEY | heavy | -0.02 | +0.17 |
| V4 | Valley + strong past year | VALLEY | year strong | -0.13 | -0.12 |
| V5 | Valley + above 200-day + strong year | VALLEY | above200, year strong | -0.24 | -0.21 |
| P1 | Peak + below 200-day average | PEAK | above200 false | +0.35 | +0.22 |
| P2 | Peak + RSI over 70 lately | PEAK | rsi_hi | +0.24 | -0.38 |
| P3 | Peak + heavy volume lately | PEAK | heavy | +0.06 | -0.07 |
| P4 | Peak + weak past year | PEAK | year weak | +0.22 | -0.19 |
| P5 | Peak + below 200-day + weak year | PEAK | above200 false, year weak | +0.40 | +0.17 |

For the Info tab table only, also: V0 "Confirmed valley alone" +0.00 / -0.10 and P0 "Confirmed
peak alone" +0.05 / -0.10. The hoped-for direction is above zero for valleys and below zero for
peaks; every number is within half a point, while a typical stock moves several points against
the market in a month.

The **test note** for a combination (one sentence pair, used on the Dashboard and the Screener):
"Tested on S&P 500 stocks from 2017 to 2026: in the month after this combination, stocks did
about the same as on an ordinary day (<dev> and <hold> points versus an ordinary day). It
describes today, not what comes next." Numbers formatted with a sign and two decimals.

## The page

### Condition chips
`condChips(c)` returns a row of small neutral chips (new `.chip` class: muted text, thin border
in `--line`-style token, no stage colors) for the conditions that are known: the 200-day chip
always when `above200` is known (Above or Below), the RSI chips only when true, Heavy volume only
when true, Strong/Weak past year when `year` is strong or weak. Unknown shows nothing. Every chip
has its title text. `row()` gains `cond` (built by one function `condsAt(f, i, day)` from the
file and `S.index.mom_median`); the Screener builds the same object from `cond` in screener.json.

Shown in: the Dashboard PEAK and VALLEY cards (one line under the badges), a new **Conditions**
column after **Signal** in the All holdings, Watchlist and Screener tables (not sortable; empty
cell when nothing is known).

### Dashboard: Highlight
A labeled select **Highlight** in the Dashboard controls (next to the range selector), options
"None" (default) and the ten combinations in two `<optgroup>`s, "Valleys" and "Peaks". Stored in
localStorage `macd-combo` (an unknown value falls back to None). With a combination chosen:
- a line under the stats row: "<label>: N of your tickers match on <selected day>." followed
  by the combination's test note;
- matching cards and table rows (All holdings, Watchlist) get the class `hl` (a left border and
  a light tint from a new `--hl` token defined for light and dark) and a "Matches" chip;
- nothing else changes. With None, the Dashboard looks exactly as before.

### Screener: condition filters and presets
New controls after **Group** (same `.filters` styling, remembered in `macd-screen` with these
defaults; `cleanScreenF` validates them and falls back to the defaults):
- **200-day average**: any | above | below (`ma`: `any`|`above`|`below`)
- **RSI lately**: any | under 30 | over 70 (`rsil`: `any`|`lo`|`hi`)
- **Heavy volume lately** checkbox (`heavy`: false)
- **Past year**: any | strong half | weak half (`year`: `any`|`strong`|`weak`)
- **Combination**: Custom (default) plus the ten combinations. Choosing one sets Show to Valleys
  or Peaks, Stage at least to 3, RSI to any, Below 1-yr high to any, Hide choppy off, and the
  four condition filters to exactly what the combination requires (the rest to any/off); Group
  and "Only tickers not on my list" are left alone. The combination is not stored separately:
  the select shows a combination whenever the current filters equal its settings exactly, and
  Custom otherwise. When it shows a combination, the test note appears under the filters.
- A condition filter other than any/off only matches tickers whose condition is known and equal.
  Condition filters apply to every Show setting, Recovering included.

### Charts tab
The price panel draws `sma200` as a thin dashed line (a new `--ma` token, light and dark) where
present, and the hover readout adds "200-day avg". Legend/note text mentions it.

### Info tab
In "The other numbers": **Conditions** (each condition's definition, as in the title texts),
**Highlight and combinations** (what matching means, that it uses the confirmed signal, and the
twelve-row test table above with one sentence on the method: combinations fixed in advance,
checked on 2017-2022 and again on 2023-2026, next-month return versus SPY compared with an
ordinary day, S&P 500 stocks, today's index members). In "Things to keep in mind": "A condition
or combination describes a stock today. In the site's ten-year test none of them predicted what
came next."

## README / SPEC
README: a short "Conditions and combinations" paragraph after "Track record" (what the chips
are, the Highlight select, the Screener filters and presets, the test result in one sentence,
not advice) and one bullet in "Reading the page". SPEC.md: the ticker-file section lists the
three new arrays and the two-year fetch with the one-year published window; index.json lists
`mom_median`; screener.json mentions `cond`; the Dashboard, Screener and Charts sections point
here; the fetch_data command line shows `--range 2y`.

## Verification expected
- `python -I fetch_data.py --only <the 503 S&P 500 tickers plus the watchlist tickers> --out
  <scratch>` (or the full universe) and a second run with `--range 1y --only <the watchlist
  tickers> --out <scratch2>`: for every ticker in both, `dates`, `close`, `macd`, `signal`,
  `hist`, `rsi` and `events` are identical on the dates both have (Yahoo's 1y window may start a
  day apart). An independent script downloads Yahoo's 2y chart for at least five tickers itself
  and recomputes `sma200`, `mom`, `volx` for every published date, and `mom_median` for three
  dates, from the definitions here; all equal after rounding. `screener.json`'s `cond` equals
  the rules above recomputed from the ticker files for every ticker.
- The page: `node --check`; served locally with that data; condition chips for three tickers on
  two days match the Python computation; the Highlight count and the highlighted rows match an
  independent count; every Screener condition filter and every preset, with counts checked
  independently over screener.json; a preset sets the visible controls and the select returns
  to Custom after a manual change; filters and Highlight survive a reload; old files without
  the new arrays render without errors (only RSI chips, no matches); no console errors; 375 px has no horizontal
  page scroll; dark mode; `esc()` on every inserted string; nothing reads as a recommendation;
  Holding details, Track record, the list editor and the existing Screener filters unchanged.
