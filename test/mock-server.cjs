// Test fixture only. Binds to the isolated container's loopback and never calls WhatsApp.
const http = require('node:http');
const fs = require('node:fs');
const counts = { sessionChecks: 0, recipientChecks: 0, sendAttempts: 0, accepted: 0, realWhatsAppMessagesSent: 0 };
const ledger = '/home/node/.n8n/waxum-mock-ledger.json';
function save() { fs.writeFileSync(ledger, JSON.stringify(counts)); }
http.createServer(async (req, res) => {
  const reply = (status, body) => { save(); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== 'Bearer MOCK-TOKEN-NOT-A-REAL-CREDENTIAL') return reply(401, { error: 'mock authentication failed' });
  let raw = ''; for await (const chunk of req) raw += chunk;
  let body = {}; try { body = JSON.parse(raw || '{}'); } catch { return reply(400, { error: 'invalid json' }); }
  const match = req.url.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]+)(.*)$/);
  if (!match) return reply(404, {});
  const [, id, path] = match;
  if (req.method === 'GET' && !path) {
    counts.sessionChecks++;
    return reply(200, { id, status: 'logged_in', is_logged_in: true, phone_number: '12025550101' });
  }
  if (req.method === 'POST' && path === '/contacts/check') {
    counts.recipientChecks++;
    return reply(200, { results: body.phones.map(phone => ({ phone, jid: phone + '@s.whatsapp.net', is_registered: true })) });
  }
  if (req.method === 'POST' && ['/messages/text', '/messages/document'].includes(path)) {
    counts.sendAttempts++;
    if (body.text === 'SIMULAR_FALHA_HTTP') return reply(503, { error: 'mock failure, not a real WhatsApp send' });
    counts.accepted++;
    return reply(200, { status: 'sent', message_id: 'MOCK-' + counts.sendAttempts, to: body.to, timestamp: Math.floor(Date.now() / 1000) });
  }
  return reply(404, {});
}).listen(3469, '127.0.0.1', save);
