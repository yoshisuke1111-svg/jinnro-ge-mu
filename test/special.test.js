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

test('cheater survives one execution and dies after wolf attack too',()=>{
  const g=makeGame(['cheater','wolf','seer','villager']);
  const c=byRole(g,'cheater');
  assert.deepEqual(g.killMany([{id:c.id,cause:'execution'}]),[]);
  assert.equal(c.alive,true);assert.equal(c.cheaterExecutionHit,true);assert.equal(c.cheaterAttackHit,false);
  assert.deepEqual(g.killMany([{id:c.id,cause:'attack'}]),[c.id]);
  assert.equal(c.alive,false);assert.equal(c.cheaterAttackHit,true);
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
