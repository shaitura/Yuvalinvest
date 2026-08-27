// Temporary: probe candidate S&P 500 *history* sources from a GitHub runner.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const C = [
  ['cboe-hist-csv',  'https://cdn.cboe.com/api/global/us_indices/daily_prices/SPX_History.csv'],
  ['cboe-hist-json', 'https://cdn.cboe.com/api/global/delayed_quotes/historical_data/_SPX.json'],
  ['cboe-quote-full','https://cdn.cboe.com/api/global/delayed_quotes/quotes/_SPX.json'],
  ['marketdata-app', 'https://api.marketdata.app/v1/indices/candles/daily/SPX/?from=2016-01-01&to=2026-08-27'],
  ['jina-stooq',     'https://r.jina.ai/https://stooq.com/q/d/l/?s=%5Espx&i=d'],
  ['allorigins-25s', 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d')],
  ['corslol',        'https://api.cors.lol/?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d')],
  ['whateverorigin', 'https://whateverorigin.org/get?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d')],
];
for (const [name, url] of C) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
    const txt = await r.text();
    const head = txt.replace(/\s+/g, ' ').slice(0, 200);
    const tail = txt.trim().split('\n').slice(-2).join(' | ').slice(0, 120);
    console.log(`${r.ok ? 'OK  ' : 'BAD '} ${name.padEnd(16)} ${r.status} ${Date.now()-t}ms len=${txt.length}\n     head: ${head}\n     tail: ${tail}`);
  } catch (e) {
    console.log(`ERR  ${name.padEnd(16)} ${Date.now()-t}ms  ${e.name}: ${e.message}`);
  }
}
