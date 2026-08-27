#!/usr/bin/env node
/**
 * Fetches S&P 500 prices + USD/ILS rate server-side (GitHub Actions runner has
 * full network access and no CORS restrictions) and writes them to static JSON
 * files that the app reads same-origin from GitHub Pages.
 *
 *   data/market.json   small, always loaded  -> current price, prev close, USD/ILS
 *   data/history.json  large, lazy loaded    -> daily closes, for past-dated beats
 *
 * Never overwrites good data with nulls: if a source fails, the previous value
 * is carried over and the failure is logged loudly.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT       = path.resolve(import.meta.dirname, '..');
const DATA_DIR   = path.join(ROOT, 'data');
const MARKET_F   = path.join(DATA_DIR, 'market.json');
const HISTORY_F  = path.join(DATA_DIR, 'history.json');
const UA         = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const log  = (...a) => console.log(...a);
const warn = (...a) => console.log('WARN:', ...a);

async function get(url, { json = true } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json,*/*' : 'text/csv,*/*' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return json ? r.json() : r.text();
}

const isoDay = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const round2 = n => Math.round(n * 100) / 100;

async function readJsonOr(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

// ── S&P 500 daily history ────────────────────────────────────────────────────
// FRED (Federal Reserve Bank of St. Louis) is the primary source: official, no
// API key, plain CSV, and — unlike Yahoo and Stooq — it does not block requests
// coming from datacentre IPs such as GitHub's runners. It carries a rolling
// 10-year window of daily S&P 500 closes, which is why the script merges each
// run onto the previously committed history instead of replacing it.
function parseCsvCloses(csv, label) {
  const rows = csv.trim().split(/\r?\n/);
  rows.shift(); // header
  const closes = {};
  for (const row of rows) {
    const f = row.split(',');
    const day = (f[0] || '').trim();
    const v   = parseFloat((f[1] || '').trim());
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && v > 0) closes[day] = round2(v);
  }
  if (!Object.keys(closes).length) throw new Error(`${label}: no rows parsed from ${rows.length} lines`);
  return closes;
}

async function historyFromFred() {
  const csv = await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500', { json: false });
  return { closes: parseCsvCloses(csv, 'fred'), source: 'fred' };
}

async function historyFromStooq() {
  const csv = await get('https://stooq.com/q/d/l/?s=%5Espx&i=d', { json: false });
  return { closes: parseCsvCloses(csv, 'stooq'), source: 'stooq' };
}

async function historyFromYahoo() {
  const d   = await get('https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=10y&interval=1d');
  const res = d?.chart?.result?.[0];
  const ts  = res?.timestamp, cl = res?.indicators?.quote?.[0]?.close;
  if (!ts?.length || !cl?.length) throw new Error('yahoo history: unexpected shape');
  const closes = {};
  for (let i = 0; i < ts.length; i++) if (cl[i] != null && cl[i] > 0) closes[isoDay(ts[i])] = round2(cl[i]);
  return { closes, source: 'yahoo' };
}

// ── S&P 500 latest quote ─────────────────────────────────────────────────────
async function quoteFromYahoo() {
  const d = await get('https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d');
  const m = d?.chart?.result?.[0]?.meta;
  if (!m?.regularMarketPrice) throw new Error('yahoo quote: no regularMarketPrice');
  return {
    price:     round2(m.regularMarketPrice),
    prevClose: m.chartPreviousClose ? round2(m.chartPreviousClose) : (m.previousClose ? round2(m.previousClose) : null),
    asOf:      m.regularMarketTime ? isoDay(m.regularMarketTime) : new Date().toISOString().slice(0, 10),
    source:    'yahoo',
  };
}

function quoteFromHistory(closes, source) {
  const days = Object.keys(closes).sort();
  if (!days.length) throw new Error('no history to derive a quote from');
  const last = days[days.length - 1], prev = days[days.length - 2];
  return { price: closes[last], prevClose: prev ? closes[prev] : null, asOf: last, source };
}

// ── USD/ILS ──────────────────────────────────────────────────────────────────
// The URL the app used (…/EXR/1.0/RER_USD_ILS--ILUDAH) now returns 404, so try
// the documented variants in turn and log which one answers.
const BOI_URLS = [
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?lastNObservations=1&format=sdmx-json',
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/all?c[SERIES_CODE]=RER_USD_ILS&lastNObservations=1&format=sdmx-json',
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS--ILUDAH?lastNObservations=1&format=sdmx-json',
];

function parseBoiSdmx(d) {
  const series = d?.data?.dataSets?.[0]?.series;
  const key    = series && Object.keys(series)[0];
  const obs    = key != null ? series[key]?.observations : null;
  if (!obs) throw new Error('unexpected shape ' + JSON.stringify(d).slice(0, 300));
  const idx  = Object.keys(obs).sort((a, b) => +b - +a)[0];
  const rate = obs[idx]?.[0];
  if (!(rate > 0)) throw new Error('no rate value');
  const dim  = d?.data?.structures?.[0]?.dimensions?.observation?.[0]
            || d?.data?.structure?.dimensions?.observation?.[0];
  const asOf = dim?.values?.[+idx]?.id || dim?.values?.[+idx]?.start?.slice(0, 10) || null;
  return { rate: Math.round(rate * 10000) / 10000, asOf, source: 'boi' };
}

async function rateFromBoi() {
  const errors = [];
  for (const url of BOI_URLS) {
    try { return parseBoiSdmx(await get(url)); }
    catch (e) { errors.push(`${url.slice(60, 130)}… → ${e.message.slice(0, 120)}`); }
  }
  throw new Error('boi: ' + errors.join(' ;; '));
}

async function rateFromFrankfurter() {
  const d = await get('https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS');
  const rate = d?.rates?.ILS;
  if (!(rate > 0)) throw new Error('frankfurter: no ILS rate');
  return { rate: Math.round(rate * 10000) / 10000, asOf: d.date || null, source: 'frankfurter' };
}

async function rateFromErApi() {
  const d = await get('https://open.er-api.com/v6/latest/USD');
  const rate = d?.rates?.ILS;
  if (!(rate > 0)) throw new Error('er-api: no ILS rate');
  return { rate: Math.round(rate * 10000) / 10000, asOf: (d.time_last_update_utc ? new Date(d.time_last_update_utc).toISOString().slice(0, 10) : null), source: 'er-api' };
}

// ── try a chain of sources, logging each attempt ─────────────────────────────
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
  let failed = false;

  log('S&P 500 history:');
  let history = null;
  try { history = await firstOk('history', [historyFromFred, historyFromStooq, historyFromYahoo]); }
  catch (e) { warn(e.message); failed = true; }

  // Merge onto whatever we already had, so a short-range source never truncates history.
  const closes = { ...(prevHistory.closes || {}), ...(history?.closes || {}) };
  const days   = Object.keys(closes).sort();
  log(days.length ? `  ${days.length} trading days, ${days[0]} .. ${days[days.length - 1]}` : '  NO trading days available');

  log('S&P 500 quote:');
  let quote = null;
  try {
    quote = await firstOk('quote', [
      function fromHistory() { return quoteFromHistory(closes, history?.source || 'carried-over'); },
      quoteFromYahoo,
    ]);
  } catch (e) { warn(e.message); failed = true; }
  if (!quote && prevMarket?.sp500) { warn('  keeping previous sp500 value'); quote = prevMarket.sp500; }

  log('USD/ILS rate:');
  let rate = null;
  try { rate = await firstOk('usdIls', [rateFromBoi, rateFromFrankfurter, rateFromErApi]); }
  catch (e) { warn(e.message); failed = true; }
  if (!rate && prevMarket?.usdIls) { warn('  keeping previous usdIls value'); rate = prevMarket.usdIls; }

  if (!quote || !days.length) {
    console.error('FATAL: no S&P 500 price and no history — refusing to write empty data files.');
    process.exit(1);
  }

  await writeFile(MARKET_F, JSON.stringify({ updatedAt: now, sp500: quote, usdIls: rate }, null, 2) + '\n');
  await writeFile(HISTORY_F, JSON.stringify({ updatedAt: now, source: history?.source || 'carried-over', closes }) + '\n');

  log('');
  log('WROTE data/market.json  ->', JSON.stringify({ sp500: quote, usdIls: rate }));
  log('WROTE data/history.json ->', days.length, 'days');
  if (failed) log('NOTE: at least one primary source failed (see WARN lines above) — fallbacks covered it.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
