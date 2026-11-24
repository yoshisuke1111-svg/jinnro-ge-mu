'use strict';

const ACTION_EVENTS=new Set(['chat','statement','vote','act','special_act']);

function clone(value){
  return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}

function isHumanOnly(game){
  return !!game&&game.phase!=='lobby'&&game.players.length>=4&&game.players.every(p=>!p.bot);
}

function captureContext(game,playerId){
  const view=game.view(playerId);
  const now=Number(view.now)||Date.now();
  return {
    schemaVersion:1,
    phase:view.phase,
    phaseId:view.phaseId,
    day:view.day,
    remainingMs:view.deadline?Math.max(0,view.deadline-now):null,
    self:{
      id:view.me.id,
      name:view.me.realName||view.me.name,
      role:view.me.role,
      alive:view.me.alive,
      auto:view.me.auto,
      lover:view.me.lover||null,
      revengeTarget:view.me.revengeTarget||null,
      levelerLevel:view.me.levelerLevel||0,
      knownWolves:clone(view.me.knownWolves||[]),
      knownMasons:clone(view.me.knownMasons||[]),
      privateResults:clone(view.me.privateResults||[]),
      infected:clone(view.me.infected||[]),
      acted:!!view.me.acted,
      voted:!!view.me.voted
    },
    players:(view.players||[]).map(p=>({
      id:p.id,name:p.name,alive:p.alive,connected:p.connected,auto:p.auto,host:p.host
    })),
    messages:clone((view.messages||[]).slice(-80)),
    claims:clone((view.claims||[]).slice(-30)),
    reports:clone((view.reports||[]).slice(-30)),
    voteHistory:clone((view.voteHistory||[]).slice(-8)),
    legal:{
      kind:view.kind||null,
      targets:clone(view.targets||[]),
      specials:clone(view.specials||[])
    },
    configRoles:clone(view.config?.roles||{})
  };
}

function normalizeAction(event,data={}){
  if(event==='chat')return {type:'chat',channel:String(data.channel||'public'),text:String(data.text||'').slice(0,400)};
  if(event==='statement')return {type:'statement',statement:clone(data)};
  if(event==='vote')return {type:'vote',target:data.target??null};
  if(event==='act')return {type:'night_action',target:data.target??null};
  if(event==='special_act')return {type:'special_action',kind:String(data.kind||''),mode:data.mode??null,target:data.target??null};
  return null;
}

function recordAction(entry,game,playerId,event,data,context=null){
  if(!ACTION_EVENTS.has(event)||!isHumanOnly(game))return null;
  const p=game.byId(playerId);
  if(!p||p.bot)return null;
  const action=normalizeAction(event,data);
  if(!action)return null;
  const example={
    schemaVersion:1,
    recordedAt:Date.now(),
    roomCode:game.code,
    playerId,
    context:context||captureContext(game,playerId),
    action
  };
  entry.trainingExamples=entry.trainingExamples||[];
  entry.trainingExamples.push(example);
  if(entry.trainingExamples.length>20000)entry.trainingExamples.splice(0,entry.trainingExamples.length-20000);
  entry.trainingLastAction=entry.trainingLastAction||new Map();
  entry.trainingLastAction.set(playerId,game.now());
  return example;
}

function sampleSilence(entry,game,{minIdleMs=12000,intervalMs=20000}={}){
  if(!isHumanOnly(game)||game.phase!=='discussion')return 0;
  entry.trainingExamples=entry.trainingExamples||[];
  entry.trainingLastAction=entry.trainingLastAction||new Map();
  entry.trainingLastSilence=entry.trainingLastSilence||new Map();
  const now=game.now();
  let added=0;
  for(const p of game.players){
    if(p.bot||!p.alive||!p.connected||p.auto)continue;
    if(!entry.trainingLastAction.has(p.id)){
      entry.trainingLastAction.set(p.id,now);
      continue;
    }
    const lastAction=entry.trainingLastAction.get(p.id);
    const lastSilence=entry.trainingLastSilence.get(p.id)||0;
    if(now-lastAction<minIdleMs||now-lastSilence<intervalMs)continue;
    entry.trainingExamples.push({
      schemaVersion:1,
      recordedAt:Date.now(),
      roomCode:game.code,
      playerId:p.id,
      context:captureContext(game,p.id),
      action:{type:'silence',durationMs:Math.round(now-lastAction)}
    });
    entry.trainingLastSilence.set(p.id,now);
    added++;
  }
  if(entry.trainingExamples.length>20000)entry.trainingExamples.splice(0,entry.trainingExamples.length-20000);
  return added;
}

function toJsonl(entry){
  return (entry.trainingExamples||[]).map(x=>JSON.stringify(x)).join('\n')+((entry.trainingExamples||[]).length?'\n':'');
}

module.exports={ACTION_EVENTS,isHumanOnly,captureContext,normalizeAction,recordAction,sampleSilence,toJsonl};
