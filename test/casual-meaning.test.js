const test=require('node:test');
const assert=require('node:assert/strict');
const {createCasualChat}=require('../casual-chat');
const {buildSemanticModel,compareWithModel}=require('../meaning-ai');
const {createApp}=require('../server');

async function post(base,path,body){
  const res=await fetch(base+path,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  return {res,json:await res.json()};
}

test('human casual chat keeps explicit reply relationships',async()=>{
  const chat=createCasualChat();
  const a=await chat.enter({name:'A',create:true,consent:true});
  const b=await chat.enter({name:'B',code:a.code,create:false,consent:true});

  const first=await chat.send({sessionToken:a.sessionToken,text:'今日寒いな'});
  const firstId=first.message.id;
  const second=await chat.send({sessionToken:b.sessionToken,text:'布団から出たくなかった',replyTo:firstId});

  assert.equal(second.message.replyTo,firstId);
  assert.equal(second.message.replyPreview.name,'A');
  assert.equal(second.message.replyPreview.text,'今日寒いな');

  const state=chat.roomState(a.sessionToken);
  assert.equal(state.messages.length,2);
  assert.equal(state.messages[1].replyTo,firstId);
  assert.equal(state.participants.length,2);
  await chat.close();
});

test('meaning prototype can gain similarity from conversation associations, not only shared text',()=>{
  const rows=[
    {message_id:'1',room_code:'R',sequence_no:1,sent_at:1000,participant_id:'a',text:'今日は寒いね',reply_to:null},
    {message_id:'2',room_code:'R',sequence_no:2,sent_at:2000,participant_id:'b',text:'布団から出たくない',reply_to:'1'},
    {message_id:'3',room_code:'R',sequence_no:3,sent_at:3000,participant_id:'a',text:'冬はつらい',reply_to:'2'},
    {message_id:'4',room_code:'R',sequence_no:4,sent_at:4000,participant_id:'b',text:'朝起きるのきつい',reply_to:'3'}
  ];
  const model=buildSemanticModel(rows);
  const result=compareWithModel('寒いね','冬つらい',model);
  assert.equal(model.messages,4);
  assert.ok(model.pairs>=3);
  assert.ok(result.learned>result.surface,'learned similarity should exceed surface similarity');
});

test('server exposes separate human chat and meaning AI APIs',async()=>{
  const calls=[];
  const fakeCasual={
    async stats(){return {storedMessages:3};},
    async enter(payload){calls.push(['enter',payload]);return {sessionToken:'s1',code:'CHAT-X',me:{id:'p1',name:payload.name},participants:[],messages:[],storageAvailable:true};},
    roomState(token){calls.push(['state',token]);return {code:'CHAT-X',me:{id:'p1',name:'A'},participants:[],messages:[]};},
    async send(payload){calls.push(['send',payload]);return {message:{id:'m1'},stored:true,state:{code:'CHAT-X',messages:[]}};},
    leave(token){calls.push(['leave',token]);return {ok:true};},
    async close(){}
  };
  const fakeMeaning={
    async stats(){return {messages:4,pairs:3,vocab:10};},
    async compare(a,b){calls.push(['compare',a,b]);return {score:.6,learned:.7,surface:.2,corpus:{messages:4,pairs:3,vocab:10},left:{learnedConcepts:[]},right:{learnedConcepts:[]},confidence:'low'};},
    async close(){}
  };
  const fakeTalk={async stats(){return {};},async close(){}};

  const app=createApp({tickMs:1000000,adminPassword:'x',conversationLab:fakeTalk,casualChat:fakeCasual,meaningAi:fakeMeaning});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await post(base,'/chat/api',{action:'create',name:'A',consent:true});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    assert.equal(made.json.sessionToken,'s1');
    assert.equal(made.json.state.code,'CHAT-X');

    const compared=await post(base,'/meaning/api',{a:'寒い',b:'冬'});
    assert.equal(compared.res.status,200,JSON.stringify(compared.json));
    assert.equal(compared.json.score,.6);
    assert.deepEqual(calls.map(x=>x[0]),['enter','compare']);
  }finally{
    await app.close();
  }
});
