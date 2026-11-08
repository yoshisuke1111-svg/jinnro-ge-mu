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
    .slice(-10)
    .map(m=>({
      speaker:String(m.name||players.get(m.playerId)?.name||'不明').slice(0,24),
      text:String(m.text||'').slice(0,180),
      kind:m.meta?.kind||null,
      target:m.meta?.target?players.get(m.meta.target)?.name||null:null
    }));
  const statement=draft?.statement?{
    kind:draft.statement.kind||null,
    target:draft.statement.target?players.get(draft.statement.target)?.name||null:null,
    role:draft.statement.role||null,
    black:typeof draft.statement.black==='boolean'?draft.statement.black:null
  }:null;
  return {
    mode,
    day:view?.day||null,
    speaker:view?.me?.name||null,
    personality:view?.me?.personality||null,
    statement,
    draft:String(draft?.text||'').slice(0,500),
    recent
  };
}

function buildInput(view,draft,mode){
  const context=publicContext(view,draft,mode);
  return [
    {
      role:'developer',
      content:[
        'あなたはオンライン人狼ゲームのCPU発言を自然な日本語に整える係です。',
        '与えられたdraftの意味・対象・白黒判定・CO内容を絶対に変えないでください。',
        'recentに無い出来事、投票、占い結果、役職情報を作らないでください。',
        'CPUが知っていても公開すべきでない秘密情報を推測・追加しないでください。',
        '「それ」「そこ」など参照先不明の言い方は避け、必要なら相手の名前や内容を短く示してください。',
        '決め台詞、芝居がかった口調、説明臭いAI文は避けてください。',
        '1〜2文、最大120文字程度。発言本文だけを返してください。'
      ].join('\n')
    },
    {
      role:'user',
      content:JSON.stringify(context)
    }
  ];
}

function createAiCpu({
  apiKey=process.env.OPENAI_API_KEY||'',
  enabled=String(process.env.AI_CPU_ENABLED||'')==='1',
  model=process.env.OPENAI_MODEL||DEFAULT_MODEL,
  fetchImpl=globalThis.fetch,
  timeoutMs=7000
}={}){
  const active=Boolean(enabled&&apiKey&&typeof fetchImpl==='function');
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
  return {enabled:active,model,rewrite};
}

module.exports={createAiCpu,extractOutputText,buildInput};
