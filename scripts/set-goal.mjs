// One-off: move the iPhone goal into Yuval's tank, using the app's own edit modal.
// This is the ONLY write this session makes. It touches goal and nothing else.
import { chromium } from 'playwright';
const BASE = 'https://shaitura.github.io/Yuvalinvest/';
const b = await chromium.launch();
const ctx = await b.newContext();

// Two independent monitors, because they catch different things:
const httpHits = [];   // HTTP verbs — what my earlier "read-only" guard watched
const wsFrames = [];   // WebSocket frames — how the Firebase SDK ACTUALLY writes
ctx.on('request', r => {
  if (r.url().includes('firebasedatabase.app') && ['PUT','POST','PATCH','DELETE'].includes(r.method()))
    httpHits.push(`${r.method()} ${r.url().slice(0,70)}`);
});

const p = await ctx.newPage();
p.on('websocket', ws => {
  if (!ws.url().includes('firebasedatabase.app')) return;
  ws.on('framesent', f => {
    const s = String(f.payload);
    if (/"a"\s*:\s*"(p|m|s)"/.test(s)) wsFrames.push('WRITE ' + s.slice(0, 220));  // p=put, m=merge
  });
});

await p.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(5000);

const before = await p.evaluate(() => ({
  child: childKey, goal: goal ? `${goal.name} ₪${goal.amount} ${goal.emoji}` : null,
  beats: (investments || []).length,
  list: (investments || []).map(i => `${i.date} ₪${i.amountNIS}`),
}));
console.log('=== לפני ===');
console.log('  תיק:', 'children/' + before.child, ' יעד:', before.goal, ' פעימות:', before.beats);

// --- edit through the real UI: open the modal, type, press save ---
await p.evaluate(() => openGoalModal());
await p.waitForTimeout(400);
await p.fill('#goalNameInput', 'אייפון');
await p.fill('#goalAmountInput', '1305');
await p.fill('#goalEmojiInput', '📱');
await p.click('button.btn-save[onclick="saveGoalModal()"]');
await p.waitForTimeout(4000);

// --- reload from scratch and confirm it stuck ---
const p2 = await ctx.newPage();
await p2.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await p2.waitForTimeout(5000);
const after = await p2.evaluate(() => ({
  child: childKey, goal: goal ? `${goal.name} ₪${goal.amount} ${goal.emoji}` : null,
  beats: (investments || []).length,
  list: (investments || []).map(i => `${i.date} ₪${i.amountNIS}`),
  goalCard: document.querySelector('.goal-card')?.innerText?.replace(/\s+/g,' ').slice(0,120),
}));
console.log('\n=== אחרי (טעינה מחדש נקייה) ===');
console.log('  תיק:', 'children/' + after.child, ' יעד:', after.goal, ' פעימות:', after.beats);
console.log('  כרטיס היעד:', after.goalCard);

// --- the old tank must be untouched ---
const p3 = await ctx.newPage();
await p3.goto(BASE + '?child=default', { waitUntil: 'networkidle', timeout: 60000 });
await p3.waitForTimeout(4000);
const def = await p3.evaluate(() => goal ? `${goal.name} ₪${goal.amount}` : null);
console.log('\n=== children/default (הגיבוי) ===');
console.log('  יעד:', def);

console.log('\n=== מה כל מוניטור תפס ===');
console.log('  HTTP PUT/POST/PATCH/DELETE :', httpHits.length ? httpHits : 'כלום');
console.log('  WebSocket write frames     :', wsFrames.length ? wsFrames : 'כלום');

const beatsIntact = after.beats === 4 && JSON.stringify(after.list) === JSON.stringify(before.list);
const ok = after.goal?.includes('אייפון') && after.goal?.includes('1305') && beatsIntact && def?.includes('אייפון');
console.log('\n  הפעימות ללא שינוי:', beatsIntact ? 'כן ✅' : 'לא ❌');
console.log('RESULT:', ok ? 'PASS' : 'FAIL');
await b.close(); process.exit(ok ? 0 : 1);
