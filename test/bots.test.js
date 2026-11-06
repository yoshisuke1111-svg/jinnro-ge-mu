const test=require('node:test');
const assert=require('node:assert/strict');
const {Game,preset}=require('../shared/rules');
const Bots=require('../shared/bots');

function makeDiscussion(){
  const g=new Game({code:'CHAT',seed:1234});
  const human=g.addPlayer({id:'human',name:'人間'});
  g.setBots(3);
  g.applyConfig({...g.config,roles:preset(4)});
  g.start();
  g.beginPhase('discussion');
  return {g,human,bots:g.players.filter(p=>p.bot)};
}

test('a generic free-form game question selects exactly one CPU responder',()=>{
  const {g,human,bots}=makeDiscussion();
  g.chat(human.id,'誰が怪しいと思う？','public',g.phaseId);
  const msg=g.messages.at(-1);
  const interested=bots.filter(p=>Bots.replyInterest(g.botView(p.id),p.brain,msg)>0);
  assert.equal(interested.length,1);
  const p=interested[0];
  p.brain.replyMessageId=msg.id;
  const reply=Bots.decide(g.botView(p.id),p.brain,'reply');
  assert.ok(reply?.text);
  assert.match(reply.text,/気にな|疑|今の考え|怪|見たい|決め手/);
});

test('when a CPU is named only that CPU wants to answer',()=>{
  const {g,human,bots}=makeDiscussion();
  const named=bots[1];
  g.chat(human.id,named.name+'、誰が怪しいと思う？','public',g.phaseId);
  const msg=g.messages.at(-1);
  const scores=bots.map(p=>[p.id,Bots.replyInterest(g.botView(p.id),p.brain,msg)]);
  assert.equal(scores.filter(([,score])=>score>0).length,1);
  assert.ok(scores.find(([id])=>id===named.id)[1]>=3);
});

test('free-form question about a named player produces contextual answer',()=>{
  const {g,human,bots}=makeDiscussion();
  const subject=bots[0],responder=bots[1];
  g.chat(human.id,subject.name+'のことどう思う？','public',g.phaseId);
  const msg=g.messages.at(-1);
  responder.brain.replyMessageId=msg.id;
  const reply=Bots.decide(g.botView(responder.id),responder.brain,'reply');
  assert.ok(reply?.text);
  assert.ok(reply.text.includes(subject.name)||reply.statement?.target===subject.id);
});


test('changing CPU count does not rewrite the role configuration',()=>{
  const g=new Game({code:'CONFIG',seed:7});
  g.addPlayer({id:'human',name:'人間'});
  g.setBots(7);
  const roles=preset(8);
  roles.seer+=1;
  roles.villager-=1;
  g.applyConfig({...g.config,roles,testRole:'seer'});
  const before=JSON.parse(JSON.stringify(g.config.roles));
  g.setBots(5);
  assert.deepEqual(g.config.roles,before);
  assert.equal(g.config.testRole,'seer');
  assert.match(g.validation?.join?.(' ')||g.view('human').validation.join(' '),/役職の合計と参加人数/);
});

test('spontaneous CPU talk avoids repeating the same recent topic',()=>{
  const {g,bots}=makeDiscussion();
  const p=bots.find(x=>x.role==='villager')||bots[0];
  const first=Bots.decide(g.botView(p.id),p.brain,'talk');
  assert.ok(first?.text||first?.statement);
  if(first.statement)g.message(p,first.text||'', 'public', first.statement);
  else g.message(p,first.text,'public');
  p.brain.talks=(p.brain.talks||0)+1;
  const second=Bots.decide(g.botView(p.id),p.brain,'talk');
  if(first.statement&&second?.statement){
    const a=[first.statement.kind,first.statement.target,first.statement.role,first.statement.black].join(':');
    const b=[second.statement.kind,second.statement.target,second.statement.role,second.statement.black].join(':');
    assert.notEqual(b,a);
  }else if(second?.text){
    assert.notEqual(second.text,first.text);
  }else{
    assert.equal(second,null);
  }
});


test('a first CPU question of the day is explicit even with no earlier conversation',()=>{
  const {g,bots}=makeDiscussion();
  const p=bots.find(x=>x.role==='villager')||bots[0];
  const view=g.botView(p.id);
  let question=null;
  for(let salt=0;salt<120&&!question;salt++){
    const brain={...p.brain,personality:{...p.brain.personality},talks:0,replies:0,topicSalt:salt,recentSpeechTopics:[]};
    const out=Bots.decide(view,brain,'talk');
    if(out?.statement?.kind==='question')question=out;
  }
  assert.ok(question,'test seed should be able to produce a question');
  assert.doesNotMatch(question.text,/その(?:判断|理由|根拠)|それ(?:どういう|って)/);
  assert.match(question.text,/誰|投票候補|怪しい|入れるなら/);
});

test('clarification question is answered by the CPU that asked and names the referenced topic',()=>{
  const {g,human,bots}=makeDiscussion();
  const subject=bots[0],asker=bots[1];

  g.publish(human.id,{kind:'accuse',target:subject.id},g.phaseId,subject.name+'がちょっと怪しいと思う');
  const reference=g.messages.at(-1);
  g.publish(asker.id,{kind:'question',target:human.id,aboutTarget:subject.id,aboutMessageId:reference.id},g.phaseId,human.name+'、その話もう少し聞いていい？');

  g.chat(human.id,'どれに対しての質問？','public',g.phaseId);
  const clarify=g.messages.at(-1);
  const interested=bots.filter(p=>Bots.replyInterest(g.botView(p.id),p.brain,clarify)>0);
  assert.deepEqual(interested.map(p=>p.id),[asker.id]);

  asker.brain.replyMessageId=clarify.id;
  const reply=Bots.decide(g.botView(asker.id),asker.brain,'reply');
  assert.ok(reply?.text);
  assert.match(reply.text,new RegExp(subject.name));
  assert.match(reply.text,/疑|話|ところ/);
});

test('question context survives publishing as public metadata',()=>{
  const {g,human,bots}=makeDiscussion();
  const asker=bots[0],subject=bots[1];
  g.chat(human.id,subject.name+'が怪しい','public',g.phaseId);
  const reference=g.messages.at(-1);
  g.publish(asker.id,{kind:'question',target:human.id,aboutTarget:subject.id,aboutMessageId:reference.id},g.phaseId,'理由を聞きたい');
  const q=g.messages.at(-1);
  assert.equal(q.meta.kind,'question');
  assert.equal(q.meta.target,human.id);
  assert.equal(q.meta.aboutTarget,subject.id);
  assert.equal(q.meta.aboutMessageId,reference.id);
});
