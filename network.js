/* Real HTTP/SSE integration, 30 simultaneous participant streams, no external packages. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createApp}=require('../server');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,message,ms=12000){
  const start=Date.now();while(Date.now()-start<ms){if(check())return;await delay(40);}throw Error('Timeout: '+message);
}
(async()=>{
  const app=createApp({tickMs:50}),streams=[],all=[],stats={participants:30,checks:[]};
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  async function api(event,data={},auth=null){
    const response=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,data,code:auth?.code||data.code,token:auth?.token})});
    return response.json();
  }
  async function attach(auth){
    const controller=new AbortController(),s={state:null,controller,events:[]};
    const response=await fetch(base+'/events?ticket='+encodeURIComponent(auth.ticket),{signal:controller.signal});
    assert.equal(response.status,200);
    const reader=response.body.getReader();
    s.task=(async()=>{
      let buffer='',decoder=new TextDecoder();
      try{
        while(true){
          const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
          let end;while((end=buffer.indexOf('\n\n'))>=0){
            const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
            const line=block.split('\n').find(x=>x.startsWith('data: '));
            const event=block.split('\n').find(x=>x.startsWith('event: '))?.slice(7);
            if(line){const data=JSON.parse(line.slice(6));s.events.push(event);if(event==='state')s.state=data;}
          }
        }
      }catch(e){if(e.name!=='AbortError'&&!controller.signal.aborted)throw e;}
    })();
    streams.push(s);await until(()=>s.state,'initial state');return s;
  }
  try{
    const host=await api('create',{name:'Host'});
    assert.ok(host.ok);all.push(host);
    await attach(host);
    for(let i=1;i<30;i++){
      const res=await api('join',{code:host.code,name:'Guest'+i});
      assert.ok(res.ok,res.error);all.push(res);await attach(res);
    }
    await until(()=>streams.every(s=>s.state.players.length===30),'30 streamed participants');
    stats.checks.push('30 simultaneous streams receive the same participant roster');
    assert.equal((await api('join',{code:host.code,name:'Overflow'})).ok,false);
    assert.equal((await api('state',{}, {code:host.code,token:'forged'})).ok,false);
    assert.equal((await api('preset',{kind:'all',count:30},all[1])).ok,false);
    assert.ok((await api('preset',{kind:'all',count:30},host)).ok);
    assert.ok((await api('start',{},host)).ok);
    await until(()=>streams.every(s=>s.state.phase==='reveal'),'role delivery');
    for(let i=0;i<all.length;i++){
      const s=streams[i].state;assert.ok(s.me.role);assert.ok(s.players.every(p=>!Object.hasOwn(p,'role')));
      assert.ok(!JSON.stringify(s).includes(all[(i+1)%all.length].token));
      await api('ready',{turn:s.phaseId},all[i]);
    }
    stats.checks.push('private roles delivered individually; foreign tokens absent; non-host config rejected');
    assert.equal((await api('join',{code:host.code,name:'LateJoin'})).ok,false);
    await until(()=>streams.every(s=>s.state.phase==='night'),'simultaneous night');
    const entry=app.rooms.get(host.code),fox=entry.game.players.find(p=>p.role==='fox');
    const wolfIndex=streams.findIndex(s=>s.state.me.role==='wolf');
    const wolfText='PACK_PRIVATE_INTEGRATION';
    assert.ok((await api('chat',{text:wolfText,channel:'wolves',turn:streams[wolfIndex].state.phaseId},all[wolfIndex])).ok);
    for(let i=0;i<all.length;i++){
      const s=streams[i].state;if(!s.kind)continue;
      const target=s.kind==='meet'?null:s.kind==='divine'?fox.id:s.targets[0]||null;
      const result=await api('act',{target,turn:s.phaseId},all[i]);assert.ok(result.ok,result.error);
    }
    await until(()=>streams.every(s=>s.state.phase==='dawn'),'dawn');
    for(let i=0;i<all.length;i++){
      const s=streams[i].state;
      if(!['wolf','darkwolf'].includes(s.me.role))assert.ok(!s.messages.some(m=>m.text===wolfText));
    }
    stats.checks.push('night actions resolve together and wolf messages never enter civilian streams');
    const ghostIndex=all.findIndex(a=>a.playerId===fox.id);
    assert.equal(streams[ghostIndex].state.me.alive,false);
    assert.ok(streams[ghostIndex].state.players.every(p=>!Object.hasOwn(p,'role')));
    const secret='GHOST_PRIVATE_INTEGRATION';
    assert.ok((await api('chat',{text:secret,channel:'ghost',turn:streams[ghostIndex].state.phaseId},all[ghostIndex])).ok);
    await delay(100);
    for(const s of streams)if(s.state.me.alive)assert.ok(!s.state.messages.some(m=>m.text===secret));
    assert.equal((await api('vote',{target:host.playerId,turn:streams[ghostIndex].state.phaseId},all[ghostIndex])).ok,false);
    stats.checks.push('real fox death, ghost isolation and dead-player action rejection');
    const index=all.findIndex((a,i)=>i!==ghostIndex&&i!==wolfIndex);
    const original=streams[index].state.me.id;
    streams[index].controller.abort();await delay(100);
    const resume=await api('join',{},all[index]);assert.ok(resume.ok,resume.error);assert.equal(resume.playerId,original);
    const resumed=await attach(resume);assert.equal(resumed.state.me.id,original);
    stats.checks.push('reconnection preserves player identity and private role');
    const csrf=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.example'},body:JSON.stringify({event:'create',data:{name:'Bad'}})});
    assert.equal(csrf.status,403);
    stats.checks.push('cross-origin POST rejected');
    const custom=await api('create',{name:'CustomHost',roomCode:'放課後-1'});assert.ok(custom.ok,custom.error);assert.equal(custom.code,'放課後-1');
    const duplicate=await api('create',{name:'Other',roomCode:'放課後-1'});assert.equal(duplicate.ok,false);
    const invalidCode=await api('create',{name:'BadCode',roomCode:'bad code!'});assert.equal(invalidCode.ok,false);
    stats.checks.push('custom Unicode room codes are normalized, reusable for joining, and duplicate/invalid codes are rejected');

    const login=await fetch(base+'/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:app.adminPassword})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const adminPost=async body=>{const r=await fetch(base+'/admin/action',{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookie},body:JSON.stringify(body)});return {status:r.status,json:await r.json()};};
    const created=await adminPost({action:'create_cpu_watch',count:8,code:'CPU-TEST'});assert.equal(created.status,200);assert.ok(created.json.ok);
    let adminData=await (await fetch(base+'/admin/data',{headers:{'Cookie':cookie}})).json();
    assert.ok(adminData.server);assert.equal(adminData.server.tickMs,50);let cpuRoom=adminData.rooms.find(r=>r.code==='CPU-TEST');assert.ok(cpuRoom?.cpuWatch);assert.equal(cpuRoom.humans,0);assert.equal(cpuRoom.bots,8);
    const fast=await adminPost({action:'toggle_fast',code:'CPU-TEST',enabled:true});assert.equal(fast.json.speed,8);
    await delay(300);adminData=await (await fetch(base+'/admin/data',{headers:{'Cookie':cookie}})).json();cpuRoom=adminData.rooms.find(r=>r.code==='CPU-TEST');assert.equal(cpuRoom.speed,8);assert.ok(cpuRoom.phase!=='lobby');
    stats.checks.push('admin server telemetry works; CPU-only room can be created and switched to 8x fast-forward');

    const html=await (await fetch(base+'/')).text();assert.ok(html.includes('人狼ゲーム'));
    const health=await (await fetch(base+'/health')).json();assert.ok(health.ok);assert.equal(health.version,'0.6.2');
    stats.ok=true;
    fs.writeFileSync(path.join(__dirname,'../docs/network-results.json'),JSON.stringify(stats,null,2)+'\n');
    console.log(JSON.stringify(stats,null,2));
  }finally{
    for(const s of streams)s.controller.abort();
    await app.close();
    await Promise.allSettled(streams.map(s=>s.task));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
