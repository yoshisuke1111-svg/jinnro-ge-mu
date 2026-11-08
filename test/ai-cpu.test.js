'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAiCpu,extractOutputText,buildInput}=require('../ai-cpu');

test('extractOutputText reads Responses API output',()=>{
  assert.equal(extractOutputText({output:[{content:[{type:'output_text',text:'自然な発言'}]}]}),'自然な発言');
});

test('disabled AI falls back to original CPU text',async()=>{
  const ai=createAiCpu({enabled:false,apiKey:'',fetchImpl:null});
  const text=await ai.rewrite({view:{},draft:{text:'元のCPU発言'},mode:'talk'});
  assert.equal(text,'元のCPU発言');
});

test('prompt includes draft and recent public context without hidden game object',()=>{
  const input=buildInput({day:2,me:{name:'CPU A'},players:[{id:'p1',name:'CPU A'},{id:'p2',name:'B'}],messages:[{channel:'public',day:2,playerId:'p2',name:'B',text:'Aを疑っている',meta:{kind:'accuse',target:'p1'}}]}, {text:'Bが気になる。',statement:{kind:'accuse',target:'p2'}}, 'talk');
  const payload=JSON.parse(input[1].content);
  assert.equal(payload.draft,'Bが気になる。');
  assert.equal(payload.statement.target,'B');
  assert.equal(payload.recent[0].speaker,'B');
});
