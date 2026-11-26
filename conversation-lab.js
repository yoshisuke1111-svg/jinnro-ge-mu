'use strict';

const crypto=require('node:crypto');

// 現在はオンライン学習を止め、評価は記録だけする。
// 返答候補は実戦人狼ログだけから作る。
const ONLINE_LEARNING=false;

const STATIC_ALIASES=[
  ['white_leveler',['白レベラー','白レベ','白レベラ']],
  ['black_leveler',['黒レベラー','黒レベ','黒レベラ']],
  ['grave_robber',['墓荒らし','墓荒','墓あらし']],
  ['resetter',['リセッター','リセッタ','リセ']],
  ['cheater',['チーター','チータ']],
  ['medium',['霊媒師','霊媒']],
  ['seer',['占い師','占い']],
  ['guard',['騎士','狩人']],
  ['madman',['狂人']],
  ['wolf',['人狼','狼']],
  ['villager',['村人']],
  ['cpu',['CPU','cpu','ボット','bot']],
  ['co',['CO','co','カミングアウト']]
];

function applyAliases(text,sessionAliases={}){
  let out=String(text||'').normalize('NFKC').toLowerCase();
  const pairs=[];
  for(const [canonical,names] of STATIC_ALIASES){
    for(const name of names)pairs.push([String(name).normalize('NFKC').toLowerCase(),canonical]);
  }
  for(const [alias,canonical] of Object.entries(sessionAliases||{})){
    if(alias&&canonical)pairs.push([String(alias).normalize('NFKC').toLowerCase(),String(canonical).normalize('NFKC').toLowerCase()]);
  }
  pairs.sort((a,b)=>b[0].length-a[0].length);
  for(const [from,to] of pairs)if(from)out=out.split(from).join(to);
  return out;
}

function inferAliasesFromText(text){
  const raw=String(text||'').normalize('NFKC').trim();
  const found={};
  const patterns=[
    /([^\s=＝「」『』]{1,16})\s*[=＝]\s*([^\s=＝「」『』]{1,24})/g,
    /([^\s「」『』]{1,16})って([^\s「」『』]{1,24})のこと/g,
    /([^\s「」『』]{1,16})は([^\s「」『』]{1,24})の略/g
  ];
  for(const re of patterns){
    let m;
    while((m=re.exec(raw))){
      const alias=String(m[1]||'').trim(),canonical=String(m[2]||'').trim();
      if(alias&&canonical&&alias!==canonical)found[alias]=canonical;
    }
  }
  return found;
}

function safeJson(text,fallback=null){
  try{return JSON.parse(String(text));}catch{return fallback;}
}

function normalizeText(text,sessionAliases={}){
  return applyAliases(text,sessionAliases)
    .replace(/[\s　]+/g,'')
    .replace(/[。、,.!！?？「」『』（）()\[\]{}・…ー~〜～:：;；"'\`]/g,'')
    .slice(0,500);
}

function grams(text){
  const s=normalizeText(text);
  const out=new Set();
  if(!s)return out;
  if(s.length===1){out.add(s);return out;}
  for(let i=0;i<s.length-1;i++)out.add(s.slice(i,i+2));
  return out;
}

function dice(a,b){
  const ga=grams(a),gb=grams(b);
  if(!ga.size||!gb.size)return 0;
  let hit=0;
  for(const g of ga)if(gb.has(g))hit++;
  return (2*hit)/(ga.size+gb.size);
}

function scoreExample(input,example,sessionAliases={}){
  const q=normalizeText(input,sessionAliases),p=normalizeText(example.prompt,sessionAliases);
  if(!q||!p)return 0;
  let score=dice(q,p);
  if(q.includes(p)||p.includes(q))score+=0.18;
  const qLen=Math.max(1,q.length),pLen=Math.max(1,p.length);
  score+=Math.min(qLen,pLen)/Math.max(qLen,pLen)*0.08;
  return Math.min(1,score);
}

function cleanReply(text){
  return String(text||'').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,180);
}

function createConversationLab({
  url=process.env.TURSO_DATABASE_URL||'',
  authToken=process.env.TURSO_AUTH_TOKEN||'',
  client=null,
  clientFactory=null,
  logger=console,
  corpusTtlMs=5*60*1000
}={}){
  const enabled=Boolean(String(url).trim()&&String(authToken).trim());
  let db=client,readyPromise=null,cache={at:0,examples:[]},lastError=null;
  const sessionAliases=new Map();

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
        await db.executeMultiple(`
          CREATE TABLE IF NOT EXISTS conversation_lab_sessions (
            session_id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            display_name TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS conversation_lab_turns (
            turn_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            speaker TEXT NOT NULL,
            text TEXT NOT NULL,
            reply_to TEXT,
            source_example_id TEXT,
            confidence REAL,
            feedback INTEGER,
            FOREIGN KEY(session_id) REFERENCES conversation_lab_sessions(session_id)
          );
          CREATE INDEX IF NOT EXISTS idx_conversation_lab_turns_session_created
            ON conversation_lab_turns(session_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_conversation_lab_turns_feedback
            ON conversation_lab_turns(feedback);
        `);
        await db.execute('SELECT 1 AS ok');
        lastError=null;
        return true;
      }catch(error){
        lastError=String(error?.message||error);
        logger.error?.('Conversation lab init failed',lastError);
        return false;
      }
    })();
    return readyPromise;
  }

  async function pageTrainingExamples(limit=2500){
    const examples=[];
    const pageSize=200;
    let offset=0;
    while(examples.length<limit){
      const take=Math.min(pageSize,limit-examples.length);
      const result=await db.execute({
        sql:`SELECT example_id, action_json, context_json
             FROM training_examples
             WHERE action_type='chat'
             ORDER BY recorded_at DESC
             LIMIT ? OFFSET ?`,
        args:[take,offset]
      });
      const rows=result.rows||[];
      if(!rows.length)break;
      for(const row of rows){
        const action=safeJson(row.action_json),context=safeJson(row.context_json);
        if(!action||action.type!=='chat'||String(action.channel||'public')!=='public'||!context)continue;
        const reply=cleanReply(action.text);
        if(!reply||reply.length<1)continue;
        const selfId=context.self?.id;
        const messages=(Array.isArray(context.messages)?context.messages:[])
          .filter(m=>m&&m.channel==='public'&&cleanReply(m.text));
        let source=null;
        for(let i=messages.length-1;i>=0;i--){
          const m=messages[i];
          if(m.playerId!==selfId){source=m;break;}
        }
        const prompt=cleanReply(source?.text||'');
        if(!prompt)continue;
        examples.push({
          id:String(row.example_id||''),
          prompt,
          reply,
          origin:'game'
        });
        if(examples.length>=limit)break;
      }
      offset+=rows.length;
      if(rows.length<take)break;
    }
    return examples;
  }

  async function positiveLabExamples(limit=600){
    const result=await db.execute({
      sql:`SELECT a.turn_id AS ai_id, a.text AS reply, u.text AS prompt
           FROM conversation_lab_turns a
           JOIN conversation_lab_turns u ON u.turn_id=a.reply_to
           WHERE a.speaker='ai' AND a.feedback=1 AND u.speaker='user'
           ORDER BY a.created_at DESC
           LIMIT ?`,
      args:[limit]
    });
    return (result.rows||[]).map(row=>({
      id:'lab:'+String(row.ai_id||''),
      prompt:cleanReply(row.prompt),
      reply:cleanReply(row.reply),
      origin:'lab'
    })).filter(x=>x.prompt&&x.reply);
  }

  async function loadCorpus({force=false}={}){
    if(!(await init()))return [];
    const now=Date.now();
    if(!force&&cache.examples.length&&now-cache.at<corpusTtlMs)return cache.examples;
    const game=await pageTrainingExamples();
    const lab=ONLINE_LEARNING?await positiveLabExamples():[];
    const seen=new Set(),examples=[];
    for(const e of [...lab,...game]){
      const key=normalizeText(e.prompt)+'\u0000'+normalizeText(e.reply);
      if(!key||seen.has(key))continue;
      seen.add(key);examples.push(e);
    }
    cache={at:now,examples};
    return examples;
  }

  async function recentReplies(sessionId){
    const result=await db.execute({
      sql:`SELECT text FROM conversation_lab_turns
           WHERE session_id=? AND speaker='ai'
           ORDER BY created_at DESC LIMIT 8`,
      args:[sessionId]
    });
    return new Set((result.rows||[]).map(r=>normalizeText(r.text)));
  }

  async function startSession(name=''){
    if(!(await init()))throw Error('会話ラボの保存先に接続できません。');
    const sessionId=crypto.randomUUID(),displayName=cleanReply(name||'あなた').slice(0,24)||'あなた';
    sessionAliases.set(sessionId,{});
    await db.execute({
      sql:'INSERT INTO conversation_lab_sessions (session_id,created_at,display_name) VALUES (?,?,?)',
      args:[sessionId,Date.now(),displayName]
    });
    const corpus=await loadCorpus();
    return {sessionId,displayName,corpusSize:corpus.length};
  }

  async function ensureSession(sessionId){
    if(!sessionId)return false;
    const result=await db.execute({
      sql:'SELECT session_id FROM conversation_lab_sessions WHERE session_id=? LIMIT 1',
      args:[sessionId]
    });
    return Boolean(result.rows?.length);
  }

  function chooseReply(input,corpus,recent,aliases={}){
    let best=null;
    for(const e of corpus){
      const repeatPenalty=recent.has(normalizeText(e.reply))?0.35:1;
      const score=scoreExample(input,e,aliases)*repeatPenalty;
      if(!best||score>best.score)best={...e,score};
    }
    if(!best||best.score<0.045){
      const candidates=corpus
        .filter(e=>!recent.has(normalizeText(e.reply)))
        .filter(e=>e.reply.length>=2&&e.reply.length<=38);
      if(candidates.length){
        const e=candidates[crypto.randomInt(candidates.length)];
        return {...e,score:0.02,lowConfidence:true};
      }
      return {id:null,reply:'まだこの話題の会話例が少ないみたい',score:0,origin:'system',lowConfidence:true};
    }
    return best;
  }

  async function send({sessionId,text}){
    if(!(await init()))throw Error('会話ラボの保存先に接続できません。');
    if(!(await ensureSession(sessionId)))throw Error('会話セッションが見つかりません。新しく始めてください。');
    const clean=cleanReply(text).slice(0,400);
    if(!clean)throw Error('メッセージを入力してください。');

    const aliases=sessionAliases.get(sessionId)||{};
    Object.assign(aliases,inferAliasesFromText(clean));
    sessionAliases.set(sessionId,aliases);

    const userTurnId=crypto.randomUUID(),now=Date.now();
    await db.execute({
      sql:`INSERT INTO conversation_lab_turns
           (turn_id,session_id,created_at,speaker,text)
           VALUES (?,?,?,?,?)`,
      args:[userTurnId,sessionId,now,'user',clean]
    });

    const [corpus,recent]=await Promise.all([loadCorpus(),recentReplies(sessionId)]);
    const picked=chooseReply(clean,corpus,recent,aliases);
    const aiTurnId=crypto.randomUUID();
    await db.execute({
      sql:`INSERT INTO conversation_lab_turns
           (turn_id,session_id,created_at,speaker,text,reply_to,source_example_id,confidence)
           VALUES (?,?,?,?,?,?,?,?)`,
      args:[aiTurnId,sessionId,Date.now(),'ai',picked.reply,userTurnId,picked.id,picked.score]
    });

    return {
      userTurnId,
      aiTurnId,
      reply:picked.reply,
      confidence:picked.score,
      lowConfidence:!!picked.lowConfidence,
      source:picked.origin||'game',
      corpusSize:corpus.length,
      aliases:Object.keys(aliases).length,
      learningActive:ONLINE_LEARNING
    };
  }

  async function feedback({sessionId,turnId,value}){
    if(!(await init()))throw Error('会話ラボの保存先に接続できません。');
    const v=Number(value);
    if(![-1,1].includes(v))throw Error('評価が不正です。');
    const result=await db.execute({
      sql:`UPDATE conversation_lab_turns
           SET feedback=?
           WHERE turn_id=? AND session_id=? AND speaker='ai'`,
      args:[v,turnId,sessionId]
    });
    // 評価は保存するが、ONLINE_LEARNING=false の間は返答候補へ即反映しない。
    return {ok:true,rowsAffected:Number(result.rowsAffected||0),learningActive:ONLINE_LEARNING};
  }

  async function stats(){
    if(!(await init()))return {enabled:false,corpusSize:0,sessions:0,turns:0,positive:0,negative:0,lastError};
    const corpus=await loadCorpus();
    const q=async sql=>Number((await db.execute(sql)).rows?.[0]?.count||0);
    return {
      enabled:true,
      learningActive:ONLINE_LEARNING,
      corpusSize:corpus.length,
      sessions:await q('SELECT COUNT(*) AS count FROM conversation_lab_sessions'),
      turns:await q('SELECT COUNT(*) AS count FROM conversation_lab_turns'),
      positive:await q('SELECT COUNT(*) AS count FROM conversation_lab_turns WHERE feedback=1'),
      negative:await q('SELECT COUNT(*) AS count FROM conversation_lab_turns WHERE feedback=-1'),
      lastError
    };
  }

  async function close(){try{db?.close?.();}catch{}}

  return {init,startSession,send,feedback,stats,loadCorpus,close};
}

module.exports={createConversationLab,normalizeText,scoreExample,dice,applyAliases,inferAliasesFromText,ONLINE_LEARNING};
