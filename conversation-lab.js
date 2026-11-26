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
  ['baker',['パン屋']],
  ['cat',['猫又']],
  ['mason',['共有者','共有']],
  ['madman',['狂人']],
  ['fanatic',['狂信者','狂信']],
  ['fox',['妖狐','狐']],
  ['jester',['てるてる坊主','てるてる','テルテル']],
  ['plague',['疫病神']],
  ['survivor',['生存者']],
  ['avenger',['復讐者']],
  ['thief',['泥棒']],
  ['darkwolf',['黒狼']],
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
  ['<question>',['本当','ほんと','マジ','まじ']],
  ['<understand>',['分かる','わかる','理解できる','理解する','把握する']],
  ['<dontknow>',['知らない','知らん','存じない','聞いたことない']],
  ['<know>',['知ってる','知っている','分かってる','把握してる']],
  ['<like>',['好き','好み','気に入ってる','いいと思う']],
  ['<dislike>',['嫌い','苦手','好きじゃない','微妙']],
  ['<good>',['良い','いい','よさそう','良さそう','アリ']],
  ['<bad>',['悪い','よくない','ダメ','駄目','なし']],
  ['<happy>',['嬉しい','うれしい','楽しい','テンション上がる']],
  ['<sad>',['悲しい','かなしい','つらい','寂しい','さみしい']],
  ['<surprise>',['驚いた','びっくりした','意外','まさか']],
  ['<possible>',['ありえる','あり得る','可能性ある','ありそう']],
  ['<unlikely>',['なさそう','可能性低い','薄そう','考えにくい']],
  ['<want>',['したい','やりたい','欲しい','ほしい']],
  ['<say>',['言う','話す','しゃべる','喋る','発言する']],
  ['<ask>',['聞く','質問する','尋ねる','訊く']],
  ['<answer>',['答える','返す','返答する','返信する']],
  ['<compare>',['比べる','比較する','どっち','どちら']],
  ['<same>',['同じ','一緒','同様','似てる']],
  ['<different>',['違う','別','異なる','違ってる']],
  ['<important>',['大事','重要','大切','ポイント']],
  ['<easy>',['簡単','易しい','楽','すぐできる']],
  ['<hard>',['難しい','むずい','困難','きつい']],
  ['<fast>',['速い','早い','すぐ','高速']],
  ['<slow>',['遅い','ゆっくり','時間かかる']],
  ['<many>',['多い','たくさん','いっぱい','大量']],
  ['<few>',['少ない','ちょっとしかない','わずか']],
  ['<before>',['前','以前','さっき','この前']],
  ['<after>',['後','あとで','その後','次']],
  ['<because>',['だから','なので','そのため','ゆえに']],
  ['<but>',['でも','けど','ただ','とはいえ']]
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
  [/じゃない\??$/u,['じゃないかな','だと思うけど','っぽくない？']],
  [/分かる|わかる/gu,['分かる','理解できる','それは分かる']],
  [/知らない|知らん/gu,['知らないな','それは知らない','聞いたことない']],
  [/いいと思う/gu,['よさそう','アリだと思う','悪くないと思う']],
  [/難しい/gu,['むずい','結構難しい','簡単ではない']],
  [/簡単/gu,['わりと楽','そこまで難しくない','すぐできそう']],
  [/すごい/gu,['かなりすごい','おお すごい','それは強い']],
  [/本当\??/gu,['ほんと？','マジ？','本当に？']],
  [/でも/gu,['ただ','けど','とはいえ']],
  [/だから/gu,['なので','それで','だからこそ']]
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

const ROLE_DISPLAY={
  white_leveler:'白レベラー',black_leveler:'黒レベラー',grave_robber:'墓荒らし',
  resetter:'リセッター',cheater:'チーター',medium:'霊媒師',seer:'占い師',
  guard:'騎士',baker:'パン屋',cat:'猫又',mason:'共有者',madman:'狂人',
  fanatic:'狂信者',fox:'妖狐',jester:'てるてる坊主',plague:'疫病神',
  survivor:'生存者',avenger:'復讐者',thief:'泥棒',darkwolf:'黒狼',
  wolf:'人狼',villager:'村人'
};

function roleMentions(text){
  const raw=String(text||'').normalize('NFKC').toLowerCase();
  const found=[];
  for(const [canonical,names] of STATIC_ALIASES){
    if(!ROLE_DISPLAY[canonical])continue;
    if(names.some(name=>raw.includes(String(name).normalize('NFKC').toLowerCase()))&&!found.includes(canonical))found.push(canonical);
  }
  return found;
}

function numericMentions(text){
  return [...String(text||'').normalize('NFKC').matchAll(/\d+(?:\.\d+)?/g)].map(m=>m[0]);
}

const GAME_TOPIC_RE=/(?:人狼|狼|村人|村目|黒っぽ|白っぽ|怪しい|疑わしい|吊り|吊る|処刑|投票|票|噛み|噛む|襲撃|占い|占う|霊媒|騎士|狩人|護衛|狂人|狂信|妖狐|狐|てるてる|役職|co|ＣＯ|対抗|チーター|リセッター|レベラー|墓荒らし|泥棒)/iu;

function hasGameTopic(text){
  return GAME_TOPIC_RE.test(String(text||''));
}

function historyText(history=[]){
  return (Array.isArray(history)?history:[]).slice(-3).map(turn=>[turn?.user,turn?.ai].filter(Boolean).join(' ')).join(' ');
}

function classifyIntent(text,{history=[]}={}){
  const prior=historyText(history);
  const raw=cleanReply(text).normalize('NFKC');
  const compact=raw.replace(/[\s　。、,.!！?？~〜～…]+/g,'');
  if(!compact)return {type:'empty'};

  if(/^(?:初めまして|はじめまして)$/u.test(compact)){
    return {type:'greeting',variant:'first_meeting'};
  }
  if(/^(?:久しぶり|ひさしぶり|お久しぶり)$/u.test(compact)){
    return {type:'greeting',variant:'reunion'};
  }
  if(/^(?:こんにちは|こんちは|こんばんは|おはよう|おはよ|やあ|どうも|よろしく|よろしくお願いします)$/u.test(compact)){
    return {type:'greeting',variant:'normal'};
  }

  if(
    /(?:人間|普通).*(?:そんな|そういう).*(?:しゃべ|喋|話し|言い).*(?:しない|ません|ない)/u.test(raw)||
    /(?:返し|返答|返信|しゃべり方|喋り方|話し方|口調|言い方|会話).*(?:おかしい|変|不自然|違う|人間っぽくない)/u.test(raw)||
    /^(?:うーん|うん|いや|んー|なんか|やっぱり|やっぱ)?(?:まだ)?(?:おかしい|変|不自然)(?:か|な|ね)?$/u.test(compact)
  ){
    return {type:'critique'};
  }

  if(/^(?:お前|君|きみ|あなた|あんた)(?:は|が)?(?:ちょっと|少し|かなり|だいぶ)?(?:怪しい|疑わしい|黒っぽい|狼っぽい|人狼っぽい|人狼だろ|狼だろ)(?:と思う|かも|な|ね)?$/u.test(compact)){
    return {type:'accusation'};
  }

  if(/^(?:何|なに)(?:を)?(?:しよう|する|しよ|やろう|やる)(?:ね|か|かな)?$/u.test(compact)||
     /^(?:何|なに)(?:か)?(?:しよう|する|やろう)(?:ね|か|かな)?$/u.test(compact)){
    return {type:'activity'};
  }

  if(/(?:なんとかなる|何とかなる|どうにかなる|大丈夫(?:だよ|さ|だ)?)/u.test(raw)){
    return {type:'reassurance'};
  }

  if(/(?:答えられない|答えれない|答えられん|答えれん|分からないよね|わからないよね|知らないよね)/u.test(raw)){
    return {type:'meta_limit'};
  }

  if(/(?:どこまで|どのくらい|どれくらい|何を|なにを).*(?:知りたい|聞きたい|知りたいの|聞きたいの)/u.test(raw)){
    return {type:'scope_question',askedForDetail:/(?:詳しく|具体的|もう少し)/u.test(prior)};
  }

  if(/^(?:私|わたし|僕|ぼく|俺|自分)(?:には|は|も)?.*(?:想像(?:が)?つかない|想像できない|分からない|わからない|知らない)/u.test(raw)){
    return {type:'uncertainty'};
  }

  if(
    /(?:あなた|君|きみ|お前|あんた).*(?:いつか|将来|これから).*(?:大人|成長|変わ|なれる|なる|できる|知る)/u.test(raw)||
    /(?:いつか|将来|これから).*(?:あなた|君|きみ|お前|あんた).*(?:大人|成長|変わ|なれる|なる|できる|知る)/u.test(raw)
  ){
    return {type:'personal_future'};
  }

  if(/(?:だろうね|だろうな|かもしれないね|かもね)[。.!！?？]*$/u.test(raw)&&!hasGameTopic(raw)){
    return {type:'soft_prediction'};
  }

  const roles=roleMentions(raw);
  const selfRolePrefix=/^(?:俺|僕|ぼく|私|わたし|自分)(?:は|が)?(?:役職は)?/u.test(raw);
  const roleEnding=/(?:です|だよ|だ|co|ＣＯ)[。.!！?？]*$/iu.test(raw);
  if(roles.length&&(selfRolePrefix||roleEnding)){
    return {type:'role_claim',role:roles[0]};
  }

  const intro=raw.match(/^(?:俺|僕|ぼく|私|わたし|自分)?(?:は)?\s*([^\s、。,.!！?？「」『』]{1,16}?)(?:と申します|といいます|と言います|っていいます|って言います|です)[。.!！]*$/u);
  if(intro){
    const name=String(intro[1]||'').trim();
    if(name&&!roleMentions(name).length&&!/^(?:俺|僕|私|自分)$/u.test(name))return {type:'self_intro',name};
  }

  if(/^[?？]+$/u.test(compact))return {type:'confused'};
  if(!hasGameTopic(raw)&&!hasGameTopic(prior)){
    if(/[?？]\s*$/u.test(raw))return {type:'general_question'};
    return {type:'general_statement'};
  }
  return {type:'search'};
}

const INTENT_LABELS={
  greeting:'挨拶',
  activity:'話題相談',
  role_claim:'役職申告',
  self_intro:'自己紹介',
  confused:'聞き返し',
  critique:'会話への指摘',
  accusation:'疑われた時の返答',
  personal_future:'将来についての雑談',
  uncertainty:'不確かさへの相づち',
  scope_question:'聞き返しへの返答',
  meta_limit:'答えられなさへの返答',
  reassurance:'励ましへの返答',
  soft_prediction:'推測への返答',
  general_question:'一般的な質問',
  general_statement:'一般的な雑談'
};

function intentReply(intent,{seed='',history=[]}={}){
  const n=stableNumber(seed+'\u0000'+JSON.stringify(intent)+'\u0000'+historyText(history));
  const pick=arr=>arr[n%arr.length];
  if(intent.type==='greeting'){
    if(intent.variant==='first_meeting')return pick(['初めまして、よろしく。','どうも、初めまして。','初めまして。よろしくね。']);
    if(intent.variant==='reunion')return pick(['久しぶり。','お、久しぶり。','久しぶりだね。']);
    return pick(['こんにちは。','どうも、こんにちは。','やあ、こんにちは。']);
  }
  if(intent.type==='critique')return pick([
    'たしかに今の返しは不自然だった。もう少し会話につながる返しにする。',
    'まだ変か。今の返しは文脈がつながってなかったな。',
    'それはそう。唐突な返しになってた。'
  ]);
  if(intent.type==='accusation')return pick([
    'え、どの辺が怪しく見えた？',
    'そう見える？ 理由は聞きたい。',
    'まじ？ どこでそう思った？'
  ]);
  if(intent.type==='personal_future')return pick([
    'どうだろう。今はまだ想像つかないけど、少しずつ変わってはいくのかもな。',
    'いつかは今と違ってるかもしれないな。まだ自分でも想像はつかないけど。',
    '分からないな。でも、ずっと今のままってこともない気はする。'
  ]);
  if(intent.type==='uncertainty')return pick([
    'まあ、そうだよな。先のことはなかなか想像つかない。',
    'うん、それは分かる。まだ見えないことの方が多いし。',
    'そうだな。今の段階じゃ想像しにくいよな。'
  ]);
  if(intent.type==='scope_question')return intent.askedForDetail
    ?pick(['ざっくりでいいよ。どうしてそう思ったのか、その辺が聞ければ十分。','そこまで細かくなくていいよ。考えた理由が少し分かれば十分。'])
    :pick(['ざっくりでいいよ。','気になるところだけでいいよ。','話せる範囲で十分。']);
  if(intent.type==='meta_limit')return pick([
    'まあ、今はまだ答えきれないな。',
    'そうだな。今の自分じゃ分からないことも多い。',
    'うん、そこはまだちゃんとは答えられない。'
  ]);
  if(intent.type==='reassurance')return pick([
    'そうだな。なんとかなると思っとくか。',
    'うん。まあ、案外なんとかなるかもな。',
    'そうだな。先のことはその時考えればいいか。'
  ]);
  if(intent.type==='soft_prediction')return pick([
    'そうかもな。まだ知らないことの方が多いと思う。',
    'たしかに、今はまだそんな段階かもな。',
    'まあ、その見方はわりと合ってる気がする。'
  ]);
  if(intent.type==='general_question')return pick([
    'どうだろう。今の自分にはまだ何とも言えないな。',
    'うーん、そこはまだ分からないな。',
    '今のところは、はっきりとは答えられない。'
  ]);
  if(intent.type==='general_statement')return pick([
    'そうだな。',
    'うん、なるほど。',
    'まあ、そういう見方もあるな。'
  ]);
  if(intent.type==='activity')return pick([
    '何か話題決める？ 人狼の話でも雑談でもいいよ',
    '何しようか 人狼の話か普通の雑談でもする？',
    'とりあえず何か一個話題出してみる？'
  ]);
  if(intent.type==='role_claim'){
    const role=ROLE_DISPLAY[intent.role]||intent.role||'その役職';
    return pick([role+'なんだ',role+'か なるほど',role+'なんだね']);
  }
  if(intent.type==='self_intro'){
    const name=intent.name||'';
    return pick(['よろしく '+name,name+'ね よろしく','どうも '+name+' よろしく']);
  }
  if(intent.type==='confused')return pick(['どうした？','ん？','何か変だった？']);
  return '';
}

function relevancePenalty(input,reply,context=''){
  const inputRoles=new Set(roleMentions(input));
  const replyRoles=roleMentions(reply);
  const foreignRoles=replyRoles.filter(role=>!inputRoles.has(role));

  const inputNumbers=new Set(numericMentions(input));
  const replyNumbers=numericMentions(reply);
  const foreignNumbers=replyNumbers.filter(n=>!inputNumbers.has(n));

  let factor=1;
  if(foreignRoles.length)factor*=Math.max(.12,1-foreignRoles.length*.42);
  if(foreignNumbers.length)factor*=.28;
  const gameLeak=hasGameTopic(reply)&&!hasGameTopic(input)&&!hasGameTopic(context);
  if(gameLeak)factor*=.04;
  return {factor,foreignRoles,foreignNumbers,gameLeak};
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
  const liveSessions=new Map();
  const memoryReplies=new Map();
  const sessionTurns=new Map();

  function rememberReply(sessionId,text){
    const list=memoryReplies.get(sessionId)||[];
    list.unshift(normalizeText(text));
    memoryReplies.set(sessionId,list.filter(Boolean).slice(0,8));
  }

  async function softDb(label,work,fallback=null){
    try{return await work();}
    catch(error){
      lastError=String(error?.message||error);
      logger.warn?.('Conversation lab '+label+' failed',lastError);
      return fallback;
    }
  }

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
        try{db?.close?.();}catch{}
        db=null;
        readyPromise=null;
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
        sql:`SELECT example_id, action_json, context_json, recorded_at, game_time, day, phase
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
        const actionTime=Number(row.game_time||row.recorded_at||0);
        const contextDay=Number(context.day??row.day??0);
        const contextPhase=String(context.phase||row.phase||'');
        const messages=(Array.isArray(context.messages)?context.messages:[])
          .filter(m=>m&&m.channel==='public'&&cleanReply(m.text))
          .filter(m=>Number(m.day??contextDay)===contextDay&&String(m.phase||contextPhase)===contextPhase);
        let source=null;
        for(let i=messages.length-1;i>=0;i--){
          const m=messages[i];
          if(m.playerId===selfId)continue;
          const messageTime=Number(m.at||0);
          if(actionTime&&messageTime&&actionTime-messageTime>45000)continue;
          source=m;break;
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
    const now=Date.now();
    if(!force&&cache.examples.length&&now-cache.at<corpusTtlMs)return cache.examples;
    if(!(await init()))return cache.examples;
    const game=await softDb('corpus read',()=>pageTrainingExamples(),null);
    if(!game)return cache.examples;
    const lab=ONLINE_LEARNING?(await softDb('positive examples',()=>positiveLabExamples(),[])):[];
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
    const memory=new Set(memoryReplies.get(sessionId)||[]);
    if(!(await init()))return memory;
    const result=await softDb('recent replies',()=>db.execute({
      sql:`SELECT text FROM conversation_lab_turns
           WHERE session_id=? AND speaker='ai'
           ORDER BY created_at DESC LIMIT 8`,
      args:[sessionId]
    }),null);
    if(result)for(const row of result.rows||[])memory.add(normalizeText(row.text));
    return memory;
  }

  async function startSession(name=''){
    const sessionId=crypto.randomUUID(),displayName=cleanReply(name||'あなた').slice(0,24)||'あなた';
    sessionAliases.set(sessionId,{});
    sessionPeople.set(sessionId,[]);
    liveSessions.set(sessionId,{displayName,createdAt:Date.now()});
    memoryReplies.set(sessionId,[]);
    sessionTurns.set(sessionId,[]);
    if(await init()){
      await softDb('session save',()=>db.execute({
        sql:'INSERT INTO conversation_lab_sessions (session_id,created_at,display_name) VALUES (?,?,?)',
        args:[sessionId,Date.now(),displayName]
      }));
    }
    const corpus=await loadCorpus();
    return {sessionId,displayName,corpusSize:corpus.length,learningActive:ONLINE_LEARNING,storageAvailable:!!db};
  }

  async function ensureSession(sessionId){
    if(!sessionId)return false;
    if(liveSessions.has(sessionId))return true;
    if(!(await init()))return false;
    const result=await softDb('session lookup',()=>db.execute({
      sql:'SELECT session_id FROM conversation_lab_sessions WHERE session_id=? LIMIT 1',
      args:[sessionId]
    }),null);
    return Boolean(result?.rows?.length);
  }

  function chooseReply(input,corpus,recent,aliases={},people=[],history=[]){
    const runtime=runtimePersonTemplate(input,people);
    const context=historyText(history);
    const comparisonInput=runtime.text;
    const ranked=[];
    for(const e of corpus){
      const rendered=renderPersonTemplate(e.reply,runtime.names);
      const repeatPenalty=recent.has(normalizeText(rendered))?0.35:1;
      const relevance=relevancePenalty(input,rendered,context);
      const score=scoreExample(comparisonInput,e,aliases)*repeatPenalty*relevance.factor;
      ranked.push({...e,score,runtimeNames:runtime.names,relevance});
    }
    ranked.sort((a,b)=>b.score-a.score);
    const best=ranked[0];

    // 弱い一致では過去ログをランダムに返さない。意味不明な飛躍の主因だった。
    const minimumScore=0.45;
    if(!best||best.score<minimumScore){
      const reply=/[?？]\s*$/u.test(String(input||''))
        ?'んー、そこはもう少し具体的に聞いてみて。'
        :'それ、もう少し詳しく聞いてもいい？';
      return {
        id:null,
        reply,
        score:best?.score||0,
        origin:'fallback',
        lowConfidence:true,
        runtimeNames:runtime.names
      };
    }

    const pool=ranked.filter(x=>x.score>=Math.max(minimumScore,best.score-0.06)).slice(0,4);
    return pool[stableNumber(input+'\u0000'+best.id)%pool.length]||best;
  }

  async function send({sessionId,text}){
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
    if(await init())await softDb('user turn save',()=>db.execute({
      sql:`INSERT INTO conversation_lab_turns
           (turn_id,session_id,created_at,speaker,text)
           VALUES (?,?,?,?,?)`,
      args:[userTurnId,sessionId,now,'user',clean]
    }));

    const history=sessionTurns.get(sessionId)||[];
    const intent=classifyIntent(clean,{history});
    const [corpus,recent]=await Promise.all([loadCorpus(),recentReplies(sessionId)]);
    let picked,reply,mode='retrieval';

    if(intent.type!=='search'){
      mode='intent';
      reply=intentReply(intent,{seed:sessionId+'\u0000'+clean,history});
      picked={id:'intent:'+intent.type,score:null,origin:'intent',lowConfidence:false};
    }else{
      picked=chooseReply(clean,corpus,recent,aliases,people,history);
      const renderedReply=renderPersonTemplate(picked.reply,picked.runtimeNames||people);
      reply=picked.origin==='fallback'
        ? renderedReply
        : paraphraseReply(renderedReply,{seed:sessionId+'\u0000'+clean+'\u0000'+picked.id});
      if(picked.origin==='fallback')mode='fallback';
    }
    const aiTurnId=crypto.randomUUID();
    rememberReply(sessionId,reply);
    history.push({user:clean,ai:reply});
    if(history.length>6)history.splice(0,history.length-6);
    sessionTurns.set(sessionId,history);
    if(await init())await softDb('ai turn save',()=>db.execute({
      sql:`INSERT INTO conversation_lab_turns
           (turn_id,session_id,created_at,speaker,text,reply_to,source_example_id,confidence)
           VALUES (?,?,?,?,?,?,?,?)`,
      args:[aiTurnId,sessionId,Date.now(),'ai',reply,userTurnId,picked.id,picked.score]
    }));

    return {
      userTurnId,
      aiTurnId,
      reply,
      confidence:picked.score,
      lowConfidence:!!picked.lowConfidence,
      source:picked.origin||'game',
      mode,
      intent:intent.type!=='search'?intent.type:null,
      intentLabel:intent.type!=='search'?(INTENT_LABELS[intent.type]||intent.type):null,
      corpusSize:corpus.length,
      aliases:Object.keys(aliases).length,
      people:people.length,
      learningActive:ONLINE_LEARNING
    };
  }

  async function feedback({sessionId,turnId,value}){
    const v=Number(value);
    if(![-1,1].includes(v))throw Error('評価が不正です。');
    if(!(await init()))return {ok:true,rowsAffected:0,stored:false,learningActive:ONLINE_LEARNING};
    const result=await softDb('feedback save',()=>db.execute({
      sql:`UPDATE conversation_lab_turns
           SET feedback=?
           WHERE turn_id=? AND session_id=? AND speaker='ai'`,
      args:[v,turnId,sessionId]
    }),null);
    // 評価は保存するが、ONLINE_LEARNING=false の間は返答候補へ即反映しない。
    const rowsAffected=Number(result?.rowsAffected||0);
    return {ok:true,rowsAffected,stored:rowsAffected>0,learningActive:ONLINE_LEARNING};
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

module.exports={createConversationLab,normalizeText,scoreExample,dice,applyAliases,applyStaticAliases,semanticNormalize,paraphraseReply,classifyIntent,intentReply,relevancePenalty,roleMentions,numericMentions,inferAliasesFromText,inferPersonNames,makePersonTemplate,runtimePersonTemplate,renderPersonTemplate,hasGameTopic,historyText,ONLINE_LEARNING};
