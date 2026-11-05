const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runAction, decodedMedia, mediaMetadata, mediaFileInfo, OPERATIONS, MAX_BINARY_BYTES} = require('../dist/nodes/Waxum/actions');
function fixture(override) {
 const calls=[]; const request=async(method,path,body)=>{calls.push({method,path,body});if(override){const out=await override(method,path,body);if(out!==undefined)return out;}
  if(path==='/sessions/teste')return{id:'teste',status:'logged_in',is_logged_in:true,phone_number:'12025550101'};
  if(path.endsWith('/contacts/check'))return{results:[{is_registered:true,phone:body.phones[0]}]};
  if(path.includes('/messages/')&&!path.includes('/store/'))return{status:'sent',message_id:'MSG-TEST',timestamp:123};
  if(path.endsWith('/receipts'))return[];
  return{success:true};};return{calls,request};
}
const base={operation:'text',sessionId:'teste',to:'5511987654321',text:'Olá\nlinha dois',fields:{},options:{expectedSenderPhone:'12025550101'}};
const operations={image:{media:'https://files.example/foto.jpg',caption:'Foto'},video:{media:'https://files.example/video.mp4',caption:'Vídeo'},audio:{media:'https://files.example/audio.ogg',ptt:true},document:{media:'https://files.example/doc.pdf',fileName:'Minha proposta.pdf',caption:'Proposta'},sticker:{media:'https://files.example/sticker.webp'},contact:{contactName:'Contato teste',contactPhone:'5547987654321'},location:{latitude:-26.9,longitude:-49.1,locationName:'Empresa',address:'Rua teste'},poll:{pollName:'Escolha',pollOptions:'["A","B"]',selectableCount:1},buttons:{buttons:'[{"button_id":"a","display_text":"Escolher"}]'},react:{messageId:'ORIGINAL',emoji:'👍'},edit:{messageId:'ORIGINAL'}};
for(const [operation,fields]of Object.entries(operations))test(operation+' usa apenas um envio com parâmetros preservados',async()=>{
 const f=fixture();const out=await runAction({...base,operation,fields},f.request);
 const sends=f.calls.filter(c=>c.path.includes('/messages/')&&!c.path.includes('/store/'));
 assert.equal(sends.length,1);assert.equal(sends[0].path,'/sessions/teste/messages/'+operation);
 assert.equal(sends[0].body.to,base.to);assert.equal(out.accepted,true);assert.equal(out.deliveryStatus,'unconfirmed');
 if(operation==='audio')assert.equal(sends[0].body.ptt,true);
 if(operation==='document')assert.equal(sends[0].body.filename,fields.fileName);
 if(operation==='contact')assert.equal(sends[0].body.contact.phones[0].number,fields.contactPhone);
});
test('prévia de todas as ações mutáveis não envia nem muda presença/leitura',async()=>{
 for(const[operation,fields]of Object.entries({...operations,text:{},read:{messageIds:'["ID"]'},typing:{chatState:'recording'},presence:{presenceState:'available'}})){
  const f=fixture();const out=await runAction({...base,operation,fields,options:{validationOnly:true}},f.request);
  assert.equal(out.dryRun,true,operation);assert.equal(out.messagesSent,0);
  assert.ok(f.calls.every(c=>c.method==='GET'||c.path.endsWith('/contacts/check')),operation);
 }
});
test('parâmetros inválidos bloqueiam HTTP antes de qualquer efeito',async()=>{
 for(const[operation,fields]of [['location',{latitude:100,longitude:1}],['poll',{pollName:'?',pollOptions:'["A","A"]'}],['buttons',{buttons:'[{"button_id":"a","display_text":"A"},{"button_id":"a","display_text":"B"}]'}],['react',{messageId:'',emoji:'👍'}],['read',{messageIds:'[]'}],['typing',{chatState:'whatever'}],['image',{media:'file:///secret'}],['searchMessages',{query:'',limit:50}],['presence',{presenceState:'bad'}]]){
  const f=fixture();await assert.rejects(runAction({...base,operation,fields},f.request));assert.equal(f.calls.length,0,operation);
 }
});
test('LID recebido no webhook é mantido e não é confundido com telefone',async()=>{
 const f=fixture();await runAction({...base,to:'123456789012345@lid'},f.request);
 assert.ok(!f.calls.some(c=>c.path.endsWith('/contacts/check')));
 assert.equal(f.calls.at(-1).body.to,'123456789012345@lid');
});
test('consulta de telefone não declara LID ou grupo como número registrado',async()=>{
 for(const to of ['123456789012345@lid','120363000000000@g.us']){const f=fixture();await assert.rejects(runAction({...base,operation:'check',to},f.request));assert.equal(f.calls.length,0);}
});
test('resposta perdida não é repetida nem expõe segredo retornado pelo HTTP',async()=>{
 const f=fixture((m,p)=>{if(p.endsWith('/messages/image'))throw new Error('PRIVATE-SECRET');});
 await assert.rejects(runAction({...base,operation:'image',fields:operations.image},f.request),e=>e.uncertain===true&&e.code==='ACTION_UNCERTAIN'&&!e.message.includes('PRIVATE-SECRET'));
 assert.equal(f.calls.filter(c=>c.path.endsWith('/messages/image')).length,1);
});
test('recibos vazios não significam entrega; grupos indicam escopo parcial',async()=>{
 const f=fixture();const empty=await runAction({...base,operation:'receipts',fields:{chatJid:'123456789012345@lid',messageId:'ID'}},f.request);assert.equal(empty.deliveryStatus,'unconfirmed');
 const g=fixture((m,p)=>p.endsWith('/receipts')?[{status:1},{status:4},{status:0}]:undefined);
 const read=await runAction({...base,operation:'receipts',fields:{chatJid:'120363000000000@g.us',messageId:'ID'}},g.request);
 assert.equal(read.deliveryStatus,'read');assert.equal(read.deliveryScope,'at_least_one_participant');
});
test('consulta de sessão desconectada funciona sem disparo e sem consulta de contato',async()=>{
 const f=fixture((m,p)=>p==='/sessions/teste'?{id:'teste',status:'disconnected',is_logged_in:false}:undefined);
 const out=await runAction({...base,operation:'sessionStatus'},f.request);assert.equal(out.data.status,'disconnected');assert.equal(f.calls.length,1);
});
test('marcar lida, digitando e presença usam as rotas e campos documentados',async()=>{
 const cases=[['read',{messageIds:'["A","B"]'},'/messages/read','chat_jid','5511987654321@s.whatsapp.net'],['typing',{chatState:'recording'},'/chatstate/send','state','recording'],['presence',{presenceState:'unavailable'},'/presence/set','status','unavailable']];
 for(const[operation,fields,path,key,value]of cases){const f=fixture();await runAction({...base,operation,fields},f.request);assert.ok(f.calls.at(-1).path.endsWith(path));assert.deepEqual(f.calls.at(-1).body[key],value);}
});
test('consultas são paginadas e valores da pesquisa são codificados',async()=>{
 for(const[operation,fields]of [['listContacts',{limit:2,offset:4}],['listChats',{limit:2}],['searchMessages',{query:'nome /? & x',limit:2}]]){
  const f=fixture();await runAction({...base,operation,fields},f.request);assert.equal(f.calls.at(-1).method,'GET');assert.ok(f.calls.at(-1).path.includes('limit=2'));
  if(operation==='searchMessages')assert.ok(f.calls.at(-1).path.includes('nome%20%2F%3F%20%26%20x'));
 }
});
test('download valida tamanho antes do HTTP e conteúdo antes de produzir binário',()=>{
 assert.throws(()=>mediaMetadata({direct_path:'x',file_length:MAX_BINARY_BYTES+1,media_type:'audio'}));
 assert.throws(()=>decodedMedia({data:'abc',size:1}));assert.throws(()=>decodedMedia({data:'T2dnUw==',size:99}));
 const data=Buffer.from('OggS teste');assert.deepEqual(decodedMedia({data:data.toString('base64'),size:data.length}),data);
 assert.deepEqual(mediaFileInfo(data,'audio'),{fileName:'midia.ogg',mimeType:'audio/ogg'});
 assert.equal(mediaFileInfo(Buffer.from('RIFF1234WAVEdata'),'audio').mimeType,'audio/wav');
});
test('remetente inesperado bloqueia nova ação e código de sessão não permite escapar da rota',async()=>{
 const f=fixture();await assert.rejects(runAction({...base,operation:'audio',fields:operations.audio,options:{expectedSenderPhone:'5511999999999'}},f.request),e=>e.code==='SENDER_MISMATCH');assert.equal(f.calls.length,1);
 const g=fixture();await assert.rejects(runAction({...base,sessionId:'../other'},g.request));assert.equal(g.calls.length,0);
});
test('texto permite responder à mensagem preservando conteúdo e prévia de link',async()=>{
 const f=fixture();await runAction({...base,options:{replyTo:'ORIGINAL',linkPreview:true}},f.request);assert.equal(f.calls.at(-1).body.reply_to,'ORIGINAL');assert.equal(f.calls.at(-1).body.text,base.text);assert.equal(f.calls.at(-1).body.link_preview,true);
});
test('catálogo contém 24 ações sem operações arbitrárias ou destrutivas',()=>{
 assert.equal(OPERATIONS.length,24);assert.equal(new Set(OPERATIONS.map(([id])=>id)).size,24);assert.ok(!OPERATIONS.some(([id])=>/delete|logout|revoke|request/i.test(id)));
});
