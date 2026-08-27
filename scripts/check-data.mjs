// Temporary, STRICTLY READ-ONLY.
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
const writes = [];
p.on('request', r => {
  const m = r.method(), u = r.url();
  if (u.includes('firebasedatabase.app') && ['PUT','POST','PATCH','DELETE'].includes(m)) writes.push(`${m} ${u}`);
});
await p.goto('https://shaitura.github.io/Yuvalinvest/?child=yuval', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(6000);

const s = await p.evaluate(() => ({
  path: FB_PATH, settings, goal,
  list: (investments || []).map(i => ({ d: i.date, nis: i.amountNIS, sp: i.sp500Price, note: i.note || '' })),
  ui: {
    sp500: document.getElementById('sp500Val').textContent,
    ils:   document.getElementById('ilsVal').textContent,
    badge: document.getElementById('beatsBadge')?.textContent,
  },
}));
console.log('=== ' + s.path + ' ===');
console.log('  שם:', s.settings?.name, s.settings?.emoji, ' | יעד:', JSON.stringify(s.goal));
console.log('  badge:', s.ui.badge, ' | S&P:', s.ui.sp500, ' | דולר:', s.ui.ils);
console.log('\n  הפעימות:');
s.list.forEach((i, n) => console.log(`    ${n + 1}. ${i.d}   ₪${i.nis}   @ S&P ${i.sp}   ${i.note}`));
console.log('\n=== כתיבות ===');
console.log(writes.length ? writes : '  אפס. קריאה בלבד. ✅');
await b.close();
