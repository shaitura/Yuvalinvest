// Temporary, STRICTLY READ-ONLY: serve THIS branch's index.html locally and point
// it at the real Firebase, so the child-resolution change is proven against live
// data before it reaches production.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TYPES = { '.html':'text/html', '.json':'application/json', '.svg':'image/svg+xml' };
const srv = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise(r => srv.listen(8080, '127.0.0.1', r));

const b = await chromium.launch();
const ctx = await b.newContext();
const writes = [];
await ctx.route('**/*', r => {
  const m = r.request().method(), u = r.request().url();
  if (u.includes('firebasedatabase.app') && ['PUT','POST','PATCH','DELETE'].includes(m)) {
    writes.push(`${m} ${u.slice(0, 90)}`);
    return r.abort('failed');            // hard block: never write during a check
  }
  return r.continue();
});

async function open(q, label) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8080/' + q, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(5000);
  const s = await p.evaluate(() => ({
    childKey, path: FB_PATH,
    name:  settings?.name || null,
    goal:  goal ? `${goal.name} ₪${goal.amount}` : null,
    count: (investments || []).length,
    list:  (investments || []).map(i => `${i.date} ₪${i.amountNIS} @${i.sp500Price}`),
    setupOpen: document.getElementById('setupOverlay').classList.contains('open'),
    sp500: document.getElementById('sp500Val').textContent,
    ils:   document.getElementById('ilsVal').textContent,
  }));
  console.log(`\n=== ${label}  ("${q || 'כתובת חשופה'}") ===`);
  console.log('  childKey :', s.childKey, '→', s.path);
  console.log('  שם / יעד :', s.name, '/', s.goal);
  console.log('  פעימות   :', s.count);
  s.list.forEach((l, i) => console.log(`     ${i + 1}. ${l}`));
  console.log('  אשף הגדרה:', s.setupOpen ? 'נפתח' : 'לא נפתח');
  console.log('  מחיר/שער :', s.sp500, '/', s.ils);
  console.log('  שגיאות   :', errs.length ? errs : 'אין');
  await p.close();
  return s;
}

const bare = await open('',            'כתובת חשופה = מה שאייקון ה-PWA פותח');
const noa  = await open('?child=noa',  'ילד/ה חדש/ה');

console.log('\n=== כתיבות למסד ===');
console.log(writes.length ? writes : '  אפס. קריאה בלבד. ✅');

const ok = bare.childKey === 'yuval' && bare.count === 4 && !bare.setupOpen
        && noa.childKey === 'noa' && noa.setupOpen && writes.length === 0;
console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
srv.close(); await b.close();
process.exit(ok ? 0 : 1);
