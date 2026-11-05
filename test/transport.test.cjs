const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendText, recipient, apiBase } = require('../dist/nodes/Waxum/transport');
const sessionId = 'minha-instancia';
const input = { sessionId, to: '5547999999999', text: 'Olá\nMensagem com {{ variável }} e acentos.' };
function fake(overrides = {}) {
  const calls = [];
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.endsWith('/contacts/check')) return overrides.lookup ?? { results: [{ is_registered: true, jid: '554799999999@s.whatsapp.net' }] };
    if (path.endsWith('/messages/text') || path.endsWith('/messages/document')) {
      if (overrides.sendError) throw new Error('network timeout with sensitive upstream body');
      return overrides.response ?? { status: 'sent', message_id: 'TEST-123', timestamp: 12345, to: '123@lid' };
    }
    return overrides.session ?? { id: sessionId, status: 'logged_in', is_logged_in: true, phone_number: '12025550101' };
  };
  return { calls, request };
}
test('envio preserva texto, telefone solicitado e formato de saída anterior', async () => {
  const f = fake(); const result = await sendText(input, f.request);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls[2].body, { to: '554799999999', text: input.text, link_preview: false });
  assert.equal(result.data.key.remoteJid, input.to + '@s.whatsapp.net');
  assert.equal(result.data.waxum.to, '123@lid');
  assert.equal(result.accepted, true); assert.equal(result.deliveryStatus, 'unconfirmed');
});
test('prévia confere API mas não chama nenhum endpoint de mensagem', async () => {
  const f = fake(); const result = await sendText({ ...input, options: { validationOnly: true } }, f.request);
  assert.equal(result.messagesSent, 0); assert.equal(result.dryRun, true);
  assert.equal(f.calls.length, 2); assert.ok(f.calls.every(c => !c.path.includes('/messages/')));
});
test('grupos preservam o JID e dispensam consulta de telefone', async () => {
  const f = fake(); await sendText({ ...input, to: '120363123456789@g.us' }, f.request);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.to, '120363123456789@g.us');
});
test('sessão desconectada bloqueia antes da consulta e do envio', async () => {
  const f = fake({ session: { id: sessionId, status: 'disconnected', is_logged_in: false } });
  await assert.rejects(sendText(input, f.request), { code: 'SESSION_DISCONNECTED' }); assert.equal(f.calls.length, 1);
});
test('instância com outro telefone conectado bloqueia envio', async () => {
  const f = fake(); await assert.rejects(sendText({ ...input, options: { expectedSenderPhone: '5511988887777' } }, f.request), { code: 'SENDER_MISMATCH' }); assert.equal(f.calls.length, 1);
});
test('destinatário diferente do consultado bloqueia envio', async () => {
  const f = fake({ lookup: { results: [{ is_registered: true, jid: '551188888888@s.whatsapp.net' }] } });
  await assert.rejects(sendText(input, f.request), { code: 'RECIPIENT_MISMATCH' }); assert.equal(f.calls.length, 2);
});
test('destinatário não registrado bloqueia envio', async () => {
  const f = fake({ lookup: { results: [{ is_registered: false }] } });
  await assert.rejects(sendText(input, f.request), { code: 'RECIPIENT_UNREGISTERED' }); assert.equal(f.calls.length, 2);
});
test('resposta de envio perdida não provoca retry nem expõe detalhes sensíveis', async () => {
  const f = fake({ sendError: true });
  await assert.rejects(sendText(input, f.request), e => e.code === 'SEND_UNCERTAIN' && e.uncertain && !e.message.includes('sensitive'));
  assert.equal(f.calls.filter(c => c.path.endsWith('/messages/text')).length, 1);
});
test('resposta sem identificador não é considerada aceite', async () => {
  const f = fake({ response: { status: 'sent' } });
  await assert.rejects(sendText(input, f.request), { code: 'SEND_UNCONFIRMED' }); assert.equal(f.calls.length, 3);
});
test('intervalo opcional ocorre antes de um único envio', async () => {
  const f = fake(); let waited = 0;
  await sendText({ ...input, options: { delayMs: 1200 } }, f.request, async ms => { waited = ms; assert.equal(f.calls.length, 2); });
  assert.equal(waited, 1200); assert.equal(f.calls.length, 3);
});
test('entradas inválidas falham sem HTTP', async () => {
  for (const changed of [{ sessionId: '../invalid' }, { to: '123@lid' }, { to: '123' }, { text: '  ' }, { options: { delayMs: -1 } }]) {
    const f = fake(); await assert.rejects(sendText({ ...input, ...changed }, f.request)); assert.equal(f.calls.length, 0);
  }
});
test('telefone formatado e sufixos públicos são normalizados', () => {
  assert.equal(recipient('+55 (47) 99999-9999').to, input.to);
  assert.equal(recipient(input.to + '@c.us').to, input.to);
  assert.equal(recipient(input.to + '@s.whatsapp.net').to, input.to);
  assert.throws(() => recipient('https://host/5547999999999'));
});
test('URL protege token contra destinos sem HTTPS e credenciais na URL', () => {
  assert.equal(apiBase('https://waxum.example/api/v1/'), 'https://waxum.example/api/v1');
  assert.equal(apiBase('http://127.0.0.1:3451'), 'http://127.0.0.1:3451/api/v1');
  for (const url of ['http://waxum.example', 'https://user:pass@waxum.example', 'https://waxum.example/other', 'https://waxum.example?token=abc']) assert.throws(() => apiBase(url));
});
test('documento mantém URL, nome e legenda e usa o endpoint correto', async () => {
  const f = fake(); const result = await sendText({ ...input, text: '', operation: 'document', media: 'https://files.example/proposta.pdf', fileName: 'Proposta Comercial.pdf', caption: 'Olá\nSua proposta.' }, f.request);
  assert.ok(f.calls[2].path.endsWith('/messages/document'));
  assert.deepEqual(f.calls[2].body, { to: '554799999999', document: { url: 'https://files.example/proposta.pdf' }, filename: 'Proposta Comercial.pdf', caption: 'Olá\nSua proposta.' });
  assert.deepEqual(result.data.message, { documentMessage: { fileName: 'Proposta Comercial.pdf', caption: 'Olá\nSua proposta.' } });
});
test('consulta positiva retorna compatibilidade sem enviar mensagens', async () => {
  const f = fake(); const result = await sendText({ ...input, text: '', operation: 'check' }, f.request);
  assert.deepEqual(result.data, [{ exists: true, jid: '554799999999@s.whatsapp.net', number: input.to }]);
  assert.equal(f.calls.length, 2);
});
test('consulta negativa é um resultado válido e não um erro de envio', async () => {
  const f = fake({ lookup: { results: [{ is_registered: false }] } });
  const result = await sendText({ ...input, text: '', operation: 'check' }, f.request);
  assert.equal(result.data[0].exists, false); assert.equal(f.calls.length, 2);
});
test('prévia de documento não envia arquivo', async () => {
  const f = fake(); const result = await sendText({ ...input, text: '', operation: 'document', media: 'https://files.example/doc.pdf', options: { validationOnly: true } }, f.request);
  assert.equal(result.messagesSent, 0); assert.equal(result.preview.media, 'https://files.example/doc.pdf'); assert.equal(f.calls.length, 2);
});
test('documentos inválidos e consulta de grupo são bloqueados sem HTTP', async () => {
  for (const changed of [{ operation: 'document', media: 'file:///etc/passwd' }, { operation: 'check', to: '120363123456789@g.us' }, { operation: 'invalid' }]) {
    const f = fake(); await assert.rejects(sendText({ ...input, ...changed }, f.request)); assert.equal(f.calls.length, 0);
  }
});
