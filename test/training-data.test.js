'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Training=require('../training-data');
const {Game}=require('../shared/rules');

function humanGame(){
  const g=new Game({code:'TRAIN',seed:123});
  for(let i=0;i<4;i++)g.addPlayer({id:'h'+i,name:'人間'+i});
  g.applyConfig({...g.config,roles:{...Object.fromEntries(Object.keys(g.config.roles).map(k=>[k,0])),villager:2,wolf:1,seer:1}});
  g.start();
  g.startDiscussion();
  return g;
}

test('training captures human action with the pre-action context',()=>{
  const g=humanGame(),entry={};
  const p=g.players[0];
  const before=Training.captureContext(g,p.id);
  Training.recordAction(entry,g,p.id,'chat',{text:'まだ分からん',channel:'public'},before);
  assert.equal(entry.trainingExamples.length,1);
  assert.equal(entry.trainingExamples[0].action.type,'chat');
  assert.equal(entry.trainingExamples[0].action.text,'まだ分からん');
  assert.equal(entry.trainingExamples[0].context.self.role,p.role);
  assert.equal(entry.trainingExamples[0].context.phase,'discussion');
});

test('training ignores rooms containing CPUs',()=>{
  const g=humanGame(),entry={};
  g.players[1].bot=true;
  const out=Training.recordAction(entry,g,g.players[0].id,'chat',{text:'テスト'},Training.captureContext(g,g.players[0].id));
  assert.equal(out,null);
  assert.equal(entry.trainingExamples,undefined);
});

test('silence is recorded as a learnable action for connected humans',()=>{
  let now=100000;
  const g=new Game({code:'SILENCE',seed:2,now:()=>now});
  for(let i=0;i<4;i++)g.addPlayer({id:'p'+i,name:'P'+i});
  g.applyConfig({...g.config,roles:{...Object.fromEntries(Object.keys(g.config.roles).map(k=>[k,0])),villager:2,wolf:1,seer:1}});
  g.start();g.startDiscussion();
  const entry={};
  Training.sampleSilence(entry,g,{minIdleMs:1000,intervalMs:1000});
  now+=1500;
  const n=Training.sampleSilence(entry,g,{minIdleMs:1000,intervalMs:1000});
  assert.equal(n,4);
  assert.ok(entry.trainingExamples.every(x=>x.action.type==='silence'));
});

test('training lifecycle records each human perspective once per phase',()=>{
  const g=humanGame(),entry={};
  const first=Training.trackLifecycle(entry,g);
  assert.equal(first,8); // 4 game_start + 4 phase_start
  assert.equal(Training.trackLifecycle(entry,g),0);
  g.beginPhase('vote');
  assert.equal(Training.trackLifecycle(entry,g),4);
  assert.equal(Training.trackLifecycle(entry,g),0);
});

test('training lifecycle marks the end only once',()=>{
  const g=humanGame(),entry={};
  Training.trackLifecycle(entry,g);
  g.phase='ended';
  g.phaseId++;
  g.winner={team:'village',winners:g.players.slice(0,2).map(p=>p.id)};
  const ended=Training.trackLifecycle(entry,g);
  assert.equal(ended,8); // 4 ended-phase snapshots + 4 game_end snapshots
  assert.equal(Training.trackLifecycle(entry,g),0);
});

test('training exports newline-delimited JSON',()=>{
  const entry={trainingExamples:[{a:1},{b:2}]};
  const out=Training.toJsonl(entry);
  assert.equal(out.split('\n').filter(Boolean).length,2);
  assert.deepEqual(JSON.parse(out.split('\n')[0]),{a:1});
});
