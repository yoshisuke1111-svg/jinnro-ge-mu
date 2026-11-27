'use strict';

function clean(value,max=300){
  return String(value||'').normalize('NFKC').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,max);
}

const STOP=new Set([
  'です','ます','だよ','だね','かな','けど','でも','から','ので','のに','って','する','した','して','いる','ある',
  'これ','それ','あれ','ここ','そこ','この','その','あの'
]);

function tokens(text){
  const raw=clean(text).toLowerCase();
  const out=[];
  for(const word of raw.match(/[a-z0-9_]+/g)||[])if(word.length>1&&!STOP.has(word))out.push('w:'+word);
  for(const segment of raw.match(/[ぁ-んァ-ヶー一-龠々]+/g)||[]){
    if(segment.length<=4&&!STOP.has(segment))out.push('p:'+segment);
    for(let n=2;n<=3;n++){
      for(let i=0;i<=segment.length-n;i++){
        const gram=segment.slice(i,i+n);
        if(!STOP.has(gram))out.push('g:'+gram);
      }
    }
  }
  return [...new Set(out)].slice(0,28);
}

function cosineMap(a,b){
  if(!a.size||!b.size)return 0;
  let dot=0,aa=0,bb=0;
  for(const v of a.values())aa+=v*v;
  for(const v of b.values())bb+=v*v;
  for(const [k,v] of a)if(b.has(k))dot+=v*b.get(k);
  if(!aa||!bb)return 0;
  return dot/Math.sqrt(aa*bb);
}

function buildSemanticModel(rows=[]){
  const messages=(rows||[]).map(row=>({
    id:String(row.message_id||row.id||''),
    room:String(row.room_code||row.room||''),
    seq:Number(row.sequence_no||row.seq||0),
    at:Number(row.sent_at||row.at||0),
    participant:String(row.participant_id||row.participantId||''),
    text:clean(row.text),
    replyTo:row.reply_to?String(row.reply_to):null
  })).filter(x=>x.id&&x.text);

  messages.sort((a,b)=>a.room.localeCompare(b.room)||a.seq-b.seq||a.at-b.at);
  const byId=new Map(messages.map(m=>[m.id,m]));
  const previousByRoom=new Map();
  const freq=new Map(),assoc=new Map();
  let pairCount=0;

  const add=(map,key,delta)=>map.set(key,(map.get(key)||0)+delta);
  const connect=(left,right,weight)=>{
    const lt=tokens(left),rt=tokens(right);
    if(!lt.length||!rt.length)return;
    pairCount++;
    for(const t of lt)add(freq,t,1);
    for(const t of rt)add(freq,t,1);
    for(const a of lt){
      let m=assoc.get(a);if(!m){m=new Map();assoc.set(a,m);}
      for(const b of rt){
        if(a===b)continue;
        add(m,b,weight);
      }
    }
    for(const a of rt){
      let m=assoc.get(a);if(!m){m=new Map();assoc.set(a,m);}
      for(const b of lt){
        if(a===b)continue;
        add(m,b,weight);
      }
    }
  };

  for(const m of messages){
    const explicit=m.replyTo&&byId.get(m.replyTo);
    const prev=previousByRoom.get(m.room);
    if(explicit)connect(explicit.text,m.text,1.35);
    else if(prev&&prev.participant!==m.participant&&(!m.at||!prev.at||m.at-prev.at<=120000))connect(prev.text,m.text,1);
    previousByRoom.set(m.room,m);
  }

  const neighbors=new Map();
  for(const [source,map] of assoc){
    const sf=Math.max(1,freq.get(source)||1);
    const scored=[...map.entries()].map(([target,count])=>{
      const tf=Math.max(1,freq.get(target)||1);
      return [target,count/Math.sqrt(sf*tf)];
    }).filter(([,score])=>score>=0.08).sort((a,b)=>b[1]-a[1]).slice(0,12);
    if(scored.length)neighbors.set(source,scored);
  }
  return {messages:messages.length,pairs:pairCount,vocab:neighbors.size,neighbors};
}

function vectorFor(text,model,{expand=true}={}){
  const base=tokens(text);
  const vec=new Map();
  for(const t of base)vec.set(t,1);
  if(expand){
    for(const t of base){
      for(const [other,score] of model.neighbors.get(t)||[]){
        const weight=Math.min(.72,.18+score*.42);
        vec.set(other,Math.max(vec.get(other)||0,weight));
      }
    }
  }
  return {base,vec};
}

function readableToken(token){
  return String(token||'').replace(/^[wpg]:/,'');
}

function conceptsFor(text,model){
  const base=new Set(tokens(text));
  const score=new Map();
  for(const t of base){
    for(const [other,value] of model.neighbors.get(t)||[]){
      if(base.has(other))continue;
      score.set(other,Math.max(score.get(other)||0,value));
    }
  }
  return [...score.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([token,value])=>({
    token:readableToken(token),score:Math.round(value*100)/100
  }));
}

function compareWithModel(a,b,model){
  const leftBase=vectorFor(a,model,{expand:false});
  const rightBase=vectorFor(b,model,{expand:false});
  const left=vectorFor(a,model,{expand:true});
  const right=vectorFor(b,model,{expand:true});
  const surface=cosineMap(leftBase.vec,rightBase.vec);
  const learned=cosineMap(left.vec,right.vec);
  const dataFactor=Math.min(1,model.pairs/80);
  const total=Math.max(0,Math.min(1,surface*(.48-.18*dataFactor)+learned*(.52+.18*dataFactor)));
  return {
    score:total,
    surface,
    learned,
    corpus:{messages:model.messages,pairs:model.pairs,vocab:model.vocab},
    left:{tokens:leftBase.base.map(readableToken),learnedConcepts:conceptsFor(a,model)},
    right:{tokens:rightBase.base.map(readableToken),learnedConcepts:conceptsFor(b,model)},
    confidence:model.pairs<20?'very_low':model.pairs<80?'low':model.pairs<300?'medium':'growing'
  };
}

function createMeaningAi({
  url=process.env.TURSO_DATABASE_URL||'',
  authToken=process.env.TURSO_AUTH_TOKEN||'',
  client=null,
  clientFactory=null,
  logger=console,
  cacheMs=120000
}={}){
  const enabled=Boolean(client||(String(url).trim()&&String(authToken).trim()));
  let db=client,readyPromise=null,lastError=null,cache={at:0,model:buildSemanticModel([])};

  async function init(){
    if(readyPromise)return readyPromise;
    readyPromise=(async()=>{
      if(!enabled)return false;
      try{
        if(!db){
          const factory=clientFactory||(async config=>{
            const mod=await import('@libsql/client');
            return mod.createClient(config);
          });
          db=await factory({url:String(url),authToken:String(authToken)});
        }
        await db.execute('SELECT 1 AS ok');
        lastError=null;
        return true;
      }catch(error){
        lastError=String(error?.message||error);
        logger.warn?.('Meaning AI init failed',lastError);
        try{db?.close?.();}catch{}
        db=null;readyPromise=null;
        return false;
      }
    })();
    return readyPromise;
  }

  async function loadModel({force=false}={}){
    if(!force&&Date.now()-cache.at<cacheMs)return cache.model;
    if(!(await init()))return cache.model;
    try{
      const result=await db.execute({
        sql:`SELECT message_id,room_code,sequence_no,sent_at,participant_id,text,reply_to
             FROM casual_chat_messages
             WHERE training_consent=1
             ORDER BY sent_at DESC
             LIMIT 2500`,
        args:[]
      });
      const model=buildSemanticModel(result.rows||[]);
      cache={at:Date.now(),model};lastError=null;
      return model;
    }catch(error){
      // The human-chat table may not exist before the first chat room is used.
      lastError=String(error?.message||error);
      return cache.model;
    }
  }

  async function compare(a,b){
    const left=clean(a),right=clean(b);
    if(!left||!right)throw Error('比べる文を2つ入力してください。');
    const model=await loadModel();
    return compareWithModel(left,right,model);
  }

  async function stats(){
    const model=await loadModel();
    return {enabled,...model,lastError};
  }

  async function close(){try{db?.close?.();}catch{}}
  return {init,loadModel,compare,stats,close};
}

module.exports={createMeaningAi,tokens,buildSemanticModel,compareWithModel,cosineMap};
