// Temporary, STRICTLY READ-ONLY: probe candidate child keys for investments.
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
const writes = [];
p.on('request', r => {
  const m = r.method(), u = r.url();
  if (u.includes('firebasedatabase.app') && ['PUT','POST','PATCH','DELETE'].includes(m)) writes.push(`${m} ${u}`);
});
await p.goto('https://shaitura.github.io/Yuvalinvest/', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(5000);

const KEYS = ['default','yuval','yuvali','Yuval','YUVAL','יובל','יובלי','shai','shaitura',
              'yuval1','child1','kid1','test','main','a','1','noa','noya','ella','maya','roni','shira'];

const rows = await p.evaluate(async keys => {
  const out = [];
  for (const k of keys) {
    try {
      const snap = await db.ref(`children/${k}`).once('value');
      const v = snap.val();
      if (!v) { out.push([k, 'ריק לגמרי', '', '']); continue; }
      const n = Object.keys(v.investments || {}).length;
      out.push([k, n + ' פעימות', v.settings?.name || '—', v.goal?.name || '—']);
    } catch (e) { out.push([k, 'שגיאה: ' + e.message.slice(0, 40), '', '']); }
  }
  return out;
}, KEYS);

console.log('=== סריקת מפתחות ילד (קריאה בלבד) ===');
console.log('  מפתח'.padEnd(16), 'פעימות'.padEnd(16), 'שם'.padEnd(12), 'יעד');
for (const [k, n, name, goal] of rows) {
  const mark = /^[1-9]/.test(n) ? '  <<< כאן יש נתונים' : '';
  console.log('  ' + k.padEnd(14), String(n).padEnd(16), String(name).padEnd(12), goal, mark);
}
console.log('\n=== כתיבות ===');
console.log(writes.length ? writes : '  אפס. קריאה בלבד. ✅');
await b.close();
