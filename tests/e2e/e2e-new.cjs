// Browser checks for: DS-160 intake → client profile, Armenian/Russian UI, SMS reminder to a client (Twilio stand-in).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '/tmp/uva-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  // 1) the DS-160 form site posts a submission
  const post = (auth) => fetch(BASE + '/api/intake/ds160', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({
    id: 'e2e-ds160-1', language: 'hy',
    data: { personal: { firstName: 'Arman', lastName: 'Simonyan' }, family: { fatherName: 'Վահե Սիմոնյան', maritalStatus: 'Միայնակ' }, contact: { mobilePhone: '098 94 82 90', email: 'arman.e2e@example.com' }, travel: { arrivalDate: '2027-01-07', duration: '10 օր' } },
  }) });
  check('intake refuses a call without the secret', (await post()).status === 401);
  const r = await post('Bearer ' + process.env.INTAKE_SECRET);
  const body = await r.json();
  check('intake creates the client from the DS-160', r.status === 200 && body.matched === 'created', JSON.stringify(body));
  check('sending the same submission again is ignored', (await (await post('Bearer ' + process.env.INTAKE_SECRET)).json()).duplicate === true);

  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  m.on('pageerror', (e) => errors.push(e.message));
  await m.goto(BASE + '/login');
  await m.fill('input[type=email]', 'demo@example.com'); await m.fill('input[type=password]', 'DemoPass2026!');
  await m.click('button[type=submit]'); await m.waitForURL('**/dashboard'); await m.waitForTimeout(1500);

  // 2) the new client page shows the DS-160 answers
  await m.goto(BASE + '/clients/' + body.clientId); await m.waitForTimeout(1800);
  check('client profile was filled from the DS-160', (await m.locator('h1:has-text("Arman Simonyan")').count()) > 0);
  await m.click('button:has-text("DS-160 answers")'); await m.waitForTimeout(700);
  check('DS-160 answers are readable on the client page', (await m.locator('text=Վահե Սիմոնյան').count()) > 0);
  await m.screenshot({ path: SHOTS + '/m-intake.png' });

  // 3) SMS reminder to the client (consent first, then send) through the Twilio stand-in
  await m.locator('[role=switch][aria-label="SMS reminders"]').first().click(); await m.waitForTimeout(800);
  await m.locator('button:has-text("Send")').first().click(); await m.waitForTimeout(1000);
  await m.locator('[role=tab]:has-text("Own text")').click();
  await m.locator('[role=tab]:has-text("SMS")').click();
  await m.fill('[role=dialog] textarea', 'Բարև Արման, խնդրում ենք ուղարկել անձնագրի պատճենը։');
  await m.locator('[role=dialog] button:has-text("Send now")').click(); await m.waitForTimeout(1500);
  check('SMS to the client was sent and logged', (await m.locator('text=Sent').count()) > 0);
  const log = JSON.parse(fs.readFileSync(process.env.MOCK_LOG, 'utf8'));
  const sms = log.find((l) => l.path.includes('/Messages.json'));
  check('SMS went to the normalised Armenian number', Boolean(sms && sms.body.includes('To=%2B37498948290')), sms ? sms.body.slice(0, 120) : 'none');

  // 4) Armenian and Russian interface
  await ctx.addCookies([{ name: 'uva_lang', value: 'hy', url: BASE }]);
  await m.goto(BASE + '/dashboard'); await m.waitForTimeout(1500);
  check('Armenian menu labels', (await m.locator('nav[aria-label] >> text=Հաճախորդներ').count()) > 0);
  await m.screenshot({ path: SHOTS + '/m-hy-dashboard.png' });
  await ctx.addCookies([{ name: 'uva_lang', value: 'ru', url: BASE }]);
  await m.goto(BASE + '/calendar'); await m.waitForTimeout(2500);
  check('Russian calendar', (await m.locator('text=Сегодня').count()) > 0);
  await ctx.addCookies([{ name: 'uva_lang', value: 'en', url: BASE }]);

  console.log('page errors:', errors.length ? errors : 'none');
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
