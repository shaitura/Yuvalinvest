// Temporary, STRICTLY READ-ONLY: report what Firebase actually holds, live.
// No clicks, no form input, no function calls that write.
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();

// Hard guard: fail loudly if the page ever tries to WRITE to Firebase.
const writes = [];
p.on('request', r => {
  const m = r.method(), u = r.url();
  if (u.includes('firebasedatabase.app') && ['PUT','POST','PATCH','DELETE'].includes(m)) writes.push(`${m} ${u}`);
});

await p.goto('https://shaitura.github.io/Yuvalinvest/', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(6000);

const state = await p.evaluate(() => ({
  childKey:    typeof childKey !== 'undefined' ? childKey : '?',
  fbPath:      typeof FB_PATH  !== 'undefined' ? FB_PATH  : '?',
  count:       Array.isArray(investments) ? investments.length : 'not an array',
  settings,
  goal,
  list: (investments || []).map(i => ({ date: i.date, nis: i.amountNIS, sp: i.sp500Price, note: i.note || '' })),
}));

// Read the sibling children/* keys straight from the database, read-only.
const all = await p.evaluate(async () => {
  const snap = await db.ref('children').once('value');
  const v = snap.val() || {};
  return Object.fromEntries(Object.entries(v).map(([k, c]) => [k, Object.keys(c?.investments || {}).length]));
});

console.log('=== מה שהאפליקציה טענה מ-Firebase, חי ===');
console.log('  childKey :', state.childKey, '  (path:', state.fbPath + ')');
console.log('  שם       :', JSON.stringify(state.settings));
console.log('  יעד      :', JSON.stringify(state.goal));
console.log('  מספר פעימות:', state.count);
console.log('\n  הפעימות:');
state.list.forEach((i, n) => console.log(`    ${n + 1}. ${i.date}  ₪${i.nis}  @ ${i.sp}  ${i.note}`));
console.log('\n=== כל הילדים במסד ===');
for (const [k, n] of Object.entries(all)) console.log(`  children/${k} → ${n} פעימות`);
console.log('\n=== כתיבות שבוצעו במהלך הבדיקה ===');
console.log(writes.length ? writes : '  אפס. קריאה בלבד. ✅');
await b.close();
