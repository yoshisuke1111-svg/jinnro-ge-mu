'use strict';

/*
 * Tursoに貯まった人間の対局ログから、自作AIを学習する。
 *
 * 重要:
 * - AI入力は context_json だけ。truth_json は絶対に入力へ混ぜない。
 * - train/test は「行」ではなく「対局(game_id)」単位で分離する。
 *   同じ試合の一部を答えとして見た状態でテストしないため。
 * - 学習したモデルと成績は Turso の ai_models に保存できる。
 */

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {extractFeatures}=require('./features');
const {actionLabel,trainActionModel,evaluateModel,predict}=require('./action-model');

const TRAINER_VERSION='action-v2-game-split';

function parseJson(text,fallback=null){
  try{return JSON.parse(String(text));}catch{return fallback;}
}

function bucket(text){
  let h=2166136261;
  for(const c of String(text||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0)%10;
}

async function loadExamples(db,limit=50000,{pageSize=250}={}){
  const rows=[];
  const size=Math.max(25,Math.min(500,Number(pageSize)||250));
  let offset=0;

  while(rows.length<limit){
    const take=Math.min(size,limit-rows.length);
    const result=await db.execute({
      sql:`SELECT example_id, game_id, recorded_at, action_json, context_json
           FROM training_examples
           ORDER BY recorded_at ASC, example_id ASC
           LIMIT ? OFFSET ?`,
      args:[take,offset]
    });
    const page=result.rows||[];
    if(!page.length)break;

    for(const row of page){
      const context=parseJson(row.context_json);
      const action=parseJson(row.action_json);
      const label=actionLabel(action);
      if(!context||!label)continue;
      const features=extractFeatures(context);
      if(!features.every(Number.isFinite))continue;
      rows.push({
        id:String(row.example_id||''),
        gameId:String(row.game_id||''),
        recordedAt:Number(row.recorded_at||0),
        phase:String(context.phase||''),
        label,
        features
      });
      if(rows.length>=limit)break;
    }

    offset+=page.length;
    if(page.length<take)break;
  }
  return rows;
}

function splitByGame(examples){
  const games=[...new Set((examples||[]).map(x=>x.gameId).filter(Boolean))];
  if(games.length<2)throw Error('学習用とテスト用に分けるには、少なくとも2試合必要です。');

  let testGames=new Set(games.filter(id=>bucket(id)<2));
  // 31試合程度の初期データでも必ず独立テスト試合を確保する。
  if(!testGames.size)testGames=new Set(games.filter((_,i)=>i%5===0));
  if(testGames.size===games.length)testGames=new Set(games.slice(0,Math.max(1,Math.floor(games.length*.2))));

  let train=examples.filter(x=>!testGames.has(x.gameId));
  let test=examples.filter(x=>testGames.has(x.gameId));

  if(!train.length||!test.length){
    const cut=Math.max(1,Math.floor(games.length*.2));
    testGames=new Set(games.slice(-cut));
    train=examples.filter(x=>!testGames.has(x.gameId));
    test=examples.filter(x=>testGames.has(x.gameId));
  }

  return {
    train,
    test,
    trainGames:[...new Set(train.map(x=>x.gameId))],
    testGames:[...new Set(test.map(x=>x.gameId))]
  };
}

function labelCounts(examples){
  const out={};
  for(const e of examples||[])out[e.label]=(out[e.label]||0)+1;
  return out;
}

function accuracyFor(model,examples){
  if(!examples.length)return {total:0,correct:0,accuracy:0};
  let correct=0;
  for(const e of examples)if(predict(model,e.features).label===e.label)correct++;
  return {total:examples.length,correct,accuracy:correct/examples.length};
}

function majorityBaseline(train,test){
  const counts=labelCounts(train);
  const label=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  if(!label||!test.length)return {label,accuracy:0};
  return {label,accuracy:test.filter(x=>x.label===label).length/test.length};
}

async function datasetMeta(db){
  const result=await db.execute(
    'SELECT COUNT(*) AS count, MAX(recorded_at) AS latest FROM training_examples'
  );
  return {
    rawExamples:Number(result.rows?.[0]?.count||0),
    latestRecordedAt:Number(result.rows?.[0]?.latest||0)
  };
}

async function saveModel(db,bundle){
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS ai_models (
      model_id TEXT PRIMARY KEY,
      trainer_version TEXT NOT NULL,
      dataset_fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      model_type TEXT NOT NULL,
      total_examples INTEGER NOT NULL,
      train_examples INTEGER NOT NULL,
      test_examples INTEGER NOT NULL,
      train_accuracy REAL NOT NULL,
      test_accuracy REAL NOT NULL,
      baseline_accuracy REAL NOT NULL,
      metrics_json TEXT NOT NULL,
      model_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ai_models_active_created
      ON ai_models(active, created_at);
  `);

  const existing=await db.execute({
    sql:'SELECT model_id FROM ai_models WHERE trainer_version=? AND dataset_fingerprint=? ORDER BY created_at DESC LIMIT 1',
    args:[TRAINER_VERSION,bundle.datasetFingerprint]
  });
  const existingId=existing.rows?.[0]?.model_id;
  if(existingId){
    await db.batch([
      {sql:'UPDATE ai_models SET active=0 WHERE active=1',args:[]},
      {sql:'UPDATE ai_models SET active=1 WHERE model_id=?',args:[existingId]}
    ],'write');
    return {modelId:String(existingId),reused:true};
  }

  const modelId=crypto.randomUUID(),now=Date.now();
  await db.batch([
    {sql:'UPDATE ai_models SET active=0 WHERE active=1',args:[]},
    {
      sql:`INSERT INTO ai_models
        (model_id,trainer_version,dataset_fingerprint,created_at,model_type,total_examples,train_examples,test_examples,train_accuracy,test_accuracy,baseline_accuracy,metrics_json,model_json,active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      args:[
        modelId,TRAINER_VERSION,bundle.datasetFingerprint,now,bundle.model.type,
        bundle.training.totalExamples,bundle.training.trainExamples,bundle.training.testExamples,
        bundle.training.trainAccuracy,bundle.training.testAccuracy,bundle.training.baselineAccuracy,
        JSON.stringify(bundle.training),JSON.stringify(bundle.model)
      ]
    }
  ],'write');
  return {modelId,reused:false};
}

async function trainWithClient(db,{limit=50000,persist=true}={}){
  const meta=await datasetMeta(db);
  const all=await loadExamples(db,limit);
  if(all.length<20)throw Error(`学習可能な行動データが ${all.length} 件しかありません。`);

  const split=splitByGame(all);
  const model=trainActionModel(split.train);
  const trainScore=evaluateModel(model,split.train);
  const testScore=evaluateModel(model,split.test);
  const baseline=majorityBaseline(split.train,split.test);

  const discussionTrain=split.train.filter(x=>x.phase==='discussion'&&['speak','silence'].includes(x.label));
  const discussionTest=split.test.filter(x=>x.phase==='discussion'&&['speak','silence'].includes(x.label));
  const discussionScore=accuracyFor(model,discussionTest);

  const datasetFingerprint=[
    TRAINER_VERSION,
    meta.rawExamples,
    meta.latestRecordedAt,
    all.length
  ].join(':');

  const training={
    trainerVersion:TRAINER_VERSION,
    source:'turso.training_examples',
    rawExamples:meta.rawExamples,
    usableExamples:all.length,
    totalExamples:all.length,
    trainExamples:split.train.length,
    testExamples:split.test.length,
    trainGames:split.trainGames.length,
    testGames:split.testGames.length,
    trainAccuracy:trainScore.accuracy,
    testAccuracy:testScore.accuracy,
    baselineLabel:baseline.label,
    baselineAccuracy:baseline.accuracy,
    discussionSpeakSilence:{
      trainExamples:discussionTrain.length,
      testExamples:discussionTest.length,
      testAccuracy:discussionScore.accuracy
    },
    labelCounts:{
      all:labelCounts(all),
      train:labelCounts(split.train),
      test:labelCounts(split.test)
    },
    byLabel:testScore.byLabel
  };

  const bundle={datasetFingerprint,model,training};
  if(persist)bundle.saved=await saveModel(db,bundle);
  return bundle;
}

async function trainAndStoreLatest({
  url=process.env.TURSO_DATABASE_URL||'',
  authToken=process.env.TURSO_AUTH_TOKEN||'',
  limit=Math.max(100,Math.min(200000,Number(process.env.AI_TRAIN_LIMIT||50000)))
}={}){
  url=String(url).trim();authToken=String(authToken).trim();
  if(!url||!authToken)throw Error('TURSO_DATABASE_URL と TURSO_AUTH_TOKEN が必要です。');
  const {createClient}=await import('@libsql/client');
  const db=createClient({url,authToken});
  try{return await trainWithClient(db,{limit,persist:true});}
  finally{db.close();}
}

async function main(){
  const bundle=await trainAndStoreLatest();
  const outPath=process.env.AI_MODEL_OUT||path.join(__dirname,'models','action-model.json');
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,JSON.stringify({...bundle.model,training:bundle.training},null,2)+'\n','utf8');

  console.log('自作AIの学習が完了しました');
  console.log(`利用可能: ${bundle.training.totalExamples}件 / 学習: ${bundle.training.trainExamples}件 / テスト: ${bundle.training.testExamples}件`);
  console.log(`独立試合: 学習${bundle.training.trainGames}試合 / テスト${bundle.training.testGames}試合`);
  console.log(`学習正解率: ${(bundle.training.trainAccuracy*100).toFixed(1)}%`);
  console.log(`テスト正解率: ${(bundle.training.testAccuracy*100).toFixed(1)}%`);
  console.log(`多数派ベースライン: ${(bundle.training.baselineAccuracy*100).toFixed(1)}% (${bundle.training.baselineLabel})`);
  console.log(`発言/沈黙を含む議論テスト: ${(bundle.training.discussionSpeakSilence.testAccuracy*100).toFixed(1)}% / ${bundle.training.discussionSpeakSilence.testExamples}件`);
  console.log(`Turso model: ${bundle.saved.modelId}${bundle.saved.reused?' (reused)':''}`);
  console.log(`モデル: ${outPath}`);
}

if(require.main===module){
  main().catch(error=>{
    console.error('自作AIの学習に失敗:',error.message||error);
    process.exitCode=1;
  });
}

module.exports={
  TRAINER_VERSION,
  loadExamples,
  bucket,
  splitByGame,
  trainWithClient,
  trainAndStoreLatest
};
