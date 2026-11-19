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

function chatLikeText(text,fallback=''){
  let out=String(text||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  out=out.replace(/^["「『]+|["」』]+$/g,'').trim();
  if(!out)out=String(fallback||'').trim();
  const parts=out.split(/[。]+/).map(x=>x.trim()).filter(Boolean).slice(0,2);
  out=(parts.length?parts.join(' '):out).replace(/[、，,]/g,'').replace(/\s+/g,' ').trim();
  if(out.length>68)out=out.slice(0,68).replace(/\s+\S*$/,'').trim()||out.slice(0,68).trim();
  return out;
}
function validAiText(text,draft){
  const out=String(text||'').trim(),statement=draft?.statement||null;
  if([...out].length<4)return false;
  if(/^(占い|霊媒|人狼|村人|白|黒|CO|ＣＯ|了解|なるほど|へえ|そう|うん|はい)[!！?？]*$/.test(out))return false;
  if(statement?.kind==='report'&&!/(白|黒|人狼ではない|人狼)/.test(out))return false;
  return true;
}
function cleanAiText(text,fallback,draft=null){
  const out=chatLikeText(text,'');
  if(validAiText(out,draft))return out;
  return chatLikeText(fallback,'');
}

function publicContext(view,draft,mode,history=null){
  const players=new Map((view?.players||[]).map(p=>[p.id,p]));
  const sourceHistory=Array.isArray(history)?history:(view?.messages||[]);
  const fullHistory=sourceHistory
    .filter(m=>m.channel==='public'||m.channel==='system')
    .map(m=>({
      id:Number(m.id)||null,
      day:Number(m.day)||null,
      phase:m.phase||null,
      channel:m.channel,
      speaker:String(m.name||players.get(m.playerId)?.name||'村の記録').slice(0,24),
      text:String(m.text||'').slice(0,300),
      kind:m.meta?.kind||null,
      target:m.meta?.target?players.get(m.meta.target)?.name||null:null
    }));
  const recent=fullHistory
    .filter(m=>m.channel==='public'&&m.day===view.day)
    .slice(-12)
    .map(m=>({...m,text:String(m.text||'').slice(0,180)}));
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
    history:fullHistory,
    previousOwn:fullHistory.filter(m=>m.channel==='public'&&m.speaker===speaker).slice(-6),
    latestOther:[...recent].reverse().find(m=>m.speaker!==speaker)||null,
    replySource
  };
}

function buildInput(view,draft,mode,history=null){
  const context=publicContext(view,draft,mode,history);
  const casual=mode==='casual';
  const directReply=mode==='reply';
  const rules=directReply?[
    'あなたはオンライン人狼ゲームに参加しているCPUプレイヤーです。replySource は、あなたが今返事をする相手の発言です。',
    'replySourceに対して会話として自然に返してください。ゲームの話ならゲームの話として、雑談なら雑談として答えてください。',
    'history は試合開始から現在までの公開会話と公開システム記録です。直前だけでなく、必要なら数日前・数十発言前の内容も踏まえてください。',
    'history内で以前出た話題、本人の発言、質問、軽い冗談、疑い先、CO、判定、投票公開後の流れを覚えているように自然につなげてください。',
    'personality の archetype・confidence・questionBias・hedging を反応にも反映してください。慎重なCPUまで強く断定しないでください。',
    '「なるほど」「へえ」「それは大変そう」「それは気になる」だけで終わらせず、replySourceの具体的な言葉や話題に反応してください。',
    'replySourceが「わろた」「悲しい」のような短い感情なら、その感情に直接返してください。「味噌カツ」「アンドロメダ銀河」のような唐突な単語なら、無理に評価せず「急に○○」のような軽い反応でも構いません。',
    '雑談に対して人狼の評価語である「気になる」「材料」「判断」を無理に使わないでください。',
    'draftは仮文なので言い回しには従わなくて構いません。statementにtarget・role・black等がある場合、その意味と事実だけは絶対に変えないでください。',
    '会話相手が疑い・黒判定・質問を向けてきた時は、まずその発言への人間らしい反応を優先してください。定型的な「候補には残す」「反応を見る」で済ませないでください。',
    'recentに無い投票、占い結果、役職、死亡理由などのゲーム内事実を作らないでください。自分だけが知る秘密情報も漏らさないでください。',
    '実在の学校・家・身体・今日の体験をCPU自身の実体験として捏造しないでください。軽い好みやキャラ付けは構いません。',
    'ゲーム中の短いチャットとして、原則1行・8〜45文字くらい、長くても65文字までにしてください。日本語の「。」と「、」は基本使わず、必要なら「？」「！」だけ使ってください。「自分」「自分視点」を主語として多用せず、日本語らしく主語を省いてください。発言本文だけを返してください。'
  ]:casual?[
    'あなたはオンライン人狼ゲームに参加しているCPUプレイヤーです。人狼の議論以外の軽い雑談にも自然に参加できます。',
    'latestOther は直前に他の参加者が話した内容です。雑談なら、その内容にちゃんと反応してください。',
    '無理に人狼の話へ戻さないでください。好きな食べ物、学校、眠い、天気、趣味など普通の世間話には普通に返してください。',
    'ただし実在の身体・学校・家・今日の体験など、CPU自身が本当に経験した事実としては語らないでください。好みや軽いキャラ付けは自然な範囲で構いません。',
    'recentに無いゲーム内事実、投票、占い結果、役職情報は作らないでください。秘密情報も漏らさないでください。',
    'draftは保険用の短い仮文です。雑談ではdraftに縛られすぎず、latestOtherへの自然な返答を優先してください。',
    'ゲーム中の短いチャットとして、原則1行・8〜45文字くらい、長くても65文字までにしてください。日本語の「。」と「、」は基本使わず、必要なら「？」「！」だけ使ってください。発言本文だけを返してください。'
  ]:[
    'あなたはオンライン人狼ゲームのCPU発言を自然な日本語に整える係です。',
    'history は試合開始から現在までの公開会話と公開システム記録です。直前だけでなく過去の公開発言も必要に応じて参照してください。',
    'draftは保険用の仮文です。draftの語順・定型句・説明の型は捨てて構いません。statementの意図・対象・白黒判定・CO内容など事実だけは絶対に変えないでください。',
    '「候補には残す」「本人の反応を見る」「発言と投票も見る」「判定は材料にする」「今見るなら」「優先度」「現時点では」など、ゲームAI・解説者っぽい言い回しを避けてください。普通のチャットなら「今は○○かな」「○○ちょっと気になる」くらいの自然な言い方にしてください。',
    '毎回「結論→理由→保留」の説明文にせず、短い一言、質問、反論、迷い、同意など会話として自然な形を選んでください。',
    'recentに無い出来事、投票、占い結果、役職情報を作らないでください。',
    'CPUが知っていても公開すべきでない秘密情報を推測・追加しないでください。',
    '「それ」「そこ」など参照先不明の言い方は避け、必要なら相手の名前や内容を短く示してください。',
    '決め台詞、芝居がかった口調、説明臭いAI文は避けてください。',
    'previousOwnやrecentと同じ言い回しを繰り返さず、意味を保ったまま自然に言い換えてください。',
    'personality の archetype・confidence・questionBias・hedging を話し方に反映してください。慎重派や迷いがちは断定を避け、聞き役は質問を増やし、強気だけは比較的断定的でも構いません。全員を同じ性格にしないでください。',
    '「まだ決め打ちはしない」「発言と投票も見る」のような定型句を毎回付け足さないでください。必要な時だけ使ってください。',
    'ゲーム中の短いチャットとして、原則1行・8〜45文字くらい、長くても65文字までにしてください。日本語の「。」と「、」は基本使わず、必要なら「？」「！」だけ使ってください。発言本文だけを返してください。'
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
  async function rewrite({view,draft,mode='talk',history=null}={}){
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
          input:buildInput(view,draft,mode,history),
          max_output_tokens:180,
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
      return cleanAiText(extractOutputText(data),fallback,draft);
    }finally{
      clearTimeout(timer);
    }
  }
  return {enabled:active,model,cpuCount:normalizedCpuCount,rewrite};
}

module.exports={createAiCpu,extractOutputText,buildInput};
