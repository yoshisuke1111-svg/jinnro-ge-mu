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
  assert.match(reply.text,/気にな|疑|今の考え|怪|見たい|決め手|何とも|誰とも|言えない/);
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


test('opening CPU talk does not invent a target before anyone has provided evidence',()=>{
  const {g,bots}=makeDiscussion();
  const p=bots.find(x=>x.role==='villager')||bots[0];
  const out=Bots.decide(g.botView(p.id),p.brain,'talk');
  assert.ok(out?.text);
  assert.ok(!out.statement||!['accuse','trust','question'].includes(out.statement.kind));
  assert.match(out.text,/まだ|分から|材料|判断|話|誰とも|何とも|言えない/);
  assert.doesNotMatch(out.text,/を疑って|白寄り|一番怪しいのは/);
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


test('previously announced suspicion gets a continuity bonus instead of resetting immediately',()=>{
  const {g,bots}=makeDiscussion();
  const p=bots.find(x=>x.role==='villager')||bots[0];
  const view=g.botView(p.id);
  const raw=Bots.ranked(view);
  assert.ok(raw.length>=2);
  const remembered=raw[1];
  p.brain.announcedTarget=remembered.id;
  const stable=Bots.ranked(view,null,p.brain);
  const before=raw.find(x=>x.id===remembered.id).score;
  const after=stable.find(x=>x.id===remembered.id).score;
  assert.ok(after>=before+6.9);
  assert.ok(p.brain.suspicionMemory?.[remembered.id]);
});


test('casual non-game question selects exactly one CPU responder',()=>{
  const {g,human,bots}=makeDiscussion();
  g.chat(human.id,'好きな食べ物って何？','public',g.phaseId);
  const msg=g.messages.at(-1);
  const intents=bots.map(p=>Bots.freeIntent(g.botView(p.id),msg,p));
  assert.ok(intents.every(i=>i.kind==='casual'));
  const interested=bots.filter(p=>Bots.replyInterest(g.botView(p.id),p.brain,msg)>0);
  assert.equal(interested.length,1);
  const p=interested[0];
  p.brain.replyMessageId=msg.id;
  const reply=Bots.decide(g.botView(p.id),p.brain,'reply');
  assert.ok(reply?.text);
  assert.doesNotMatch(reply.text,/投票|占い|怪し|疑/);
});

test('named CPU answers casual chat directly',()=>{
  const {g,human,bots}=makeDiscussion();
  const named=bots[1];
  g.chat(human.id,named.name+'、今日眠いわ','public',g.phaseId);
  const msg=g.messages.at(-1);
  const scores=bots.map(p=>[p.id,Bots.replyInterest(g.botView(p.id),p.brain,msg)]);
  assert.equal(scores.filter(([,score])=>score>0).length,1);
  assert.ok(scores.find(([id])=>id===named.id)[1]>=3);
});


test('special-role comment is treated as game conversation',()=>{
  const {g,human,bots}=makeDiscussion();
  g.chat(human.id,'チーター怖くね','public',g.phaseId);
  const msg=g.messages.at(-1);
  const intents=bots.map(p=>Bots.freeIntent(g.botView(p.id),msg,p));
  assert.ok(intents.every(i=>i.kind==='opinion'));
  assert.ok(intents.every(i=>i.gameTalk===true));
});

test('CPU reply message keeps the exact human message id',()=>{
  const {g,human,bots}=makeDiscussion();
  g.chat(human.id,'おなかすいた','public',g.phaseId);
  const source=g.messages.at(-1);
  const responder=bots.find(p=>Bots.replyInterest(g.botView(p.id),p.brain,source)>0);
  assert.ok(responder);
  responder.brain.replyMessageId=source.id;
  responder.brain.replyAt=0;
  g.botTalkAt=0;
  g.tick(Bots);
  const reply=[...g.messages].reverse().find(m=>m.playerId===responder.id&&m.meta?.replyTo===source.id);
  assert.ok(reply);
});


test('first spontaneous discussion speech stays uncertain without evidence',()=>{
  const {g,bots}=makeDiscussion();
  const p=bots[0];
  const out=Bots.decide(g.botView(p.id),p.brain,'talk');
  assert.ok(out?.text);
  assert.ok(!out.statement||!['accuse','trust'].includes(out.statement.kind));
  assert.match(out.text,/まだ|分から|材料|判断|話|誰とも|何とも|言えない/);
});

test('asking who is suspicious before evidence does not force a random accusation',()=>{
  const {g,human,bots}=makeDiscussion();
  g.chat(human.id,'誰が怪しいかな？','public',g.phaseId);
  const msg=g.messages.at(-1);
  const responder=bots.find(p=>Bots.replyInterest(g.botView(p.id),p.brain,msg)>0);
  assert.ok(responder);
  responder.brain.replyMessageId=msg.id;
  const out=Bots.decide(g.botView(responder.id),responder.brain,'reply');
  assert.ok(out?.text);
  assert.notEqual(out.statement?.kind,'accuse');
  assert.match(out.text,/まだ|分から|材料|判断|話/);
});

test('asking about one player before evidence stays neutral',()=>{
  const {g,human,bots}=makeDiscussion();
  const subject=bots[0],responder=bots[1];
  g.chat(human.id,subject.name+'どう思う？','public',g.phaseId);
  const msg=g.messages.at(-1);
  responder.brain.replyMessageId=msg.id;
  const out=Bots.decide(g.botView(responder.id),responder.brain,'reply');
  assert.ok(out?.text);
  assert.ok(!out.statement||!['accuse','trust'].includes(out.statement.kind));
  assert.match(out.text,/まだ|保留|判断|材料|白とも黒とも|見てない/);
});

test('special-role chatter does not fabricate a suspect target',()=>{
  const {g,human,bots}=makeDiscussion();
  g.chat(human.id,'チーター怖くね','public',g.phaseId);
  const msg=g.messages.at(-1);
  const responder=bots.find(p=>Bots.replyInterest(g.botView(p.id),p.brain,msg)>0);
  assert.ok(responder);
  responder.brain.replyMessageId=msg.id;
  const out=Bots.decide(g.botView(responder.id),responder.brain,'reply');
  assert.ok(out?.text);
  assert.notEqual(out.statement?.kind,'accuse');
});


test('accused CPU asks for grounds instead of accusing an unrelated player',()=>{
  const {g,human,bots}=makeDiscussion();
  const accused=bots.find(p=>p.role==='villager')||bots[0];
  g.publish(human.id,{kind:'accuse',target:accused.id},g.phaseId,accused.name+'がちょっと怪しい');
  const source=g.messages.at(-1);
  accused.brain.replyMessageId=source.id;
  const out=Bots.decide(g.botView(accused.id),accused.brain,'reply');
  assert.ok(out?.text);
  assert.equal(out.statement?.kind,'question');
  assert.equal(out.statement?.target,human.id);
  assert.match(out.text,/理由|根拠|どこ|怪しく|何で|なんで/);
});

test('accused CPU may redirect only when another player has grounded suspicion evidence',()=>{
  const {g,human,bots}=makeDiscussion();
  const accused=bots.find(p=>p.role==='villager')||bots[0];
  const other=bots.find(p=>p.id!==accused.id);
  g.publish(other.id,{kind:'accuse',target:human.id},g.phaseId,human.name+'が怪しいと思う');
  g.publish(human.id,{kind:'accuse',target:accused.id},g.phaseId,accused.name+'が怪しい');
  const source=g.messages.at(-1);
  accused.brain.replyMessageId=source.id;
  const out=Bots.decide(g.botView(accused.id),accused.brain,'reply');
  assert.ok(out?.text);
  // It can defend or redirect, but must never invent a third unrelated suspect.
  if(out.statement?.kind==='accuse')assert.equal(out.statement.target,human.id);
  else assert.equal(out.statement?.kind,'question');
});

test('spontaneous talk under accusation prioritizes defense over unrelated suspicion',()=>{
  const {g,human,bots}=makeDiscussion();
  const accused=bots.find(p=>p.role==='villager')||bots[0];
  g.publish(human.id,{kind:'accuse',target:accused.id},g.phaseId,accused.name+'が怪しい');
  const out=Bots.decide(g.botView(accused.id),accused.brain,'talk');
  assert.ok(out?.text);
  assert.ok(['question','accuse'].includes(out.statement?.kind)||!out.statement);
  if(out.statement?.kind==='question')assert.equal(out.statement.target,human.id);
  assert.match(out.text,/自分|疑|理由|根拠|怪しく/);
});


test('accused casual CPU omits explicit self pronoun',()=>{
  const {g,human,bots}=makeDiscussion();
  const accused=bots.find(p=>p.role==='villager')||bots[0];
  accused.brain.personality={...(accused.brain.personality||{}),tone:'casual'};
  g.publish(human.id,{kind:'accuse',target:accused.id},g.phaseId,accused.name+'が怪しい');
  const msg=g.messages.at(-1);
  accused.brain.replyMessageId=msg.id;
  const out=Bots.decide(g.botView(accused.id),accused.brain,'reply');
  assert.ok(out?.text);
  assert.doesNotMatch(out.text,/自分/);
  assert.match(out.text,/何で|なんで|怪し|疑/);
});


test('common CPU chat avoids commentator-style suspicion wording',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../shared/bots.js'),'utf8');
  assert.doesNotMatch(src,/今見るなら/);
});


test('CPU names are drawn from the pool instead of always starting with Aoi',()=>{
  const {Game}=require('../shared/rules');
  const firstNames=[];
  for(const seed of [1,2,3,4,5,6,7,8]){
    const g=new Game({code:'N'+seed,seed});
    g.setBots(1);
    firstNames.push(g.players.find(p=>p.bot).name);
  }
  assert.ok(new Set(firstNames).size>1);
  assert.ok(firstNames.some(n=>n!=='アオイ'));
});

test('CPU personalities include distinct archetypes and behavior biases',()=>{
  const {Game}=require('../shared/rules');
  const g=new Game({code:'PERS',seed:77});
  g.setBots(10);
  const ps=g.players.filter(p=>p.bot).map(p=>p.brain.personality);
  assert.ok(new Set(ps.map(p=>p.archetype)).size>=4);
  assert.ok(ps.every(p=>Number.isInteger(p.questionBias)&&Number.isInteger(p.hedging)));
});

test('bot view exposes personality only to the bot reasoning view',()=>{
  const {Game}=require('../shared/rules');
  const g=new Game({code:'PVIEW',seed:12});
  g.setBots(4);
  const p=g.players.find(x=>x.bot);
  const bv=g.botView(p.id);
  assert.ok(bv.me.personality?.archetype);
});
