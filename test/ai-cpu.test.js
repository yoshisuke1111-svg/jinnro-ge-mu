'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAiCpu,createProvider,extractOutputText,buildInput}=require('../ai-cpu');

test('extractOutputText reads Responses API output',()=>{
  assert.equal(extractOutputText({output:[{content:[{type:'output_text',text:'自然な発言'}]}]}),'自然な発言');
});

test('disabled AI falls back to original CPU text',async()=>{
  const ai=createAiCpu({enabled:false,apiKey:'',fetchImpl:null});
  const text=await ai.rewrite({view:{},draft:{text:'元のCPU発言'},mode:'talk'});
  assert.equal(text,'元のCPU発言');
});

test('prompt includes draft and recent public context without hidden game object',()=>{
  const input=buildInput({day:2,me:{name:'CPU A'},players:[{id:'p1',name:'CPU A'},{id:'p2',name:'B'}],messages:[{channel:'public',day:2,playerId:'p2',name:'B',text:'Aを疑っている',meta:{kind:'accuse',target:'p1'}}]}, {text:'Bが気になる。',statement:{kind:'accuse',target:'p2'}}, 'talk');
  const payload=JSON.parse(input[1].content);
  assert.equal(payload.draft,'Bが気になる。');
  assert.equal(payload.statement.target,'B');
  assert.equal(payload.recent[0].speaker,'B');
});


test('AI CPU count defaults to three and is clamped',()=>{
  assert.equal(createAiCpu({enabled:false,apiKey:'',cpuCount:3,fetchImpl:null}).cpuCount,3);
  assert.equal(createAiCpu({enabled:false,apiKey:'',cpuCount:99,fetchImpl:null}).cpuCount,6);
  assert.equal(createAiCpu({enabled:false,apiKey:'',cpuCount:0,fetchImpl:null}).cpuCount,1);
});

test('prompt carries recent self speech so the model can avoid repetition',()=>{
  const input=buildInput({day:1,me:{name:'CPU A'},players:[{id:'a',name:'CPU A'},{id:'b',name:'B'}],messages:[
    {channel:'public',day:1,playerId:'a',name:'CPU A',text:'Bが少し気になる。',meta:{kind:'accuse',target:'b'}},
    {channel:'public',day:1,playerId:'b',name:'B',text:'理由は？',meta:{kind:'question',target:'a'}}
  ]},{text:'Bをもう少し見たい。',statement:{kind:'accuse',target:'b'}},'talk');
  const payload=JSON.parse(input[1].content);
  assert.equal(payload.previousOwn.length,1);
  assert.equal(payload.previousOwn[0].text,'Bが少し気になる。');
});


test('casual prompt prioritizes the latest human message',()=>{
  const input=buildInput({day:1,me:{name:'CPU A'},players:[{id:'a',name:'CPU A'},{id:'h',name:'人間'}],messages:[
    {channel:'public',day:1,playerId:'h',name:'人間',text:'好きな食べ物って何？'},
    {channel:'public',day:1,playerId:'a',name:'CPU A',text:'へえ、そうなんだ。'}
  ]},{text:'へえ、そうなんだ。'},'casual');
  const developer=input[0].content;
  const payload=JSON.parse(input[1].content);
  assert.match(developer,/雑談/);
  assert.match(developer,/無理に人狼の話へ戻さない/);
  assert.equal(payload.latestOther.text,'好きな食べ物って何？');
});


test('reply mode uses the exact human source message',()=>{
  const input=buildInput({
    day:1,
    me:{name:'レン'},
    players:[{id:'r',name:'レン'},{id:'h',name:'ウラン'}],
    messages:[
      {id:10,channel:'public',day:1,playerId:'h',name:'ウラン',text:'仮病でクワガタムシ'},
      {id:11,channel:'public',day:1,playerId:'r',name:'レン',text:'へえ、面白いな。',meta:{kind:'reply',replyTo:10}}
    ]
  },{text:'へえ、面白いな。',statement:{kind:'reply',replyTo:10}},'reply');
  const developer=input[0].content;
  const payload=JSON.parse(input[1].content);
  assert.match(developer,/replySource/);
  assert.match(developer,/具体的な言葉や話題に反応/);
  assert.equal(payload.replySource.text,'仮病でクワガタムシ');
});


test('AI context includes the full public game history',()=>{
  const view={
    day:3,
    me:{name:'レン'},
    players:[{id:'r',name:'レン'},{id:'h',name:'ウラン'}],
    messages:[{id:99,day:3,phase:'discussion',channel:'public',playerId:'h',name:'ウラン',text:'直近'}]
  };
  const history=[
    {id:1,day:1,phase:'discussion',channel:'public',playerId:'h',name:'ウラン',text:'初日にクワガタの話をした'},
    {id:2,day:1,phase:'vote',channel:'system',playerId:null,name:'村の記録',text:'1日目の投票結果'},
    {id:50,day:2,phase:'discussion',channel:'public',playerId:'r',name:'レン',text:'その話まだ覚えてる'},
    {id:99,day:3,phase:'discussion',channel:'public',playerId:'h',name:'ウラン',text:'直近'}
  ];
  const input=buildInput(view,{text:'返答',statement:{kind:'reply',replyTo:99}},'reply',history);
  const payload=JSON.parse(input[1].content);
  assert.equal(payload.history.length,4);
  assert.equal(payload.history[0].text,'初日にクワガタの話をした');
  assert.equal(payload.history[1].channel,'system');
  assert.match(input[0].content,/試合開始から現在まで/);
});


test('AI prompt asks for short punctuation-light chat',()=>{
  const input=buildInput({day:1,me:{name:'CPU A'},players:[],messages:[]},{text:'仮文。長い説明。'},'talk');
  const developer=input[0].content;
  assert.match(developer,/8〜45文字/);
  assert.match(developer,/「。」と「、」は基本使わず/);
});


test('rejects unusably short AI output and keeps meaningful report fallback',async()=>{
  const ai=createAiCpu({apiKey:'x',enabled:true,model:'test',fetchImpl:async()=>({ok:true,json:async()=>({output_text:'占い'})})});
  const view={day:1,me:{name:'CPU',personality:{}},players:[{id:'a',name:'CPU'},{id:'b',name:'鈾'}],messages:[]};
  const out=await ai.rewrite({view,draft:{text:'占い結果 鈾は黒だった',statement:{kind:'report',target:'b',role:'seer',black:true}},mode:'talk'});
  assert.match(out,/鈾|黒/);
  assert.notEqual(out,'占い');
});


test('custom provider can use a replaceable endpoint',async()=>{
  let called=null;
  const ai=createAiCpu({
    enabled:true,
    provider:'custom',
    baseUrl:'https://example.invalid/my-ai',
    apiKey:'mine',
    model:'my-model',
    fetchImpl:async(url,options)=>{
      called={url,options};
      return {ok:true,json:async()=>({output_text:'その黒は違うと思う'})};
    }
  });
  const out=await ai.rewrite({
    view:{day:1,me:{name:'CPU',personality:{}},players:[],messages:[]},
    draft:{text:'元の発言'},
    mode:'talk'
  });
  assert.equal(ai.provider,'custom');
  assert.equal(called.url,'https://example.invalid/my-ai');
  assert.match(called.options.headers.authorization,/mine/);
  assert.equal(out,'その黒は違うと思う');
});

test('OpenAI remains the default provider and uses its Responses endpoint',()=>{
  const provider=createProvider({provider:'openai',apiKey:'x',fetchImpl:async()=>{}});
  assert.equal(provider.kind,'openai');
  assert.equal(provider.endpoint,'https://api.openai.com/v1/responses');
});
