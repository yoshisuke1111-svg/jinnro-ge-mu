const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server');
const {preset}=require('../shared/rules');

async function api(base,event,data={},code='',token=''){
  const res=await fetch(base+'/api',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({event,code,token,data})
  });
  return {res,json:await res.json()};
}

test('disconnected human can reclaim the same CPU-proxied seat by room code and exact name',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'復帰テスト',roomCode:'REJOIN1'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    const {code,playerId}=made.json;
    const entry=app.rooms.get(code),g=entry.game;
    g.setBots(3);
    g.applyConfig({...g.config,roles:preset(4)});
    g.start();

    const p=g.byId(playerId);
    const originalRole=p.role;
    p.privateResults.push({id:'keep-me',kind:'notice',day:g.day,text:'復帰後も残る'});
    g.disconnect(playerId);
    p.disconnectedAt=g.now()-16000;
    p.auto=true;

    const rejoined=await api(base,'join',{name:'復帰テスト',code},code,'');
    assert.equal(rejoined.res.status,200,JSON.stringify(rejoined.json));
    assert.equal(rejoined.json.rejoined,true);
    assert.equal(rejoined.json.playerId,playerId);
    assert.equal(p.connected,true);
    assert.equal(p.auto,false);
    assert.equal(p.role,originalRole);
    assert.ok(p.privateResults.some(x=>x.id==='keep-me'));
  }finally{await app.close();}
});

test('unknown name cannot enter a game already in progress',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'ホスト',roomCode:'REJOIN2'});
    const entry=app.rooms.get(made.json.code),g=entry.game;
    g.setBots(3);
    g.applyConfig({...g.config,roles:preset(4)});
    g.start();

    const denied=await api(base,'join',{name:'知らない人',code:made.json.code},made.json.code,'');
    assert.equal(denied.res.status,400);
    assert.match(denied.json.error,/参加済みの名前/);
  }finally{await app.close();}
});
