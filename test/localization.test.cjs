const assert = require('node:assert/strict');
const {test} = require('node:test');
const {NodeHelpers} = require('n8n-workflow');
const {Waxum} = require('../dist/nodes/Waxum/Waxum.node');

const typeVersion = 6;
const description = new Waxum().getNodeType(typeVersion).description;

function visibleParameters(parameters) {
  return description.properties.filter(property => property.type !== 'hidden' &&
    NodeHelpers.displayParameter(parameters, property, {typeVersion}, description));
}

test('switching languages keeps values and expressions from an older workflow', () => {
  const saved = {
    resource: 'web:validated',
    operation: 'text',
    sessionId: {__rl: true, mode: 'id', value: 'example-session'},
    to: '12025550101',
    text: '={{ $json.message }}',
    options: {validationOnly: true, delayMs: 200},
  };
  const english = ['Language / Idioma', 'Category', 'Operation', 'Session', 'Recipient', 'Message', 'Options'];
  const portuguese = ['Language / Idioma', 'Categoria', 'Operação', 'Instância', 'Destinatário', 'Mensagem', 'Opções'];

  for (const [interfaceLanguage, labels] of [[undefined, english], ['pt-BR', portuguese], ['en', english]]) {
    const parameters = {...saved, interfaceLanguage};
    const fields = visibleParameters(parameters);
    const resolved = NodeHelpers.getNodeParameters(description.properties, parameters, true, false,
      {typeVersion}, description);
    assert.deepEqual(fields.map(field => field.displayName), labels);
    assert.equal(new Set(fields.map(field => field.name)).size, fields.length);
    const options = fields.find(field => field.name === 'options');
    assert.equal(options.displayOptions.show?.interfaceLanguage, undefined);
    assert.equal(options.displayOptions.hide?.interfaceLanguage, undefined);
    assert.deepEqual(resolved, {...saved, interfaceLanguage: interfaceLanguage ?? 'en'});
  }
});

test('the category selector filters actions in both languages and preserves the sidebar entries', async () => {
  const resources = description.properties.filter(property => property.name === 'resource');
  const [englishCategory, portugueseCategory] = resources;
  assert.equal(resources.length, 2);
  assert.equal(englishCategory.type, 'options');
  assert.equal(portugueseCategory.type, 'options');
  assert.equal(portugueseCategory.options, undefined);
  const method = portugueseCategory.typeOptions.loadOptionsMethod;
  const node = new Waxum().getNodeType(typeVersion);
  const portugueseCategories = await node.methods.loadOptions[method]();
  assert.deepEqual(englishCategory.options.map(option => option.value),
    portugueseCategories.map(option => option.value));
  assert.equal(portugueseCategories.find(option => option.value === 'web:groups').name, 'Web · Grupos');

  const operations = description.properties.filter(property => property.name === 'operation');
  for (const resource of englishCategory.options) {
    const [english, portuguese, ...extra] = operations.filter(property =>
      property.displayOptions.show.resource.includes(resource.value));
    assert.equal(extra.length, 0);
    assert.equal(english.displayName, 'Operation');
    assert.equal(portuguese.displayName, 'Operação');
    assert.deepEqual(english.options.map(option => option.value),
      portuguese.options.map(option => option.value), resource.value);
  }
  const fields = visibleParameters({
    interfaceLanguage: 'pt-BR', resource: 'cloud:send', operation: 'send/buttons',
  });
  const operation = fields.find(field => field.name === 'operation');
  assert.equal(operation.options.find(option => option.value === 'send/buttons').name, 'Botões');
  assert.equal(fields.find(field => field.name === 'arg_buttons').displayName, 'Botões (JSON)');

  const groupFields = visibleParameters({interfaceLanguage: 'pt-BR', resource: 'web:groups'});
  const groupActions = groupFields.find(field => field.name === 'operation').options;
  assert.ok(groupActions.some(option => option.value === 'groups/list'));
  assert.ok(groupActions.every(option => option.value.startsWith('groups/')));
});
