'use strict';

const crypto=require('node:crypto');

const ACTION_EVENTS=new Set(['chat','statement','vote','act','special_act']);
const SOURCE_VERSION='0.8.4';

function clone(value){
  return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}

function safeJson(value){
  try{return JSON.stringify(value??null);}catch{return 'null';}
}

function isHumanOnly(game){
  return !!game&&game.phase!=='lobby'&&game.players.length>=4&&game.players.every(p=>!p.bot);
}

function captureContext(game,playerId){
  const view=game.view(playerId);
  const now=Number(view.now)||Date.now();
  return {
    schemaVersion:2,
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
    messages:clone(view.messages||[]),
    claims:clone(view.claims||[]),
    reports:clone(view.reports||[]),
    voteHistory:clone(view.voteHistory||[]),
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

function gameKey(game){
  return `${game.code}:${Number(game.startedAt||game.createdAt||0)}`;
}

function truthSnapshot(game){
  const winners=new Set(game.winner?.winners||[]);
  return {
    phase:game.phase,
    phaseId:game.phaseId,
    day:game.day,
    players:game.players.map(p=>({
      id:p.id,
      name:p.name,
      bot:!!p.bot,
      alive:!!p.alive,
      connected:!!p.connected,
      auto:!!p.auto,
      role:p.role||null,
      initialRole:p.initialRole||p.role||null,
      lover:p.lover||null,
      revengeTarget:p.revengeTarget||null,
      revengeDone:!!p.revengeDone,
      levelerLevel:p.levelerLevel||0,
      won:winners.has(p.id)
    })),
    actions:clone(game.actions||{}),
    specialActions:clone(game.specialActions||{}),
    votes:clone(game.votes||{}),
    claims:clone(game.claims||[]),
    reports:clone(game.reports||[]),
    voteHistory:clone(game.voteHistory||[]),
    winner:clone(game.winner||null)
  };
}

function createTursoStore({
  url=process.env.TURSO_DATABASE_URL||'',
  authToken=process.env.TURSO_AUTH_TOKEN||'',
  client=null,
  clientFactory=null,
  logger=console
}={}){
  const enabled=Boolean(String(url).trim()&&String(authToken).trim());
  let db=client,readyPromise=null,tail=Promise.resolve(),pending=0,writes=0,lastWriteAt=null,lastError=null,state=enabled?'initializing':'disabled';
  const sequenceByGame=new Map();
  let host='';
  try{host=new URL(String(url)).host;}catch{}

  const status=()=>({enabled,state,pending,writes,lastWriteAt,lastError,host});

  async function init(){
    if(readyPromise)return readyPromise;
    readyPromise=(async()=>{
      if(!enabled){
        state='disabled';
        if(process.env.NODE_ENV==='production')logger.warn?.('Turso training store: disabled (missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN)');
        return false;
      }
      try{
        if(!db){
          const factory=clientFactory||(async config=>{
            const mod=await import('@libsql/client');
            return mod.createClient(config);
          });
          db=await factory({url:String(url),authToken:String(authToken)});
        }
        await db.batch([
          `CREATE TABLE IF NOT EXISTS training_games (
            game_id TEXT PRIMARY KEY,
            room_code TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            source_version TEXT NOT NULL,
            player_count INTEGER NOT NULL,
            human_count INTEGER NOT NULL,
            config_json TEXT NOT NULL,
            winner_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS training_players (
            game_id TEXT NOT NULL,
            player_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            is_bot INTEGER NOT NULL,
            initial_role TEXT,
            current_role TEXT,
            lover_id TEXT,
            final_alive INTEGER,
            won INTEGER,
            personality_json TEXT,
            PRIMARY KEY (game_id, player_id)
          )`,
          `CREATE TABLE IF NOT EXISTS training_examples (
            example_id TEXT PRIMARY KEY,
            game_id TEXT NOT NULL,
            sequence_no INTEGER NOT NULL,
            recorded_at INTEGER NOT NULL,
            game_time INTEGER NOT NULL,
            day INTEGER,
            phase TEXT,
            actor_id TEXT,
            actor_name TEXT,
            actor_role TEXT,
            action_type TEXT NOT NULL,
            action_json TEXT NOT NULL,
            context_json TEXT NOT NULL,
            truth_json TEXT NOT NULL
          )`,
          'CREATE INDEX IF NOT EXISTS idx_training_examples_game_sequence ON training_examples(game_id, sequence_no)',
          'CREATE INDEX IF NOT EXISTS idx_training_examples_action ON training_examples(action_type)',
          'CREATE INDEX IF NOT EXISTS idx_training_games_started ON training_games(started_at)'
        ],'write');
        await db.execute('SELECT 1 AS ok');
        state='connected';lastError=null;
        logger.log?.(`Turso training store: connected${host?` (${host})`:''}`);
        return true;
      }catch(error){
        state='error';lastError=String(error?.message||error);
        logger.error?.('Turso training store: connection failed',lastError);
        return false;
      }
    })();
    return readyPromise;
  }

  function enqueue(work){
    if(!enabled)return Promise.resolve(false);
    pending++;
    const run=tail.then(async()=>{
      if(!(await init()))return false;
      await work(db);
      writes++;lastWriteAt=Date.now();lastError=null;state='connected';
      return true;
    }).catch(error=>{
      state='error';lastError=String(error?.message||error);
      logger.error?.('Turso training write failed',lastError);
      return false;
    }).finally(()=>{pending=Math.max(0,pending-1);});
    tail=run.then(()=>undefined);
    return run;
  }

  function persistExample(example,game){
    if(!enabled||!example||!isHumanOnly(game))return Promise.resolve(false);
    const gameId=gameKey(game),sequence=(sequenceByGame.get(gameId)||0)+1;
    sequenceByGame.set(gameId,sequence);
    const exampleId=example.exampleId||(example.exampleId=crypto.randomUUID());
    const now=Date.now(),endedAt=game.phase==='ended'?now:null,winners=new Set(game.winner?.winners||[]);
    const actor=game.byId(example.playerId);
    const truth=truthSnapshot(game);
    const statements=[{
      sql:`INSERT INTO training_games
        (game_id,room_code,started_at,ended_at,source_version,player_count,human_count,config_json,winner_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(game_id) DO UPDATE SET
          ended_at=excluded.ended_at,
          player_count=excluded.player_count,
          human_count=excluded.human_count,
          config_json=excluded.config_json,
          winner_json=excluded.winner_json,
          updated_at=excluded.updated_at`,
      args:[gameId,game.code,Number(game.startedAt||game.createdAt||now),endedAt,SOURCE_VERSION,game.players.length,game.humans().length,safeJson(game.config),safeJson(game.winner||null),now,now]
    }];
    for(const p of game.players){
      statements.push({
        sql:`INSERT INTO training_players
          (game_id,player_id,display_name,is_bot,initial_role,current_role,lover_id,final_alive,won,personality_json)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(game_id,player_id) DO UPDATE SET
            display_name=excluded.display_name,
            current_role=excluded.current_role,
            lover_id=excluded.lover_id,
            final_alive=excluded.final_alive,
            won=excluded.won,
            personality_json=excluded.personality_json`,
        args:[gameId,p.id,p.name,p.bot?1:0,p.initialRole||p.role||null,p.role||null,p.lover||null,p.alive?1:0,winners.has(p.id)?1:0,safeJson(p.brain?.personality||null)]
      });
    }
    statements.push({
      sql:`INSERT OR IGNORE INTO training_examples
        (example_id,game_id,sequence_no,recorded_at,game_time,day,phase,actor_id,actor_name,actor_role,action_type,action_json,context_json,truth_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args:[exampleId,gameId,sequence,Number(example.recordedAt||now),Number(game.now?.()||now),Number(example.context?.day||game.day||0),String(example.context?.phase||game.phase||''),example.playerId||null,actor?.name||example.context?.self?.name||null,actor?.role||example.context?.self?.role||null,String(example.action?.type||'unknown'),safeJson(example.action),safeJson(example.context),safeJson(truth)]
    });
    return enqueue(client=>client.batch(statements,'write'));
  }

  async function counts(){
    if(!(await init()))return {games:0,players:0,examples:0};
    const read=async table=>{
      const result=await db.execute(`SELECT COUNT(*) AS count FROM ${table}`);
      return Number(result.rows?.[0]?.count||0);
    };
    return {
      games:await read('training_games'),
      players:await read('training_players'),
      examples:await read('training_examples')
    };
  }

  async function close(){
    await tail;
    try{db?.close?.();}catch{}
  }

  return {enabled,init,persistExample,status,counts,close};
}

const tursoStore=createTursoStore();
void tursoStore.init();

function appendMemoryExample(entry,example){
  entry.trainingExamples=entry.trainingExamples||[];
  entry.trainingExamples.push(example);
  if(entry.trainingExamples.length>20000)entry.trainingExamples.splice(0,entry.trainingExamples.length-20000);
}

function lifecycleExample(game,player,action){
  return {
    schemaVersion:2,
    recordedAt:Date.now(),
    roomCode:game.code,
    playerId:player.id,
    context:captureContext(game,player.id),
    action
  };
}

function trackLifecycle(entry,game){
  if(!isHumanOnly(game))return 0;
  const key=gameKey(game);
  if(!entry.trainingLifecycle||entry.trainingLifecycle.key!==key){
    entry.trainingLifecycle={key,started:false,ended:false,lastPhaseId:null};
  }
  const state=entry.trainingLifecycle;
  let recorded=0;

  if(!state.started){
    state.started=true;
    for(const p of game.players){
      const example=lifecycleExample(game,p,{type:'game_start',playerCount:game.players.length});
      void tursoStore.persistExample(example,game);
      recorded++;
    }
  }

  if(state.lastPhaseId!==game.phaseId){
    state.lastPhaseId=game.phaseId;
    for(const p of game.players){
      const example=lifecycleExample(game,p,{type:'phase_start',phase:game.phase,day:game.day});
      void tursoStore.persistExample(example,game);
      recorded++;
    }
  }

  if(game.phase==='ended'&&!state.ended){
    state.ended=true;
    const winners=new Set(game.winner?.winners||[]);
    for(const p of game.players){
      const example=lifecycleExample(game,p,{type:'game_end',winner:clone(game.winner||null),won:winners.has(p.id)});
      void tursoStore.persistExample(example,game);
      recorded++;
    }
  }

  return recorded;
}

function recordAction(entry,game,playerId,event,data,context=null){
  if(!ACTION_EVENTS.has(event)||!isHumanOnly(game))return null;
  const p=game.byId(playerId);
  if(!p||p.bot)return null;
  const action=normalizeAction(event,data);
  if(!action)return null;
  const example={
    schemaVersion:2,
    recordedAt:Date.now(),
    roomCode:game.code,
    playerId,
    context:context||captureContext(game,playerId),
    action
  };
  appendMemoryExample(entry,example);
  entry.trainingLastAction=entry.trainingLastAction||new Map();
  entry.trainingLastAction.set(playerId,game.now());
  void tursoStore.persistExample(example,game);
  return example;
}

function sampleSilence(entry,game,{minIdleMs=12000,intervalMs=20000}={}){
  trackLifecycle(entry,game);
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
    const example={
      schemaVersion:2,
      recordedAt:Date.now(),
      roomCode:game.code,
      playerId:p.id,
      context:captureContext(game,p.id),
      action:{type:'silence',durationMs:Math.round(now-lastAction)}
    };
    appendMemoryExample(entry,example);
    void tursoStore.persistExample(example,game);
    entry.trainingLastSilence.set(p.id,now);
    added++;
  }
  return added;
}

function toJsonl(entry){
  return (entry.trainingExamples||[]).map(x=>JSON.stringify(x)).join('\n')+((entry.trainingExamples||[]).length?'\n':'');
}

module.exports={
  ACTION_EVENTS,
  isHumanOnly,
  captureContext,
  normalizeAction,
  recordAction,
  sampleSilence,
  trackLifecycle,
  toJsonl,
  createTursoStore,
  tursoStore,
  getTursoStatus:()=>tursoStore.status(),
  getTursoCounts:()=>tursoStore.counts()
};
