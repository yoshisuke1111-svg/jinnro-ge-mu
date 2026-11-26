const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('forced room collapse has no warning text and falls from top to bottom',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  const transport=fs.readFileSync(path.join(__dirname,'..','public','transport.js'),'utf8');

  const start=app.indexOf('function playRoomCollapse');
  const end=app.indexOf('const transport=WWTransport.create',start);
  const collapse=app.slice(start,end);

  assert.doesNotMatch(collapse,/禁忌|ADMINISTRATOR OVERRIDE|ROOM COLLAPSE/);
  assert.match(collapse,/sort\(\(a,b\)=>a\.rect\.top-b\.rect\.top\)/);
  assert.match(collapse,/topRatio\*1650/);
  assert.match(collapse,/collapse-fall/);
  assert.match(transport,/collapse-topdown-piece/);
  assert.match(transport,/118vh/);
  assert.doesNotMatch(transport,/collapse-lite-fall/);
});
