const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '/tmp/uva-shots';
require('fs').mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ channel: 'chromium' });
  // ───────── service worker: shows a push notification (delivered via the browser's own push-event hook) ─────────
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.grantPermissions(['notifications'], { origin: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/login');
  await page.fill('input[type=email]', 'demo@example.com'); await page.fill('input[type=password]', 'DemoPass2026!');
  await page.click('button[type=submit]'); await page.waitForURL('**/dashboard'); await page.waitForTimeout(2500);
  const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { has: !!r, scope: r?.scope, active: r?.active?.state }; });
  check('service worker registered and active', swState.has && swState.active === 'activated', JSON.stringify(swState));
  const manifest = await (await ctx.request.get(BASE + '/manifest.webmanifest')).json();
  check('web app manifest valid (standalone, icons incl. maskable, start_url)', manifest.display === 'standalone' && manifest.icons.some((i) => i.purpose === 'maskable') && manifest.start_url.startsWith('/dashboard'));
  for (const icon of manifest.icons) { const r = await ctx.request.get(BASE + icon.src); if (r.status() !== 200) check('icon ' + icon.src, false); }
  check('all manifest icons are served', true);
  const swFile = await ctx.request.get(BASE + '/sw.js');
  check('sw.js served with no-cache and root scope', swFile.status() === 200 && /no-cache/.test(swFile.headers()['cache-control'] || '') && swFile.headers()['service-worker-allowed'] === '/');

  const cdp = await ctx.newCDPSession(page);
  let regId = null;
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { if (e.registrations?.[0]) regId = e.registrations[0].registrationId; });
  await cdp.send('ServiceWorker.enable');
  await page.waitForTimeout(800);
  const payload = { title: 'US VISA WITH ARGISHTI — Reminder', body: 'High priority · Call Karen — Visa Interview Preparation — Mon 2 Nov, 3:00 PM', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: 'task-abc', requireInteraction: true, actions: [{ action: 'open', title: 'Open' }, { action: 'snooze', title: 'Snooze 15 min' }], data: { taskId: 'abc', url: '/tasks?open=abc', priority: 'High' } };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: regId, data: JSON.stringify(payload) });
  await page.waitForTimeout(1200);
  const shown = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); const n = await r.getNotifications(); return n.map((x) => ({ title: x.title, body: x.body, icon: x.icon, tag: x.tag, actions: x.actions?.map((a) => a.action), requireInteraction: x.requireInteraction })); });
  check('a push event displays a notification with company icon, title, task text, priority and Open/Snooze buttons', shown.length === 1 && shown[0].title.includes('US VISA WITH ARGISHTI') && /icon-192/.test(shown[0].icon) && shown[0].body.includes('Call Karen') && shown[0].actions?.join() === 'open,snooze' && shown[0].requireInteraction === true, JSON.stringify(shown[0]).slice(0, 200));

  // ───────── phone layout ─────────
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  await m.goto(BASE + '/login'); await m.waitForTimeout(1800);
  await m.screenshot({ path: (SHOTS + '/m-login.png') });
  await m.fill('input[type=email]', 'demo@example.com'); await m.fill('input[type=password]', 'DemoPass2026!');
  await m.click('button[type=submit]'); await m.waitForURL('**/dashboard'); await m.waitForTimeout(2500);
  const vw = await m.evaluate(() => innerWidth);
  check('phone viewport is 390px wide (no horizontal overflow)', vw === 390, String(vw));
  await m.screenshot({ path: (SHOTS + '/m-dashboard2.png') });
  const nav = await m.locator('nav[aria-label="Primary"]').boundingBox();
  check('mobile bottom navigation is visible at the bottom', nav && nav.y + nav.height > 800, JSON.stringify(nav));
  await m.tap('button[aria-label="Quick add task"]');
  await m.waitForSelector('[role=dialog]'); await m.waitForTimeout(800);
  check('one-tap Quick Add opens from the bottom bar', await m.locator('[role=dialog] >> text=New task').count() > 0);
  await m.screenshot({ path: (SHOTS + '/m-quickadd-ai.png') });
  await m.keyboard.press('Escape'); await m.waitForTimeout(500);
  await m.tap('button[aria-label="More"]'); await m.waitForTimeout(800);
  await m.screenshot({ path: (SHOTS + '/m-more.png') });
  await m.keyboard.press('Escape');
  for (const r of ['calendar', 'clients', 'interviews', 'gmail', 'documents', 'notifications', 'settings']) {
    await m.goto(`${BASE}/${r}`); await m.waitForTimeout(r === 'calendar' ? 3000 : 1800);
    const w = await m.evaluate(() => document.documentElement.scrollWidth);
    check(`/${r} fits the phone screen`, w <= 391, String(w));
    await m.screenshot({ path: `${SHOTS}/m2-${r}.png` });
  }
  // dark mode
  await m.goto(BASE + '/dashboard'); await m.waitForTimeout(1500);
  await m.evaluate(() => { localStorage.setItem('uva-theme', 'dark'); document.documentElement.classList.add('dark'); });
  await m.waitForTimeout(600);
  await m.screenshot({ path: (SHOTS + '/m-dark-dashboard.png') });
  await page.evaluate(() => { localStorage.setItem('uva-theme', 'dark'); document.documentElement.classList.add('dark'); });
  await page.goto(BASE + '/dashboard'); await page.waitForTimeout(2500);
  await page.screenshot({ path: (SHOTS + '/d-dark-dashboard.png'), fullPage: true });
  await page.goto(BASE + '/calendar'); await page.waitForTimeout(3000);
  await page.screenshot({ path: (SHOTS + '/d-dark-calendar.png') });
  console.log('page errors:', errors.length ? errors : 'none');
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
