const test=require('node:test');
const assert=require('node:assert/strict');
const {Game,ROLE_IDS,checkConfig}=require('../shared/rules');

function counts(roles){
  const out=Object.fromEntries(ROLE_IDS.map(k=>[k,0]));
  for(const r of roles)out[r]++;
  return out;
}
function makeGame(roles){
  const g=new Game({code:'TEST',seed:12345});
  g.setBots(roles.length);
  g.applyConfig({...g.config,roles:counts(roles),firstNightSafe:false,testRole:''});
  g.start({allowBotOnly:true,roleOrder:roles});
  return g;
}
function byRole(g,role){return g.players.find(p=>p.role===role);}

test('white and black leveler must be configured as a pair',()=>{
  const roles=['wolf','white_leveler','villager','villager'];
  const cfg={roles:counts(roles),times:{reveal:20,night:30,other:20,dawn:8,discussion:120,vote:30,execution:8},lovers:false,firstNightSafe:false};
  assert.match(checkConfig(cfg,4).join('\n'),/セット/);
});

test('cheater survives wolf attacks but dies from one execution',()=>{
  const g=makeGame(['cheater','wolf','seer','villager']);
  const c=byRole(g,'cheater');
  assert.deepEqual(g.killMany([{id:c.id,cause:'attack'}]),[]);
  assert.equal(c.alive,true);assert.equal(c.cheaterAttackHit,true);
  assert.deepEqual(g.killMany([{id:c.id,cause:'execution'}]),[c.id]);
  assert.equal(c.alive,false);assert.equal(c.cheaterExecutionHit,true);
});

test('only the cheater receives every true role before game end',()=>{
  const g=makeGame(['cheater','wolf','seer','villager']);
  const c=byRole(g,'cheater'),v=byRole(g,'villager');
  const cv=g.view(c.id),vv=g.view(v.id);
  assert.equal(cv.cheaterActive,true);
  assert.ok(cv.players.every(p=>p.role));
  assert.ok(vv.players.filter(p=>p.id!==v.id).every(p=>p.role===undefined));
});

test('cheater blocks normal wins and wins with only wolf-team survivors',()=>{
  const g=makeGame(['cheater','wolf','seer','villager']);
  const c=byRole(g,'cheater');
  for(const p of g.players)if(p.id!==c.id&&p.role!=='wolf')p.alive=false;
  const win=g.computeWin();
  assert.equal(win.kind,'cheater');assert.deepEqual(win.winners,[c.id]);
});

test('seer becomes cheater detector while cheater is alive',()=>{
  const g=makeGame(['seer','cheater','wolf','villager']);
  const seer=byRole(g,'seer'),c=byRole(g,'cheater');
  g.startNight();g.submitAction(seer.id,c.id,g.phaseId,true);g.resolveNight();
  const r=seer.privateResults.find(x=>x.kind==='seer');
  assert.equal(r.mode,'cheater');assert.equal(r.cheater,true);
});

test('thief transfers the stolen role and leaves a villager behind',()=>{
  const g=makeGame(['thief','wolf','seer','villager']);
  const thief=byRole(g,'thief'),seer=byRole(g,'seer');
  g.stealRole(thief,seer);
  assert.equal(thief.role,'seer');assert.equal(seer.role,'villager');
});

test('white leveler exact divination reveals the current role',()=>{
  const g=makeGame(['white_leveler','black_leveler','wolf','villager']);
  const white=byRole(g,'white_leveler'),black=byRole(g,'black_leveler');
  white.levelerLevel=2;g.startNight();
  g.submitSpecialAction(white.id,'leveler_divine',black.id,null,g.phaseId);
  g.resolveNight();
  const r=white.privateResults.find(x=>x.kind==='leveler_seer');
  assert.equal(r.role,'black_leveler');
});

test('level 7 white and black levelers mutually destroy each other',()=>{
  const g=makeGame(['white_leveler','black_leveler','wolf','villager']);
  const white=byRole(g,'white_leveler'),black=byRole(g,'black_leveler');
  white.levelerLevel=6;black.levelerLevel=6;
  g.startNight();g.resolveNight();
  assert.equal(white.levelerLevel,7);assert.equal(black.levelerLevel,7);
  assert.equal(white.alive,false);assert.equal(black.alive,false);
});


test('resetter rewinds to the captured dawn state and can only use it once',()=>{
  const g=makeGame(['resetter','wolf','seer','villager']);
  const resetter=byRole(g,'resetter'),seer=byRole(g,'seer'),villager=byRole(g,'villager');

  g.lastScene={id:10,type:'dawn',victims:[],title:'穏やかな朝'};
  g.startDiscussion(); // captures the dawn snapshot

  g.giveRole(seer,'wolf',{implantedFrom:{role:'seer',state:{}}});
  g.killMany([{id:villager.id,cause:'execution'}]);
  g.lastExecuted=villager.id;
  g.lastScene={id:11,type:'execution',victims:[{id:villager.id,name:villager.name}],title:'投票が確定しました'};

  g.startNight();
  assert.ok(g.specialKinds(resetter).includes('reset'));
  g.submitSpecialAction(resetter.id,'reset',null,null,g.phaseId);
  g.resolveNight();

  assert.equal(g.phase,'dawn');
  assert.equal(villager.alive,true);
  assert.equal(seer.role,'seer');
  assert.equal(resetter.resetUsed,true);
  assert.equal(g.lastScene.id,10);

  g.startDiscussion();
  g.startNight();
  assert.ok(!g.specialKinds(resetter).includes('reset'));
});

test('CPU resetter actually queues a rewind after an execution',()=>{
  const g=makeGame(['resetter','wolf','seer','villager']);
  const resetter=byRole(g,'resetter'),villager=byRole(g,'villager');

  g.startDiscussion();
  g.killMany([{id:villager.id,cause:'execution'}]);
  g.lastExecuted=villager.id;
  g.startNight();

  g.autoSpecial(resetter);
  assert.equal(g.specialActions[resetter.id].reset.length,1);
  g.resolveNight();
  assert.equal(resetter.resetUsed,true);
  assert.equal(villager.alive,true);
});

test('black leveler Lv2 can hide a wolf from exact leveler divination',()=>{
  const g=makeGame(['white_leveler','black_leveler','wolf','villager']);
  const white=byRole(g,'white_leveler'),black=byRole(g,'black_leveler'),wolf=byRole(g,'wolf');
  white.levelerLevel=2;black.levelerLevel=2;
  g.startNight();

  g.submitSpecialAction(black.id,'hide_wolf',wolf.id,null,g.phaseId);
  g.submitSpecialAction(white.id,'leveler_divine',wolf.id,null,g.phaseId);
  g.resolveNight();

  const r=white.privateResults.find(x=>x.kind==='leveler_seer'&&x.target===wolf.id);
  assert.equal(r.role,'unknown');
});

test('black leveler Lv3 implants a wolf and remembers the old role',()=>{
  const g=makeGame(['white_leveler','black_leveler','wolf','villager']);
  const black=byRole(g,'black_leveler'),villager=byRole(g,'villager');
  black.levelerLevel=3;
  g.startNight();

  g.submitSpecialAction(black.id,'implant_wolf',villager.id,null,g.phaseId);
  g.resolveNight();

  assert.equal(villager.role,'wolf');
  assert.equal(villager.implantedFrom.role,'villager');
});

test('black leveler Lv4 can kill two different targets in one night',()=>{
  const g=makeGame(['white_leveler','black_leveler','wolf','villager','villager','villager']);
  const black=byRole(g,'black_leveler');
  const victims=g.players.filter(p=>p.role==='villager').slice(0,2);
  black.levelerLevel=4;
  g.startNight();

  g.submitSpecialAction(black.id,'leveler_kill',victims[0].id,null,g.phaseId);
  g.submitSpecialAction(black.id,'leveler_kill',victims[1].id,null,g.phaseId);
  g.resolveNight();

  assert.equal(victims[0].alive,false);
  assert.equal(victims[1].alive,false);
});

test('black leveler Lv5 is immortal except for the leveler duel',()=>{
  const g=makeGame(['white_leveler','black_leveler','wolf','villager']);
  const black=byRole(g,'black_leveler');
  black.levelerLevel=5;
  assert.deepEqual(g.killMany([{id:black.id,cause:'execution'}]),[]);
  assert.equal(black.alive,true);
  assert.deepEqual(g.killMany([{id:black.id,cause:'leveler_duel'}]),[black.id]);
  assert.equal(black.alive,false);
});

test('black leveler Lv6 hides its name on the board and in new chat messages',()=>{
  const g=makeGame(['white_leveler','black_leveler','wolf','villager']);
  const black=byRole(g,'black_leveler'),viewer=byRole(g,'villager');
  black.levelerLevel=6;
  g.beginPhase('discussion');

  const m=g.message(black,'まだ生きてる','public');
  const publicBlack=g.view(viewer.id).players.find(p=>p.id===black.id);

  assert.equal(publicBlack.name,'？？？');
  assert.equal(m.name,'？？？');
  assert.equal(g.realName(black.id),black.name);
});
