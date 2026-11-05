const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server');
const fs=require('node:fs');
const path=require('node:path');

async function api(base,event,data={},code='',token=''){
  const res=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event,data,code,token})});
  return {res,json:await res.json()};
}

test('CPU count changes do not mutate saved roles through the API',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'ホスト',roomCode:'KEEPROLE'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    const {code,token}=made.json;
    const entry=app.rooms.get(code);
    entry.game.setBots(7);
    const roles={...entry.game.config.roles};
    roles.villager=1;roles.seer=1;roles.medium=1;roles.guard=1;roles.wolf=2;roles.madman=2;
    entry.game.applyConfig({...entry.game.config,roles});
    const before=JSON.parse(JSON.stringify(entry.game.config.roles));

    const changed=await api(base,'bots',{count:6},code,token);
    assert.equal(changed.res.status,200,JSON.stringify(changed.json));
    assert.deepEqual(entry.game.config.roles,before);
  }finally{await app.close();}
});

test('a new human joining does not auto-add a villager',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'ホスト',roomCode:'JOINROLE'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    const entry=app.rooms.get(made.json.code);
    entry.game.setBots(7);
    const before=JSON.parse(JSON.stringify(entry.game.config.roles));

    const joined=await api(base,'join',{name:'ゲスト'},made.json.code,'');
    assert.equal(joined.res.status,200,JSON.stringify(joined.json));
    assert.deepEqual(entry.game.config.roles,before);
    assert.match(entry.game.view(made.json.playerId).validation.join(' '),/役職の合計と参加人数/);
  }finally{await app.close();}
});


test('CPU count button keeps an unsaved role draft in the browser',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  const line=source.split('\n').find(x=>x.includes("$('setBots').onclick"));
  assert.ok(line,'setBots click handler should exist');
  assert.match(line,/call\('bots'/);
  assert.doesNotMatch(line,/settingsDirty\s*=\s*false/);
  assert.doesNotMatch(line,/settingsVersion\s*=\s*-1/);
});
