// Temporary: drive a real browser against the PRODUCTION GitHub Pages site.
import { chromium } from 'playwright';
const BASE = 'https://shaitura.github.io/Yuvalinvest/';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 932 } });
const responses = [], errs = [];
p.on('response', r => responses.push([r.status(), r.url()]));
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

await p.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForFunction(() => document.getElementById('sp500Val')?.textContent !== 'טוען...', { timeout: 30000 })
       .catch(() => errs.push('TIMEOUT: price never left "טוען..."'));

const ui = await p.evaluate(() => ({
  sp500:  document.getElementById('sp500Val')?.textContent,
  change: document.getElementById('sp500Change')?.textContent,
  ils:    document.getElementById('ilsVal')?.textContent,
  footer: document.getElementById('lastUpdated')?.textContent,
  alert:  getComputedStyle(document.getElementById('apiAlert')).display,
  manual: getComputedStyle(document.getElementById('manualGroup')).display,
}));

// Exercise all three functions against the live files.
const fns = await p.evaluate(async () => ({
  current:    await fetchCurrentPrice(),
  rate:       await fetchExchangeRate(),
  histNormal: await fetchHistoricalPrice('2020-03-23'),
  histSunday: await fetchHistoricalPrice('2026-08-23'),
  histOld:    await fetchHistoricalPrice('1999-01-04'),
}));

console.log('=== LIVE: ' + BASE + ' ===');
console.log('  S&P 500        :', ui.sp500, ui.change);
console.log('  USD/ILS        :', ui.ils);
console.log('  footer         :', ui.footer);
console.log('  apiAlert       :', ui.alert  === 'none' ? 'hidden OK' : '*** VISIBLE — STILL BROKEN ***');
console.log('  manual entry   :', ui.manual === 'none' ? 'hidden OK' : '*** VISIBLE — STILL BROKEN ***');
console.log('\n=== the three functions, live ===');
console.log('  fetchCurrentPrice   :', JSON.stringify(fns.current));
console.log('  fetchExchangeRate   :', fns.rate);
console.log('  fetchHistoricalPrice 2020-03-23 (trading day):', fns.histNormal);
console.log('  fetchHistoricalPrice 2026-08-23 (Sunday)     :', fns.histSunday);
console.log('  fetchHistoricalPrice 1999-01-04 (pre-series) :', fns.histOld);

console.log('\n=== every network response ===');
responses.forEach(([s, u]) => console.log(`  ${s}  ${u.slice(0, 110)}`));
const bad = responses.filter(([s]) => s >= 400);
console.log('\n=== page errors ===');
console.log(errs.length ? errs.map(e => '  ' + e).join('\n') : '  (none)');

await p.screenshot({ path: 'live.png', fullPage: true });
await b.close();

const ok = ui.alert === 'none' && ui.manual === 'none' && fns.current?.price > 0 && fns.rate > 0 && fns.histNormal > 0;
console.log('\nRESULT:', ok ? 'LIVE SITE WORKING' : 'LIVE SITE NOT WORKING');
if (bad.length) console.log('non-2xx responses:', bad);
process.exit(ok ? 0 : 1);
