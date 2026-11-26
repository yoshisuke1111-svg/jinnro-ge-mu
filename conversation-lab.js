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

/*
 * 小さな意味辞書。
 * 検索時は表現の違いを概念へ寄せ、出力時は逆に複数の言い回しへ散らす。
 * 外部AIや辞書APIには依存しない。
 */
const SEMANTIC_LEXICON=[
  ['<suspicious>',['怪しい','疑わしい','黒っぽい','狼っぽい','引っかかる','気になる']],
  ['<whiteish>',['白い','白っぽい','村っぽい','村目','白寄り']],
  ['<unknown>',['分からない','わからない','わからん','判断つかない','読めない','何とも言えない']],
  ['<agree>',['そう思う','同意','同じ意見','わかる','それはそう']],
  ['<disagree>',['違うと思う','そうは思わない','反対','微妙だと思う','納得できない']],
  ['<maybe>',['たぶん','多分','おそらく','かもしれない','かも']],
  ['<slightly>',['ちょっと','少し','やや','若干']],
  ['<opinion>',['どう思う','どう見る','どう感じる','どう考える']],
  ['<reason>',['理由','根拠','なんで','なぜ','どうして']],
  ['<vote>',['投票する','投票','入れる','票を入れる']],
  ['<execute>',['吊る','吊り','処刑する','処刑']],
  ['<attack>',['噛む','襲撃する','襲う','噛み']],
  ['<divine>',['占う','占いを見る','占い先にする']],
  ['<protect>',['守る','護衛する','護衛']],
  ['<claim>',['coする','カミングアウトする','役職を名乗る','名乗る']],
  ['<reply>',['返事','返信','反応','リアクション']],
  ['<now>',['今のところ','今んとこ','今は','現在']],
  ['<strong>',['かなり','結構','だいぶ','相当']],
  ['<think>',['思う','感じる','見える','考える']],
  ['<question>',['本当','ほんと','マジ','まじ']]
];

const OUTPUT_LEXICON=[
  [/ちょっと怪しい/gu,['少し気になる','やや疑ってる','少し黒っぽく見える']],
  [/少し怪しい/gu,['ちょっと気になる','やや疑ってる','少し黒く見える']],
  [/怪しいと思う/gu,['気になるかな','疑ってる','黒っぽく見える']],
  [/怪しい/gu,['気になる','疑わしい','黒っぽい']],
  [/白いと思う/gu,['白寄りに見える','村っぽく感じる','今は白めかな']],
  [/白い/gu,['白寄り','村っぽい','白め']],
  [/分からない|わからない|わからん/gu,['まだ判断つかない','まだ読めない','何とも言えない']],
  [/たぶん|多分/gu,['たぶん','おそらく','たぶんだけど']],
  [/そう思う/gu,['そんな気はする','そう見える','自分も近い見方']],
  [/どう思う/gu,['どう見る','どう感じる','どう考えてる']],
  [/理由/gu,['根拠','そう見た理由','理由']],
  [/ちょっと/gu,['少し','やや','ちょい']],
  [/かな$/u,['かも','気がする','と思う']],
  [/だと思う$/u,['かなと思う','って見てる','気がする']],
  [/じゃない\??$/u,['じゃないかな','だと思うけど','っぽくない？']]
];

function semanticNormalize(text){
  let out=String(text||'');
  const pairs=[];
  for(const [concept,forms] of SEMANTIC_LEXICON){
    for(const form of forms)pairs.push([String(form).normalize('NFKC').toLowerCase(),concept]);
  }
  pairs.sort((a,b)=>b[0].length-a[0].length);
  for(const [from,to] of pairs)if(from)out=out.split(from).join(to);
  return out;
}

function stableNumber(text){
  let h=2166136261;
  for(const ch of String(text||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return h>>>0;
}

function paraphraseReply(text,{seed=''}={}){
  const original=String(text||'').trim();
  let out=original;
  let changed=false;
  let salt=stableNumber(seed+'\u0000'+original);
  for(const [pattern,choices] of OUTPUT_LEXICON){
    pattern.lastIndex=0;
    if(!pattern.test(out))continue;
    pattern.lastIndex=0;
    const choice=choices[salt%choices.length];
    salt=Math.imul(salt^0x9e3779b9,16777619)>>>0;
    const next=out.replace(pattern,choice);
    if(next!==out){out=next;changed=true;}
    // 一文を全部置換しすぎない。1〜2箇所の自然な言い換えに留める。
    if(changed&&salt%3===0)break;
  }
  if(!changed){
    // 安全に変えられる語がない短文は、意味を変えにくい終助詞だけ軽く変える。
    if(/だね$/u.test(out))out=out.replace(/だね$/u,'だな');
    else if(/だな$/u.test(out))out=out.replace(/だな$/u,'だね');
    else if(/かな$/u.test(out))out=out.replace(/かな$/u,'かも');
  }
  return cleanReply(out)||original;
}


function staticAliasPairs(){
  const pairs=[];
  for(const [canonical,names] of STATIC_ALIASES){
    for(const name of names)pairs.push([String(name).normalize('NFKC').toLowerCase(),canonical]);
  }
  return pairs.sort((a,b)=>b[0].length-a[0].length);
}

function applyStaticAliases(text){
  let out=String(text||'').normalize('NFKC').toLowerCase();
  for(const [from,to] of staticAliasPairs())if(from)out=out.split(from).join(to);
  return out;
}

function applyAliases(text,sessionAliases={}){
  let out=String(text||'').normalize('NFKC').toLowerCase();
  const pairs=[...staticAliasPairs()];
  for(const [alias,canonical] of Object.entries(sessionAliases||{})){
    if(alias&&canonical)pairs.push([
      String(alias).normalize('NFKC').toLowerCase(),
      applyStaticAliases(canonical)
    ]);
  }
  pairs.sort((a,b)=>b[0].length-a[0].length);
  for(const [from,to] of pairs)if(from)out=out.split(from).join(to);
  // セッション別名の展開先がさらに既知略称だった場合も正式形へ寄せる。
  return applyStaticAliases(out);
}

function inferAliasesFromText(text){
  const raw=String(text||'').normalize('NFKC').trim();
  const found={};
  const patterns=[
    /([^\s=＝「」『』]{1,16})\s*[=＝]\s*([^\s=＝「」『』]{1,24}?)(?=って|と呼|$|[。、,.!！?？])/g,
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
  return semanticNormalize(applyAliases(text,sessionAliases))
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

const RESERVED_NAME_WORDS=new Set([
  '人狼','狼','村人','占い','占い師','霊媒','霊媒師','騎士','狩人','狂人',
  'チーター','リセッター','白レベラー','黒レベラー','墓荒らし',
  'cpu','bot','ボット','co','今日','明日','昨日','今','誰','みんな','全員','自分'
].map(x=>String(x).normalize('NFKC').toLowerCase()));

function usablePersonName(value){
  const name=String(value||'').normalize('NFKC').trim().replace(/(?:さん|くん|君|ちゃん|氏)$/u,'');
  const key=name.toLowerCase();
  if(name.length<2||name.length>16||RESERVED_NAME_WORDS.has(key))return '';
  if(!/^[\p{L}\p{N}_ー・.-]+$/u.test(name))return '';
  return name;
}

function inferPersonNames(text,known=[]){
  const raw=String(text||'').normalize('NFKC');
  const out=[];
  const add=value=>{const name=usablePersonName(value);if(name&&!/(?:どっち|どちら)/u.test(name)&&!out.includes(name))out.push(name);};

  // すでにこの会話で人名として見つけた語は、再登場時にも人名として扱う。
  for(const name of known||[])if(name&&raw.includes(name))add(name);

  // 「田中さん」「佐藤ちゃん」などは強い人名シグナル。
  for(const m of raw.matchAll(/([\p{L}\p{N}_ー・.-]{2,16}?)(?:さん|くん|君|ちゃん|氏)(?=$|[\s、。,.!！?？はがをにともって])/gu))add(m[1]);

  // 「田中と佐藤どっち」のような比較。
  for(const m of raw.matchAll(/([\p{L}\p{N}_ー・.-]{2,12})と([\p{L}\p{N}_ー・.-]{2,12})(?:なら|だと|は)?(?:どっち|どちら)/gu)){
    add(m[1]);add(m[2]);
  }

  // 人狼会話で頻出する「Xどう思う」「X怪しい」など。
  // 文頭や句読点の後だけを見ることで、普通の文章を人名扱いしすぎない。
  const triggers='(?:どう思|怪し|白い|黒い|吊り|吊る|投票|噛み|噛む|占う|占い先|守る|護衛|狼っぽ|村っぽ)';
  const re=new RegExp('(?:^|[\\s、。,.!！?？])([\\p{L}\\p{N}_ー・.-]{2,8}?)(?:さん|くん|君|ちゃん|氏)?(?:は|が|を|に|へ|って)?(?='+triggers+')','gu');
  for(const m of raw.matchAll(re))add(m[1]);

  // 会話の冒頭にある軽い前置きを除去してもう一度見る。
  const stripped=raw.replace(/^(?:正直|今は?|じゃあ|てか|ちなみに|ところで|個人的には?|俺は|私は)[、,\s]*/u,'');
  if(stripped!==raw){
    const m=stripped.match(new RegExp('^([\\p{L}\\p{N}_ー・.-]{2,8}?)(?:さん|くん|君|ちゃん|氏)?(?:は|が|を|に|へ|って)?(?='+triggers+')','u'));
    if(m)add(m[1]);
  }
  return out;
}

function makePersonTemplate(prompt,reply,playerNames=[]){
  const p=String(prompt||''),r=String(reply||''),names=[];
  for(const value of playerNames||[]){
    const name=usablePersonName(value);
    if(name&&!names.includes(name)&&(p.includes(name)||r.includes(name)))names.push(name);
  }
  // 参加者一覧の順ではなく、会話の中で最初に登場した順でスロットを決める。
  names.sort((a,b)=>{
    const ai=Math.min(p.indexOf(a)>=0?p.indexOf(a):1e9,r.indexOf(a)>=0?r.indexOf(a)+p.length+1:1e9);
    const bi=Math.min(p.indexOf(b)>=0?p.indexOf(b):1e9,r.indexOf(b)>=0?r.indexOf(b)+p.length+1:1e9);
    return ai-bi||b.length-a.length;
  });
  const slotByName=new Map(names.map((name,i)=>[name,i+1]));
  const replace=text=>{
    let out=String(text||'');
    for(const name of [...names].sort((a,b)=>b.length-a.length)){
      out=out.split(name).join('{{person'+slotByName.get(name)+'}}');
    }
    return out;
  };
  return {prompt:replace(p),reply:replace(r),personSlots:slotByName.size};
}

function runtimePersonTemplate(text,known=[]){
  const names=inferPersonNames(text,known);
  let templated=String(text||'');
  names.forEach((name,i)=>{templated=templated.split(name).join('{{person'+(i+1)+'}}');});
  return {text:templated,names};
}

function renderPersonTemplate(text,names=[]){
  return String(text||'').replace(/\{\{person(\d+)\}\}/g,(_,n)=>{
    const name=names[Number(n)-1];
    return name||'その人';
  });
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
  const sessionPeople=new Map();

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
        const playerNames=(Array.isArray(context.players)?context.players:[]).map(p=>p?.name).filter(Boolean);
        const templated=makePersonTemplate(prompt,reply,playerNames);
        examples.push({
          id:String(row.example_id||''),
          prompt:templated.prompt,
          reply:templated.reply,
          personSlots:templated.personSlots,
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
    sessionPeople.set(sessionId,[]);
    await db.execute({
      sql:'INSERT INTO conversation_lab_sessions (session_id,created_at,display_name) VALUES (?,?,?)',
      args:[sessionId,Date.now(),displayName]
    });
    const corpus=await loadCorpus();
    return {sessionId,displayName,corpusSize:corpus.length,learningActive:ONLINE_LEARNING};
  }

  async function ensureSession(sessionId){
    if(!sessionId)return false;
    const result=await db.execute({
      sql:'SELECT session_id FROM conversation_lab_sessions WHERE session_id=? LIMIT 1',
      args:[sessionId]
    });
    return Boolean(result.rows?.length);
  }

  function chooseReply(input,corpus,recent,aliases={},people=[]){
    const runtime=runtimePersonTemplate(input,people);
    const comparisonInput=runtime.text;
    const ranked=[];
    for(const e of corpus){
      const rendered=renderPersonTemplate(e.reply,runtime.names);
      const repeatPenalty=recent.has(normalizeText(rendered))?0.35:1;
      const score=scoreExample(comparisonInput,e,aliases)*repeatPenalty;
      ranked.push({...e,score,runtimeNames:runtime.names});
    }
    ranked.sort((a,b)=>b.score-a.score);
    const best=ranked[0];
    if(!best||best.score<0.045){
      const candidates=corpus
        .filter(e=>!recent.has(normalizeText(renderPersonTemplate(e.reply,runtime.names))))
        .filter(e=>e.reply.length>=2&&e.reply.length<=38);
      if(candidates.length){
        const e=candidates[stableNumber(input)%candidates.length];
        return {...e,score:0.02,lowConfidence:true,runtimeNames:runtime.names};
      }
      return {id:null,reply:'まだこの話題の会話例が少ないみたい',score:0,origin:'system',lowConfidence:true};
    }
    const pool=ranked.filter(x=>x.score>=best.score-0.08).slice(0,5);
    return pool[stableNumber(input+'\u0000'+best.id)%pool.length]||best;
  }

  async function send({sessionId,text}){
    if(!(await init()))throw Error('会話ラボの保存先に接続できません。');
    if(!(await ensureSession(sessionId)))throw Error('会話セッションが見つかりません。新しく始めてください。');
    const clean=cleanReply(text).slice(0,400);
    if(!clean)throw Error('メッセージを入力してください。');

    const aliases=sessionAliases.get(sessionId)||{};
    Object.assign(aliases,inferAliasesFromText(clean));
    sessionAliases.set(sessionId,aliases);
    const people=sessionPeople.get(sessionId)||[];
    for(const name of inferPersonNames(clean,people))if(!people.includes(name))people.push(name);
    sessionPeople.set(sessionId,people);

    const userTurnId=crypto.randomUUID(),now=Date.now();
    await db.execute({
      sql:`INSERT INTO conversation_lab_turns
           (turn_id,session_id,created_at,speaker,text)
           VALUES (?,?,?,?,?)`,
      args:[userTurnId,sessionId,now,'user',clean]
    });

    const [corpus,recent]=await Promise.all([loadCorpus(),recentReplies(sessionId)]);
    const picked=chooseReply(clean,corpus,recent,aliases,people);
    const renderedReply=renderPersonTemplate(picked.reply,picked.runtimeNames||people);
    const reply=paraphraseReply(renderedReply,{seed:sessionId+'\u0000'+clean+'\u0000'+picked.id});
    const aiTurnId=crypto.randomUUID();
    await db.execute({
      sql:`INSERT INTO conversation_lab_turns
           (turn_id,session_id,created_at,speaker,text,reply_to,source_example_id,confidence)
           VALUES (?,?,?,?,?,?,?,?)`,
      args:[aiTurnId,sessionId,Date.now(),'ai',reply,userTurnId,picked.id,picked.score]
    });

    return {
      userTurnId,
      aiTurnId,
      reply,
      confidence:picked.score,
      lowConfidence:!!picked.lowConfidence,
      source:picked.origin||'game',
      corpusSize:corpus.length,
      aliases:Object.keys(aliases).length,
      people:people.length,
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

module.exports={createConversationLab,normalizeText,scoreExample,dice,applyAliases,applyStaticAliases,semanticNormalize,paraphraseReply,inferAliasesFromText,inferPersonNames,makePersonTemplate,runtimePersonTemplate,renderPersonTemplate,ONLINE_LEARNING};
