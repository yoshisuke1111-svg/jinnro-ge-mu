const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server');
const {normalizeText,scoreExample,semanticNormalize,paraphraseReply,classifyIntent,intentReply,analyzeMeaning,relevancePenalty,inferAliasesFromText,inferPersonNames,makePersonTemplate,runtimePersonTemplate,renderPersonTemplate,hasGameTopic,ONLINE_LEARNING}=require('../conversation-lab');

async function post(base,body){
  const res=await fetch(base+'/talk/api',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  return {res,json:await res.json()};
}

test('conversation similarity handles Japanese text normalization',()=>{
  assert.equal(normalizeText('  誰が怪しい？ '),'誰が<suspicious>');
  assert.ok(scoreExample('誰が怪しい？',{prompt:'誰が怪しいと思う？'})>0.25);
  assert.ok(scoreExample('誰が怪しい？',{prompt:'今日は晴れだね'})<0.2);
});

test('conversation lab API starts, replies, and records feedback',async()=>{
  const calls=[];
  const fakeLab={
    async stats(){return {enabled:true,corpusSize:12,sessions:1,turns:2,positive:0,negative:0};},
    async startSession(name,mode){calls.push(['start',name,mode]);return {sessionId:'session-1',displayName:name||'あなた',mode:mode||'general',corpusSize:12};},
    async send(payload){calls.push(['send',payload]);return {userTurnId:'u1',aiTurnId:'a1',reply:'今はまだ分からないかな',confidence:.42,lowConfidence:false,source:'game',corpusSize:12,meaning:{topic:'一般雑談'}};},
    async teach(payload){calls.push(['teach',payload]);return {ok:true,stored:true};},
    async feedback(payload){calls.push(['feedback',payload]);return {ok:true,rowsAffected:1};},
    async close(){calls.push(['close']);}
  };
  const app=createApp({tickMs:1000000,adminPassword:'x',conversationLab:fakeLab});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const started=await post(base,{action:'start',name:'テスト',mode:'general'});
    assert.equal(started.res.status,200,JSON.stringify(started.json));
    assert.equal(started.json.sessionId,'session-1');
    assert.equal(started.json.mode,'general');

    const sent=await post(base,{action:'send',sessionId:'session-1',text:'誰が怪しい？'});
    assert.equal(sent.res.status,200,JSON.stringify(sent.json));
    assert.equal(sent.json.reply,'今はまだ分からないかな');
    assert.equal(sent.json.aiTurnId,'a1');

    const taught=await post(base,{action:'teach',sessionId:'session-1',turnId:'a1',correction:'そうだな、まだ分からないな'});
    assert.equal(taught.res.status,200,JSON.stringify(taught.json));
    assert.equal(taught.json.stored,true);

    const rated=await post(base,{action:'feedback',sessionId:'session-1',turnId:'a1',value:1});
    assert.equal(rated.res.status,200,JSON.stringify(rated.json));
    assert.equal(rated.json.rowsAffected,1);
    assert.deepEqual(calls.slice(0,4).map(x=>x[0]),['start','send','teach','feedback']);
  }finally{await app.close();}
});


test('conversation aliases normalize known shorthand and session-only nicknames',()=>{
  assert.equal(ONLINE_LEARNING,false);
  assert.equal(normalizeText('黒レベが怪しい'),'black_levelerが<suspicious>');
  assert.equal(normalizeText('霊媒どう思う？'),'medium<opinion>');
  assert.equal(normalizeText('村田は怪しい'),'村田は<suspicious>');

  const aliases=inferAliasesFromText('黒ちゃん=黒レベラーって呼ぶ');
  assert.equal(aliases['黒ちゃん'],'黒レベラー');

  const explicit=inferAliasesFromText('クロは黒レベラーの略');
  assert.equal(explicit['クロ'],'黒レベラー');
  assert.equal(normalizeText('クロ怪しくない？',explicit),'black_leveler怪しくない');
});


test('conversation reply templates replace old player names with current names',()=>{
  const pair=makePersonTemplate('伊織どう思う？','伊織ちょっと怪しい',['真白','伊織']);
  assert.equal(pair.prompt,'{{person1}}どう思う？');
  assert.equal(pair.reply,'{{person1}}ちょっと怪しい');

  const runtime=runtimePersonTemplate('田中どう思う？');
  assert.deepEqual(runtime.names,['田中']);
  assert.equal(runtime.text,'{{person1}}どう思う？');
  assert.equal(renderPersonTemplate(pair.reply,runtime.names),'田中ちょっと怪しい');
});

test('person-name detection handles particles, honorifics, and two-name comparisons',()=>{
  assert.deepEqual(inferPersonNames('田中は怪しい'),['田中']);
  assert.deepEqual(inferPersonNames('佐藤さんどう思う？'),['佐藤']);
  assert.deepEqual(inferPersonNames('田中と佐藤どっちが怪しい？'),['田中','佐藤']);

  const pair=makePersonTemplate('伊織と真白どっち？','伊織かな',['伊織','真白']);
  const runtime=runtimePersonTemplate('田中と佐藤どっち？',['田中','佐藤']);
  assert.equal(renderPersonTemplate(pair.reply,runtime.names),'田中かな');
});

test('old names never leak when the current message has no matching person name',()=>{
  const pair=makePersonTemplate('伊織について','伊織はまだ分からない',['伊織']);
  assert.equal(renderPersonTemplate(pair.reply,[]),'その人はまだ分からない');
});


test('semantic vocabulary treats different wording as the same concept',()=>{
  assert.equal(semanticNormalize('怪しい'),' <suspicious>'.trim());
  assert.equal(semanticNormalize('疑わしい'),'<suspicious>');
  assert.equal(semanticNormalize('どう見る'),'<opinion>');
  assert.ok(scoreExample('その人ちょっと怪しい',{prompt:'その人は少し疑わしい'})>0.45);
});

test('retrieved human lines are paraphrased instead of copied verbatim when vocabulary allows it',()=>{
  const original='田中ちょっと怪しい';
  const rewritten=paraphraseReply(original,{seed:'case-1'});
  assert.notEqual(rewritten,original);
  assert.ok(rewritten.includes('田中'));
  assert.ok(/気になる|疑ってる|黒っぽ|黒く/.test(rewritten));

  const unknown=paraphraseReply('まだ分からないかな',{seed:'case-2'});
  assert.notEqual(unknown,'まだ分からないかな');
  assert.ok(/判断|読め|何とも/.test(unknown));
});


test('the bad chat examples are routed by intent instead of copied from old game logs',()=>{
  assert.equal(classifyIntent('こんにちは').type,'greeting');
  assert.equal(classifyIntent('初めまして').type,'greeting');
  assert.equal(classifyIntent('久しぶり～').type,'greeting');
  assert.equal(classifyIntent('なにしようね？').type,'activity');
  assert.equal(classifyIntent('人間はそんなしゃべり方しません').type,'critique');
  assert.equal(classifyIntent('うーんまだおかしいか').type,'critique');
  assert.equal(classifyIntent('お前怪しい').type,'accusation');

  const wolf=classifyIntent('俺人狼');
  assert.equal(wolf.type,'role_claim');
  assert.equal(wolf.role,'wolf');

  const jester=classifyIntent('てるてるです');
  assert.equal(jester.type,'role_claim');
  assert.equal(jester.role,'jester');

  const intro=classifyIntent('鈾と申します');
  assert.equal(intro.type,'self_intro');
  assert.equal(intro.name,'鈾');

  assert.equal(classifyIntent('妖狐はいねぇよ').type,'search');
});

test('intent replies stay on the user intent',()=>{
  assert.match(intentReply(classifyIntent('こんにちは'),{seed:'hello'}),/こんにちは|どうも|やあ/);
  assert.match(intentReply(classifyIntent('初めまして'),{seed:'first'}),/初めまして/);
  assert.match(intentReply(classifyIntent('久しぶり～'),{seed:'reunion'}),/久しぶり/);
  assert.match(intentReply(classifyIntent('人間はそんなしゃべり方しません'),{seed:'critique'}),/不自然|変|唐突|文脈/);
  assert.match(intentReply(classifyIntent('お前怪しい'),{seed:'accuse'}),/怪しく|理由|どこ|そう思/);
  assert.match(intentReply(classifyIntent('なにしようね？'),{seed:'activity'}),/話題|人狼|雑談|話/);
  assert.match(intentReply(classifyIntent('俺人狼'),{seed:'wolf'}),/人狼/);
  assert.match(intentReply(classifyIntent('てるてるです'),{seed:'jester'}),/てるてる坊主/);
  assert.match(intentReply(classifyIntent('鈾と申します'),{seed:'intro'}),/鈾/);
});

test('unrelated roles and numbers heavily penalize retrieved replies',()=>{
  const bad=relevancePenalty('俺人狼','流石に狂人3はやりすぎかぁ');
  assert.ok(bad.factor<0.2);
  assert.deepEqual(bad.foreignRoles,['madman']);
  assert.deepEqual(bad.foreignNumbers,['3']);

  const good=relevancePenalty('俺人狼','人狼なんだね');
  assert.equal(good.factor,1);
});


test('general chat is separated from werewolf retrieval',()=>{
  assert.equal(hasGameTopic('なんとかなるさ'),false);
  assert.equal(hasGameTopic('今日は誰を吊る？'),true);
  assert.equal(classifyIntent('あなたもいつか大人になるのか？').type,'personal_future');
  assert.equal(classifyIntent('私には想像がつかないよ').type,'uncertainty');
  assert.equal(classifyIntent('あなたはまだ知ってることが1歳に満たないだろうね').type,'soft_prediction');
  assert.equal(classifyIntent('どこまで知りたい？').type,'scope_question');
  assert.equal(classifyIntent('まぁ答えれないよね').type,'meta_limit');
  assert.equal(classifyIntent('なんとかなるさ').type,'reassurance');
  assert.match(intentReply(classifyIntent('なんとかなるさ'),{seed:'reassure'}),/なんとか|その時|案外/);
});

test('werewolf-only replies are rejected in unrelated general conversation',()=>{
  const wolfLeak=relevancePenalty('なんとかなるさ','じゃあ今日は田中を吊る？','将来の話をしている');
  assert.equal(wolfLeak.gameLeak,true);
  assert.ok(wolfLeak.factor<0.1);
});


test('meaning analysis exposes what the conversation AI thinks the sentence is doing',()=>{
  const future=analyzeMeaning('あなたもいつか大人になるのか？',{history:[]});
  assert.equal(future.domain,'general');
  assert.equal(future.topic,'将来・成長');
  assert.equal(future.target,'相手');
  assert.equal(future.tense,'未来');
  assert.match(future.summary,/将来|変わ/);

  const contextual=analyzeMeaning('どこまで知りたい？',{
    history:[{user:'あなたもいつか大人になるのか？',ai:'まだ分からないな'}]
  });
  assert.equal(contextual.contextDependence,'高');
  assert.equal(contextual.usesHistory,true);

  const game=analyzeMeaning('今日は誰を吊る？',{history:[]});
  assert.equal(game.domain,'werewolf');
  assert.equal(game.topic,'人狼ゲーム');
});
