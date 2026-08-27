// Temporary: probe candidate S&P 500 sources from a GitHub runner.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const C = [
  ['cboe-quote',   'https://cdn.cboe.com/api/global/delayed_quotes/quotes/_SPX.json'],
  ['cboe-chart',   'https://cdn.cboe.com/api/global/delayed_quotes/charts/_SPX.json'],
  ['fred-txt',     'https://fred.stlouisfed.org/data/SP500.txt'],
  ['fred-graph',   'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500'],
  ['stooq-pl',     'https://stooq.pl/q/d/l/?s=%5Espx&i=d'],
  ['stooq-lite',   'https://stooq.com/q/l/?s=%5Espx&f=sd2t2ohlc&e=csv'],
  ['yahoo-q1',     'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d'],
  ['allorigins',   'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d')],
  ['codetabs',     'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d')],
  ['corsproxy',    'https://corsproxy.io/?' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d')],
  ['stockanalysis','https://stockanalysis.com/api/symbol/i/SPX/history?range=10Y&period=Daily'],
  ['wsj-histfeed', 'https://www.wsj.com/market-data/quotes/index/SPX'],
  ['nasdaq-idx',   'https://api.nasdaq.com/api/quote/SPX/info?assetclass=index'],
  ['marketwatch',  'https://www.marketwatch.com/investing/index/spx/downloaddatapartial?startdate=01/01/2016&enddate=12/31/2026&daterange=d30&frequency=p1d&csvdownload=true'],
];
for (const [name, url] of C) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(15000) });
    const body = (await r.text()).replace(/\s+/g, ' ').slice(0, 150);
    console.log(`${r.ok ? 'OK  ' : 'BAD '} ${name.padEnd(14)} ${r.status} ${Date.now()-t}ms  ${body}`);
  } catch (e) {
    console.log(`ERR  ${name.padEnd(14)} ${Date.now()-t}ms  ${e.name}: ${e.message}`);
  }
}
