const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server');

async function post(base,path,body,cookie=''){
  const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  const json=await res.json();return {res,json};
}

test('admin can create exact-role CPU room and control CPU votes and wolf attack',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'test-admin'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const login=await post(base,'/admin/login',{password:'test-admin'});
    assert.equal(login.res.status,200);
    const cookie=login.res.headers.get('set-cookie').split(';')[0];

    const roles=['wolf','seer','guard','villager'];
    const made=await post(base,'/admin/action',{action:'create_cpu_watch',count:4,code:'ADMINTEST',roles},cookie);
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    const entry=app.rooms.get('ADMINTEST');
    assert.ok(entry);
    assert.deepEqual(entry.game.players.map(p=>p.role),roles);

    const g=entry.game;
    g.startVote();
    const bots=g.living();
    const target=bots[1];
    const votes=Object.fromEntries(bots.map(p=>[p.id,p.id===target.id?null:target.id]));
    const voteRes=await post(base,'/admin/action',{action:'set_cpu_votes',code:'ADMINTEST',votes},cookie);
    assert.equal(voteRes.res.status,200,JSON.stringify(voteRes.json));
    for(const p of bots)assert.equal(g.votes[p.id],p.id===target.id?null:target.id);

    g.startNight();
    const wolf=g.players.find(p=>p.role==='wolf');
    const victim=g.players.find(p=>p.role==='villager');
    const attack=await post(base,'/admin/action',{action:'set_cpu_attack',code:'ADMINTEST',target:victim.id},cookie);
    assert.equal(attack.res.status,200,JSON.stringify(attack.json));
    assert.equal(g.actions[wolf.id],victim.id);

    wolf.bot=false;
    delete g.actions[wolf.id];
    const denied=await post(base,'/admin/action',{action:'set_cpu_attack',code:'ADMINTEST',target:victim.id},cookie);
    assert.equal(denied.res.status,400);
    assert.match(denied.json.error,/人間の人狼/);
  }finally{await app.close();}
});


test('admin can force-kill and revive a player during a running game',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'test-admin'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const login=await post(base,'/admin/login',{password:'test-admin'});
    assert.equal(login.res.status,200);
    const cookie=login.res.headers.get('set-cookie').split(';')[0];

    const roles=['wolf','seer','guard','villager'];
    const made=await post(base,'/admin/action',{action:'create_cpu_watch',count:4,code:'LIFETEST',roles},cookie);
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    const g=app.rooms.get('LIFETEST').game;
    const target=g.players.find(p=>p.role==='seer');
    assert.equal(target.alive,true);

    const killed=await post(base,'/admin/action',{action:'force_kill',code:'LIFETEST',playerId:target.id},cookie);
    assert.equal(killed.res.status,200,JSON.stringify(killed.json));
    assert.equal(target.alive,false);
    assert.equal(target.deathCause,'admin');

    const revived=await post(base,'/admin/action',{action:'force_revive',code:'LIFETEST',playerId:target.id},cookie);
    assert.equal(revived.res.status,200,JSON.stringify(revived.json));
    assert.equal(target.alive,true);
    assert.equal(target.deathAt,null);
    assert.equal(target.deathCause,null);
  }finally{await app.close();}
});


test('admin can broadcast a narration to every player view in a room',async()=>{
  const app=createApp({tickMs:1000000,adminPassword:'test-admin'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const login=await post(base,'/admin/login',{password:'test-admin'});
    assert.equal(login.res.status,200);
    const cookie=login.res.headers.get('set-cookie').split(';')[0];

    const roles=['wolf','seer','guard','villager'];
    const made=await post(base,'/admin/action',{action:'create_cpu_watch',count:4,code:'NARRATE',roles},cookie);
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    const g=app.rooms.get('NARRATE').game;

    const sent=await post(base,'/admin/action',{action:'broadcast_narration',code:'NARRATE',text:'管理者から全員へテスト'},cookie);
    assert.equal(sent.res.status,200,JSON.stringify(sent.json));
    assert.equal(g.adminNarration.text,'管理者から全員へテスト');
    assert.ok(g.adminNarration.id>=1);

    for(const p of g.players){
      const view=g.view(p.id);
      assert.equal(view.adminNarration.text,'管理者から全員へテスト');
      assert.equal(view.adminNarration.id,g.adminNarration.id);
    }
  }finally{await app.close();}
});
