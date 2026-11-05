const http=require('node:http');let calls=[];
const audio=Buffer.from('OggS test-audio');
const server=http.createServer((req,res)=>{const chunks=[];let size=0;req.on('data',b=>{size+=b.length;if(size>1024*1024){req.destroy();return;}chunks.push(b);});req.on('end',()=>{const raw=Buffer.concat(chunks),path=req.url.split('?')[0];let body={};try{body=JSON.parse(raw.toString()||'{}');}catch{}
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/fixture-stats')return reply(200,{calls});
 const validAuth=req.headers.authorization==='Bearer MOCK-TOKEN-NOT-A-REAL-CREDENTIAL';
 calls.push({method:req.method,path,bytes:raw.length,validAuth});if(!validAuth)return reply(401,{error:'Fixture credential mismatch'});
 const sid=path.match(/^\/api\/v1\/sessions\/([^/]+)$/)?.[1];if(req.method==='GET'&&sid)return reply(200,{id:sid,status:'logged_in',is_logged_in:true,phone_number:'12025550101'});
 if(path.endsWith('/contacts/check'))return reply(200,{results:[{phone:body.phones[0],is_registered:true}]});
 if(path.endsWith('/media/download'))return reply(200,{data:audio.toString('base64'),size:audio.length});
 if(path.endsWith('/receipts'))return reply(200,[{status:3,timestamp_ms:123,user_jid:'123456789012345@lid'}]);
 if(path.endsWith('/contacts/info'))return reply(200,{contacts:[{jid:'5511987654321@s.whatsapp.net',is_registered:true,is_business:false}]});
 if(path.endsWith('/picture'))return reply(200,{url:'https://files.example/avatar.jpg'});
 if(path.endsWith('/contacts'))return reply(200,{contacts:[{jid:'5511987654321@s.whatsapp.net',full_name:'Test Contact'}],total:1});
 if(path.endsWith('/store/chats')||path.endsWith('/store/search'))return reply(200,[]);
 if(path.endsWith('/messages/read')||path.endsWith('/presence/set')||path.endsWith('/chatstate/send'))return reply(200,{success:true});
 if(path.includes('/messages/')){if(body.text==='SIMULATE_HTTP_FAILURE')return reply(500,{error:'MOCK SECRET DO NOT EXPOSE'});return reply(200,{message_id:'MOCK-'+calls.length,status:'sent',timestamp:123,to:body.to});}
 return reply(404,{error:'Unsupported fixture endpoint'});
});});server.listen(3469,'127.0.0.1');
