const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === 'n8n-workflow') return {NodeConnectionTypes: {Main: 'main'},
    NodeOperationError: class extends Error { constructor(node, message) { super(message); } }};
  return load.call(this, id, ...args);
};
const { WaxumV5 } = require('../dist/nodes/Waxum/WaxumV5');
const { actions } = require('../dist/nodes/Waxum/catalog.generated');
Module._load = load;
const node = new WaxumV5();

function context(values, provider, typeVersion = 5, response = {acknowledged: true}) {
  const calls = [];
  return {
    calls, getNodeParameter: (name, index, fallback) => values[name] ?? fallback,
    getCredentials: async type => {
      assert.equal(type, 'waxumApi');
      return {baseUrl: 'https://waxum.example'};
    },
    getInputData: () => [{json: {}}], continueOnFail: () => false,
    getNode: () => ({id: 'test', typeVersion}), getWorkflow: () => ({id: 'test'}), getExecutionId: () => 'test',
    helpers: {
      assertBinaryData: () => ({fileName: 'teste.png', mimeType: 'image/png'}),
      getBinaryDataBuffer: async () => Buffer.from('mock'),
      prepareBinaryData: async () => ({data: 'mock'}),
      httpRequestWithAuthentication: async (type, request) => {
        assert.equal(type, 'waxumApi');
        calls.push(request);
        if (request.method === 'GET' && request.url.endsWith('/sessions/session-demo')) return {id: 'session-demo', provider};
        if (request.url.endsWith('/contacts/check') && values.operation !== 'contacts/check') {
          const [phone] = request.body.phones;
          const canonical = phone === '5547999990000' ? '554799990000' : phone;
          return {results: [{is_registered: true, jid: canonical + '@s.whatsapp.net'}]};
        }
        return request.encoding === 'arraybuffer'
          ? {body: Buffer.from('mock'), headers: {'content-type': 'application/zip'}}
          : response;
      },
    },
  };
}
function valueFor(field, action) {
  if (field.name === 'to' && ['send/buttons', 'send/quick-reply'].includes(action)) return '551188880000';
  if (field.type === 'file') return 'data';
  if (field.type === 'select') return field.options[0];
  if (field.type === 'checkbox') return false;
  if (field.type === 'number') return 1;
  if (field.name === 'buttons' && ['send/buttons', 'send/quick-reply'].includes(action)) {
    return [{button_id: 'sim', display_text: 'Sim'}];
  }
  if (field.type === 'json') return {sample: true};
  return field.in_path ? 'item@example' : 'sample';
}

test('todas as ações do painel aparecem no canal correto e constroem a requisição correspondente', async () => {
  assert.equal(actions.length, 246);
  assert.equal(new Set(actions.map(action => action.id)).size, actions.length);
  for (const action of actions) {
    const {id: key, group, channel: required, method, rawBody} = action;
    for (const channel of ['web', 'cloud']) {
      const choice = node.description.properties.find(property => property.name === 'operation' &&
        property.displayOptions.show.apiChannel?.includes(channel) &&
        property.displayOptions.show.category.includes(group));
      assert.equal(Boolean(choice?.options.some(option => option.value === key)), !required || required === channel, key);
    }
    const channel = required || 'web';
    const values = Object.fromEntries(action.fields.map(field => [field.name, valueFor(field, key)]));
    const params = {apiChannel: channel, category: group, operation: key, confirmAction: true,
      sessionId: {__rl: true, mode: 'id', value: 'session-demo'}};
    for (const [name, value] of Object.entries(values)) params['arg_' + name] = value;
    const execution = context(params, channel === 'cloud' ? 'whatsapp_cloud' : 'whatsapp_web');
    const [[output]] = await node.execute.call(execution);
    const sent = execution.calls.at(-1);
    const url = new URL(sent.url);
    const expectedPath = key === 'send/buttons' ? '/api/v1/sessions/{sid}/messages/quick-reply' : '/api/v1' + action.path;
    const path = expectedPath.replace('{sid}', 'session-demo').replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(values[name]));
    assert.equal(url.pathname, path, key);
    assert.equal(sent.method, method, key);
    assert.equal(output.json.operation, key);
    assert.equal(output.json.success, true);
    for (const field of action.fields) {
      const value = values[field.name];
      if (field.in_path || value === '') continue;
      if (field.in_query || method === 'GET') {
        assert.equal(url.searchParams.get(field.name), typeof value === 'object' ? JSON.stringify(value) : String(value), key);
      } else if (sent.body instanceof FormData) {
        assert.equal(field.type === 'file' ? sent.body.get(field.name).size : sent.body.get(field.name),
          field.type === 'file' ? 4 : typeof value === 'object' ? JSON.stringify(value) : String(value), key);
      } else if (rawBody) {
        assert.deepEqual(sent.body, values[rawBody], key);
      } else {
        assert.equal(Object.getPrototypeOf(sent.body), Object.prototype, key);
        const quickReply = ['send/buttons', 'send/quick-reply'].includes(key);
        const wireName = quickReply ? ({text: 'body_text', footer: 'footer_text'}[field.name] ?? field.name) : field.name;
        const wireValue = quickReply && field.name === 'buttons'
          ? value.map(({button_id, display_text}) => ({id: button_id, display_text})) : value;
        assert.deepEqual(sent.body[wireName], wireValue, key);
      }
    }
    if (action.download) assert.ok(output.binary.data, key);
  }
});

test('bloqueia canal incompatível e ação sensível ainda sem confirmação', async () => {
  const mismatch = context({apiChannel: 'web', category: 'groups', operation: 'groups/list', sessionId: 'session-demo'}, 'whatsapp_cloud');
  await assert.rejects(node.execute.call(mismatch), /another channel/);
  assert.equal(mismatch.calls.length, 1);
  const destructive = context({apiChannel: 'web', category: 'info', operation: 'info/delete', sessionId: 'session-demo'}, 'whatsapp_web');
  await assert.rejects(node.execute.call(destructive), /Confirm Sensitive Operation/);
  assert.equal(destructive.calls.length, 0);
});

test('o painel lateral do n8n encontra cada ação na categoria e no canal corretos', async () => {
  const native = new WaxumV5(6);
  const properties = native.description.properties;
  const resourceProperty = properties.find(property => property.name === 'resource');
  assert.equal(resourceProperty.type, 'options');
  const resources = resourceProperty.options;
  const listed = new Map(resources.map(resource => [resource.value,
    properties.find(property => property.name === 'operation' &&
      property.displayOptions.show.resource.includes(resource.value)).options]));
  assert.equal(listed.size, resources.length);
  assert.ok(listed.get('web:validated').some(option => option.value === 'text'));
  assert.equal(listed.has('web:transcription'), false);
  assert.equal(listed.has('cloud:transcription'), false);
  for (const action of actions) {
    for (const channel of ['web', 'cloud']) {
      const resource = channel + ':' + action.group;
      const available = !action.channel || action.channel === channel;
      assert.equal(Boolean(listed.get(resource)?.some(option => option.value === action.id)), available, resource + '/' + action.id);
      if (!available) continue;
      const params = {resource, operation: action.id, confirmAction: true, sessionId: 'session-demo'};
      for (const field of action.fields) params['arg_' + field.name] = valueFor(field, action.id);
      const execution = context(params, channel === 'web' ? 'whatsapp_web' : 'whatsapp_cloud', 6);
      const [[output]] = await native.execute.call(execution);
      assert.equal(output.json.operation, action.id);
      assert.equal(execution.calls.at(-1).method, action.method);
    }
  }
  const wrongResource = context({resource: 'cloud:info', operation: 'groups/list'}, 'whatsapp_cloud', 6);
  await assert.rejects(native.execute.call(wrongResource), /chosen resource and channel/);
  assert.equal(wrongResource.calls.length, 0);
});

test('botões Cloud mantêm o formato oficial e o aceite fica separado da entrega', async () => {
  const native = new WaxumV5(6);
  const params = {resource: 'cloud:send', operation: 'send/buttons', sessionId: 'session-demo',
    arg_to: 'destino', arg_text: 'Mensagem', arg_buttons: '[{"button_id":"sim","display_text":"Sim"}]'};
  const accepted = context(params, 'whatsapp_cloud', 6, {status: 'sent', message_id: 'mock'});
  const [[sent]] = await native.execute.call(accepted);
  assert.ok(accepted.calls.at(-1).url.endsWith('/messages/buttons'));
  assert.equal(accepted.calls.at(-1).body.content_text, 'Mensagem');
  assert.deepEqual(accepted.calls.at(-1).body.buttons, [{button_id: 'sim', display_text: 'Sim'}]);
  assert.equal(sent.json.accepted, true);
  assert.equal(sent.json.deliveryStatus, 'unconfirmed');
  const scheduled = context(params, 'whatsapp_cloud', 6, {status: 'pending', schedule_id: 'mock'});
  const [[queued]] = await native.execute.call(scheduled);
  assert.equal(queued.json.accepted, undefined);
});

test('botões Web enviam ao número cadastrado após a resolução do nono dígito', async () => {
  const native = new WaxumV5(6);
  const params = {resource: 'web:send', operation: 'send/buttons', sessionId: 'session-demo',
    arg_to: '5547999990000', arg_text: 'Mensagem', arg_buttons: '[{"button_id":"sim","display_text":"Sim"}]'};
  const execution = context(params, 'whatsapp_web', 6, {status: 'sent', message_id: 'mock'});
  await native.execute.call(execution);
  assert.deepEqual(execution.calls.map(call => new URL(call.url).pathname), [
    '/api/v1/sessions/session-demo',
    '/api/v1/sessions/session-demo/contacts/check',
    '/api/v1/sessions/session-demo/messages/quick-reply',
  ]);
  assert.deepEqual(execution.calls[1].body, {phones: ['5547999990000']});
  assert.equal(execution.calls[2].body.to, '554799990000');
});
