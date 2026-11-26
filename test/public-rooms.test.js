const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server');
const Bots=require('../shared/bots');

async function api(base,event,data={},code='',token=''){
  const res=await fetch(base+'/api',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({event,code,token,data})
  });
  return {res,json:await res.json()};
}
async function rooms(base){
  const res=await fetch(base+'/rooms',{cache:'no-store'});
  return {res,json:await res.json()};
}

test('online rooms are publicly discoverable while solo practice rooms stay hidden',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const online=await api(base,'create',{name:'公開ホスト',roomCode:'PUBLIC1'});
    const solo=await api(base,'create',{name:'練習者',roomCode:'SOLOHIDE',solo:true,role:'seer'});
    assert.equal(online.res.status,200,JSON.stringify(online.json));
    assert.equal(solo.res.status,200,JSON.stringify(solo.json));

    const listed=await rooms(base);
    assert.equal(listed.res.status,200);
    const codes=listed.json.rooms.map(r=>r.code);
    assert.ok(codes.includes('PUBLIC1'));
    assert.ok(!codes.includes('SOLOHIDE'));
    const publicRoom=listed.json.rooms.find(r=>r.code==='PUBLIC1');
    assert.equal(publicRoom.host,'公開ホスト');
    assert.equal(publicRoom.players,1);
    assert.equal(publicRoom.joinable,true);
  }finally{await app.close();}
});

test('a new player must be approved by the host before a seat is created',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'HOST',roomCode:'APPROVE'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));

    const direct=await api(base,'join',{name:'GUEST',code:'APPROVE'},'APPROVE','');
    assert.equal(direct.res.status,400);
    assert.match(direct.json.error,/許可|参加申請/);
    assert.equal(app.rooms.get('APPROVE').game.players.length,1);

    const requested=await api(base,'request_join',{name:'GUEST',code:'APPROVE'},'APPROVE','');
    assert.equal(requested.res.status,200,JSON.stringify(requested.json));
    assert.ok(requested.json.requestId);

    const hostState=await api(base,'state',{},'APPROVE',made.json.token);
    assert.equal(hostState.res.status,200,JSON.stringify(hostState.json));
    assert.deepEqual(hostState.json.state.joinRequests.map(r=>r.name),['GUEST']);

    const approved=await api(base,'approve_join',{requestId:requested.json.requestId},'APPROVE',made.json.token);
    assert.equal(approved.res.status,200,JSON.stringify(approved.json));
    assert.equal(approved.json.status,'approved');

    const status=await api(base,'join_status',{requestId:requested.json.requestId},'APPROVE','');
    assert.equal(status.res.status,200,JSON.stringify(status.json));
    assert.equal(status.json.status,'approved');
    assert.ok(status.json.approvalToken);

    const joined=await api(base,'join',{
      name:'GUEST',code:'APPROVE',requestId:requested.json.requestId,approvalToken:status.json.approvalToken
    },'APPROVE','');
    assert.equal(joined.res.status,200,JSON.stringify(joined.json));
    assert.ok(joined.json.recoveryKey);
    assert.equal(app.rooms.get('APPROVE').game.players.filter(p=>!p.bot).length,2);

    const guestState=await api(base,'state',{},'APPROVE',joined.json.token);
    assert.deepEqual(guestState.json.state.joinRequests,[]);
  }finally{await app.close();}
});

test('host can reject a join request and rejected applicant never gets a seat',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'HOST',roomCode:'REJECT'});
    const requested=await api(base,'request_join',{name:'NOPE',code:'REJECT'},'REJECT','');
    assert.equal(requested.res.status,200,JSON.stringify(requested.json));

    const rejected=await api(base,'reject_join',{requestId:requested.json.requestId},'REJECT',made.json.token);
    assert.equal(rejected.res.status,200,JSON.stringify(rejected.json));
    assert.equal(rejected.json.status,'rejected');

    const status=await api(base,'join_status',{requestId:requested.json.requestId},'REJECT','');
    assert.equal(status.json.status,'rejected');
    assert.equal(status.json.approvalToken,null);
    assert.equal(app.rooms.get('REJECT').game.players.length,1);
  }finally{await app.close();}
});

test('solo practice uses silent seats that act but never chat',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'練習者',roomCode:'SILENT1',solo:true,role:'seer'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    const entry=app.rooms.get('SILENT1'),g=entry.game;
    const silent=g.players.filter(p=>p.silent);
    assert.equal(entry.solo,true);
    assert.equal(silent.length,7);
    assert.ok(silent.every(p=>p.bot));

    g.start();
    g.startDiscussion();
    for(const p of silent){p.brain.nextTalk=0;p.brain.actionAt=0;}
    g.botTalkAt=0;
    g.tick(Bots);
    assert.equal(g.messages.filter(m=>m.playerId&&g.byId(m.playerId)?.silent).length,0);

    g.startVote();
    for(const p of silent)p.brain.actionAt=0;
    g.tick(Bots);
    assert.ok(Object.keys(g.votes).some(id=>g.byId(id)?.silent));
  }finally{await app.close();}
});

test('a second applicant cannot retrieve another pending request id by copying the name',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'x'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    await api(base,'create',{name:'HOST',roomCode:'DUPREQ'});
    const first=await api(base,'request_join',{name:'SAME',code:'DUPREQ'},'DUPREQ','');
    assert.equal(first.res.status,200,JSON.stringify(first.json));

    const second=await api(base,'request_join',{name:'SAME',code:'DUPREQ'},'DUPREQ','');
    assert.equal(second.res.status,400);
    assert.match(second.json.error,/すでに/);
    assert.equal(second.json.requestId,undefined);
  }finally{await app.close();}
});
