#!/usr/bin/env node
/**
 * Fetches S&P 500 prices + USD/ILS rate server-side and writes them to static
 * JSON files that the app reads same-origin from GitHub Pages.
 *
 *   data/market.json   small, always loaded  -> current price, prev close, USD/ILS
 *   data/history.json  large, lazy loaded    -> daily closes, for past-dated beats
 *
 * Why these sources: the browser cannot call Yahoo or the Bank of Israel directly
 * (no CORS headers), and free CORS proxies no longer work from a production
 * domain. Doing it server-side removes CORS entirely — but not every source is
 * reachable from a datacentre IP either. Measured from a GitHub runner:
 *   Yahoo Finance    HTTP 429 (blocks datacentre IPs)
 *   Stooq            JavaScript anti-bot challenge
 *   FRED             connection times out
 *   CBOE             works — and it is the exchange that lists SPX
 * So CBOE is primary for the index and the Bank of Israel for the rate, each
 * with fallbacks, and every attempt is logged so a future breakage is obvious.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT      = path.resolve(import.meta.dirname, '..');
const DATA_DIR  = path.join(ROOT, 'data');
const MARKET_F  = path.join(DATA_DIR, 'market.json');
const HISTORY_F = path.join(DATA_DIR, 'history.json');
const UA        = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS   = 20000;
const HISTORY_YEARS = 15;

const log  = (...a) => console.log(...a);
const warn = (...a) => console.log('WARN:', ...a);
const round2 = n => Math.round(n * 100) / 100;
const round4 = n => Math.round(n * 10000) / 10000;

// Node's fetch has no default timeout — without one an unresponsive source
// (fred.stlouisfed.org just hangs from here) would stall the whole job.
async function get(url, { json = true } = {}) {
  let r;
  try {
    r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: json ? 'application/json,*/*' : 'text/csv,*/*' },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS}ms` : `${e.name}: ${e.message}`);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return json ? r.json() : r.text();
}

async function readJsonOr(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

// ── S&P 500 daily history ────────────────────────────────────────────────────
// CBOE publishes the official SPX daily close back to 1975 as plain CSV
// (DATE,SPX with US-style MM/DD/YYYY dates).
async function historyFromCboe() {
  const csv  = await get('https://cdn.cboe.com/api/global/us_indices/daily_prices/SPX_History.csv', { json: false });
  const rows = csv.trim().split(/\r?\n/);
  rows.shift();
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - HISTORY_YEARS);
  const closes = {};
  for (const row of rows) {
    const [d, v] = row.split(',');
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || '').trim());
    const close = parseFloat(v);
    if (!m || !(close > 0)) continue;
    const day = `${m[3]}-${m[1]}-${m[2]}`;
    if (new Date(day) >= cutoff) closes[day] = round2(close);
  }
  if (!Object.keys(closes).length) throw new Error(`no rows parsed from ${rows.length} lines`);
  return { closes, source: 'cboe' };
}

async function historyFromYahoo() {
  const d   = await get('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=10y&interval=1d');
  const res = d?.chart?.result?.[0];
  const ts  = res?.timestamp, cl = res?.indicators?.quote?.[0]?.close;
  if (!ts?.length || !cl?.length) throw new Error('unexpected shape');
  const closes = {};
  for (let i = 0; i < ts.length; i++) {
    if (cl[i] != null && cl[i] > 0) closes[new Date(ts[i] * 1000).toISOString().slice(0, 10)] = round2(cl[i]);
  }
  return { closes, source: 'yahoo' };
}

// ── S&P 500 latest quote ─────────────────────────────────────────────────────
// The daily close is the number this app wants. Only if CBOE is already quoting
// a session that the history file does not cover yet do we fall back to the
// (15-minute delayed) live price, and then we flag it as intraday.
function quoteFromHistory(closes) {
  const days = Object.keys(closes).sort();
  if (!days.length) throw new Error('no history to derive a quote from');
  const last = days[days.length - 1], prev = days[days.length - 2];
  return { price: closes[last], prevClose: prev ? closes[prev] : null, asOf: last, intraday: false, source: 'cboe-close' };
}

async function quoteFromCboeLive(closes) {
  const d = await get('https://cdn.cboe.com/api/global/delayed_quotes/quotes/_SPX.json');
  const q = d?.data;
  if (!(q?.current_price > 0)) throw new Error('no current_price');
  const day  = (d.timestamp || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('no usable timestamp');
  if (closes[day]) throw new Error(`session ${day} already closed in history`);
  const prev = q.prev_day_close > 0 ? round2(q.prev_day_close)
             : (q.price_change != null ? round2(q.current_price - q.price_change) : null);
  return { price: round2(q.current_price), prevClose: prev, asOf: day, intraday: true, source: 'cboe-live' };
}

// ── USD/ILS ──────────────────────────────────────────────────────────────────
// The URL the app used (…/EXR/1.0/RER_USD_ILS--ILUDAH) now returns 404, so try
// the current variants in turn and log which one answered.
const BOI_URLS = [
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?lastNObservations=1&format=sdmx-json',
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/all?c[SERIES_CODE]=RER_USD_ILS&lastNObservations=1&format=sdmx-json',
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS--ILUDAH?lastNObservations=1&format=sdmx-json',
];

function parseBoiSdmx(d) {
  const series = d?.data?.dataSets?.[0]?.series;
  const key    = series && Object.keys(series)[0];
  const obs    = key != null ? series[key]?.observations : null;
  if (!obs) throw new Error('unexpected shape ' + JSON.stringify(d).slice(0, 200));
  const idx  = Object.keys(obs).sort((a, b) => +b - +a)[0];
  const rate = obs[idx]?.[0];
  if (!(rate > 0)) throw new Error('no rate value');
  const dim  = d?.data?.structures?.[0]?.dimensions?.observation?.[0]
            || d?.data?.structure?.dimensions?.observation?.[0];
  const asOf = dim?.values?.[+idx]?.id || dim?.values?.[+idx]?.start?.slice(0, 10) || null;
  return { rate: round4(rate), asOf, source: 'boi' };
}

async function rateFromBoi() {
  const errors = [];
  for (const url of BOI_URLS) {
    try {
      const out = await parseBoiSdmx(await get(url));
      log(`       via ${url.split('/EXR/1.0/')[1].split('?')[0]}`);
      return out;
    } catch (e) { errors.push(`${url.split('/EXR/1.0/')[1].split('?')[0]}: ${e.message.slice(0, 100)}`); }
  }
  throw new Error(errors.join(' ;; '));
}

async function rateFromFrankfurter() {
  const d = await get('https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS');
  if (!(d?.rates?.ILS > 0)) throw new Error('no ILS rate');
  return { rate: round4(d.rates.ILS), asOf: d.date || null, source: 'frankfurter' };
}

async function rateFromErApi() {
  const d = await get('https://open.er-api.com/v6/latest/USD');
  if (!(d?.rates?.ILS > 0)) throw new Error('no ILS rate');
  const asOf = d.time_last_update_utc ? new Date(d.time_last_update_utc).toISOString().slice(0, 10) : null;
  return { rate: round4(d.rates.ILS), asOf, source: 'er-api' };
}

// ── try a chain of sources, logging every attempt ────────────────────────────
async function firstOk(label, fns) {
  const errors = [];
  for (const fn of fns) {
    try {
      const out = await fn();
      log(`  OK   ${label} <- ${fn.name}`);
      return out;
    } catch (e) {
      errors.push(`${fn.name}: ${e.message}`);
      warn(`  FAIL ${label} <- ${fn.name}: ${e.message}`);
    }
  }
  throw new Error(`${label}: all sources failed [${errors.join(' | ')}]`);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const prevMarket  = await readJsonOr(MARKET_F, null);
  const prevHistory = await readJsonOr(HISTORY_F, { closes: {} });
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let degraded = false;

  log('S&P 500 history:');
  let history = null;
  try { history = await firstOk('history', [historyFromCboe, historyFromYahoo]); }
  catch (e) { warn(e.message); degraded = true; }

  // Merge onto what is already committed so a short-window source never truncates.
  const closes = { ...(prevHistory.closes || {}), ...(history?.closes || {}) };
  const days   = Object.keys(closes).sort();
  log(days.length ? `       ${days.length} trading days, ${days[0]} .. ${days[days.length - 1]}`
                  : '       NO trading days available');

  log('S&P 500 quote:');
  let quote = null;
  try {
    quote = await firstOk('quote', [
      function fromCboeLive() { return quoteFromCboeLive(closes); },
      function fromHistory()  { return quoteFromHistory(closes); },
    ]);
  } catch (e) { warn(e.message); degraded = true; }
  if (!quote && prevMarket?.sp500) { warn('       keeping the previously committed sp500 value'); quote = prevMarket.sp500; }

  log('USD/ILS rate:');
  let rate = null;
  try { rate = await firstOk('usdIls', [rateFromBoi, rateFromFrankfurter, rateFromErApi]); }
  catch (e) { warn(e.message); degraded = true; }
  if (!rate && prevMarket?.usdIls) { warn('       keeping the previously committed usdIls value'); rate = prevMarket.usdIls; }

  if (!quote || !days.length) {
    console.error('FATAL: no S&P 500 price and no history — refusing to write empty data files.');
    process.exit(1);
  }

  await writeFile(MARKET_F,  JSON.stringify({ updatedAt: now, sp500: quote, usdIls: rate }, null, 2) + '\n');
  await writeFile(HISTORY_F, JSON.stringify({ updatedAt: now, source: history?.source || 'carried-over', closes }) + '\n');

  log('');
  log('WROTE data/market.json  ->', JSON.stringify({ sp500: quote, usdIls: rate }));
  log('WROTE data/history.json ->', days.length, 'days');
  if (degraded) log('NOTE: a primary source failed (see WARN above) — a fallback covered it.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
