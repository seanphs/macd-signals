# P/E and PEG

Addendum to SPEC.md (2026-11-18). Shows each stock's trailing P/E and PEG ratio next to the
indicator numbers, so a viewer can see at a glance whether a high P/E comes with high expected
growth. These are **valuation numbers from Yahoo Finance, not signals**: the page shows them, sorts
and filters by them, and never colours or ranks them as good or bad. They are the latest values
only, one per stock, not a history, so the day picker does not change them.

## Where the numbers come from

Yahoo's fundamentals-timeseries service, which needs no login cookie (the quoteSummary and
v7 quote services now answer "Invalid Crumb" / "Unauthorized" without one):

```
https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/<SYM>
    ?symbol=<SYM>&type=EQMJM_TTM,EQLXT_TTM&period1=<now - 31 days>&period2=<now + 1 day>
```

`EQMJM_TTM` is the **Trailing P/E** and `EQLXT_TTM` the **PEG Ratio (current)** of the "Valuation
Measures" table on Yahoo's Statistics page for the stock (`finance.yahoo.com/quote/<SYM>/key-statistics/`);
the page itself asks for these coded series names. On 2026-11-18 the two matched that page for
every stock checked (AAPL, NVDA, AVGO, TSLA, KO, ARM, JPM, BRK-B, ...). Each series holds a few
dated points; the newest one dated within the last 31 days is used. They are usually one to three
trading days behind the last bar (Yahoo refreshes them on its own schedule).

The same service also has `trailingPegRatio` (also what quoteSummary calls `pegRatio`). It is a
different PEG that often disagrees with the Statistics page, sometimes by a factor of ten
(TSLA 4.4 against 37.5, ARM 1.5 against 21.3, in Nov 2026), because it divides by a different growth
figure. It is deliberately not used: the page should show the number a viewer finds on Yahoo.

## fetch_data.py

- After a ticker's chart is fetched and its record built, and only when the chart's
  `meta.instrumentType` is `EQUITY` (funds, indexes, futures and crypto have no earnings),
  `fetch_valuation(sym)` asks for the two series: one try, `VAL_TIMEOUT` (10 s), after a pause of
  `--sleep` seconds so Yahoo sees no burst. `parse_valuation` takes the newest valid point of each
  series (a finite number with an ISO date on or after the cutoff) and rounds it to 2 decimals.
- The record gets `"val"`:
  `{"pe": 39.67, "peg": 4.02, "date": "2026-11-13"}` (`date` = the newer of the two points'
  dates); a field is null when Yahoo has no such point (a company with losses has no P/E, one
  without a growth estimate has no PEG). `"val": null` for a ticker that is not a stock.
- When the request fails (network error, HTTP error, non-JSON answer) the record keeps the
  previous night's `val` from the file on disk (`previous_valuation`), if it has a usable value
  dated within the last 31 days; otherwise `val` is null. The price data is never affected.
- After `VAL_TROUBLE_LIMIT` (10) failures in a row, no more P/E or PEG requests are made that
  night: every remaining stock keeps its previous values. The same happens for a ticker fetched
  while the chart fetching is in its "hurry" mode (Yahoo looks down), and for every ticker with
  `--no-valuation`.
- One log line after the loop counts the outcomes, e.g.
  `P/E and PEG: fetched 512, none at Yahoo 38, not a stock 252`. When at least 20 stocks were
  asked and not one got a value, a warning line says so. An HTTP 404 with "No timeseries type(s)
  specified" for every stock means Yahoo renamed the series: look up the new names on the
  Statistics page (the page's own timeseries request lists them in its `type=` parameter, next to
  the `_TTM` value that matches the table) and change `VAL_TYPES` / `VAL_URL`.
- A stale ticker (chart fetch failed) keeps its whole previous file, `val` included.
- `screener.json` entries get `"pe"`, `"peg"` and `"val_date"` from the file's `val` (null when
  absent, including files written before 2026-11-18).
- The night's run gets a little longer: one more request for each of the roughly 650 stocks, plus
  the pause before it, about four to six minutes.

## The page

Every value is read with `valFrom`: a number when the file has a finite one, else null. A P/E or
PEG of zero or less is shown as `n/m` (not meaningful), never matches the PEG filter and sorts
with the missing values. P/E shows one decimal (no decimals from 100 up), PEG two. Every cell's
hover text gives the exact value and its date, or why there is none.

- **Dashboard**: the All holdings and Watchlist tables get sortable **P/E** and **PEG** columns
  after "% below 1-yr high" (before the Peak record and holding-details columns), only when at
  least one row of that table has a value. A missing value sorts last in either direction; the
  first click sorts ascending. If the columns disappear while the table is sorted by one of them,
  the table goes back to its default order.
- **Screener**: the same two columns after "3M change", always present, and a **PEG** filter
  (`any` (default) | `under 1` | `under 1.5` | `under 2`), stored as `peg` in `macd-screen`. A
  limit lets through only tickers with a PEG above 0 and under the limit. The Combination
  select ignores it (like Group).
- **Charts**: the line above the chart ends with `P/E 39.7, PEG 4.02 (Yahoo, as of 2026-11-13)`
  when Yahoo has either value.
- **Info**: entries **P/E (price / earnings)** and **PEG** in "The other numbers" (what they are,
  the rule of thumb that under 1 reads as cheap for the growth and over 2 as expensive, why the
  growth forecast and other sites' numbers make it unreliable, `n/m`, latest value only, not a
  signal), an entry **P/E and PEG: tested** with the test below and its signal table, a sentence
  in "Things to keep in mind", and a sentence in "About this site". The PEG filter's hover text
  ends with the test's result.
- Footer: "Prices, P/E and PEG from Yahoo Finance, updated nightly."

## The test (2026-11-18): do P/E or PEG tell when to buy or sell?

Asked by the owner after the columns were added. Short answer: no, not in the data available.

**Data.** Yahoo keeps only five quarter-end values of the Statistics-page series (`EQMJM_3M` for
P/E, `EQLXT_3M` for PEG; mostly 2025-09-30 to 2026-09-30), so the test covers about one year.
Universe: the 503 `S&P 500` tickers of universe.txt (498 with two years of daily prices, 428 with
PEG history), plus SPY; Yahoo's adjusted closes. Point in time: a quarter-end value is used only
from 50 calendar days after its date, when the quarter's earnings would have been reported.
Survivorship bias: today's members only.

**Valuation alone.** On the first trading day of each month (Dec 2025 to Oct 2026), the stocks
with a positive value were split into fifths by PEG, and separately by P/E; each stock's return
over the next 21 or 63 trading days was compared with the average of all stocks that day.

| | Lowest fifth ahead of highest | Mean gap (points) | Gap month by month |
|---|---|---|---|
| PEG, next 21 days | 5 of 11 months | -0.23 | +1.0 -0.8 +1.6 +1.8 -2.6 -2.1 -0.8 +2.4 +1.9 -3.2 -1.6 |
| PEG, next 63 days | 5 of 9 | -0.43 | +1.1 +1.6 +3.1 -3.3 -6.5 -1.2 +1.9 +1.1 -1.7 |
| P/E, next 21 days | 7 of 11 | +1.24 | +2.2 +4.4 -1.1 +3.0 -6.5 -4.7 +1.3 +7.4 +2.5 -8.1 +13.2 |
| P/E, next 63 days | 6 of 9 | +1.32 | +4.2 +6.1 -2.2 -8.8 -8.0 +3.0 +8.9 +3.7 +5.0 |

The P/E gap (t about 0.7 over the 11 months) is well within luck. The rule-of-thumb PEG groups
over 63 days, against the average stock: under 1 -0.34, 1 to 2 -1.01, over 2 -1.53 (medians
-2.02, -2.38, -3.25), in the expected order but not consistent month by month (above).

**With MACD signals.** Every confirmed (stage 3) signal from 2025-05 to 2026-10 whose stock had a
known value that day (8,284 signals), with the same measure as `docs/COMBOS.md`: the stock's
return over the next 20 trading days minus SPY's, minus the mean of that measure over every
stock-day of the same month. 95% ranges by resampling calendar weeks (signals on the same days
move together). Hoped-for direction: above zero for valleys, below zero for peaks.

| Combination | Signals | Average | 95% range | Before May 2026 | From May 2026 |
|---|---|---|---|---|---|
| Confirmed valley alone | 4,209 | -0.24 | -0.86 to +0.45 | -0.02 | -0.44 |
| Valley + PEG under 1 | 1,117 | -0.37 | -1.17 to +0.43 | +0.04 | -0.78 |
| Valley + PEG 1 to 2 | 934 | +0.06 | -0.89 to +0.94 | +0.33 | -0.15 |
| Valley + PEG over 2 | 2,051 | -0.58 | -1.32 to +0.26 | -1.04 | -0.14 |
| Valley + P/E in the cheapest fifth | 795 | +0.06 | -1.15 to +1.34 | +0.10 | +0.03 |
| Valley + P/E in the priciest fifth | 826 | -0.64 | -1.98 to +0.74 | +1.23 | -2.33 |
| Confirmed peak alone | 4,075 | -0.39 | -1.17 to +0.38 | -0.21 | -0.57 |
| Peak + PEG over 2 | 1,996 | -0.67 | -1.49 to +0.11 | -0.96 | -0.38 |
| Peak + PEG 1 to 2 | 888 | -0.31 | -1.15 to +0.57 | -0.17 | -0.42 |
| Peak + PEG under 1 | 1,083 | -0.34 | -1.21 to +0.50 | -0.01 | -0.67 |
| Peak + P/E in the priciest fifth | 814 | -0.66 | -2.54 to +1.07 | +1.06 | -2.17 |
| Peak + P/E in the cheapest fifth | 769 | -0.30 | -1.33 to +0.67 | -0.40 | -0.21 |

Every range includes zero. "Peak + PEG over 2" came closest and kept its sign in both halves,
but it is barely different from the confirmed peak alone, and among a dozen combinations one that
close is what chance gives. The Info tab shows eight of these rows. A longer test needs P/E and
PEG history Yahoo does not keep; until then the page says what this one found.

## Verification done (2026-11-18)

- A 12-ticker run (stocks, an ETF, an index, a T-bill fund, loss-makers): values equal Yahoo's
  Statistics page; ETFs, the index and the fund get `val: null`; RKLB gets nulls.
- Failure paths (a test script run against copies of a real output folder): Yahoo unreachable
  keeps the previous values and fresh prices; the trouble limit stops the requests; no previous
  file gives null; `--no-valuation` keeps values; renamed series (HTTP 404) gives nulls and the
  warning; kept values older than 31 days are dropped.
- The page, served locally with 80 freshly fetched tickers: columns, hover text, sorting both
  ways (missing last), Screener PEG filter counts equal to an independent count over
  screener.json for every limit, the filter remembered after a reload, the Charts line, no
  console errors, no horizontal page scroll at 375 px.
