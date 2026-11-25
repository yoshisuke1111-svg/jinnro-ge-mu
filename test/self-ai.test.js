'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {FEATURE_NAMES,extractFeatures}=require('../ai/features');
const {
  actionLabel,
  trainActionModel,
  predict,
  evaluateModel
}=require('../ai/action-model');

test('self AI feature extractor returns a fixed numeric vector',()=>{
  const context={
    phase:'discussion',
    day:1,
    remainingMs:60000,
    self:{
      id:'me',
      role:'villager',
      alive:true,
      auto:false,
      privateResults:[],
      knownWolves:[],
      knownMasons:[],
      acted:false,
      voted:false
    },
    players:[
      {id:'me',alive:true,connected:true},
      {id:'p2',alive:true,connected:true},
      {id:'p3',alive:false,connected:false},
      {id:'p4',alive:true,connected:true}
    ],
    messages:[
      {playerId:'me',text:'おはよう'},
      {playerId:'p2',text:'おはよう'}
    ],
    claims:[],
    reports:[],
    voteHistory:[],
    legal:{targets:['p2','p4'],specials:[]}
  };

  const features=extractFeatures(context);
  assert.equal(features.length,FEATURE_NAMES.length);
  assert.ok(features.every(Number.isFinite));
  assert.equal(features[FEATURE_NAMES.indexOf('phase_discussion')],1);
  assert.equal(features[FEATURE_NAMES.indexOf('self_alive')],1);
});

test('training action types are grouped into first AI labels',()=>{
  assert.equal(actionLabel({type:'chat'}),'speak');
  assert.equal(actionLabel({type:'statement'}),'speak');
  assert.equal(actionLabel({type:'silence'}),'silence');
  assert.equal(actionLabel({type:'vote'}),'vote');
  assert.equal(actionLabel({type:'night_action'}),'night_action');
  assert.equal(actionLabel({type:'special_action'}),'special_action');
  assert.equal(actionLabel({type:'unknown'}),null);
});

test('self AI can learn a simple pattern without an AI library',()=>{
  const featureNames=['bias','signal'];
  const labels=['speak','silence'];
  const examples=[];

  for(let i=0;i<40;i++){
    examples.push({label:'speak',features:[1,1]});
    examples.push({label:'silence',features:[1,0]});
  }

  const model=trainActionModel(examples,{
    epochs:100,
    learningRate:0.1,
    featureNames,
    labels
  });

  assert.equal(predict(model,[1,1]).label,'speak');
  assert.equal(predict(model,[1,0]).label,'silence');
  assert.ok(evaluateModel(model,examples).accuracy>0.95);
});
