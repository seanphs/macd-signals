# MACD Signals

A small website that shows what two common stock-chart indicators, **MACD** and **RSI**, are
doing for the tickers you choose. Every weeknight a free GitHub job downloads a year of daily
prices for about 800 tickers from Yahoo Finance, works out the numbers and the signals, and
publishes them to the site. Each visitor keeps their own list of tickers in their own browser.
There is nothing to install, no login and no cost.

**Screener.** Besides your own list, the **Screener** tab shows every ticker in the data set
that fired a signal on the last completed trading day, so you can see where the indicator turned
on stocks you do not follow yet. It covers the latest day only (the day picker does not apply
there). Filters narrow the list: **Show** (valleys, peaks, recovering, or all signals), **Stage at
least**, **RSI**, **Below 1-yr high at least**, **Group** (S&P 500, Nasdaq-100, ETFs and so on),
and a **Hide choppy** box that is on by default. The filters are remembered in your browser. An
**Add to watch** button puts a ticker on your watch list without leaving the tab. Like the rest
of the page, the Screener describes what the indicator did; it is not a list of things to buy
or sell.

**Holding details.** On the **My list** tab, under the list editor, a **Holding details** table
lets you record, for each holding, how many shares you own, your average cost per share, the
date you bought, a sell target and a trailing stop percentage. Every field is optional.
**Save details** stores them, and the Dashboard then shows a portfolio row (value, day change,
gain since cost, long-term positions), extra columns in the holdings table (**Value**,
**Weight**, **Gain**, **Target**, **Stop**, **Held** and **vs SPY (1M)**) and a section called
**Your targets and stops** that lists the holdings whose closing price is close to, or past, the
numbers you entered. The targets and stops are your own numbers; the page only measures how far each price
is from them, and it never suggests one. The details stay in your browser only: they are never
put in the page address, so the **Copy link** button never carries them. The **Backup** box under
the table is for moving them to another device: **Copy backup** copies them as a block of text,
and **Restore from backup** reads that text back in on the other device.

**This site is not financial advice.** It describes what an indicator is doing. It does not tell
anyone what to buy or sell.

## Do I need a GitHub account?

Yes, one. GitHub is the free service that stores the files, runs the nightly job and hosts the
website. The owner of the site needs one free GitHub account. People who only look at the site do
not need anything. [SETUP.md](SETUP.md) walks through creating the account and everything after it.

## How it works

1. `universe.txt` lists the tickers the job downloads: the big US indexes, the S&P 500, the
   Nasdaq-100, the Dow 30, popular ETFs and popular stocks, about 800 in all. Lines starting
   with `## ` (two hashes) name the groups the Screener's **Group** filter offers: `## Indexes`,
   `## S&P 500`, `## Nasdaq-100`, `## ETFs`, `## Other stocks` and `## Added by the owner`.
2. Every Monday to Friday night (US time) GitHub runs the job described in
   `.github/workflows/update.yml`. The job runs `fetch_data.py`, which downloads a year of daily
   closing prices for each ticker from Yahoo Finance, computes MACD, RSI and the signals, and
   writes a one-line-per-ticker summary of the latest day for the Screener (`screener.json`).
3. The job publishes the `site` folder together with the computed data using **GitHub Pages**,
   GitHub's free website hosting. The site address looks like
   `https://<your-username>.github.io/macd-signals/`.
4. The page does the rest in your browser. You type in your tickers; it shows the dashboard, the
   charts and the signals for them.

Details worth knowing:

- **Timing.** The job starts at 05:37 UTC, Tuesday to Saturday. That is 1:37 am New York time
  (12:37 am in winter) Monday to Friday night, hours after the day's closing price is final and
  well before the morning. The odd minute is deliberate: GitHub starts jobs scheduled on the top
  of the hour hours late, because so many repositories ask for that moment. GitHub can still
  start it a little late when it is busy. The footer of the page
  shows the date its numbers are as of. (Yahoo leaves the day's closing price blank for an hour
  or two right after the close; if the job ever runs in that window it uses Yahoo's closing quote
  instead, so the page is still up to date.)
- **If Yahoo does not answer for a ticker,** the job keeps the previous night's file for that
  ticker and marks it "stale". The page then shows a small "data from <date>" badge next to that
  ticker. If fewer than half of the tickers have any usable file at all (fresh or kept from the
  night before), the job stops with an error instead of publishing a half-empty site.
- **Keeping the schedule alive.** GitHub switches off scheduled jobs in public repositories that
  have had no activity for 60 days. To prevent that, each successful run writes the date into
  `.github/last-run.txt` and saves that change. That counts as activity.
- **Cost.** Free. GitHub Pages and the job's running time are free for public repositories.
- **Privacy.** See [Privacy](#privacy) below.

## The files

| File | What it is |
|---|---|
| `universe.txt` | The tickers the job downloads, in groups headed by `## ` lines. Edit this to add tickers (under `## Added by the owner`). |
| `fetch_data.py` | The program that downloads prices and computes the numbers. |
| `site/` | The web page itself: `index.html`, `app.js`, `style.css`. |
| `site/data/` | The computed data: `index.json`, `screener.json` (the Screener's latest-day summary) and one file per ticker. The job creates it; it is not kept in the repository. |
| `.github/workflows/update.yml` | The nightly job. |
| `.github/last-run.txt` | The date of the last successful run. |
| `README.md` | This file. |
| `SETUP.md` | Step-by-step setup for the owner. |
| `docs/SPEC.md` | The technical description the files were built to. |
| `docs/SCREENER.md` | The same for the Screener tab and `screener.json`. |
| `docs/HOLDINGS.md` | The same for the Holding details table and the portfolio columns it adds to the Dashboard. |

A "repository" is GitHub's word for one project's folder. A "commit" is a saved change with a
short note attached. A "workflow" is a job GitHub runs for you.

## Adding tickers

The page can only show tickers that are in `universe.txt`. If you put a ticker in your list and the
page says "Not in the data set: ZZZZ. Ask the site owner to add it to universe.txt.", add it like
this:

1. On GitHub, open your repository and click `universe.txt`.
2. Click the pencil icon (**Edit file**) at the top right of the file.
3. Scroll to the bottom, to the heading `## Added by the owner`, and type the ticker on its own
   line below the note there. Use Yahoo's spelling: `BRK-B`, not `BRK.B`. (The `## ` lines are
   group headings; a ticker belongs to the nearest `## ` heading above it, so one added at the
   bottom shows up in the Screener's "Added by the owner" group.)
4. Click **Commit changes...**, then click **Commit changes** in the box that opens.
5. The new ticker is downloaded by the next nightly run. If you do not want to wait, run the job
   by hand (next section).

If Yahoo does not know a symbol, the "failed" count in the run's summary goes up by one and the
page keeps saying it is not in the data set. The summary shows only the count, not the name. To
see which ticker failed and why, click the run, click **Fetch prices and compute signals** in the
left column, expand the step of the same name and look for a line like
`ZZZZ: HTTP Error 404: Not Found`. (The same names are in
`https://<your-username>.github.io/macd-signals/data/index.json` under "failed".) Check the
spelling on finance.yahoo.com.

A ticker that was listed less than about two months ago fails too, with a line like
`ZZZZ: only 21 daily bars (need 40)`. The numbers need 40 trading days of history. Leave it in
`universe.txt`; it starts working on its own once the history is long enough.

## Running the update by hand

1. Open the repository on GitHub and click the **Actions** tab.
2. In the left column, click **Update prices and publish**.
3. Click the **Run workflow** button on the right, above the list of runs, then click the green
   **Run workflow** button in the small box that opens.
4. A new run appears in the list within a few seconds. A yellow circle means it is running, a
   green check mark means it finished, a red X means it failed. A run takes about 5 to 15
   minutes.
5. Click the run to see a box titled "Nightly price update" with one line like
   `fetched 790  stale 3  failed 2  last_bar 2026-10-29  elapsed 312s`.
   "fetched" is the number of tickers downloaded fresh, "stale" the number kept from the night
   before, "failed" the number with no data, and "last_bar" the trading day the numbers are as of.

## Sharing the site

Anyone can open the site address. Nobody needs a GitHub account to view it.

- The plain address (`https://<your-username>.github.io/macd-signals/`) opens with an empty
  list, and the visitor types in their own tickers.
- The **Copy link** button on the page copies an address that includes your current list, so the
  person you send it to sees the same tickers. Without that link, your list is private to your
  browser.

## Reading the page

- **Dashboard** shows, for the day you pick, the holdings with PEAK signals (the indicator turning
  down from a high), the holdings with VALLEY signals (the indicator turning up from a low),
  holdings near their one-year high, a table of all holdings, your watchlist and a timeline of
  recent signals. Each signal has a stage: 1 is an early warning, 2 means the indicator has
  turned, 3 is a confirmed crossover.
- **Screener** shows every ticker in the data set that fired on the last completed trading day,
  with filters for direction, stage, RSI, distance below the one-year high and group, and an
  **Add to watch** button. The day picker does not apply there. Clicking a ticker opens its
  chart even if it is not on your list.
- **Charts** shows one ticker at a time: price, MACD and RSI over the range you choose, from 5
  days to 1 year. Move the mouse over the chart to read the numbers for any day.
- **Info** explains every term on the page in plain language. Start there if MACD and RSI are new
  to you.
- **Holding details** (on the **My list** tab) adds your own numbers to the Dashboard. With
  shares and cost entered, the holdings table gains **Value** (shares times the day's close),
  **Weight** (that value as a share of all your holdings with shares) and **Gain** (the close
  compared with what you paid). **Target** and **Stop** show how far the close is from the sell
  target and the trailing stop you entered; a trailing stop is measured from the highest close
  since your purchase date (or over the past year if no date is set). **Held** shows how long you
  have held the position and marks it "long-term" after more than one year; what that means for
  taxes depends on your situation, and the page does not give tax advice. **vs SPY (1M)** is the
  one-month change minus SPY's one-month change, in percentage points. A column is only shown
  when at least one holding has the number it needs.

A signal is an observation about a chart pattern. It is not a prediction and not a
recommendation.

## Troubleshooting

Open the **Actions** tab first. The latest run is at the top. A green check mark means the run
worked. A red X means it failed: click the run, then read the box titled "Nightly price update"
on its Summary page and the red error line under it.

| What you see | What it usually means | What to do |
|---|---|---|
| The latest run has a red X. | Something in the job failed. | Click the run and read the summary line and the red error text, then find the matching row below. |
| Error text "Get Pages site failed. Please verify that the repository has Pages enabled and configured to build using GitHub Actions". | GitHub Pages is not switched on, or its Source is not set to GitHub Actions. | Do step 4 of SETUP.md (**Settings** → **Pages** → **Source** → **GitHub Actions**), then run the job by hand. |
| Summary shows a large "stale" count (or, on the very first run, a large "failed" count), and the log says "10 fetches in a row failed; Yahoo looks down or blocking", "Out of time after 40 minutes", or mentions "429", "Too Many Requests" or "403". | Yahoo Finance was limiting or blocking downloads from GitHub's computers that night. | Nothing tonight; the page keeps last night's files. Run the job by hand a few hours later, or wait for the next night. If it happens every night for a week, ask the assistant to look at `fetch_data.py`. |
| Summary says "fetch_data.py was stopped after 150 minutes without finishing". | Yahoo was down or blocking GitHub's computers for the whole night. | Nothing tonight; the page keeps last night's files. Run the job by hand a few hours later, or wait for the next night. |
| Error text "Failed to create deployment (status: 404)" in the Publish step. | Pages is switched on, but its Source is still "Deploy from a branch". | Same fix as the "Get Pages site failed" row: **Settings** → **Pages** → **Source** → **GitHub Actions**, then run the job by hand. |
| Summary says "fetch_data.py printed no summary line", or the log shows a "Traceback". | The program crashed. | Copy the red text and ask the assistant to fix it. |
| The Actions tab says the scheduled workflow was disabled, or there has been no run for several days. | GitHub switches off schedules after 60 days without activity in the repository. The job prevents this by saving the date every night, but if it was failing or GitHub was changed, this can still happen. | Click **Update prices and publish** in the left column, click **Enable workflow**, then run the job by hand. |
| The page says "The data has not been published yet, or the nightly job has not run. See SETUP.md." | No run has finished successfully yet, or Pages is not set up. | Do steps 4 to 6 of SETUP.md. |
| The Screener tab says "The screener data has not been published yet; it appears after the next nightly run." | The nightly job that ran last did not write `screener.json` (the log then has a line "screener.json was not written"), or the site was published before the Screener existed. | Run the job by hand once. If the log says "screener.json was not written" again, copy that line and ask the assistant. The rest of the page is unaffected. |
| The page shows a banner "Data last updated <date>. The nightly job may have stopped". | The last successful run is more than three days old. | Check the Actions tab for red runs and follow the rows above. |
| The page shows an older date than you expect in the footer. | Your browser is showing a saved copy of the page, or the job has not run yet. | Hold Ctrl and press F5 (a "hard refresh", which makes the browser re-download the page). Then check the Actions tab. Publishing can take up to 10 minutes after a run finishes. |
| The site address shows "404" or "There isn't a GitHub Pages site here". | Pages is not switched on, no run has finished yet, or the address is mistyped. | Check the address: `https://<your-username>.github.io/macd-signals/`. Under **Settings** → **Pages** the page should say "Your site is live at". |
| A ticker shows "Not in the data set". | The ticker is not in `universe.txt`, Yahoo does not know the spelling, or the ticker is too new to have 40 trading days of history. | See "Adding tickers" above, including how to find the ticker's line in the run's log. |
| A green run shows a yellow warning "Date not recorded". | The date-saving step could not save because something else changed the repository at the same moment. | Nothing. The site was published; the next run saves the date. |
| A run sits at "Queued" or "Waiting" for a long time. | GitHub is busy, or another run of this job is still going. | Wait. Only one run publishes at a time. |
| The **Run workflow** button is missing. | The file `.github/workflows/update.yml` is not on the `main` branch of the repository. | Check that the file exists on GitHub at that exact path. See step 3 of SETUP.md. |

## Running it on your own PC

You do not need this; the job does everything on GitHub. For the curious (or for the assistant),
this is the same program run at home:

```
cd D:\MACD_Web
python -I fetch_data.py --only AAPL,MSFT,SPY
cd site
python -m http.server 8000
```

Then open http://localhost:8000/ in a browser. The page cannot be opened directly as a file;
it needs that small local web server.

To send a change made on the PC up to GitHub, run `git pull --rebase origin main` before
`git push`: the nightly job adds a small commit (the date in `.github/last-run.txt`) every
night, so a push without a pull first is refused with "fetch first". Edits made on the GitHub
website itself (for example to `universe.txt`) need nothing of the sort.

## Privacy

- Your lists stay in your browser (and in the page address, if you use **Copy link**). The page
  sends nothing anywhere; it only reads data files from the site itself.
- A link made with **Copy link** contains the tickers in the list. Share it only with people you
  want to see them. Holding details (shares, cost, dates, targets and stops) are never part of
  the link; they stay in your browser only, and the **Backup** box is the one way they leave it,
  as text you copy yourself.
- The repository is public, as GitHub Pages requires on the free plan. It contains the code, the
  ticker list and the nightly prices. It contains no names, account numbers, amounts or anything
  else personal.
- GitHub records visitors' IP addresses in its security logs, as it does for every site it hosts.

## Not financial advice

Everything on this site and in this repository describes what a mathematical indicator is doing
with past prices. It is not investment advice, it is not a recommendation to buy or sell anything,
and past patterns say nothing certain about the future. Any decision is yours alone. If you want
advice, talk to a licensed financial advisor.
