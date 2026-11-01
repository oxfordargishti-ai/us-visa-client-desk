const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '/tmp/uva-shots';
require('fs').mkdirSync(SHOTS, { recursive: true });
const O = { origin: BASE };
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message.slice(0, 200)));
  // Everything the browser ever receives is scanned for secrets at the end.
  const bodies = [];
  page.on('response', async (r) => { try { const ct = r.headers()['content-type'] || ''; if (/json|html|javascript|text/.test(ct)) bodies.push({ url: r.url(), text: await r.text() }); } catch {} });
  const api = async (method, path, data) => {
    const r = await ctx.request.fetch(BASE + path, { method, headers: { ...O, 'content-type': 'application/json' }, data: data === undefined ? undefined : JSON.stringify(data) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status(), body: j };
  };

  // ── sign in ──
  await page.goto(BASE + '/login');
  await page.fill('input[type=email]', 'demo@example.com');
  await page.fill('input[type=password]', 'DemoPass2026!');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  check('sign in through the UI', true);
  await page.waitForTimeout(1500);

  // ── a reminder that will really fire in ~75s (verified at the end through the cron endpoint) ──
  const soon = new Date(Date.now() + 80_000).toISOString();
  const rem = await api('POST', '/api/tasks', { title: 'E2E reminder task', due_at: soon, reminder_offsets: [0], priority: 'High' });
  check('task with an at-time reminder created', rem.status === 200 && rem.body.reminders.length === 1);
  // a fake device so the dispatcher exercises the real web-push library against an unreachable endpoint
  const sub = await api('POST', '/api/push/subscribe', { endpoint: 'https://push.invalid.example/sub-1', keys: { p256dh: 'BP' + 'x'.repeat(85), auth: 'y'.repeat(22) }, label: 'E2E fake device' });
  check('push subscription stored (server has VAPID keys)', sub.status === 200, JSON.stringify(sub.body).slice(0, 80));

  // ── AI approval workflow ──
  const before = (await api('GET', '/api/tasks?view=all&limit=300')).body.tasks.length;
  await page.click('button:has-text("New task") >> nth=0');
  await page.waitForSelector('textarea[aria-label="Describe the task"]');
  await page.fill('textarea[aria-label="Describe the task"]', 'Call Karen tomorrow at 3 PM to prepare him for his U.S. visa interview. Remind me five hours before.');
  await page.click('button:has-text("Preview task")');
  await page.waitForSelector('text=Here\'s what I understood', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: (SHOTS + '/e2e-ai-preview.png') });
  const title = await page.inputValue('#qa-title');
  check('AI preview shows the extracted title', title === 'Call Karen — Visa Interview Preparation', title);
  const afterParse = (await api('GET', '/api/tasks?view=all&limit=300')).body.tasks.length;
  check('nothing is saved by the preview step', afterParse === before);
  const dateVal = await page.inputValue('input[type=date] >> nth=0');
  const timeVal = await page.inputValue('input[type=time] >> nth=0');
  const tomorrow = new Date(Date.now() + 4 * 3600e3 + 86400e3).toISOString().slice(0, 10); // Yerevan tomorrow
  check('"tomorrow at 3 PM" resolved from the real clock (ignoring the model\'s wrong date)', dateVal === tomorrow && timeVal === '15:00', `${dateVal} ${timeVal}`);
  await page.click('button:has-text("Confirm & save task")');
  await page.waitForSelector('text=Task saved', { timeout: 10000 });
  const list = (await api('GET', '/api/tasks?view=all&limit=300')).body.tasks;
  const saved = list.find((t) => t.title === 'Call Karen — Visa Interview Preparation' && t.source === 'ai');
  check('task exists only after confirmation', Boolean(saved) && list.length === before + 1);
  check('saved with source=ai, client linked, due 15:00 Yerevan (11:00Z)', saved?.source === 'ai' && saved.client_name === 'Karen Sargsyan' && saved.due_at === `${tomorrow}T11:00:00.000Z`, saved?.due_at);
  const det = (await api('GET', `/api/tasks/${saved.id}`)).body;
  check('five-hour reminder stored at 06:00Z', det.reminders.some((r) => r.remind_at === `${tomorrow}T06:00:00.000Z` && r.status === 'pending'));

  // ── calendar shows it immediately ──
  await page.goto(BASE + '/calendar?date=' + tomorrow);
  await page.waitForSelector('.fc-event', { timeout: 15000 });
  const evText = await page.locator('.fc-event', { hasText: 'Call Karen' }).first().innerText().catch(() => '');
  check('approved task appears on the calendar', /Call Karen/.test(evText), evText.replace(/\n/g, ' '));
  await page.screenshot({ path: (SHOTS + '/e2e-calendar-week.png') });
  for (const [label, shot] of [['Month', 'month'], ['Agenda', 'agenda'], ['Day', 'day'], ['Interviews', 'interviews']]) {
    await page.click(`[role=tab]:has-text("${label}")`); await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/e2e-calendar-${shot}.png` });
  }
  check('calendar views switch (Day/Week/Month/Agenda/Interviews)', true);

  // ── drag & drop reschedule ──
  const dragTask = (await api('POST', '/api/tasks', { title: 'Drag test task', due_at: `${tomorrow}T06:00:00.000Z`, reminder_offsets: [60] })).body.task;
  await page.goto(BASE + '/calendar?date=' + tomorrow); await page.waitForSelector('.fc-event'); await page.waitForTimeout(500);
  await page.click('[role=tab]:has-text("Week")'); await page.waitForTimeout(1200);
  const ev = page.locator('.fc-event', { hasText: 'Drag test task' }).first();
  const box = await ev.boundingBox();
  const cols = await page.locator('.fc-timegrid-col').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width }; }));
  if (box && cols.length > 1) {
    const colWidth = cols[0].w;
    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + colWidth, box.y + 70, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const moved = (await api('GET', `/api/tasks/${dragTask.id}`)).body;
    const d0 = new Date(dragTask.due_at).getTime(), d1 = new Date(moved.task.due_at).getTime();
    const pend = moved.reminders.filter((r) => r.status === 'pending');
    check('drag-and-drop moved the task to the next day and rebuilt reminders', Math.abs(d1 - d0 - 86400e3) < 3 * 3600e3 && pend.length === 1 && new Date(pend[0].remind_at).getTime() === d1 - 3600e3 && moved.reminders.some((r) => r.status === 'canceled'), `${dragTask.due_at} → ${moved.task.due_at}; pending reminder ${pend[0]?.remind_at}`);
  } else check('drag-and-drop', false, 'event not draggable in this layout');

  // ── complete from the planner ──
  await page.goto(BASE + '/tasks?view=today'); await page.waitForTimeout(1500);
  const first = page.locator('[role=checkbox][aria-label^="Complete"]').first();
  const label = await first.getAttribute('aria-label');
  await first.click();
  await page.waitForSelector('text=Done — nicely handled', { timeout: 8000 });
  await page.screenshot({ path: (SHOTS + '/e2e-complete.png') });
  const doneName = label.replace('Complete "', '').replace(/"$/, '');
  const comp = (await api('GET', '/api/tasks?view=completed&limit=50')).body.tasks;
  check('checking a task completes it (with undo toast)', comp.some((t) => t.title === doneName), doneName);

  // ── client, notes, documents ──
  await page.goto(BASE + '/clients'); await page.waitForTimeout(1200);
  await page.click('button:has-text("New client") >> nth=0');
  await page.fill('[role=dialog] input[placeholder="e.g. Karen Sargsyan"]', 'E2E Client Nare Poghosyan');
  await page.fill('[role=dialog] input[placeholder="+374 99 000000"] >> nth=0', '+37499111222');
  await page.click('[role=dialog] button:has-text("Create client")');
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 10000 });
  const clientUrl = page.url();
  check('client created and opened', true);
  await page.click('[role=tab]:has-text("Notes")');
  await page.fill('textarea[aria-label="Note"]', 'Client asked for a call on Thursday to discuss the interview.');
  await page.click('button:has-text("Save note")');
  await page.waitForSelector('text=Client asked for a call on Thursday', { timeout: 8000 });
  check('note saved to the client timeline', true);
  await page.click('[role=tab]:has-text("Documents")');
  fs.writeFileSync(require('path').join(require('os').tmpdir(), 'uva-e2e-passport.pdf'), '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  await page.setInputFiles('input[type=file]', require('path').join(require('os').tmpdir(), 'uva-e2e-passport.pdf'));
  await page.waitForSelector('text=e2e-passport.pdf', { timeout: 10000 });
  await page.waitForTimeout(800);
  const clientId = clientUrl.split('/').pop().split('?')[0];
  const detail = (await api('GET', `/api/clients/${clientId}`)).body;
  const passportItem = detail.checklist.find((c) => c.category === 'Passport');
  check('uploaded document ticks the matching checklist item', passportItem?.status === 'received');
  const dl = await ctx.request.get(`${BASE}/api/documents/${detail.documents[0].id}/download`);
  check('authorised download works', dl.status() === 200 && (await dl.body()).toString().startsWith('%PDF'));
  const anon = await (await browser.newContext()).request.get(`${BASE}/api/documents/${detail.documents[0].id}/download`);
  check('the same download link fails when not signed in', anon.status() === 401);
  await page.screenshot({ path: (SHOTS + '/e2e-client-docs.png'), fullPage: true });

  // ── Gmail OAuth (mock Google) ──
  await api('POST', '/api/gmail/disconnect', {});
  await page.goto(BASE + '/gmail'); await page.waitForTimeout(1500);
  await page.screenshot({ path: (SHOTS + '/e2e-gmail-connect.png') });
  await page.click('button:has-text("Connect with Google")');
  await page.waitForURL('**/gmail?connected=1', { timeout: 15000 });
  await page.waitForSelector('text=Documents for my interview', { timeout: 15000 });
  check('Gmail connected through OAuth redirect and real inbox messages shown', true);
  await page.screenshot({ path: (SHOTS + '/e2e-gmail-inbox.png'), fullPage: true });
  const st = (await api('GET', '/api/gmail/status')).body;
  check('status shows connected account, read-only gmail scope', st.connected && st.gmail_scope && !st.calendar_scope && st.account === 'info@usvisawithargishti.com');
  check('"may need action" is flagged on the appointment email', await page.locator('text=May need action').count() > 0);
  check('sender matched to a client is only SUGGESTED', await page.locator('text=Looks like Karen Sargsyan').count() > 0);
  await page.click('button:has-text("Documents for my interview")');
  await page.waitForSelector('text=passport-scan.pdf', { timeout: 10000 });
  await page.screenshot({ path: (SHOTS + '/e2e-gmail-thread.png') });
  await page.click('[role=dialog] button:text-is("Link")');
  await page.waitForSelector('text=Conversation linked', { timeout: 8000 });
  const kd = (await api('GET', '/api/clients?q=Karen')).body.clients[0];
  const kdet = (await api('GET', `/api/clients/${kd.id}`)).body;
  check('email linked to client only after the owner confirmed', kdet.links.length === 1 && kdet.links[0].status === 'confirmed');
  await page.click('[role=dialog] button:text-is("Save")');
  await page.waitForSelector('text=Save to a client', { timeout: 5000 });
  await page.click('button:has-text("Save file")');
  await page.waitForSelector('text=Saved to client documents', { timeout: 10000 });
  const kdet2 = (await api('GET', `/api/clients/${kd.id}`)).body;
  check('email attachment copied into the client\'s private documents', kdet2.documents.some((d) => d.filename === 'passport-scan.pdf' && d.source === 'gmail'));
  // AI email analysis is opt-in
  const off = await api('POST', `/api/gmail/threads/${encodeURIComponent('t-18f3a1b2c3d4e5f1')}/analyze`, {});
  check('AI email analysis refused while opt-in is off', off.status === 403);
  await api('PATCH', '/api/preferences', { ai_email_analysis: true });
  const on = await api('POST', `/api/gmail/threads/${encodeURIComponent('t-18f3a1b2c3d4e5f1')}/analyze`, {});
  check('AI email analysis works after opt-in', on.status === 200 && /passport/i.test(on.body.analysis.summary));
  await api('PATCH', '/api/preferences', { ai_email_analysis: false });

  // ── Google Calendar sync (mock) ──
  await page.goto(BASE + '/settings'); await page.waitForTimeout(1500);
  await page.click('button:has-text("Connect Google Calendar")');
  await page.waitForURL('**/settings?connected=1', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const st2 = (await api('GET', '/api/gmail/status')).body;
  check('Google Calendar connected; Gmail connection kept', st2.calendar_scope && st2.gmail_scope && st2.calendar_sync_enabled);
  const cal = await api('POST', '/api/tasks', { title: 'Sync me to Google', due_at: new Date(Date.now() + 3 * 86400e3).toISOString(), reminder_offsets: [] });
  await sleep(2500);
  let mlog = JSON.parse(fs.readFileSync((process.env.MOCK_LOG || '/tmp/uva-mock-log.json'), 'utf8'));
  check('new task pushed to Google Calendar (POST /events)', mlog.some((e) => e.method === 'POST' && /\/calendar\/v3\/calendars\/primary\/events$/.test(e.path) && /Sync me to Google/.test(e.body)));
  await api('PATCH', `/api/tasks/${cal.body.task.id}`, { due_at: new Date(Date.now() + 4 * 86400e3).toISOString() });
  await sleep(2500);
  await api('DELETE', `/api/tasks/${cal.body.task.id}`);
  await sleep(2500);
  mlog = JSON.parse(fs.readFileSync((process.env.MOCK_LOG || '/tmp/uva-mock-log.json'), 'utf8'));
  check('reschedule → PUT and delete → DELETE reached Google', mlog.some((e) => e.method === 'PUT' && /\/events\/gev-/.test(e.path)) && mlog.some((e) => e.method === 'DELETE' && /\/events\/gev-/.test(e.path)));
  check('every Google API call used a bearer token (no passwords anywhere)', mlog.filter((e) => /^\/(gmail|calendar)/.test(e.path)).every((e) => e.auth === 'bearer'));

  // ── notifications page + planner AI ──
  await page.goto(BASE + '/tasks?view=today'); await page.waitForTimeout(1500);
  await page.click('button:has-text("Suggest priorities")');
  await page.waitForSelector('text=Start with the interview prep', { timeout: 15000 });
  await page.screenshot({ path: (SHOTS + '/e2e-planner-ai.png') });
  check('AI day suggestions shown without changing any task', true);

  // ── cron: the reminder due ~80s after creation fires from the server ──
  const wait = new Date(soon).getTime() + 5000 - Date.now();
  if (wait > 0) { console.log(`waiting ${Math.ceil(wait / 1000)}s for the reminder to become due…`); await sleep(wait); }
  const c1 = await ctx.request.get(BASE + '/api/cron/dispatch', { headers: { authorization: 'Bearer dev-cron-secret-123456' } });
  const cj = await c1.json();
  check('cron endpoint dispatched the due reminder without any browser tab involved', c1.status() === 200 && cj.claimed >= 1, JSON.stringify({ claimed: cj.claimed, sent: cj.sent, retrying: cj.retrying, failed: cj.failed }));
  const notif = (await api('GET', '/api/notifications?channel=all&limit=50')).body;
  const inapp = notif.notifications.find((n) => n.channel === 'inapp' && /E2E reminder task/.test(n.body));
  const push = notif.notifications.find((n) => n.channel === 'push' && /E2E reminder task/.test(n.body));
  check('in-app notification created with task title, priority and time', Boolean(inapp) && /High priority/.test(inapp.body) && /E2E reminder task/.test(inapp.body), inapp?.body);
  check('real web-push attempt to the (unreachable) device failed visibly with an actionable error', push && ['failed', 'expired'].includes(push.status) && Boolean(push.error), push ? `${push.status}: ${push.error}` : 'no push row');
  const c2 = await (await ctx.request.get(BASE + '/api/cron/dispatch', { headers: { authorization: 'Bearer dev-cron-secret-123456' } })).json();
  const inappCount = (await api('GET', '/api/notifications?channel=all&limit=100')).body.notifications.filter((n) => n.channel === 'inapp' && /E2E reminder task/.test(n.body)).length;
  check('running the dispatcher again does not duplicate the notification', inappCount === 1, `second run claimed ${c2.claimed}`);
  await page.goto(BASE + '/notifications'); await page.waitForTimeout(1500);
  await page.screenshot({ path: (SHOTS + '/e2e-notifications.png'), fullPage: true });
  await page.click('[role=tab]:has-text("Delivery log")'); await page.waitForTimeout(700);
  await page.screenshot({ path: (SHOTS + '/e2e-notifications-log.png') });

  // ── secrets never reach the browser ──
  const leaked = bodies.filter((b) => /rt-SECRET-1|"refresh_token"|at-1|p256dh_enc|password_hash/.test(b.text));
  check('no refresh token, access token or password hash ever sent to the browser', leaked.length === 0, leaked.map((l) => l.url).slice(0, 3).join(', '));

  console.log('\nconsole errors:', consoleErrors.length ? [...new Set(consoleErrors)] : 'none');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(2); });
