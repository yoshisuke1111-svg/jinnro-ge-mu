const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server');
const {normalizeText,scoreExample,inferAliasesFromText,ONLINE_LEARNING}=require('../conversation-lab');

async function post(base,body){
  const res=await fetch(base+'/talk/api',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  return {res,json:await res.json()};
}

test('conversation similarity handles Japanese text normalization',()=>{
  assert.equal(normalizeText('  誰が怪しい？ '),'誰が怪しい');
  assert.ok(scoreExample('誰が怪しい？',{prompt:'誰が怪しいと思う？'})>0.25);
  assert.ok(scoreExample('誰が怪しい？',{prompt:'今日は晴れだね'})<0.2);
});

test('conversation lab API starts, replies, and records feedback',async()=>{
  const calls=[];
  const fakeLab={
    async stats(){return {enabled:true,corpusSize:12,sessions:1,turns:2,positive:0,negative:0};},
    async startSession(name){calls.push(['start',name]);return {sessionId:'session-1',displayName:name||'あなた',corpusSize:12};},
    async send(payload){calls.push(['send',payload]);return {userTurnId:'u1',aiTurnId:'a1',reply:'今はまだ分からないかな',confidence:.42,lowConfidence:false,source:'game',corpusSize:12};},
    async feedback(payload){calls.push(['feedback',payload]);return {ok:true,rowsAffected:1};},
    async close(){calls.push(['close']);}
  };
  const app=createApp({tickMs:1000000,adminPassword:'x',conversationLab:fakeLab});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const started=await post(base,{action:'start',name:'テスト'});
    assert.equal(started.res.status,200,JSON.stringify(started.json));
    assert.equal(started.json.sessionId,'session-1');

    const sent=await post(base,{action:'send',sessionId:'session-1',text:'誰が怪しい？'});
    assert.equal(sent.res.status,200,JSON.stringify(sent.json));
    assert.equal(sent.json.reply,'今はまだ分からないかな');
    assert.equal(sent.json.aiTurnId,'a1');

    const rated=await post(base,{action:'feedback',sessionId:'session-1',turnId:'a1',value:1});
    assert.equal(rated.res.status,200,JSON.stringify(rated.json));
    assert.equal(rated.json.rowsAffected,1);
    assert.deepEqual(calls.slice(0,3).map(x=>x[0]),['start','send','feedback']);
  }finally{await app.close();}
});


test('conversation aliases normalize known shorthand and session-only nicknames',()=>{
  assert.equal(ONLINE_LEARNING,false);
  assert.equal(normalizeText('黒レベが怪しい'),'black_levelerが怪しい');
  assert.equal(normalizeText('霊媒どう思う？'),'mediumどう思う');
  assert.equal(normalizeText('村田は怪しい'),'村田は怪しい');

  const aliases=inferAliasesFromText('黒ちゃん=黒レベラーって呼ぶ');
  assert.equal(aliases['黒ちゃん'],'黒レベラー');

  const explicit=inferAliasesFromText('クロは黒レベラーの略');
  assert.equal(explicit['クロ'],'黒レベラー');
  assert.equal(normalizeText('クロ怪しくない？',explicit),'black_leveler怪しくない');
});
