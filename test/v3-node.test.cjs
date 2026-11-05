const{test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');const load=Module._load;
Module._load=function(id,...args){if(id==='n8n-workflow')return{NodeConnectionTypes:{Main:'main'},NodeOperationError:class extends Error{constructor(node,message,options){super(message);this.options=options;}},VersionedNodeType:class{constructor(versions,description){this.nodeVersions=versions;this.description=description;}getNodeType(v){return this.nodeVersions[v];}}};return load.call(this,id,...args);};
const{WaxumV3}=require('../dist/nodes/Waxum/WaxumV3.node');const{Waxum}=require('../dist/nodes/Waxum/Waxum.node');Module._load=load;
function context(rows,overrides={}){const calls=[],credentials=[];return{calls,credentials,getInputData:()=>rows.map(json=>({json})),getCredentials:async name=>{credentials.push(name);return {baseUrl:'https://waxum.example',apiToken:'PRIVATE-WAXUM'};},getNode:()=>({id:'NODE',name:'Waxum',typeVersion:3,...overrides.node}),getWorkflow:()=>({id:'WF'}),getExecutionId:()=>'EXEC',continueOnFail:()=>overrides.continueOnFail===true,getNodeParameter:(key,i,fallback)=>rows[i][key]??fallback,helpers:{assertBinaryData:(i)=>rows[i].operation==='image'?{fileName:'foto.png',mimeType:'image/png'}:{fileName:'audio.ogg',mimeType:'audio/ogg'},getBinaryDataBuffer:async()=>Buffer.from('OggS test-audio'),prepareBinaryData:async(buffer,name,mime)=>({data:buffer.toString('base64'),fileName:name,mimeType:mime}),httpRequestWithAuthentication:async function(credential,req){calls.push({credential,req});if(overrides.http)return overrides.http(credential,req);if(req.url.endsWith('/contacts/check'))return{results:[{is_registered:true,phone:req.body.phones[0]}]};if(req.url.endsWith('/media/download')){const b=Buffer.from('OggS test-audio');return{data:b.toString('base64'),size:b.length};}if(req.url.includes('/messages/'))return{message_id:'TEST',status:'sent'};return{id:'teste',status:'logged_in',is_logged_in:true};}}};}
const base={operation:'image',sessionId:'teste',to:'5511987654321',media:'https://files.example/image.png'};
test('v1 a v5 preservam o contrato e novos nós usam versão 6', () => {
  const node = new Waxum();
  assert.equal(node.description.defaultVersion, 6);
  assert.equal(node.getNodeType(1).constructor.name, 'WaxumLegacy');
  assert.equal(node.getNodeType(2).constructor.name, 'WaxumLegacy');
  assert.equal(node.getNodeType(3).description.credentials[0].name, 'waxumApi');
  assert.deepEqual(node.getNodeType(4).description.credentials.map(credential => credential.name),
    ['waxumApi']);
  assert.equal(node.getNodeType(4).description.usableAsTool, true);
  assert.equal(node.getNodeType(5).description.credentials[0].name, 'waxumApi');
  assert.equal(node.getNodeType(6).description.credentials[0].name, 'waxumApi');
});

test('a lista da versão 6 filtra as instâncias pelo canal da categoria', async () => {
  const node = new Waxum().getNodeType(6);
  const execution = context([], {http: () => ({sessions: [
    {id: 'web', provider: 'whatsapp_web'},
    {id: 'cloud', provider: 'whatsapp_cloud'},
  ]})});
  execution.getCurrentNodeParameters = () => ({resource: 'cloud:info'});
  const {results} = await node.methods.listSearch.searchSessions.call(execution);
  assert.deepEqual(results.map(result => result.value), ['cloud']);
});

test('a lista consulta apenas as instâncias retornadas pela credencial compartilhada', async () => {
  const node = new Waxum().getNodeType(4);
  const execution = context([], {
    http: (credential, request) => {
      assert.equal(credential, 'waxumApi');
      assert.equal(request.url, 'https://waxum.example/api/v1/sessions');
      assert.equal(request.method, 'GET');
      return {sessions: [
        {id: 'teste-web', name: 'Sessão de teste', is_logged_in: true, phone_number: 'omitir'},
        {id: 'demo', name: 'Notificações', is_logged_in: false},
      ]};
    },
  });
  assert.deepEqual(await node.methods.listSearch.searchSessions.call(execution, 'TESTE'), {
    results: [{value: 'teste-web', name: 'Sessão de teste · teste-web', description: 'Connected'}],
  });
});

test('seleção, ID digitado e expressão usam a mesma credencial e o mesmo ID', async () => {
  const node = new Waxum().getNodeType(4);
  for (const sessionId of [
    {__rl: true, mode: 'list', value: 'teste'},
    {__rl: true, mode: 'id', value: 'teste'},
    'teste',
  ]) {
    const execution = context([{operation: 'sessionStatus', sessionId}], {node: {typeVersion: 4}});
    const [[output]] = await node.execute.call(execution);
    assert.equal(output.json.success, true);
    assert.equal(execution.calls[0].req.url, 'https://waxum.example/api/v1/sessions/teste');
    assert.deepEqual(execution.credentials, ['waxumApi']);
  }
});
test('imagem binária não publica URL e usa a credencial somente no servidor Waxum',async()=>{const c=context([{...base,mediaSource:'binary'}]);const[[out]]=await new WaxumV3().execute.call(c);assert.equal(out.json.accepted,true);const req=c.calls.at(-1);assert.ok(req.req.body.image.data);assert.equal(req.req.body.image.mimetype,'image/png');assert.equal(req.credential,'waxumApi');assert.ok(!JSON.stringify(c.calls).includes('PRIVATE-WAXUM'));});
test('download retorna arquivo binário sem duplicar base64 no JSON',async()=>{const c=context([{operation:'downloadMedia',sessionId:'teste',mediaMetadata:{direct_path:'/x',media_key:'key',file_sha256:'hash',file_enc_sha256:'hash2',file_length:15,media_type:'audio'}}]);const[[out]]=await new WaxumV3().execute.call(c);assert.equal(out.binary.data.mimeType,'audio/ogg');assert.equal(out.json.data.binaryProperty,'data');assert.equal(out.json.data.data,undefined);});
test('falha de ação preserva ligação de item e sai pela porta de erro',async()=>{const c=context([{...base,to:'invalid'},base],{continueOnFail:true,node:{onError:'continueErrorOutput'}});const[out]=await new WaxumV3().execute.call(c);assert.ok(out[0].error instanceof Error);assert.equal(out[0].pairedItem.item,0);assert.equal(out[1].json.accepted,true);assert.equal(out[1].pairedItem.item,1);});
test('retry continua bloqueado antes de qualquer credencial ou chamada',async()=>{const c=context([base],{node:{retryOnFail:true}});await assert.rejects(new WaxumV3().execute.call(c),/Retry On Fail/);assert.equal(c.calls.length,0);});
