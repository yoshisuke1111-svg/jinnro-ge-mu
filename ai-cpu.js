'use strict';

const DEFAULT_MODEL='gpt-6-luna';
const OPENAI_URL='https://api.openai.com/v1/responses';

function extractOutputText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();
  const parts=[];
  for(const item of data?.output||[]){
    for(const part of item?.content||[]){
      if(part?.type==='output_text'&&typeof part.text==='string')parts.push(part.text);
    }
  }
  return parts.join('\n').trim();
}

function cleanAiText(text,fallback){
  let out=String(text||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  out=out.replace(/^["「『]+|["」』]+$/g,'').trim();
  if(!out)return fallback;
  if(out.length>180)out=out.slice(0,180).replace(/[、,][^、,。！？]*$/,'')||out.slice(0,180);
  return out.trim()||fallback;
}

function publicContext(view,draft,mode){
  const players=new Map((view?.players||[]).map(p=>[p.id,p]));
  const recent=(view?.messages||[])
    .filter(m=>m.channel==='public'&&m.day===view.day)
    .slice(-12)
    .map(m=>({
      id:Number(m.id)||null,
      speaker:String(m.name||players.get(m.playerId)?.name||'不明').slice(0,24),
      text:String(m.text||'').slice(0,180),
      kind:m.meta?.kind||null,
      target:m.meta?.target?players.get(m.meta.target)?.name||null:null
    }));
  const statement=draft?.statement?{
    kind:draft.statement.kind||null,
    target:draft.statement.target?players.get(draft.statement.target)?.name||null:null,
    role:draft.statement.role||null,
    black:typeof draft.statement.black==='boolean'?draft.statement.black:null,
    replyTo:Number(draft.statement.replyTo)||null
  }:null;
  const speaker=view?.me?.name||null;
  const replySourceId=Number(draft?.statement?.replyTo||0);
  const replySource=replySourceId?recent.find(m=>m.id===replySourceId)||null:null;
  return {
    mode,
    day:view?.day||null,
    speaker,
    personality:view?.me?.personality||null,
    statement,
    draft:String(draft?.text||'').slice(0,500),
    recent,
    previousOwn:recent.filter(m=>m.speaker===speaker).slice(-3),
    latestOther:[...recent].reverse().find(m=>m.speaker!==speaker)||null,
    replySource
  };
}

function buildInput(view,draft,mode){
  const context=publicContext(view,draft,mode);
  const casual=mode==='casual';
  const directReply=mode==='reply';
  const rules=directReply?[
    'あなたはオンライン人狼ゲームに参加しているCPUプレイヤーです。replySource は、あなたが今返事をする相手の発言です。',
    'replySourceに対して会話として自然に返してください。ゲームの話ならゲームの話として、雑談なら雑談として答えてください。',
    '「なるほど」「へえ」「それは大変そう」だけで終わらせず、相手の内容に具体的に触れてください。',
    'statementにtarget・role・black等がある場合、その意味と事実は絶対に変えないでください。',
    'recentに無い投票、占い結果、役職、死亡理由などのゲーム内事実を作らないでください。自分だけが知る秘密情報も漏らさないでください。',
    '実在の学校・家・身体・今日の体験をCPU自身の実体験として捏造しないでください。軽い好みやキャラ付けは構いません。',
    '1〜2文、最大120文字程度。発言本文だけを返してください。'
  ]:casual?[
    'あなたはオンライン人狼ゲームに参加しているCPUプレイヤーです。人狼の議論以外の軽い雑談にも自然に参加できます。',
    'latestOther は直前に他の参加者が話した内容です。雑談なら、その内容にちゃんと反応してください。',
    '無理に人狼の話へ戻さないでください。好きな食べ物、学校、眠い、天気、趣味など普通の世間話には普通に返してください。',
    'ただし実在の身体・学校・家・今日の体験など、CPU自身が本当に経験した事実としては語らないでください。好みや軽いキャラ付けは自然な範囲で構いません。',
    'recentに無いゲーム内事実、投票、占い結果、役職情報は作らないでください。秘密情報も漏らさないでください。',
    'draftは保険用の短い仮文です。雑談ではdraftに縛られすぎず、latestOtherへの自然な返答を優先してください。',
    '1〜2文、最大120文字程度。発言本文だけを返してください。'
  ]:[
    'あなたはオンライン人狼ゲームのCPU発言を自然な日本語に整える係です。',
    '与えられたdraftの意味・対象・白黒判定・CO内容を絶対に変えないでください。',
    'recentに無い出来事、投票、占い結果、役職情報を作らないでください。',
    'CPUが知っていても公開すべきでない秘密情報を推測・追加しないでください。',
    '「それ」「そこ」など参照先不明の言い方は避け、必要なら相手の名前や内容を短く示してください。',
    '決め台詞、芝居がかった口調、説明臭いAI文は避けてください。',
    'previousOwnやrecentと同じ言い回しを繰り返さず、意味を保ったまま自然に言い換えてください。',
    '「まだ決め打ちはしない」「発言と投票も見る」のような定型句を毎回付け足さないでください。必要な時だけ使ってください。',
    '1〜2文、最大120文字程度。発言本文だけを返してください。'
  ];
  return [
    {role:'developer',content:rules.join('\n')},
    {role:'user',content:JSON.stringify(context)}
  ];
}

function createAiCpu({
  apiKey=process.env.OPENAI_API_KEY||'',
  enabled=String(process.env.AI_CPU_ENABLED||'')==='1',
  model=process.env.OPENAI_MODEL||DEFAULT_MODEL,
  cpuCount=process.env.AI_CPU_COUNT||3,
  fetchImpl=globalThis.fetch,
  timeoutMs=4500
}={}){
  const active=Boolean(enabled&&apiKey&&typeof fetchImpl==='function');
  const parsedCpuCount=Number(cpuCount);
  const normalizedCpuCount=Math.max(1,Math.min(6,Number.isFinite(parsedCpuCount)?Math.trunc(parsedCpuCount):3));
  async function rewrite({view,draft,mode='talk'}={}){
    const fallback=String(draft?.text||'').trim();
    if(!active||!fallback)return fallback;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(OPENAI_URL,{
        method:'POST',
        headers:{
          'authorization':'Bearer '+apiKey,
          'content-type':'application/json'
        },
        body:JSON.stringify({
          model,
          input:buildInput(view,draft,mode),
          max_output_tokens:120,
          store:false
        }),
        signal:controller.signal
      });
      if(!response.ok){
        let detail='';
        try{detail=(await response.text()).slice(0,240);}catch{}
        throw Error('OpenAI API '+response.status+(detail?': '+detail:''));
      }
      const data=await response.json();
      return cleanAiText(extractOutputText(data),fallback);
    }finally{
      clearTimeout(timer);
    }
  }
  return {enabled:active,model,cpuCount:normalizedCpuCount,rewrite};
}

module.exports={createAiCpu,extractOutputText,buildInput};
