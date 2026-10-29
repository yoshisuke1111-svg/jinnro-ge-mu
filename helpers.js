const {Game,DEFAULT_TIMES,ROLE_IDS,preset}=require('../shared/rules');
const Bots=require('../shared/bots');
function fixture(roles,seed=100){
  let clock=100000;
  const g=new Game({code:'TEST',seed,now:()=>clock});
  roles.forEach((_,i)=>g.addPlayer({id:'p'+i,name:'Player'+i,bot:i!==0}));
  g.config.roles=Object.fromEntries(ROLE_IDS.map(k=>[k,roles.filter(x=>x===k).length]));
  g.config.times={...DEFAULT_TIMES};
  g.start();
  roles.forEach((role,i)=>{g.players[i].role=role;g.players[i].brain={};});
  return {g,setTime:t=>clock=t,advanceTime:ms=>clock+=ms};
}
function autoHuman(g){
  for(const p of g.humans()){
    const view=g.botView(p.id);
    if(['reveal','dawn','execution'].includes(g.phase)){g.markReady(p.id,g.phaseId);continue;}
    if(!p.alive)continue;
    if(g.phase==='night'&&g.nightKind(p)&&!Object.hasOwn(g.actions,p.id)){
      const c=Bots.decide(view,p.brain,'night');
      g.submitAction(p.id,c.target??null,g.phaseId,true);
    }
    if(g.phase==='discussion'){
      if((p.brain.talks||0)<2){
        const c=Bots.decide(view,p.brain,'talk');
        if(c.statement)g.publish(p.id,c.statement,g.phaseId,c.text);else if(c.text)g.message(p,c.text);
        p.brain.talks=(p.brain.talks||0)+1;
      }
      if(g.now()-g.startedAt>=12000)g.markReady(p.id,g.phaseId);
    }
    if(g.phase==='vote'&&!Object.hasOwn(g.votes,p.id)){
      const c=Bots.decide(view,p.brain,'vote');g.submitVote(p.id,c.target??null,g.phaseId,true);
    }
  }
}
function simulate({seed=1,n=8,kind='basic',role='',limit=20000}={}){
  let clock=100000;
  const g=new Game({code:'SIM'+seed,seed,now:()=>clock});
  g.addPlayer({id:'human',name:'テスター'});
  g.setBots(n-1);
  g.config.roles=preset(n,kind);g.config.lovers=kind==='all';g.config.testRole=role;
  g.start();let steps=0;
  while(g.phase!=='ended'&&steps++<limit){clock+=250;autoHuman(g);g.tick(Bots);}
  if(g.phase!=='ended')throw Error(`stalled: seed=${seed}, n=${n}, kind=${kind}, phase=${g.phase}, day=${g.day}`);
  return {g,steps,elapsed:clock-100000};
}
module.exports={fixture,simulate,autoHuman};
