'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {Game,preset}=require('../shared/rules');
const {captureContext,createTursoStore}=require('../training-data');

function humanGame(){
  const g=new Game({code:'TURSO',seed:42});
  for(let i=1;i<=4;i++)g.addPlayer({id:'p'+i,name:'人間'+i});
  g.applyConfig({...g.config,roles:preset(4)});
  g.start();
  g.beginPhase('discussion');
  return g;
}

test('Turso store creates schema and writes a human training example',async()=>{
  const batches=[];
  const fake={
    async batch(statements,mode){batches.push({statements,mode});return [];},
    async execute(){return {rows:[{ok:1}]};},
    close(){}
  };
  const store=createTursoStore({
    url:'libsql://example.turso.io',
    authToken:'secret',
    client:fake,
    logger:{log(){},warn(){},error(){}}
  });
  assert.equal(await store.init(),true);
  const g=humanGame();
  const example={
    schemaVersion:2,
    recordedAt:Date.now(),
    roomCode:g.code,
    playerId:'p1',
    context:captureContext(g,'p1'),
    action:{type:'chat',channel:'public',text:'誰が怪しい？'}
  };
  assert.equal(await store.persistExample(example,g),true);
  const sql=batches.flatMap(x=>x.statements).map(x=>typeof x==='string'?x:x.sql).join('\n');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS training_games/);
  assert.match(sql,/INSERT INTO training_games/);
  assert.match(sql,/INSERT INTO training_players/);
  assert.match(sql,/INSERT OR IGNORE INTO training_examples/);
  assert.equal(store.status().state,'connected');
  assert.equal(store.status().writes,1);
  await store.close();
});

test('Turso store stays disabled without secrets',async()=>{
  const store=createTursoStore({url:'',authToken:'',logger:{log(){},warn(){},error(){}}});
  assert.equal(await store.init(),false);
  assert.equal(store.status().enabled,false);
  assert.equal(store.status().state,'disabled');
});
