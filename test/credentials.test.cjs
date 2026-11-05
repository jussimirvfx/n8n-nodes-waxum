const assert = require('node:assert/strict');
const {test} = require('node:test');
const {Expression} = require('n8n-workflow');
const {WaxumApi} = require('../dist/credentials/WaxumApi.credentials');

test('credential test lists sessions on the configured server', async () => {
  const credential = new WaxumApi();
  const credentials = {baseUrl: ' https://waxum.example/api/v1/ ', apiToken: 'test-token'};
  const options = credential.test.request;
  const url = Expression.resolveWithoutWorkflow(options.url.slice(1), {$credentials: credentials});
  const request = await credential.authenticate(credentials, {...options, url});

  assert.equal(request.method, 'GET');
  assert.equal(request.url, 'https://waxum.example/api/v1/sessions');
  assert.equal(request.headers.Authorization, 'Bearer test-token');
  assert.equal(request.disableFollowRedirect, true);
});

test('credential refuses to send the token to a different origin or remote HTTP', async () => {
  const credential = new WaxumApi();
  const credentials = {baseUrl: 'https://waxum.example', apiToken: 'test-token'};

  await assert.rejects(credential.authenticate(credentials, {
    url: 'https://other.example/api/v1/sessions',
  }), {code: 'INVALID_URL'});
  await assert.rejects(credential.authenticate({...credentials, baseUrl: 'http://waxum.example'}, {
    url: 'http://waxum.example/api/v1/sessions',
  }), {code: 'INVALID_URL'});
});
