"""Nightly price fetch for the MACD Signals web page.

Reads universe.txt (one ticker per line), pulls about a year of daily closes for every
ticker from Yahoo Finance, computes MACD (12/26/9), RSI (14) and the three-stage
peak/valley signals for every day of that history, and writes one JSON file per ticker
plus index.json into site/data/. The web page reads those files; nothing else is needed.

The math is copied unchanged from macd_scan.py, the daily scanner this page grew out of:
same EMA seeding (simple average of the first n values), same MACD and RSI definitions,
same signal rules. The scanner looks at the latest day only; this script records every day.

Three signal stages, earliest to latest. Each fires only on the day it first appears:
  1 early     - histogram shrank 2 days in a row after its own high/low (momentum fading)
  2 turn      - the MACD line itself changed direction (above zero for a peak, below for a valley)
  3 confirmed - MACD crossed the signal line (histogram changed sign / bar color)
These describe what the indicator did. They are not advice to buy or sell anything.

If Yahoo cannot be reached for a ticker and last night's file is still in the output folder,
that file is kept as it is and the ticker is marked "stale" in index.json together with the
error. A ticker with no file at all is listed under "failed". A file is never written half-way.

A night when Yahoo is down or blocking us must still end with a readable summary and last
night's files republished, so the run keeps itself short: after TROUBLE_LIMIT fetch failures
in a row each remaining ticker gets a single quick try, and once TIME_BUDGET has passed no
more fetching is attempted at all; the remaining tickers keep their file (stale) or are
listed as failed with the reason "the run was out of time".

Exit code 0 normally. Exit code 1 when universe.txt is missing or empty, or when fewer than
half of the universe ended up with a usable file (fresh or kept), so a broken night fails
visibly instead of publishing an empty site. The --only and --limit switches are for testing
a few tickers by hand; a run with --only always exits 0 and simply reports its counts.

Standard library only (Python 3.9+). The only network traffic is to Yahoo Finance.

Usage:  python -I fetch_data.py [--universe universe.txt] [--out site/data] [--only T1,T2,...]
                                [--limit N] [--sleep 0.25] [--range 1y]
"""
import argparse
import collections
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={range}&interval=1d"
FAST, SLOW, SIG = 12, 26, 9
RSI_N = 14
# |MACD| under this % of price means MACD is hugging zero; signals there are mostly chop.
# The page uses this value (from index.json) to mark such days as choppy.
WEAK_PCT = 0.25
# What a ticker may look like after normalisation. The '^' prefix is for indexes (^GSPC),
# '=' appears in futures symbols (GC=F), '-' in class shares (BRK-B).
SYMBOL_RE = re.compile(r"^[A-Z0-9^=.-]{1,12}$")
ATTEMPTS = 3
BACKOFF = (2, 4, 8)         # seconds to wait after the 1st, 2nd, 3rd failed attempt
RATE_LIMIT_WAIT = 15        # seconds to wait after an HTTP 429 ("too many requests")
TIMEOUT = 20                # seconds to wait for one answer from Yahoo
# When Yahoo is down or blocking us, the usual retries would make 800 tickers take hours and
# the nightly job would be cancelled before it could write index.json. So: after this many
# fetch failures in a row, every remaining ticker gets one try with a short timeout ...
TROUBLE_LIMIT = 10
HURRY_TIMEOUT = 10
# ... and after this many seconds nothing is fetched any more; the leftovers keep last
# night's file (marked stale) or are listed as failed. Well under the workflow's 150-minute
# `timeout` wrapper and its 180-minute job limit.
TIME_BUDGET = 40 * 60
MIN_BARS = SLOW + SIG + 5   # same minimum history as macd_scan.py (40 completed days)
PROGRESS_EVERY = 50


class YahooBlocked(ValueError):
    """Yahoo answered with something that is not JSON (a block or consent page, usually)."""


# ---------------------------------------------------------------- the ticker list

def normalise(raw):
    """Upper-case a ticker and write class shares the way Yahoo does (BRK.B -> BRK-B)."""
    return raw.strip().upper().replace(".", "-")


def read_universe(path):
    """Return the tickers of universe.txt in file order, duplicates dropped.

    '#' starts a comment; blank lines and [section] headers are skipped. Tickers are
    normalised here but not validated: main() reports odd ones under "failed".
    """
    tickers = []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or (line.startswith("[") and line.endswith("]")):
            continue
        sym = normalise(line)
        if sym not in tickers:
            tickers.append(sym)
    return tickers


# ---------------------------------------------------------------- fetching from Yahoo

def fetch_chart(sym, range_="1y", attempts=ATTEMPTS, timeout=TIMEOUT):
    """Download Yahoo's daily chart for one ticker and return its "result" object.

    Up to `attempts` tries with growing waits in between. After an HTTP 429 (Yahoo asking us
    to slow down) the wait is longer. An HTTP 404 means Yahoo does not know the ticker, so
    that one is not retried. An answer that is not JSON (a block page) counts as a failure.
    """
    url = URL.format(sym=urllib.parse.quote(sym, safe=""), range=range_)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                try:
                    data = json.load(resp)
                except json.JSONDecodeError:
                    raise YahooBlocked("Yahoo did not return data (blocked or unavailable)") from None
            break
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == attempts - 1:
                raise
            time.sleep(RATE_LIMIT_WAIT if e.code == 429 else BACKOFF[attempt])
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(BACKOFF[attempt])
    chart = data.get("chart") or {}
    if not chart.get("result"):
        error = chart.get("error") or {}
        raise ValueError(error.get("description") or "Yahoo returned no data")
    return chart["result"][0]


def completed_bars(res):
    """Return (dates, closes) of completed daily bars, selected exactly as macd_scan.py does."""
    if not res.get("timestamp"):
        raise ValueError("Yahoo returned no price bars")
    ts = res["timestamp"]
    closes = res["indicators"]["quote"][0]["close"]
    meta = res["meta"]
    # Drop today's bar while the session is still open; it is a partial candle.
    reg = meta.get("currentTradingPeriod", {}).get("regular", {})
    if reg and ts[-1] >= reg["start"] and time.time() < reg["end"]:
        ts, closes = ts[:-1], closes[:-1]
    offset = meta.get("gmtoffset", 0)
    pairs = [(t, c) for t, c in zip(ts, closes) if c is not None]
    dates = [dt.datetime.fromtimestamp(t + offset, dt.timezone.utc).date() for t, _ in pairs]
    return dates, [c for _, c in pairs]


# ---------------------------------------------------------------- the math (verbatim from macd_scan.py)

def ema(values, n):
    """EMA seeded with the simple average of the first n values."""
    out = [None] * len(values)
    out[n - 1] = sum(values[:n]) / n
    k = 2 / (n + 1)
    for i in range(n, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1 - k)
    return out


def macd(closes):
    fast, slow = ema(closes, FAST), ema(closes, SLOW)
    line = [f - s for f, s in zip(fast[SLOW - 1:], slow[SLOW - 1:])]
    sig = ema(line, SIG)[SIG - 1:]
    line = line[SIG - 1:]
    hist = [m - s for m, s in zip(line, sig)]
    return line, sig, hist


def rsi(closes, n=14):
    """Wilder's RSI of the last bar."""
    gains = [max(b - a, 0) for a, b in zip(closes, closes[1:])]
    losses = [max(a - b, 0) for a, b in zip(closes, closes[1:])]
    avg_gain, avg_loss = sum(gains[:n]) / n, sum(losses[:n]) / n
    for g, l in zip(gains[n:], losses[n:]):
        avg_gain = (avg_gain * (n - 1) + g) / n
        avg_loss = (avg_loss * (n - 1) + l) / n
    return 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)


def detect(m, h):
    """Return [(direction, stage, description)] that first appeared on the last bar."""
    out = []
    if h[-1] > 0 and h[-1] < h[-2] < h[-3] and h[-3] >= h[-4]:
        out.append(("PEAK", 1, "histogram shrinking 2 days after its high"))
    if h[-1] < 0 and h[-1] > h[-2] > h[-3] and h[-3] <= h[-4]:
        out.append(("VALLEY", 1, "histogram shrinking 2 days after its low"))
    if m[-2] > 0 and m[-1] < m[-2] and m[-2] >= m[-3]:
        out.append(("PEAK", 2, "MACD line turned down above zero"))
    if m[-2] < 0 and m[-1] > m[-2] and m[-2] <= m[-3]:
        out.append(("VALLEY", 2, "MACD line turned up below zero"))
    if h[-2] > 0 >= h[-1]:
        out.append(("PEAK", 3, "MACD crossed below signal line"))
    if h[-2] < 0 <= h[-1]:
        out.append(("VALLEY", 3, "MACD crossed above signal line"))
    return out


# ---------------------------------------------------------------- the same math for every day

def rsi_series(closes, n=14):
    """Wilder's RSI for every bar: None for the first n bars, then the same arithmetic as
    rsi() above step by step, so the last value is identical to rsi(closes)."""
    gains = [max(b - a, 0) for a, b in zip(closes, closes[1:])]
    losses = [max(a - b, 0) for a, b in zip(closes, closes[1:])]
    out = [None] * len(closes)
    avg_gain, avg_loss = sum(gains[:n]) / n, sum(losses[:n]) / n
    out[n] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i, (g, l) in enumerate(zip(gains[n:], losses[n:]), start=n + 1):
        avg_gain = (avg_gain * (n - 1) + g) / n
        avg_loss = (avg_loss * (n - 1) + l) / n
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def events_by_day(dates, line, hist):
    """Run detect() as of every day, as if the scanner had run each morning.

    `line` and `hist` are the MACD line and histogram as macd() returns them (no padding).
    Returns {date: [event, ...]} with a key only for days that had at least one signal.
    """
    first = len(dates) - len(line)  # index in `dates` of the first MACD value
    out = {}
    for k in range(4, len(line) + 1):  # detect() looks back 4 bars
        found = detect(line[:k], hist[:k])
        if found:
            day = dates[first + k - 1].isoformat()
            out[day] = [{"dir": d, "stage": st, "detail": txt} for d, st, txt in found]
    return out


def build_record(sym, res, fetched_at):
    """Turn one Yahoo result into the dictionary that becomes site/data/<SYM>.json."""
    dates, closes = completed_bars(res)
    if len(closes) < MIN_BARS:
        raise ValueError(f"only {len(closes)} daily bars (need {MIN_BARS})")
    meta = res["meta"]
    line, sig, hist = macd(closes)
    pad = [None] * (len(closes) - len(line))  # the warm-up days have no MACD yet

    def rounded(values, places):
        return [None if v is None else round(v, places) for v in values]

    return {
        "symbol": sym,
        "name": meta.get("shortName") or meta.get("longName") or sym,
        "currency": meta.get("currency"),
        "exchange": meta.get("exchangeName"),
        "fetched": fetched_at,
        "stale": False,
        "dates": [d.isoformat() for d in dates],
        "close": rounded(closes, 4),
        "macd": rounded(pad + line, 4),
        "signal": rounded(pad + sig, 4),
        "hist": rounded(pad + hist, 4),
        "rsi": rounded(rsi_series(closes, RSI_N), 2),
        "events": events_by_day(dates, line, hist),
    }


# ---------------------------------------------------------------- files and bookkeeping

def now_utc():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path, obj):
    """Write the whole file under a temporary name, then rename it into place, so a reader
    (or a crash) never sees a half-written file."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)


def cached_summary(path):
    """(name, last_bar) of a ticker file left from an earlier run, or None if there is none."""
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["name"], data["dates"][-1]


def describe(e):
    """One plain line about why a ticker failed, for index.json and the log."""
    if isinstance(e, urllib.error.HTTPError):
        return str(e)  # e.g. "HTTP Error 404: Not Found"
    if isinstance(e, urllib.error.URLError):
        return f"could not reach Yahoo ({e.reason})"
    text = str(e).strip()
    if isinstance(e, ValueError) and text:
        return text  # our own messages, e.g. "only 12 daily bars (need 40)"
    return f"{e.__class__.__name__}: {text}" if text else e.__class__.__name__


def looks_like_outage(e):
    """True when an error says Yahoo itself is unreachable or blocking us (timeouts, refused
    connections, HTTP 403/429/5xx, block pages), as opposed to one ticker being odd (HTTP 404,
    too few bars, "no data for symbol")."""
    if isinstance(e, urllib.error.HTTPError):
        return e.code != 404
    # URLError and socket timeouts are both kinds of OSError.
    return isinstance(e, (OSError, YahooBlocked))


def most_common(values):
    """The value that appears most often; a tie goes to the latest one. None if empty."""
    counts = collections.Counter(values)
    return max(counts, key=lambda v: (counts[v], v)) if counts else None


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--universe", default=HERE / "universe.txt",
                    help="ticker list, one per line (default: universe.txt next to this script)")
    ap.add_argument("--out", default=HERE / "site" / "data",
                    help="folder for the JSON files (default: site/data next to this script)")
    ap.add_argument("--only", help="comma-separated tickers to fetch instead of the universe (testing)")
    ap.add_argument("--limit", type=int, help="fetch only the first N tickers (testing)")
    ap.add_argument("--sleep", type=float, default=0.25, help="seconds to pause between tickers")
    ap.add_argument("--range", default="1y", help="how much history to ask Yahoo for (default 1y)")
    args = ap.parse_args(argv)
    started = time.time()

    if args.only:
        requested = []
        for raw in args.only.split(","):
            sym = normalise(raw)
            if sym and sym not in requested:
                requested.append(sym)
    else:
        if not Path(args.universe).is_file():
            print(f"Cannot find the ticker list {args.universe}")
            return 1
        requested = read_universe(args.universe)
    if args.limit is not None:
        requested = requested[:args.limit]
    if not requested:
        print("No tickers to fetch.")
        return 1

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tickers, failed = {}, {}
    fetched = stale = 0
    trouble = 0            # fetch failures in a row that look like Yahoo being down
    out_of_time = False    # set once TIME_BUDGET has passed; no fetching after that
    for i, sym in enumerate(requested, 1):
        if not SYMBOL_RE.match(sym):
            failed[sym] = "bad symbol"
            print(f"  {sym}: bad symbol", flush=True)
        else:
            path = out / f"{sym}.json"
            if not out_of_time and time.time() - started > TIME_BUDGET:
                out_of_time = True
                print(f"Out of time after {TIME_BUDGET // 60} minutes. The remaining tickers keep "
                      "last night's file (marked stale) or are listed as failed.", flush=True)
            try:
                if out_of_time:
                    raise ValueError("not fetched: the run was out of time")
                hurry = trouble >= TROUBLE_LIMIT
                try:
                    res = fetch_chart(sym, args.range, attempts=1 if hurry else ATTEMPTS,
                                      timeout=HURRY_TIMEOUT if hurry else TIMEOUT)
                except Exception as e:
                    if looks_like_outage(e):
                        trouble += 1
                        if trouble == TROUBLE_LIMIT:
                            print(f"{trouble} fetches in a row failed; Yahoo looks down or blocking. "
                                  "Trying each remaining ticker once, with a short timeout.", flush=True)
                    raise
                trouble = 0
                record = build_record(sym, res, now_utc())
                write_json(path, record)
                tickers[sym] = {"name": record["name"], "last_bar": record["dates"][-1], "stale": False}
                fetched += 1
            except Exception as e:
                reason = describe(e)
                try:
                    cached = cached_summary(path)
                except Exception as cache_error:
                    cached, reason = None, f"{reason}; kept file unreadable: {describe(cache_error)}"
                if cached:
                    name, last_bar = cached
                    tickers[sym] = {"name": name, "last_bar": last_bar, "stale": True, "error": reason}
                    stale += 1
                    print(f"  {sym}: {reason} -> keeping the file from {last_bar}", flush=True)
                else:
                    failed[sym] = reason
                    print(f"  {sym}: {reason}", flush=True)
            if i < len(requested):
                time.sleep(args.sleep)
        if i % PROGRESS_EVERY == 0:
            print(f"{i}/{len(requested)}  fetched {fetched}  stale {stale}  failed {len(failed)}"
                  f"  ({time.time() - started:.0f}s)", flush=True)

    last_bar = most_common(t["last_bar"] for t in tickers.values())
    write_json(out / "index.json", {
        "generated": now_utc(),
        "last_bar": last_bar,
        "count": len(tickers),
        "params": {"fast": FAST, "slow": SLOW, "signal": SIG, "rsi": RSI_N, "weak_pct": WEAK_PCT},
        "tickers": tickers,
        "failed": failed,
    })
    print(f"fetched {fetched}  stale {stale}  failed {len(failed)}  last_bar {last_bar}"
          f"  elapsed {time.time() - started:.0f}s", flush=True)

    if not args.only and len(tickers) * 2 < len(requested):
        print(f"Only {len(tickers)} of {len(requested)} tickers have a usable file. "
              "Something is wrong with the data source; see the lines above.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
