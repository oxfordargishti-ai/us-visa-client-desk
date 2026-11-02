// Local stand-ins for api.anthropic.com and Google (OAuth, Gmail, Calendar) so the real code paths can be exercised offline.
const http = require('http');
const fs = require('fs');
const log = [];
const granted = new Set();
const b64u = (s) => Buffer.from(s).toString('base64url');
const PDF = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF';
const idToken = 'h.' + b64u(JSON.stringify({ sub: 'g-123', email: 'info@usvisawithargishti.com', email_verified: true })) + '.s';

const hdr = (id, from, subject, date) => ({ id, threadId: 't-' + id, snippet: '', labelIds: ['INBOX', 'UNREAD'], internalDate: String(date), payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: 'info@usvisawithargishti.com' }, { name: 'Subject', value: subject }] } });
const NOW = Date.now();
const MSGS = {
  '18f3a1b2c3d4e5f1': { ...hdr('18f3a1b2c3d4e5f1', 'Karen Sargsyan <karen.demo@example.com>', 'Documents for my interview', NOW - 3600e3), snippet: 'Hello Argishti, please find my passport scan attached. My interview is on Wednesday — can you confirm what else I need to bring?' },
  '18f3a1b2c3d4e5f2': { ...hdr('18f3a1b2c3d4e5f2', 'U.S. Embassy Notifications <noreply@example.org>', 'Appointment confirmation — action required', NOW - 7200e3), snippet: 'Your appointment is confirmed. Please bring your DS-160 confirmation page. Deadline to reschedule: Friday.' },
  '18f3a1b2c3d4e5f3': { ...hdr('18f3a1b2c3d4e5f3', 'Travel Deals <news@deals.example>', 'Weekend flight offers', NOW - 86400e3), snippet: 'Save 20% on flights this weekend.' },
};
const THREAD = (tid) => {
  const id = tid.replace('t-', '');
  const m = MSGS[id];
  if (!m) return { messages: [] };
  const body = id === '18f3a1b2c3d4e5f1'
    ? 'Hello Argishti,\n\nPlease find my passport scan attached (number AB1234567). My interview is on Wednesday at 10:30 — can you confirm what else I need to bring?\n\nThanks,\nKaren'
    : m.snippet;
  const parts = [{ mimeType: 'text/plain', body: { data: b64u(body), size: body.length } }];
  if (id === '18f3a1b2c3d4e5f1') parts.push({ mimeType: 'application/pdf', filename: 'passport-scan.pdf', body: { attachmentId: 'att-1', size: PDF.length } });
  return { messages: [{ ...m, payload: { ...m.payload, mimeType: 'multipart/mixed', parts } }] };
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    log.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization ? 'bearer' : (req.headers['x-api-key'] ? 'x-api-key' : 'none'), body: raw.slice(0, 4000) });
    fs.writeFileSync((process.env.MOCK_LOG || '/tmp/uva-mock-log.json'), JSON.stringify(log, null, 1));
    const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const p = url.pathname;

    // ───── Twilio (SMS to clients) ─────
    if (/^\/2010-04-01\/Accounts\/[^/]+\/Messages\.json$/.test(p) && req.method === 'POST') {
      const f = Object.fromEntries(new URLSearchParams(raw));
      if (!/^\+\d{8,15}$/.test(f.To || '')) return json({ code: 21211, message: "The 'To' number is not a valid phone number." }, 400);
      return json({ sid: 'SM' + Date.now(), to: f.To, status: 'queued' }, 201);
    }

    // ───── Anthropic ─────
    if (p === '/v1/messages' && req.method === 'POST') {
      const body = JSON.parse(raw);
      const tool = body.tool_choice?.name;
      const text = body.messages?.[0]?.content || '';
      let input;
      if (tool === 'create_task_draft') {
        input = /Karen/.test(text)
          ? { title: 'Call Karen — Visa Interview Preparation', category: 'Interview Preparation', priority: 'Normal', client_name: 'Karen', date_basis: 'tomorrow', date: '2000-01-01', time: '15:00', reminders_minutes_before: [300], missing_information: [], assumptions: [] }
          : { title: text.slice(0, 60), category: 'Administrative Work', priority: 'Normal', client_name: null, date_basis: 'none', reminders_minutes_before: [], missing_information: ['date', 'time'], assumptions: [] };
      } else if (tool === 'suggest_priorities') {
        const ids = [...text.matchAll(/^([0-9a-f-]{36}) \|/gm)].map((m) => m[1]);
        input = { focus_note: 'Start with the interview prep, then clear the overdue payment follow-up.', ordered: ids.map((id, i) => ({ task_id: id, reason: i === 0 ? 'Time-critical and client-facing' : 'Keeps the pipeline moving' })) };
      } else if (tool === 'analyze_email_thread') {
        input = { summary: 'Karen sent her passport scan and asks what else to bring on Wednesday.', requires_action: true, appointment_related: true, document_requests: ['Confirm items to bring'], deadlines: [{ date: null, description: 'Interview on Wednesday 10:30' }], follow_up_tasks: [{ title: 'Reply to Karen with interview-day checklist', category: 'Client Phone Call', due_date: null }], suggested_client_id: null };
      } else return json({ type: 'error', error: { type: 'invalid_request_error', message: 'unknown tool' } }, 400);
      return json({ id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'tool_use', id: 'toolu_mock', name: tool, input }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
    }

    // ───── Google OAuth ─────
    if (p === '/o/oauth2/v2/auth') {
      (url.searchParams.get('scope') || '').split(' ').forEach((x) => granted.add(x));
      const redirect = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      res.writeHead(302, { location: `${redirect}?code=mock-code&state=${encodeURIComponent(state)}` });
      return res.end();
    }
    if (p === '/token' && req.method === 'POST') {
      const f = new URLSearchParams(raw);
      if (f.get('grant_type') === 'authorization_code') {
        const scope = [...granted].join(' ');
        return json({ access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-SECRET-1', scope, id_token: idToken });
      }
      return json({ access_token: 'at-2', expires_in: 3600 });
    }
    if (p === '/revoke') return json({});

    // ───── Gmail ─────
    if (p === '/gmail/v1/users/me/messages' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      let ids = Object.keys(MSGS);
      if (/karen\.demo@example\.com/.test(q)) ids = ['18f3a1b2c3d4e5f1'];
      return json({ messages: ids.map((id) => ({ id, threadId: 't-' + id })) });
    }
    let m = p.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
    if (m && MSGS[m[1]]) return json(MSGS[m[1]]);
    m = p.match(/^\/gmail\/v1\/users\/me\/threads\/([^/]+)$/);
    if (m) return json(THREAD(m[1]));
    if (/\/messages\/18f3a1b2c3d4e5f1\/attachments\/att-1$/.test(p)) return json({ data: b64u(PDF), size: PDF.length });
    if (p === '/gmail/v1/users/me/labels/INBOX') return json({ messagesUnread: 3 });

    // ───── Calendar ─────
    if (/^\/calendar\/v3\/calendars\/[^/]+\/events$/.test(p) && req.method === 'POST') return json({ id: 'gev-' + Math.random().toString(36).slice(2, 8) });
    if (/^\/calendar\/v3\/calendars\/[^/]+\/events\/[^/]+$/.test(p)) { if (req.method === 'DELETE') { res.writeHead(204); return res.end(); } return json({ id: p.split('/').pop() }); }

    json({ error: 'not mocked: ' + p }, 404);
  });
}).listen(4010, '127.0.0.1', () => console.log('mocks on 4010'));
process.on('message', () => {});
