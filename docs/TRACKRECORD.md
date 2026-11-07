# Track record: what the price did after past signals

Addendum to SPEC.md (2026-11-07). For one ticker at a time, the page shows how the close moved
in the 5, 10 and 20 trading days after each signal in the year of history it already has, next
to what the close did on an ordinary day over the same period. The point is to let a viewer see
whether MACD signals on *this* ticker have meant anything, with the base rate beside them so a
"hit rate" of 55% against a base rate of 52% reads as the noise it is. Browser-side only: no
change to fetch_data.py, universe.txt or the workflow. Nothing may read as a prediction or
advice; the wording is "what happened after past signals", never "what will happen".

## Definitions (computed in the browser from the ticker file, up to the selected day)

Let `i` be the ticker's bar on or before the selected day (`row().i`), `close[]` and `dates[]`
the file arrays, `first` the first index with a MACD value. Horizons `H = [5, 10, 20]` bars.

- A **signal** is one event `{dir, stage}` on day index `k <= i`. Each event counts once per
  (dir, stage) group; a day with two stages of the same direction contributes to both groups.
- For a signal at `k` and horizon `h`, the **outcome** exists only if `k + h <= i`:
  `chg = (close[k + h] / close[k] - 1) * 100`. A PEAK signal is a **hit** when `chg < 0`; a
  VALLEY signal when `chg > 0`. (`chg == 0` is a miss.)
- **Hit rate** per group and horizon: hits / outcomes, shown as "4 of 6" with the percent in the
  title. **Median move** per group and horizon: the median of `chg`, signed, one decimal.
- **Base rate** per horizon: over every day `k` with `first <= k` and `k + h <= i`, the share of
  days where `close[k + h] < close[k]` (the "lower" base rate, to compare with peaks) and the
  share where `close[k + h] > close[k]` (the "higher" base rate, for valleys); plus the median
  `chg` over those days.
- Groups in this order: PEAK early warning, PEAK MACD turned, PEAK confirmed, VALLEY early
  warning, VALLEY MACD turned, VALLEY confirmed.
- Sample-size rule: a group/horizon with fewer than 5 outcomes shows its numbers in the muted
  `.sub` style with the title "Too few signals to judge"; the section note says "Fewer than
  about 10 signals is too few to judge; a year of daily data rarely has more." A group that has
  signals but no outcome yet at a horizon (every signal is younger than `h` bars) shows "–" with
  the title "No outcome yet: every signal is less than h trading days old" (the holdings column
  too), unlike a group with zero signals, whose "–" has no title.

## Where it appears

### Charts tab

A new section under the chart box: heading **Track record for <TICKER>** with the note "what
the close did 5, 10 and 20 trading days after each signal in the past year, up to the selected
day, next to what it did on an ordinary day. A description of the past, not a prediction."

1. A table, one row per group plus two base-rate rows at the bottom ("Any day, lower" and
   "Any day, higher"), columns: Signal · Count (signals up to the selected day) · for each
   horizon: **Hit rate** ("4 of 6") and **Median move** ("-2.3%", `up`/`down` classes as the
   Screener uses). Groups with zero signals show "–" in every cell. The hit-rate cell's title
   reads "4 hits of 6 outcomes (67%); base rate 52%".
2. Under the table, a **Show each signal** toggle (a `<details>` element) that lists every
   signal in the groups, newest first: date, stage badge (reuse `badge()`), close that day, and
   the +5 / +10 / +20 moves (signed percent, `–` where the outcome is not yet available because
   the horizon runs past the selected day). Clicking a date in that list sets the day picker to
   that date (`setDay`) so the chart shows it.
3. The section re-renders whenever the chart does (ticker, day). The range selector does not
   affect it. It is hidden when no ticker is loaded.

### Dashboard: holdings table

One optional column after `% below 1-yr high` (before the holding-details columns, if those
are shown): **Peak record (10d)** = the confirmed-PEAK group's 10-day hit rate for the
holding, as "4 of 6" with the same title text and muted style under 5 outcomes, "–" with no
confirmed peaks. Sortable (`SORT.holdings` key `record`: by hit rate, then by count; missing
last). Cells under 5 outcomes (the muted ones) sort after the full-sample cells whichever way
the column is sorted, and cells with no outcome yet sort last with the missing ones. Added to
the glossary.

### Screener

Unchanged (the screener file does not carry history).

## Info tab additions

In "The other numbers": **Track record** (what it measures, horizons, hit vs base rate, small
samples, past only), **Hit rate** (definition for peaks and valleys; `chg == 0` is a miss),
**Base rate** (why it is shown), **Median move**, **Peak record (10d)** (the holdings column).
One sentence in "Things to keep in mind": a hit rate close to the base rate means the signal
added nothing on that ticker over the past year.

## README / SPEC

README: a short "Track record" paragraph after "Holding details" and a bullet in "Reading the
page" (Charts tab section + the holdings column; past only). SPEC.md: the Charts tab section
lists the Track record block with a pointer to this file; the Dashboard holdings table lists the
`Peak record (10d)` column.

## Verification expected

- `node --check`. Served locally with the real ticker files. For at least three tickers and two
  selected days, every count, hit rate, median move and base rate recomputed independently in
  Python from the ticker JSON (written from the definitions above, not from app.js) and compared
  with the page, including: a signal whose horizon runs past the selected day (excluded from
  that horizon, shown as "–" in the list), a day with two stages of one direction (counted in
  both groups), the `chg == 0` case (a miss) if constructible, groups with zero signals, the
  under-5 muted style, the base-rate windows (`first <= k`, `k + h <= i`), and the holdings
  column against the same computation. The date click in the list moves the day picker and the
  chart. 375 px (table scrolls), dark mode, keyboard access (the `<details>` summary and date
  buttons), no console errors, `esc()` on every inserted string, nothing that reads as a
  prediction; Screener, holding details and the list editor unchanged.
