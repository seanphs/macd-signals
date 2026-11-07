# Holding details: shares, cost, targets

Addendum to SPEC.md (2026-11-06). The viewer can record, per holding, how many shares they own,
what they paid, when, and the price levels they personally care about. The page then shows
position value, weight, gain, distance to those levels, holding period and performance against
SPY. Everything is optional, stays in the viewer's browser, and never enters the shareable link.
No change to fetch_data.py, universe.txt or the workflow: it is all browser-side arithmetic on
data the page already has. Nothing may read as advice: the page measures distance to the
viewer's own numbers and never suggests a target, a stop, or an action.

## Storage

localStorage key `macd-holdings`, a JSON object keyed by ticker (normalized like the lists):

```
{"AAPL": {"shares": 120, "cost": 182.5, "date": "2024-03-15", "target": 350, "trail": 10}, ...}
```

- `shares`: number >= 0 (fractions allowed), `cost`: average cost **per share** > 0,
  `date`: purchase date `YYYY-MM-DD` not in the future, `target`: a sell price > 0 the viewer
  chose, `trail`: a trailing-stop distance in percent, 0 < trail <= 100. Every field optional;
  a ticker with no valid field is dropped from the object.
- `readHoldings()` validates on load (same discipline as `readStored()`: anything invalid is
  ignored, never crashes); `storeHoldings()` writes it. Details for tickers not in the holdings
  list are kept (the viewer may remove and re-add a ticker) but never shown.
- The URL hash and "Copy link" are unchanged: details are never put in the address.
- Backup: on the My list tab, under the details table, a "Backup" box: a read-only textarea with
  the JSON (`macd-holdings` pretty-printed), a **Copy backup** button, and a textarea + **Restore
  from backup** button that parses pasted JSON with the same validation, merges it over the
  current details (pasted tickers replace, others stay) and reports what it took. Plain
  sentence above it: "Your details stay in this browser. To move them to another device, copy
  this backup there and restore it; the shareable link never contains them."

## Entering details (My list tab)

Below the list editor, a section **Holding details** that appears only when the saved holdings
list is non-empty: one row per holding ticker, in list order, with inputs
Shares · Avg cost · Bought (date input) · Sell target · Trailing stop %, each an `<input>` with
`inputmode="decimal"` (date: `type="date"`), labelled by column header and `aria-label`
"<field> for <ticker>". A **Save details** button (and Ctrl+Enter in any input) validates and
stores; a note under the table lists what was ignored ("Ignored for AAPL: cost (not a number)")
in the same `.msg warn` style as the list editor. Empty inputs mean "not set". After saving,
the Dashboard is re-rendered (no file loads needed). Below the table one sentence: "Targets
and stops are your own numbers; the page only measures how far each price is from them."

## Derived values (in `row()` or a helper `position(r)`)

For holding `r` on the selected day, with details `d` (may be missing fields):

- `value = shares * close` (needs shares), `costTotal = shares * cost`,
  `gainPct = (close / cost - 1) * 100` (needs cost), `gainAbs = (close - cost) * shares`.
- `weight = value / sum(value over holdings with shares) * 100`.
- `dayChg = (close - prevClose) * shares` where prevClose is the bar before `r.i` (null if none).
- `toTarget = (target / close - 1) * 100`: positive = still below the target, negative = above it.
- Trailing stop: `ref = highest close from the purchase date (if set and within the file) or
  from the start of the file, through the selected day`; `stopPrice = ref * (1 - trail / 100)`;
  `toStop = (close / stopPrice - 1) * 100`: positive = above the stop, negative = below it.
- Holding period: `heldDays` = calendar days from `date` to the selected day; `longTerm` =
  held more than 365 days (366 or more; US long-term treatment starts the day after one year).
  The page says "more than one year" and never states tax consequences.
- `vsSpy1m = chg1m(ticker) - chg1m(SPY)` in percentage points, where `chg1m` is the close vs
  the close 21 bars earlier (null if either is short). SPY's file is loaded whenever it is in the
  data set (`loadFiles(['SPY'])` alongside the lists; it is not shown as a watch ticker unless
  listed). If SPY is missing the column shows "–".
- `currency`: from the ticker file (`f.currency`); money is formatted `fmtMoney(v, cur)`:
  USD → `$1,234.56`, otherwise `1,234.56 CAD`; two decimals, thousands separators; percentages
  via `fmtPct`, signed where a sign carries meaning (`+4.2%`).

## Dashboard changes (all only when at least one holding has at least one detail)

1. **Portfolio stats row** under the existing stats (same `.stats` style): Portfolio value
   (sum over holdings with shares, with "n of m holdings have shares" as the small text), Day
   change (sum of dayChg, signed, with %), Gain / loss since cost (sum of gainAbs over holdings with
   shares and cost, and the percent vs sum of costTotal), Long-term positions (count of
   holdings whose date makes them long-term, shown only if any dates are set). Hidden entirely
   when no holding has shares.
2. **Holdings table** gets columns after "% below 1-yr high": `Value`, `Weight`, `Gain` (percent
   since cost, signed, `up`/`down` classes), `Target` (toTarget as "+4.2% below" / "2.1% above",
   with the target price in the title), `Stop` ("3.1% above" / "BELOW" in the `down` style,
   stop price in the title), `Held` ("1y 3m", with "long-term" badge when longTerm), `vs SPY
   (1M)` (signed percentage points). Each column appears only if any holding has the field it
   needs (Value/Weight: shares; Gain: shares+cost or cost alone shows the percent; Target;
   Stop: trail; Held: date). All sortable (`SORT.holdings` keys `value`, `weight`, `gain`,
   `target`, `stop`, `held`, `spy`). Missing values show "–" and sort last.
3. **PEAK and VALLEY cards**: a line under the name, when known: "Value $43,200 · 18.4% of
   portfolio · +61% since cost · 1.2% below your target" (only the parts that exist). Card
   order: stage first (as now), then by value descending when any holding has shares, then
   the old rule.
4. **New section "Your targets and stops"** between "Near highs" and "Holdings: VALLEY
   signals": chips for holdings that are at or above their target, within 3% below it, at or
   below their trailing stop, or within 3% above it. Wording: "AAPL closed 1.2% below your
   target of $350.00", "AAPL closed above your target of $350.00 (by 2.3%)", "VTR closed 0.8%
   above its 10% trailing stop ($81.20)", "VTR closed below its 10% trailing stop ($81.20)".
   Hidden when nobody set a target or stop; "None close on this day." when none qualify.
   A peak-signal badge is added to the chip when the ticker also fired a PEAK that day.

## Info tab additions

In "The other numbers": **Holding details** (what you can enter, where it is kept, that the
link never carries it), **Value / Weight / Gain since cost**, **Sell target** (your number; the
page shows the distance), **Trailing stop** (defined from the highest close since purchase or
over the past year; the page shows the distance; it does not place orders), **Held /
long-term** (more than one year; tax rules depend on the viewer's situation and the page does
not give tax advice), **vs SPY (1M)**. One sentence in "Things to keep in mind": distance to a
target is arithmetic on your own number, not a forecast.

## README / SPEC

README: a short "Holding details" paragraph (what it does, browser-only, the backup box) and
a bullet in "Reading the page"; the privacy paragraph gains one sentence. SPEC.md: the page
section lists the My list "Holding details" block and the Dashboard additions with a pointer
to this file; "State" lists `macd-holdings`.

## Verification expected

- `node --check`. Served locally with the real ticker files (SPY present). Enter details for
  three holdings (one with everything, one with shares only, one with a target only) and verify
  every derived number against an independent Python computation over the same ticker files
  (value, weight, gain, day change, toTarget, stop price and toStop with and without a purchase
  date, held period and the long-term boundary at exactly 365 vs 366 days, vs SPY). Verify
  validation (negative shares, text in cost, a future date, trail 0 and 101) is reported and
  ignored; the hash does not change when details are saved; Copy link does not include them;
  reload keeps them; the Backup copy/restore round trip; removing a ticker from holdings hides
  its columns but a re-add brings the details back; Ctrl+Enter saves; keyboard reachability;
  375 px layout (table scrolls, inputs usable); dark mode; no console errors; every string
  inserted through `esc()`; nothing on the page reads as a recommendation.
