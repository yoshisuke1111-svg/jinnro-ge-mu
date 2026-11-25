'use strict';

/*
 * 自作AIの「最初の脳」。
 *
 * 外部のAIライブラリは使わず、多クラス・ロジスティック回帰
 * (softmax regression) をJavaScriptだけで学習する。
 *
 * これはまだ文章を生成するAIではない。
 * 盤面から「次に何をするか」を確率で予測するAI。
 */

const {FEATURE_NAMES}=require('./features');

const ACTION_LABELS=['speak','silence','vote','night_action','special_action'];

function actionLabel(action={}){
  const type=String(action.type||'');
  if(type==='chat'||type==='statement')return 'speak';
  if(type==='silence')return 'silence';
  if(type==='vote')return 'vote';
  if(type==='night_action')return 'night_action';
  if(type==='special_action')return 'special_action';
  return null;
}

function dot(a,b){
  let total=0;
  for(let i=0;i<Math.min(a.length,b.length);i++)total+=a[i]*b[i];
  return total;
}

function softmax(logits){
  const max=Math.max(...logits);
  const exp=logits.map(v=>Math.exp(v-max));
  const sum=exp.reduce((a,b)=>a+b,0)||1;
  return exp.map(v=>v/sum);
}

function predictProbabilities(model,features){
  const logits=model.weights.map(row=>dot(row,features));
  const probabilities=softmax(logits);
  return Object.fromEntries(model.labels.map((label,i)=>[label,probabilities[i]]));
}

function predict(model,features){
  const probabilities=predictProbabilities(model,features);
  let label=model.labels[0],probability=-1;
  for(const [candidate,value] of Object.entries(probabilities)){
    if(value>probability){label=candidate;probability=value;}
  }
  return {label,probability,probabilities};
}

function trainActionModel(examples,{
  epochs=140,
  learningRate=0.08,
  l2=0.0005,
  featureNames=FEATURE_NAMES,
  labels=ACTION_LABELS
}={}){
  const clean=(examples||[]).filter(x=>
    labels.includes(x?.label)&&
    Array.isArray(x?.features)&&
    x.features.length===featureNames.length&&
    x.features.every(Number.isFinite)
  );
  if(!clean.length)throw Error('学習できるデータがありません。');

  const labelIndex=new Map(labels.map((label,i)=>[label,i]));
  const counts=Object.fromEntries(labels.map(label=>[label,0]));
  for(const e of clean)counts[e.label]++;
  const present=labels.filter(label=>counts[label]>0).length||1;

  // 少数クラスが完全に埋もれないよう、出現数の逆数で重み付けする。
  const classWeight=Object.fromEntries(labels.map(label=>[
    label,
    counts[label]?Math.min(5,clean.length/(present*counts[label])):0
  ]));

  const weights=labels.map(()=>Array(featureNames.length).fill(0));

  for(let epoch=0;epoch<epochs;epoch++){
    // 学習率を少しずつ落として、終盤の振動を抑える。
    const lr=learningRate/(1+epoch*0.015);

    for(const example of clean){
      const truth=labelIndex.get(example.label);
      const probs=softmax(weights.map(row=>dot(row,example.features)));
      const sampleWeight=classWeight[example.label]||1;

      for(let k=0;k<labels.length;k++){
        const error=(probs[k]-(k===truth?1:0))*sampleWeight;
        for(let j=0;j<featureNames.length;j++){
          const gradient=error*example.features[j]+l2*weights[k][j];
          weights[k][j]-=lr*gradient;
        }
      }
    }
  }

  return {
    schemaVersion:1,
    type:'multiclass-logistic-regression',
    createdAt:new Date().toISOString(),
    featureNames:[...featureNames],
    labels:[...labels],
    counts,
    weights
  };
}

function evaluateModel(model,examples){
  let correct=0,total=0;
  const byLabel={};
  for(const label of model.labels)byLabel[label]={correct:0,total:0};

  for(const example of examples||[]){
    if(!model.labels.includes(example?.label)||!Array.isArray(example?.features))continue;
    const result=predict(model,example.features);
    total++;
    byLabel[example.label].total++;
    if(result.label===example.label){
      correct++;
      byLabel[example.label].correct++;
    }
  }

  return {
    total,
    correct,
    accuracy:total?correct/total:0,
    byLabel:Object.fromEntries(Object.entries(byLabel).map(([label,v])=>[
      label,
      {...v,accuracy:v.total?v.correct/v.total:0}
    ]))
  };
}

module.exports={
  ACTION_LABELS,
  actionLabel,
  trainActionModel,
  predict,
  predictProbabilities,
  evaluateModel
};
