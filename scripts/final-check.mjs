// Temporary, STRICTLY READ-ONLY: final check against the LIVE production site.
import { chromium } from 'playwright';
const BASE = 'https://shaitura.github.io/Yuvalinvest/';
const b = await chromium.launch();
const ctx = await b.newContext();
const writes = [];
await ctx.route('**/*', r => {
  const m = r.request().method(), u = r.request().url();
  if (u.includes('firebasedatabase.app') && ['PUT','POST','PATCH','DELETE'].includes(m)) {
    writes.push(`${m} ${u.slice(0,80)}`); return r.abort('failed');
  }
  return r.continue();
});
async function open(q, label) {
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + q, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(5000);
  const s = await p.evaluate(() => ({
    childKey, name: settings?.name || null,
    goal: goal ? `${goal.name} ₪${goal.amount}` : null,
    count: (investments || []).length,
    badge: document.getElementById('beatsBadge')?.textContent,
    sp500: document.getElementById('sp500Val').textContent,
    ils: document.getElementById('ilsVal').textContent,
    footer: document.getElementById('lastUpdated').textContent,
    alert: getComputedStyle(document.getElementById('apiAlert')).display,
  }));
  console.log(`\n=== ${label} ===`);
  console.log(`  תיק: children/${s.childKey}  |  ${s.name}  |  יעד: ${s.goal}`);
  console.log(`  פעימות: ${s.count}   badge: ${s.badge}`);
  console.log(`  S&P: ${s.sp500}  דולר: ${s.ils}`);
  console.log(`  ${s.footer}`);
  console.log(`  אזהרת מחיר: ${s.alert === 'none' ? 'מוסתרת ✅' : 'מוצגת ⚠️'}   שגיאות: ${errs.length ? errs : 'אין'}`);
  if (q === '') await p.screenshot({ path: 'final.png', fullPage: false });
  await p.close(); return s;
}
const bare = await open('', 'כתובת חשופה / אייקון PWA');
const def  = await open('?child=default', 'התיק הישן — היעד שנשמר');
console.log('\n=== כתיבות למסד ===');
console.log(writes.length ? writes : '  אפס. קריאה בלבד. ✅');
const ok = bare.childKey === 'yuval' && bare.count === 4 && bare.alert === 'none'
        && def.goal && def.goal.includes('אייפון') && writes.length === 0;
console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
await b.close(); process.exit(ok ? 0 : 1);
