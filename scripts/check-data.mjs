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

console.log('=== מה שהאפליקציה טענה מ-Firebase, חי ===');
console.log('  childKey :', state.childKey, '  (path:', state.fbPath + ')');
console.log('  שם       :', JSON.stringify(state.settings));
console.log('  יעד      :', JSON.stringify(state.goal));
console.log('  מספר פעימות:', state.count);
console.log('\n  הפעימות:');
state.list.forEach((i, n) => console.log(`    ${n + 1}. ${i.date}  ₪${i.nis}  @ ${i.sp}  ${i.note}`));
// Reading the /children root is denied by the security rules (as it should be),
// so read only this child's own node — the same path the app itself reads.
let mine = null;
try {
  mine = await p.evaluate(async () => {
    const snap = await db.ref(`${FB_PATH}/investments`).once('value');
    const v = snap.val();
    return v ? Object.keys(v).length : 0;
  });
} catch (e) { mine = 'read failed: ' + e.message.split('\n')[0]; }
console.log('\n=== קריאה ישירה מהמסד (לא דרך ה-UI) ===');
console.log(`  ${state.fbPath}/investments → ${mine} רשומות`);
console.log('\n=== כתיבות שבוצעו במהלך הבדיקה ===');
console.log(writes.length ? writes : '  אפס. קריאה בלבד. ✅');
await b.close();
