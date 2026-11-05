const test=require('node:test');
const assert=require('node:assert/strict');
const {Game}=require('../shared/rules');
const Bots=require('../shared/bots');

function makeDiscussion(){
  const g=new Game({code:'CHAT',seed:1234});
  const human=g.addPlayer({id:'human',name:'人間'});
  g.setBots(3);
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
  assert.match(reply.text,/気にな|疑|今の考え|怪/);
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
