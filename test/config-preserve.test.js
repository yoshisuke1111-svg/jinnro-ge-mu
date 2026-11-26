const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server');
const fs=require('node:fs');
const path=require('node:path');

async function api(base,event,data={},code='',token=''){
  const res=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event,data,code,token})});
  return {res,json:await res.json()};
}
async function approvedJoin(base,made,name){
  const requested=await api(base,'request_join',{name,code:made.code},made.code,'');
  assert.equal(requested.res.status,200,JSON.stringify(requested.json));
  const approved=await api(base,'approve_join',{requestId:requested.json.requestId},made.code,made.token);
  assert.equal(approved.res.status,200,JSON.stringify(approved.json));
  const status=await api(base,'join_status',{requestId:requested.json.requestId},made.code,'');
  assert.equal(status.json.status,'approved',JSON.stringify(status.json));
  return api(base,'join',{name,code:made.code,requestId:requested.json.requestId,approvalToken:status.json.approvalToken},made.code,'');
}

test('normal online rooms reject CPU additions through the public game API',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'ホスト',roomCode:'NOCPU'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    const before=JSON.parse(JSON.stringify(app.rooms.get(made.json.code).game.config.roles));

    const changed=await api(base,'bots',{count:6},made.json.code,made.json.token);
    assert.equal(changed.res.status,400);
    assert.match(changed.json.error,/CPUを追加できません/);
    assert.equal(app.rooms.get(made.json.code).game.players.length,1);
    assert.deepEqual(app.rooms.get(made.json.code).game.config.roles,before);
  }finally{await app.close();}
});

test('an approved new human joining does not auto-add a villager',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const madeRes=await api(base,'create',{name:'ホスト',roomCode:'JOINROLE'});
    assert.equal(madeRes.res.status,200,JSON.stringify(madeRes.json));
    const made=madeRes.json,entry=app.rooms.get(made.code);
    const before=JSON.parse(JSON.stringify(entry.game.config.roles));

    const joined=await approvedJoin(base,made,'ゲスト');
    assert.equal(joined.res.status,200,JSON.stringify(joined.json));
    assert.deepEqual(entry.game.config.roles,before);
    assert.match(entry.game.view(made.playerId).validation.join(' '),/役職の合計と参加人数/);
  }finally{await app.close();}
});

test('browser has no normal CPU-count control and exposes the public room browser',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  assert.doesNotMatch(source,/\$\('setBots'\)\.onclick/);
  assert.doesNotMatch(html,/id="cpuCount"/);
  assert.match(html,/id="roomBrowser"/);
  assert.match(html,/id="joinRequestsBox"/);
  assert.match(source,/request_join/);
  assert.match(source,/approve_join/);
});

test('board player tap keeps its centering transform on mobile',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','public','style.css'),'utf8');
  assert.match(css,/\.board-player:active:not\(:disabled\)\{transform:translate\(-50%,-50%\)\}/);
  const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  assert.match(app,/max-width:700px/);
  assert.match(app,/boardMenu.*scrollIntoView/s);
});

test('board view has a quick public chat form wired to the normal chat API',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  assert.match(html,/id="boardChatForm"/);
  assert.match(html,/id="boardChatInput"/);
  assert.match(app,/submitChat\('boardChatInput','boardSend','public'\)/);
});

test('reply metadata alone is not labeled as an arrow',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  assert.match(app,/\['accuse','trust','question','report','claim'\]\.includes\(m\.meta\?\.kind\)/);
  assert.doesNotMatch(app,/\$\{m\.meta\?' · 矢印':''\}/);
});
