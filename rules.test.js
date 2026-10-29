/* Deterministic rule, secrecy and CPU tests; run with Node's built-in test runner. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,simulate}=require('./helpers');
const {Game,ROLE_IDS,ROLES,DEFAULT_TIMES,preset,checkConfig}=require('../shared/rules');
const Bots=require('../shared/bots');

test('16 base roles, with lover as a separate modifier; valid presets through 30 players',()=>{
  assert.equal(ROLE_IDS.length,16);
  for(let n=4;n<=30;n++){
    const config={roles:preset(n),times:DEFAULT_TIMES,lovers:false};
    assert.deepEqual(checkConfig(config,n),[]);
  }
  assert.deepEqual(checkConfig({roles:preset(24,'all'),times:DEFAULT_TIMES,lovers:true},24),[]);
});
test('bad role totals, a single mason, invalid deadlines and wolf-majority starts are rejected',()=>{
  const config={roles:preset(8),times:{...DEFAULT_TIMES},lovers:false};
  config.roles.mason=1;assert.ok(checkConfig(config,8).length);
  config.roles=preset(8);config.times.other=31;assert.ok(checkConfig(config,8).length);
  config.times.other=20;config.roles={...Object.fromEntries(ROLE_IDS.map(k=>[k,0])),wolf:4,villager:4};
  assert.ok(checkConfig(config,8).length);
});
test('names normalize, are unique, and are limited to 16 Unicode characters',()=>{
  const g=new Game();g.addPlayer({id:'a',name:' test '});
  assert.throws(()=>g.addPlayer({id:'b',name:'test'}));
  assert.throws(()=>g.addPlayer({id:'b',name:'a'.repeat(17)}));
  g.addPlayer({id:'b',name:'😀'.repeat(16)});
});
test('only the host can change settings and players cannot start twice',()=>{
  const {g}=fixture(['villager','wolf','seer','guard']);
  assert.throws(()=>g.command('p1','bots',{count:6},Bots),/部屋主/);
  assert.throws(()=>g.start(),/開始/);
});
test('seer result: wolf black; darkwolf, fox and madman white',()=>{
  for(const [role,expected] of [['wolf',true],['darkwolf',false],['fox',false],['madman',false]]){
    const roles=['seer',role,'villager','guard',...(role==='wolf'||role==='darkwolf'?[]:['wolf','villager'])];
    const {g}=fixture(roles);g.day=2;g.startNight();g.submitAction('p0','p1',g.phaseId);
    assert.equal(g.byId('p0').privateResults.at(-1).black,expected);
    assert.throws(()=>g.submitAction('p0','p2',g.phaseId),/確定済み/);
  }
});
test('divining a fox kills it at dawn, not immediately, even under protection',()=>{
  const {g}=fixture(['seer','fox','guard','wolf','villager','villager']);
  g.day=2;g.startNight();g.submitAction('p0','p1');g.submitAction('p2','p1');g.submitAction('p3','p4');
  assert.equal(g.byId('p1').alive,true);
  g.resolveNight();assert.equal(g.byId('p1').alive,false);assert.equal(g.byId('p4').alive,false);
});
test('multiple guards can protect multiple targets; guarded player survives the attack',()=>{
  const {g}=fixture(['wolf','guard','guard','villager','seer','villager']);
  g.day=2;g.startNight();g.submitAction('p0','p3');g.submitAction('p1','p3');g.submitAction('p2','p4');
  g.resolveNight();assert.equal(g.byId('p3').alive,true);
});
test('wolves cannot attack teammates; guard and seer cannot select themselves',()=>{
  const {g}=fixture(['wolf','darkwolf','seer','guard','villager','villager']);
  g.day=2;g.startNight();
  assert.throws(()=>g.submitAction('p0','p1'));
  assert.throws(()=>g.submitAction('p2','p2'));
  assert.throws(()=>g.submitAction('p3','p3'));
});
test('initial night is a meeting, but divination still works',()=>{
  const {g}=fixture(['wolf','seer','villager','guard']);g.startNight();
  assert.equal(g.nightKind(g.byId('p0')),'meet');
  g.submitAction('p0',null);g.submitAction('p1','p0');
  g.resolveNight();assert.equal(g.living().length,4);assert.equal(g.byId('p1').privateResults[0].black,true);
});
test('medium sees black for black wolf, and no medium action is required',()=>{
  const {g}=fixture(['medium','darkwolf','wolf','villager','guard','villager']);
  g.lastExecuted='p1';g.byId('p1').alive=false;g.day=2;g.startNight();
  assert.equal(g.byId('p0').privateResults.at(-1).black,true);
  assert.equal(g.nightKind(g.byId('p0')),null);
});
test('night-timeout delegates actions without kicking; other roles expire at 20 s',()=>{
  const {g,advanceTime}=fixture(['guard','wolf','seer','villager']);
  g.day=2;g.startNight();advanceTime(20100);g.fillActions(Bots,true);
  assert.ok(Object.hasOwn(g.actions,'p0'));assert.ok(!Object.hasOwn(g.actions,'p1'));
  advanceTime(10100);g.fillActions(Bots,true);assert.ok(Object.hasOwn(g.actions,'p1'));assert.ok(Object.hasOwn(g.actions,'p2'));
  assert.equal(g.players.length,4);
});
test('all submitted night actions finish early, never wait for 30 s unnecessarily',()=>{
  const {g,advanceTime}=fixture(['seer','wolf','guard','villager']);
  g.day=2;g.startNight();g.submitAction('p0','p1');g.submitAction('p1','p3');g.submitAction('p2','p3');
  advanceTime(2000);g.checkEarly();assert.equal(g.phase,'dawn');
});
test('stale turn and duplicate votes are rejected',()=>{
  const {g}=fixture(['villager','wolf','seer','guard']);g.startVote();
  assert.throws(()=>g.submitVote('p0','p1',g.phaseId-1),/フェーズ/);
  g.submitVote('p0','p1',g.phaseId);assert.throws(()=>g.submitVote('p0','p2'),/確定済み/);
});
test('tied votes get one runoff; a second tie produces no execution',()=>{
  const {g}=fixture(['villager','wolf','seer','guard']);g.startVote();
  for(const [p,t] of [['p0','p1'],['p1','p0'],['p2','p0'],['p3','p1']])g.submitVote(p,t);
  g.resolveVote();assert.equal(g.phase,'vote');assert.equal(g.round,1);
  for(const [p,t] of [['p0','p1'],['p1','p0'],['p2','p0'],['p3','p1']])g.submitVote(p,t);
  g.resolveVote();assert.equal(g.phase,'execution');assert.equal(g.lastExecuted,null);assert.equal(g.living().length,4);
});
test('vote timeout is abstention, not elimination or inactivity kick',()=>{
  const {g}=fixture(['villager','wolf','seer','guard']);g.startVote();g.resolveVote();
  assert.equal(g.living().length,4);assert.ok(g.voteHistory[0].ballots.every(b=>b.target===null));
});
test('attacked cat takes a participating wolf with it, execution takes one living player',()=>{
  let {g}=fixture(['cat','wolf','seer','guard']);g.day=2;g.startNight();g.submitAction('p1','p0');g.resolveNight();
  assert.equal(g.byId('p0').alive,false);assert.equal(g.byId('p1').alive,false);
  ({g}=fixture(['cat','wolf','seer','guard']));
  const deaths=g.killMany([{id:'p0',cause:'execution'}]);assert.equal(deaths.length,2);
});
test('lover deaths cascade once; cat does not trigger from heartbreak',()=>{
  const {g}=fixture(['cat','wolf','seer','guard','villager','villager']);
  g.byId('p0').lover='p4';g.byId('p4').lover='p0';
  const deaths=g.killMany([{id:'p4',cause:'attack'}],['p1']);
  assert.deepEqual(deaths,['p4','p0']);assert.equal(g.byId('p1').alive,true);
});
test('jester wins only on direct execution; it has priority over ordinary victory',()=>{
  const {g}=fixture(['jester','wolf','seer','villager']);
  g.killMany([{id:'p0',cause:'execution'}]);const result=g.computeWin('p0');
  assert.equal(result.kind,'jester');assert.deepEqual(result.winners,['p0']);
  assert.equal(g.computeWin(null),null);
});
test('lover modifier replaces a jester original win condition',()=>{
  const {g}=fixture(['jester','wolf','seer','guard','villager','villager']);
  g.byId('p0').lover='p4';g.byId('p4').lover='p0';
  g.killMany([{id:'p0',cause:'execution'}]);
  assert.notEqual(g.computeWin('p0')?.kind,'jester');
});
test('plague wins only while alive and all other living players are infected',()=>{
  const {g}=fixture(['plague','wolf','seer','guard']);
  g.infected.add('p1');g.infected.add('p2');assert.equal(g.computeWin(),null);
  g.infected.add('p3');assert.equal(g.computeWin().kind,'plague');
  g.byId('p0').alive=false;assert.notEqual(g.computeWin()?.kind,'plague');
});
test('normal end: lovers before fox before village/wolves; survivors co-win',()=>{
  const {g}=fixture(['fox','wolf','seer','survivor','villager','guard']);
  g.byId('p1').alive=false;
  assert.equal(g.computeWin().kind,'fox');assert.ok(g.computeWin().winners.includes('p3'));
  g.byId('p2').lover='p4';g.byId('p4').lover='p2';
  assert.equal(g.computeWin().kind,'lovers');
  g.byId('p0').alive=false;g.byId('p2').lover=null;g.byId('p4').lover=null;
  assert.equal(g.computeWin().kind,'village');
});
test('revenge accomplishment persists after own death and is an additional win',()=>{
  const {g}=fixture(['avenger','wolf','seer','guard','villager','villager']);
  g.byId('p0').revengeTarget='p4';g.startVote();
  for(const p of g.living())g.submitVote(p.id,p.id==='p4'?'p1':'p4');
  g.resolveVote();assert.ok(g.byId('p0').revengeDone);
  g.byId('p0').alive=false;g.byId('p1').alive=false;
  assert.ok(g.computeWin().winners.includes('p0'));
});
test('madman is not counted as a wolf, and dead village members can win',()=>{
  const {g}=fixture(['wolf','madman','seer','villager']);
  assert.equal(g.computeWin(),null);
  g.byId('p0').alive=false;g.byId('p2').alive=false;
  assert.ok(g.computeWin().winners.includes('p2'));
  assert.ok(!g.computeWin().winners.includes('p1'));
});
test('ghosts cannot vote or act; living players never receive ghost chat',()=>{
  const {g}=fixture(['villager','wolf','seer','guard']);g.byId('p0').alive=false;g.startDiscussion();
  g.chat('p0','幽霊の秘密','ghost');assert.ok(!g.view('p1').messages.some(m=>m.text==='幽霊の秘密'));
  assert.ok(g.view('p0').messages.some(m=>m.text==='幽霊の秘密'));
  assert.throws(()=>g.chat('p0','村に話す','public'));
  g.startVote();assert.throws(()=>g.submitVote('p0','p1'));
  g.startNight();assert.throws(()=>g.submitAction('p0','p1'));
});
test('a dead wolf does not receive future pack messages',()=>{
  const {g}=fixture(['wolf','darkwolf','seer','guard','villager','villager']);
  g.startNight();g.chat('p1','死亡前の相談','wolves');
  g.killMany([{id:'p0',cause:'execution'}]);g.chat('p1','死亡後の秘密','wolves');
  const m=g.view('p0').messages;assert.ok(m.some(x=>x.text==='死亡前の相談'));assert.ok(!m.some(x=>x.text==='死亡後の秘密'));
});
test('other roles, private results, infection state and tokens never enter a public view',()=>{
  const {g}=fixture(['villager','wolf','seer','plague','fanatic','madman']);
  g.infected.add('p0');g.byId('p2').privateResults.push({kind:'seer',target:'p1',black:true});
  const view=g.view('p0');
  assert.ok(view.players.every(p=>!Object.hasOwn(p,'role')));
  assert.deepEqual(view.me.privateResults,[]);assert.deepEqual(view.me.knownWolves,[]);assert.deepEqual(view.me.infected,[]);
  assert.ok(!JSON.stringify(view).includes('"token"'));
  assert.deepEqual(g.view('p4').me.knownWolves,['p1']);assert.deepEqual(g.view('p5').me.knownWolves,[]);
});
test('bots cannot distinguish hidden-role swaps with the same public information',()=>{
  const {g}=fixture(['villager','wolf','seer','guard']);g.startDiscussion();
  const before=g.botView('p0');
  [g.byId('p1').role,g.byId('p3').role]=[g.byId('p3').role,g.byId('p1').role];
  const after=g.botView('p0');assert.deepEqual(after,before);
  assert.deepEqual(Bots.decide(after,{},'vote'),Bots.decide(before,{},'vote'));
});
test('CPU publicly reports an actual private investigation and prioritizes its black target',()=>{
  const {g}=fixture(['seer','wolf','guard','villager']);g.day=2;g.startNight();g.submitAction('p0','p1');g.startDiscussion();
  const speech=Bots.decide(g.botView('p0'),g.byId('p0').brain,'talk');
  assert.equal(speech.statement.target,'p1');assert.equal(speech.statement.black,true);
  g.startVote();assert.equal(Bots.decide(g.botView('p0'),{},'vote').target,'p1');
});
test('wolf and fanatic CPU never vote for a known teammate when alternatives exist',()=>{
  const {g}=fixture(['wolf','darkwolf','seer','guard','fanatic','villager']);g.startVote();
  for(const id of ['p0','p1','p4'])assert.ok(!['p0','p1'].includes(Bots.decide(g.botView(id),{},'vote').target));
});
test('human structured lies are allowed; simple Japanese CO and black/white text is parsed',()=>{
  const {g}=fixture(['wolf','villager','seer','guard']);g.startDiscussion();
  g.publish('p0',{kind:'report',role:'seer',target:'p1',black:true});
  assert.equal(g.reports.at(-1).black,true);
  g.chat('p1','占い師CO。Player0は白','public');
  assert.equal(g.reports.at(-1).playerId,'p1');assert.equal(g.reports.at(-1).black,false);
});
test('board relation statements are public claims and can be used by every role',()=>{
  const {g}=fixture(['wolf','villager','seer','guard']);g.startDiscussion();
  g.publish('p0',{kind:'accuse',target:'p1'});g.publish('p1',{kind:'trust',target:'p2'});g.publish('p2',{kind:'question',target:'p0'});
  const meta=g.view('p3').messages.filter(m=>m.meta).slice(-3).map(m=>m.meta.kind);
  assert.deepEqual(meta,['accuse','trust','question']);
  g.publish('p0',{kind:'report',role:'medium',target:'p2',black:false});
  assert.equal(g.reports.at(-1).role,'medium');assert.equal(g.reports.at(-1).playerId,'p0');
});
test('CPU personality generation is deterministic and includes social reaction traits',()=>{
  const g=new Game({code:'PERS',seed:1});
  const a=g.makePersonality('cpu-a'),b=g.makePersonality('cpu-a'),c=g.makePersonality('cpu-b');
  assert.deepEqual(a,b);assert.notDeepEqual(a,c);
  for(const k of ['tone','sociability','confidence','verbosity','suspicion','reactivity','humor','tempo'])assert.ok(Object.hasOwn(a,k));
});
test('only lobby inactivity kicks; a new host is chosen and active game silence is allowed',()=>{
  let clock=1000;const g=new Game({now:()=>clock});
  g.addPlayer({id:'a',name:'A'});g.addPlayer({id:'b',name:'B'});
  clock+=60000;g.touch('b');g.tick(Bots);assert.equal(g.players.length,2);
  clock+=16000;g.tick(Bots);assert.equal(g.players.length,1);assert.equal(g.host,'b');
  const f=fixture(['villager','wolf','seer','guard']);f.g.startDiscussion();f.advanceTime(76000);f.g.tick(Bots);
  assert.equal(f.g.players.length,4);
});
test('disconnect takeover and next-phase reconnection are controlled safely',()=>{
  const {g,advanceTime}=fixture(['villager','wolf','seer','guard']);g.startDiscussion();g.disconnect('p0');
  advanceTime(14999);g.tick(Bots);assert.equal(g.byId('p0').auto,false);
  advanceTime(2);g.tick(Bots);assert.equal(g.byId('p0').auto,true);
  g.connect('p0');assert.equal(g.byId('p0').auto,true);
  g.startVote();assert.equal(g.byId('p0').auto,false);
});
test('death and ending reveal do not block a second game',()=>{
  const {g}=fixture(['villager','wolf','seer','guard']);
  g.byId('p1').alive=false;g.finish(g.computeWin());
  assert.ok(g.view('p0').players.every(p=>p.role));
  g.reset();assert.equal(g.phase,'lobby');assert.ok(g.players.every(p=>p.role===null&&p.alive));
});
test('multiple complete games, including 24/30 participants and all special roles',()=>{
  for(const [n,kind] of [[4,'basic'],[6,'basic'],[8,'basic'],[12,'third'],[24,'all'],[30,'all']]){
    for(let seed=1;seed<=3;seed++){
      const {g}=simulate({seed:seed*97,n,kind});assert.ok(g.winner);
      for(const m of g.messages.filter(m=>m.channel==='public'&&m.playerId)){
        assert.ok(!/(?:私は|自分は|僕は)人狼(?:です|だ|$)/.test(m.text),m.text);
      }
    }
  }
});

test('host handoff works even after a finished match',()=>{
  let clock=1000;const g=new Game({now:()=>clock});
  g.addPlayer({id:'a',name:'A'});g.addPlayer({id:'b',name:'B'});
  g.phase='ended';g.disconnect('a');clock+=15001;g.tick(Bots);
  assert.equal(g.host,'b');
});
test('guardian CPU prioritizes a lover instead of excluding them',()=>{
  const {g}=fixture(['guard','wolf','seer','villager','medium','villager']);
  g.byId('p0').lover='p4';g.byId('p4').lover='p0';g.day=2;g.startNight();
  assert.equal(Bots.decide(g.botView('p0'),{},'night').target,'p4');
});
test('CPU white-result caveats only mention roles in the actual roster',()=>{
  const {g}=fixture(['seer','wolf','guard','villager']);g.day=2;g.startNight();g.submitAction('p0','p3');g.startDiscussion();
  const msg=Bots.decide(g.botView('p0'),{},'talk').text;
  assert.ok(!msg.includes('黒狼'));assert.ok(!msg.includes('妖狐'));assert.ok(!msg.includes('狂人'));
});
test('dead CPU speaks to ghosts, never living players, and never votes',()=>{
  const {g,advanceTime}=fixture(['villager','wolf','seer','guard']);
  g.byId('p2').alive=false;g.startDiscussion();advanceTime(5000);g.tick(Bots);
  assert.ok(g.messages.some(m=>m.playerId==='p2'&&m.channel==='ghost'));
  assert.ok(!g.view('p0').messages.some(m=>m.playerId==='p2'&&m.channel==='ghost'));
  g.startVote();advanceTime(5000);g.tick(Bots);assert.ok(!Object.hasOwn(g.votes,'p2'));
});
test('bots never receive the solo pinned-role setting',()=>{
  const {g}=fixture(['seer','wolf','guard','villager']);
  g.config.testRole='seer';assert.equal(g.botView('p1').config.testRole,'');
});

test('seer can create at most one divination result per game day',()=>{
  const {g}=fixture(['seer','wolf','guard','villager']);
  g.day=2;g.startNight();g.submitAction('p0','p1');
  assert.equal(g.byId('p0').privateResults.filter(r=>r.kind==='seer'&&r.day===2).length,1);
  // Even if the same-day night phase were restarted by an invalid/manual flow, no second result is allowed.
  g.startNight();
  assert.throws(()=>g.submitAction('p0','p2'),/1日に1回/);
  assert.equal(g.byId('p0').privateResults.filter(r=>r.kind==='seer'&&r.day===2).length,1);
});

test('CPU discussion starts quietly and direct replies are delayed instead of instant',()=>{
  const {g,setTime,advanceTime}=fixture(['villager','wolf','seer','guard']);
  g.startDiscussion();const start=g.startedAt;
  advanceTime(1000);g.tick(Bots);
  assert.equal(g.messages.filter(m=>m.channel==='public'&&m.playerId).length,0);
  g.chat('p0','Player1は今どう見てる？','public');
  g.tick(Bots);
  const b=g.byId('p1').brain;
  assert.ok(b.replyAt>=g.now()+3000);
  const before=g.messages.filter(m=>m.playerId==='p1'&&m.channel==='public').length;
  setTime(b.replyAt-1);g.tick(Bots);
  assert.equal(g.messages.filter(m=>m.playerId==='p1'&&m.channel==='public').length,before);
  setTime(Math.max(b.replyAt,g.botTalkAt)+1);g.tick(Bots);
  assert.ok(g.messages.some(m=>m.playerId==='p1'&&m.channel==='public'));
  assert.ok(g.now()-start>=3000);
});

test('CPU public chatter is globally rate-limited during a normal two-minute discussion',()=>{
  const roles=['villager','wolf','seer','guard','medium','madman','villager','villager'];
  const {g,advanceTime}=fixture(roles,321);g.startDiscussion();
  for(let i=0;i<470;i++){advanceTime(250);g.tick(Bots);if(g.phase!=='discussion')break;}
  const cpuMessages=g.messages.filter(m=>m.channel==='public'&&m.playerId&&g.byId(m.playerId)?.bot);
  assert.ok(cpuMessages.length<=9,`too many CPU messages: ${cpuMessages.length}`);
  assert.ok(cpuMessages.length>=1,'CPUs should still participate');
});

test('normal discussion progression is timer-driven even when nobody presses ready',()=>{
  const {g,setTime}=fixture(['villager','wolf','seer','guard']);
  g.startDiscussion();
  for(const p of g.living())g.ready.add(p.id);
  g.checkEarly();
  assert.equal(g.phase,'discussion','ready flags should not end the discussion early');
  setTime(g.deadline+1);g.tick(Bots);
  assert.equal(g.phase,'vote');
});

test('bot-only games are allowed only through the explicit CPU-watch start option',()=>{
  const g=new Game({code:'CPUONLY',seed:42});
  g.setBots(8);
  assert.throws(()=>g.start(),/人間が1人以上/);
  g.start({allowBotOnly:true});
  assert.equal(g.phase,'reveal');
  assert.equal(g.humans().length,0);
  assert.equal(g.players.length,8);
  assert.ok(g.players.every(p=>p.bot&&p.role));
});
