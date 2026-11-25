'use strict';

/*
 * Tursoに貯まった人間の対局ログから、最初の自作AIを学習するスクリプト。
 *
 * 実行:
 *   npm run ai:train
 *
 * 必要な環境変数:
 *   TURSO_DATABASE_URL
 *   TURSO_AUTH_TOKEN
 *
 * 生成物:
 *   ai/models/action-model.json
 *
 * 注意:
 *   学習入力には context_json だけを使う。
 *   truth_json は「正解確認用」であり、AIの入力には絶対に使わない。
 */

const fs=require('node:fs');
const path=require('node:path');
const {extractFeatures}=require('./features');
const {actionLabel,trainActionModel,evaluateModel}=require('./action-model');

function parseJson(text,fallback=null){
  try{return JSON.parse(String(text));}catch{return fallback;}
}

function bucket(text){
  // 同じexampleが毎回同じ train/test 側に入る簡単な決定的分割。
  let h=2166136261;
  for(const c of String(text||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0)%10;
}

async function loadExamples(db,limit){
  const result=await db.execute({
    sql:`SELECT example_id, action_json, context_json
         FROM training_examples
         ORDER BY recorded_at ASC
         LIMIT ?`,
    args:[limit]
  });

  const rows=[];
  for(const row of result.rows||[]){
    const context=parseJson(row.context_json);
    const action=parseJson(row.action_json);
    const label=actionLabel(action);
    if(!context||!label)continue;
    rows.push({
      id:String(row.example_id||''),
      label,
      features:extractFeatures(context)
    });
  }
  return rows;
}

async function main(){
  const url=String(process.env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
  if(!url||!authToken)throw Error('TURSO_DATABASE_URL と TURSO_AUTH_TOKEN が必要です。');

  const limit=Math.max(100,Math.min(200000,Number(process.env.AI_TRAIN_LIMIT||50000)));
  const {createClient}=await import('@libsql/client');
  const db=createClient({url,authToken});

  try{
    const all=await loadExamples(db,limit);
    if(all.length<20){
      console.log(`学習データは現在 ${all.length} 件です。最低20件ほど集まってから学習してください。`);
      return;
    }

    let train=all.filter(x=>bucket(x.id)>=2);
    let test=all.filter(x=>bucket(x.id)<2);

    // データが少ない初期段階では、テスト側が空になることがある。
    if(!test.length){
      test=train.slice(-Math.max(1,Math.floor(train.length*0.2)));
      train=train.slice(0,Math.max(1,train.length-test.length));
    }

    const model=trainActionModel(train);
    const trainScore=evaluateModel(model,train);
    const testScore=evaluateModel(model,test);

    const outPath=process.env.AI_MODEL_OUT||
      path.join(__dirname,'models','action-model.json');
    fs.mkdirSync(path.dirname(outPath),{recursive:true});
    fs.writeFileSync(outPath,JSON.stringify({
      ...model,
      training:{
        source:'turso.training_examples',
        totalExamples:all.length,
        trainExamples:train.length,
        testExamples:test.length,
        trainAccuracy:trainScore.accuracy,
        testAccuracy:testScore.accuracy
      }
    },null,2)+'\n','utf8');

    console.log('自作AIの学習が完了しました');
    console.log(`学習: ${train.length}件 / テスト: ${test.length}件`);
    console.log(`学習正解率: ${(trainScore.accuracy*100).toFixed(1)}%`);
    console.log(`テスト正解率: ${(testScore.accuracy*100).toFixed(1)}%`);
    console.log(`モデル: ${outPath}`);
  }finally{
    db.close();
  }
}

if(require.main===module){
  main().catch(error=>{
    console.error('自作AIの学習に失敗:',error.message||error);
    process.exitCode=1;
  });
}

module.exports={loadExamples,bucket};
