const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'n8n-workflow') return {
    NodeConnectionTypes: { Main: 'main' },
    NodeOperationError: class extends Error { constructor(node, message, options) { super(message); this.options = options; } },
  };
  return originalLoad.call(this, id, ...args);
};
const { WaxumLegacy: Waxum } = require('../dist/nodes/Waxum/WaxumV1.node');
Module._load = originalLoad;
function context(rows, extra = {}) {
  const calls = [];
  return {
    calls,
    getInputData: () => rows.map(json => ({ json })),
    getCredentials: async () => ({ baseUrl: 'https://waxum.example', apiToken: 'PRIVATE-TOKEN' }),
    getNode: () => ({ name: 'Waxum', id: 'TEST-NODE', ...extra.node }),
    getWorkflow: () => ({ id: 'TEST-WORKFLOW' }),
    getExecutionId: () => 'TEST-EXECUTION',
    getNodeParameter: (key, index, fallback) => rows[index][key] ?? fallback,
    continueOnFail: () => extra.continueOnFail === true,
    helpers: { httpRequestWithAuthentication: async function (credential, request) {
      calls.push({ credential, request });
      const sessionId = request.url.split('/sessions/')[1].split('/')[0];
      if (request.url.endsWith('/contacts/check')) return { results: [{ is_registered: true, phone: request.body.phones[0] }] };
      if (request.url.endsWith('/messages/text')) return { status: 'sent', message_id: 'ID-' + request.body.to };
      return { id: sessionId, status: 'logged_in', is_logged_in: true };
    } },
  };
}
const first = { sessionId: 'one', to: '5511987654321', text: 'Item um' };
test('variáveis por item mantêm instância, destinatário, texto e vínculo corretos', async () => {
  const second = { sessionId: 'two', to: '5547987654321', text: 'Item dois\ncom quebra' };
  const ctx = context([first, second]); const [out] = await new Waxum().execute.call(ctx);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(x => x.pairedItem.item), [0, 1]);
  assert.deepEqual(out.map(x => x.json.data.message.conversation), [first.text, second.text]);
  assert.deepEqual(out.map(x => x.json.waxum.sessionId), ['one', 'two']);
  assert.deepEqual(ctx.calls.filter(x => x.request.url.endsWith('/messages/text')).map(x => x.request.body.to), [first.to, second.to]);
  for (const c of ctx.calls) {
    assert.equal(c.credential, 'waxumApi'); assert.equal(c.request.disableFollowRedirect, true);
    assert.ok(!JSON.stringify(c.request).includes('PRIVATE-TOKEN'));
  }
});
test('continuar após erro preserva erro do item e processa o próximo corretamente', async () => {
  const ctx = context([{ ...first, to: 'invalid' }, first], { continueOnFail: true });
  const [out] = await new Waxum().execute.call(ctx);
  assert.equal(out[0].json.code, 'INVALID_RECIPIENT'); assert.equal(out[0].pairedItem.item, 0);
  assert.equal(out[1].json.accepted, true); assert.equal(out[1].pairedItem.item, 1);
  assert.equal(ctx.calls.length, 3);
});
test('erro padrão interrompe antes de processar o próximo item', async () => {
  const ctx = context([{ ...first, to: 'invalid' }, first]);
  await assert.rejects(new Waxum().execute.call(ctx), e => e.options.itemIndex === 0);
  assert.equal(ctx.calls.length, 0);
});
test('retry do próprio n8n é bloqueado antes de qualquer HTTP', async () => {
  const ctx = context([first], { node: { retryOnFail: true } });
  await assert.rejects(new Waxum().execute.call(ctx), /Retry On Fail/); assert.equal(ctx.calls.length, 0);
});
test('nó tem somente três campos principais obrigatórios', () => {
  assert.deepEqual(new Waxum().description.properties.filter(x => x.required && !x.displayOptions?.show).map(x => x.name), ['sessionId', 'to', 'text']);
});
test('variável sem conteúdo não envia a palavra undefined', async () => {
  const ctx = context([{ ...first, text: undefined }]);
  await assert.rejects(new Waxum().execute.call(ctx), /Enter a message/);
  assert.equal(ctx.calls.length, 0);
});
test('saída de erro sinaliza o item para o roteador nativo do n8n', async () => {
  const ctx = context([{ ...first, to: 'invalid' }, first], { continueOnFail: true, node: { onError: 'continueErrorOutput' } });
  const [out] = await new Waxum().execute.call(ctx);
  assert.ok(out[0].error instanceof Error); assert.equal(out[0].json.code, 'INVALID_RECIPIENT');
  assert.equal(out[1].error, undefined); assert.equal(out[1].json.accepted, true);
  assert.deepEqual(out.map(x => x.pairedItem.item), [0, 1]);
});
test('metadados de origem são preservados para auditoria dos fluxos', async () => {
  const ctx = context([first]); const [[out]] = await new Waxum().execute.call(ctx);
  assert.equal(out.json.waxum.sourceWorkflowId, 'TEST-WORKFLOW');
  assert.equal(out.json.waxum.sourceExecutionId, 'TEST-EXECUTION');
  assert.equal(out.json.waxum.sourceNodeId, 'TEST-NODE');
});
