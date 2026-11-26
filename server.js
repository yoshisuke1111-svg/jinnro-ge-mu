/* Zero-dependency Node.js server: HTTPS proxy -> HTTP actions + SSE state updates.
 * Secrets never appear in invitation URLs or public state. Stream tickets are one-use.
 */
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const {Game,preset,ROLES,ROLE_IDS,WOLF,validName}=require('./shared/rules');
const Bots=require('./shared/bots');
const {createAiCpu}=require('./ai-cpu');
const Training=require('./training-data');
const {createConversationLab}=require('./conversation-lab');
const VERSION='0.8.4';
const token=()=>crypto.randomBytes(32).toString('base64url');
const normalizeRoomCode=value=>{
  const code=String(value||'').normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase();
  if(!code)return '';
  if([...code].length<3||[...code].length>16)throw Error('部屋コードは3〜16文字で入力してください。');
  if(!/^[\p{L}\p{N}_-]+$/u.test(code))throw Error('部屋コードは文字・数字・-・_だけ使えます。');
  return code;
};
function makeClock(){
  let realBase=Date.now(),gameBase=realBase,speed=1;
  return {now(){return gameBase+(Date.now()-realBase)*speed;},setSpeed(next){const current=this.now();realBase=Date.now();gameBase=current;speed=next;},getSpeed(){return speed;}};
}

function createApp({tickMs=250,maxRooms=100,adminPassword=process.env.ADMIN_PASSWORD||null,discordWebhook=process.env.DISCORD_WEBHOOK_URL||'',discordNotifyUserId=process.env.DISCORD_NOTIFY_USER_ID||'',publicBaseUrl=process.env.PUBLIC_BASE_URL||'',fetchImpl=globalThis.fetch,sleepImpl=ms=>new Promise(resolve=>setTimeout(resolve,ms)),aiCpu=null,conversationLab=null,collapseDelayMs=5000}={}) {
  const rooms=new Map(),tickets=new Map(),rates=new Map(),chatRates=new Map(),adminSessions=new Map();
  const ai=aiCpu||createAiCpu({fetchImpl});
  const talk=conversationLab||createConversationLab();
  const startedReal=Date.now(),recentErrors=[];let requestCount=0,apiCount=0;
  const recordError=(scope,error)=>{recentErrors.push({at:Date.now(),scope,message:String(error?.message||error)});if(recentErrors.length>40)recentErrors.splice(0,recentErrors.length-40);};
  const effectiveAdminPassword=adminPassword||crypto.randomBytes(9).toString('base64url');
  const cleanBase=String(publicBaseUrl||'').trim().replace(/\/+$/,'');
  async function notifyRoomCreated({code,creator}){
    if(!discordWebhook||typeof fetchImpl!=='function')return false;
    const invite=cleanBase?cleanBase+'/?room='+encodeURIComponent(code):'';
    const mention=/^\d{5,30}$/.test(String(discordNotifyUserId||''))?String(discordNotifyUserId):'';
    const payload={
      content:mention?'<@'+mention+'> 新しい人狼部屋が作成されました。':'新しい人狼部屋が作成されました。',
      allowed_mentions:mention?{users:[mention]}:{parse:[]},
      embeds:[{
        title:'🐺 新しい部屋',
        color:0xd8bc83,
        fields:[
          {name:'部屋コード',value:'`'+String(code).slice(0,32)+'`',inline:true},
          {name:'作成者',value:String(creator||'不明').slice(0,80),inline:true}
        ],
        ...(invite?{url:invite,description:'[部屋を開く]('+invite+')'}:{}),
        timestamp:new Date().toISOString()
      }]
    };
    for(let attempt=1;attempt<=4;attempt++){
      const response=await fetchImpl(discordWebhook,{method:'POST',headers:{'content-type':'application/json','user-agent':'NAIST-STELLA-Werewolf/0.7.2'},body:JSON.stringify(payload)});
      if(response.ok)return true;
      if(response.status!==429)throw Error('Discord通知に失敗しました ('+response.status+')');
      let retryMs=0;
      try{
        const body=await response.clone().json();
        retryMs=Number(body?.retry_after)||0; // Discord's JSON retry_after is milliseconds.
      }catch{}
      const resetAfter=Number(response.headers?.get?.('x-ratelimit-reset-after'));
      const retryAfter=Number(response.headers?.get?.('retry-after'));
      if(!retryMs&&Number.isFinite(resetAfter)&&resetAfter>0)retryMs=resetAfter*1000;
      if(!retryMs&&Number.isFinite(retryAfter)&&retryAfter>0)retryMs=retryAfter*1000;
      retryMs=Math.max(250,Math.min(120000,retryMs||1000));
      if(attempt===4)throw Error('Discord通知に失敗しました (429: 再試行上限)');
      await sleepImpl(retryMs+100);
    }
    return false;
  }
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  const allowed={
    '/':'public/index.html','/index.html':'public/index.html','/app.js':'public/app.js','/style.css':'public/style.css',
    '/transport.js':'public/transport.js','/shared/rules.js':'shared/rules.js','/solo.html':'public/solo.html',
    '/admin':'public/admin.html','/admin.html':'public/admin.html','/admin.js':'public/admin.js','/admin.css':'public/admin.css',
    '/talk':'public/talk.html','/talk.html':'public/talk.html','/talk.js':'public/talk.js','/talk.css':'public/talk.css'
  };
  const json=(res,status,obj)=>{if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
  const send=(res,event,data)=>{
    if(res.destroyed||res.writableEnded)return;
    if(res.writableLength>2*1024*1024){res.destroy();return;}
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  function budget(key,limit,span) {
    const now=Date.now();let r=rates.get(key);
    if(!r||now-r.start>=span){r={start:now,count:0};rates.set(key,r);}
    if(++r.count>limit)throw Error('操作が多すぎます。少し間を空けてください。');
  }
  function streamTicket(entry,pid) {
    const t=token();tickets.set(t,{code:entry.game.code,pid,until:Date.now()+45000});return t;
  }
  function pendingJoinRequests(entry){
    const now=Date.now(),requests=entry.joinRequests||new Map();
    for(const [id,r] of requests){
      if((r.status==='pending'&&r.expiresAt<=now)||(r.status==='approved'&&r.approvalUntil<=now)){
        r.status='expired';r.approvalToken=null;
      }
      if((r.status==='rejected'||r.status==='expired'||r.status==='joined')&&now-(r.decidedAt||r.createdAt)>10*60000)requests.delete(id);
    }
    return [...requests.values()].filter(r=>r.status==='pending'&&r.expiresAt>now);
  }
  function roomView(entry,pid){
    const view=entry.game.view(pid);
    view.solo=!!entry.solo;
    view.publicRoom=!entry.solo&&!entry.cpuWatch;
    view.joinRequests=pid===entry.game.host&&entry.game.phase==='lobby'
      ?pendingJoinRequests(entry).map(r=>({id:r.id,name:r.name,createdAt:r.createdAt}))
      :[];
    return view;
  }
  function publicRoomList(){
    const now=Date.now();
    return [...rooms.entries()]
      .filter(([,entry])=>!entry.solo&&!entry.cpuWatch&&!entry.collapsing)
      .map(([code,entry])=>{
        const g=entry.game,host=g.byId(g.host);
        return {
          code,
          host:host?.name||'部屋主不在',
          hostOnline:!!host?.connected,
          players:g.humans().length,
          maxPlayers:30,
          phase:g.phase,
          day:g.day,
          joinable:g.phase==='lobby'&&!!host?.connected&&g.players.length<30,
          pending:pendingJoinRequests(entry).length,
          createdAt:g.createdAt||now
        };
      })
      .sort((a,b)=>(b.joinable-a.joinable)||b.createdAt-a.createdAt)
      .slice(0,100);
  }
  function ensureAiSeats(entry){
    if(!ai.enabled||entry.game.phase==='lobby'||entry.game.phase==='ended')return [];
    const botIds=entry.game.players.filter(p=>p.bot&&!p.silent).map(p=>p.id);
    entry.aiBotIds=botIds;
    return botIds;
  }
  function queueAiRewrite(entry){
    const ids=ensureAiSeats(entry);if(!ids.length)return false;
    entry.aiRewriteSeen=entry.aiRewriteSeen||new Set();
    entry.aiRewritePending=entry.aiRewritePending||new Set();
    const selected=new Set(ids),game=entry.game;
    const humanReplySource=message=>{
      const replyTo=Number(message.meta?.replyTo||0);
      if(!Number.isInteger(replyTo)||replyTo<=0)return null;
      const source=game.messages.find(m=>m.id===replyTo&&m.channel==='public'&&m.day===message.day);
      return source?.playerId&&!game.byId(source.playerId)?.bot?source:null;
    };
    const candidates=game.messages.filter(m=>{
      if(m.channel!=='public'||!m.text||entry.aiRewriteSeen.has(m.id)||entry.aiRewritePending.has(m.id))return false;
      return selected.has(m.playerId)||!!humanReplySource(m);
    });
    for(const message of candidates.slice(0,Math.max(1,ai.cpuCount))){
      entry.aiRewritePending.add(message.id);
      const id=message.playerId,view=game.botView(id),source=humanReplySource(message),draft={text:message.text,statement:message.meta||null};
      const mode=source?'reply':'talk';
      const history=game.messages
        .filter(m=>m.channel==='public'||m.channel==='system')
        .map(m=>({id:m.id,day:m.day,phase:m.phase,channel:m.channel,playerId:m.playerId,name:m.name,text:m.text,meta:m.meta||null}));
      void ai.rewrite({view,draft,mode,history}).then(text=>{
        const current=game.messages.find(m=>m.id===message.id);
        if(!current||current.playerId!==id||current.channel!=='public')return;
        const clean=String(text||'').trim();
        if(clean&&clean!==current.text){current.text=clean;game.changed();}
      }).catch(error=>{
        recordError('ai cpu rewrite',error);
      }).finally(()=>{
        entry.aiRewritePending.delete(message.id);entry.aiRewriteSeen.add(message.id);
        if(!entry.aiRewritePending.size)broadcast(entry);
      });
    }
    return entry.aiRewritePending.size>0;
  }
  function broadcast(entry) {
    if(entry.collapsing)return;
    if(entry.aiRewritePending?.size){entry.aiBroadcastDeferred=true;return;}
    entry.aiBroadcastDeferred=false;
    const game=entry.game;
    for(const [pid,res] of entry.clients){
      if(!game.byId(pid)){send(res,'removed',{message:'この席は部屋から削除されました。参加画面から入り直せます。'});res.end();entry.clients.delete(pid);continue;}
      send(res,'state',roomView(entry,pid));
    }
    entry.revision=game.revision;
  }
  function forceRemoveSeat(entry,pid){
    const g=entry.game,p=g.byId(pid);
    if(!p)throw Error('対象プレイヤーが見つかりません。');
    const name=p.name,client=entry.clients.get(pid);
    if(client){
      send(client,'removed',{message:'管理者により部屋から退出させられました。'});
      entry.clients.delete(pid);client.end();
    }
    for(const [sessionToken,sessionPid] of entry.sessions)if(sessionPid===pid)entry.sessions.delete(sessionToken);
    for(const [ticketId,ticket] of tickets)if(ticket.code===g.code&&ticket.pid===pid)tickets.delete(ticketId);
    g.players=g.players.filter(x=>x.id!==pid);
    delete g.actions[pid];delete g.specialActions[pid];delete g.votes[pid];
    g.ready.delete(pid);g.infected.delete(pid);g.hiddenWolves.delete(pid);
    for(const [id,target] of Object.entries(g.actions))if(target===pid)delete g.actions[id];
    for(const [id,target] of Object.entries(g.votes))if(target===pid)delete g.votes[id];
    for(const actions of Object.values(g.specialActions||{}))for(const [kind,ids] of Object.entries(actions||{}))actions[kind]=(ids||[]).filter(id=>id!==pid);
    if(Array.isArray(g.runoff))g.runoff=g.runoff.filter(id=>id!==pid);
    for(const other of g.players){
      if(other.lover===pid)other.lover=null;
      if(other.revengeTarget===pid)other.revengeTarget=null;
    }
    if(g.host===pid)g.host=g.humans().find(x=>x.connected)?.id||g.humans()[0]?.id||null;
    g.configVersion++;
    if(!['lobby','ended'].includes(g.phase))g.pendingWin=g.computeWin(null);
    g.system(name+'が管理者により部屋から退出しました。');
    g.changed();broadcast(entry);
    return p;
  }
  async function readBody(req) {
    let size=0,chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>16384)throw Error('送信データが大きすぎます。');chunks.push(chunk);}
    let v;try{v=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('JSON形式のデータが必要です。');}
    if(!v||typeof v!=='object'||Array.isArray(v))throw Error('入力形式が不正です。');
    return v;
  }
  const parseCookies=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [decodeURIComponent(i<0?x:x.slice(0,i)),decodeURIComponent(i<0?'':x.slice(i+1))];}));
  function adminAuth(req){
    const sid=parseCookies(req).ww_admin,session=sid&&adminSessions.get(sid);
    if(!session||session.until<Date.now()){if(sid)adminSessions.delete(sid);return false;}
    session.until=Date.now()+12*60*60*1000;return true;
  }
  const safeEqual=(a,b)=>{const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);};
  function adminBotInfo(g,p){
    if(!p.bot)return null;
    let suspicion=[];
    try{
      if(p.role){const e=Bots.evaluate(g.botView(p.id));suspicion=Object.entries(e.score).filter(([id])=>id!==p.id).map(([id,score])=>({name:g.name(id),score:Math.round(score*10)/10,reason:(e.reasons[id]||[]).sort((a,b)=>b.weight-a.weight)[0]?.text||''})).sort((a,b)=>b.score-a.score).slice(0,5);}
    }catch{}
    const b=p.brain||{};
    return {personality:b.personality||null,talks:b.talks||0,announcedTarget:b.announcedTarget?g.name(b.announcedTarget):null,replyQueued:!!b.replyMessageId,reportDay:b.reportDay||null,fakeRole:b.fakeRole||null,suspicion};
  }
  function adminSnapshot(){
    const now=Date.now(),mem=process.memoryUsage();
    return {version:VERSION,now,server:{
      startedAt:startedReal,uptimeMs:now-startedReal,node:process.version,pid:process.pid,platform:`${process.platform} ${process.arch}`,
      hostname:os.hostname(),rss:mem.rss,heapUsed:mem.heapUsed,heapTotal:mem.heapTotal,external:mem.external,
      loadavg:os.loadavg(),tickMs,maxRooms,requests:requestCount,apiRequests:apiCount,openStreams:[...rooms.values()].reduce((a,e)=>a+e.clients.size,0),
      tickets:tickets.size,adminSessions:adminSessions.size,ai:{enabled:ai.enabled,model:ai.model,cpuCount:ai.cpuCount},recentErrors:recentErrors.slice().reverse()
    },rooms:[...rooms.entries()].map(([code,entry])=>{
      const g=entry.game,gameNow=g.now();
      return {code,phase:g.phase,phaseLabel:g.phase,day:g.day,createdAt:g.createdAt,startedAt:g.startedAt,deadline:g.deadline,gameNow,collapsing:!!entry.collapsing,collapseStartedAt:entry.collapseStartedAt||null,
        cpuWatch:!!entry.cpuWatch,fastMode:!!entry.fastMode,speed:entry.clock?.getSpeed?.()||1,connected:entry.clients.size,humans:g.humans().length,
        bots:g.players.filter(p=>p.bot).length,alive:g.living().length,total:g.players.length,winner:g.winner,host:g.host?g.name(g.host):(entry.cpuWatch?'CPU観戦':'—'),
        training:{eligible:Training.isHumanOnly(g),examples:(entry.trainingExamples||[]).length},
        actions:Object.fromEntries(Object.entries(g.actions).map(([id,target])=>[g.realName(id),target?g.realName(target):null])),
        specialActions:Object.fromEntries(Object.entries(g.specialActions||{}).map(([id,actions])=>[g.realName(id),Object.fromEntries(Object.entries(actions).map(([k,ids])=>[k,(ids||[]).map(t=>t?g.realName(t):null)]))])),
        votes:Object.fromEntries(Object.entries(g.votes).map(([id,target])=>[g.realName(id),target?g.realName(target):null])),
        players:g.players.map(p=>({id:p.id,name:p.name,bot:p.bot,connected:p.connected,alive:p.alive,auto:p.auto,role:p.role,lover:p.lover?g.realName(p.lover):null,
          levelerLevel:p.levelerLevel||0,cheaterExecutionHit:!!p.cheaterExecutionHit,cheaterAttackHit:!!p.cheaterAttackHit,resetUsed:!!p.resetUsed,
          personality:p.bot?(p.brain?.personality||null):null,aiSpeech:!!entry.aiBotIds?.includes(p.id),botDebug:adminBotInfo(g,p),privateResults:p.privateResults.slice(-12),action:Object.hasOwn(g.actions,p.id)?(g.actions[p.id]?g.realName(g.actions[p.id]):null):undefined,
          vote:Object.hasOwn(g.votes,p.id)?(g.votes[p.id]?g.realName(g.votes[p.id]):null):undefined})),
        messages:g.messages.slice(-160).map(m=>({...m})),claims:g.claims.slice(-60),reports:g.reports.slice(-60),voteHistory:g.voteHistory.slice(-12),adminNarration:g.adminNarration?{...g.adminNarration}:null};
    })};
  }
  const server=http.createServer(async(req,res)=>{
    requestCount++;
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    let url;try{url=new URL(req.url,'http://localhost');}catch{return json(res,400,{ok:false,error:'Invalid URL'});}
    const ip=req.socket.remoteAddress||'local'; // Do not trust arbitrary X-Forwarded-For headers.
    try{
      if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,version:VERSION,uptimeMs:Date.now()-startedReal,rooms:rooms.size});
      if(req.method==='GET'&&url.pathname==='/rooms'){
        return json(res,200,{ok:true,rooms:publicRoomList(),now:Date.now()});
      }
      if(req.method==='GET'&&url.pathname==='/health/training'){
        const status=Training.getTursoStatus();
        const summary=await Training.getTursoSummary();
        return json(res,200,{ok:true,state:status.state,pending:status.pending,writesSinceBoot:status.writes,lastWriteAt:status.lastWriteAt,summary});
      }
      if(req.method==='GET'&&url.pathname==='/health/talk'){
        const stats=await talk.stats();
        return json(res,200,{ok:true,...stats});
      }
      if(req.method==='POST'&&url.pathname==='/talk/api'){
        if(!String(req.headers['content-type']).startsWith('application/json'))return json(res,415,{ok:false,error:'JSONが必要です。'});
        const body=await readBody(req),action=String(body.action||'');
        if(action==='start'){
          budget('talk-start:'+ip,30,300000);
          const result=await talk.startSession(String(body.name||'').slice(0,32));
          return json(res,200,{ok:true,...result});
        }
        const sessionId=String(body.sessionId||'').slice(0,80);
        budget('talk:'+sessionId+':'+ip,80,60000);
        if(action==='send'){
          const result=await talk.send({sessionId,text:String(body.text||'').slice(0,400)});
          return json(res,200,{ok:true,...result});
        }
        if(action==='feedback'){
          const result=await talk.feedback({sessionId,turnId:String(body.turnId||'').slice(0,80),value:Number(body.value)});
          return json(res,200,result);
        }
        throw Error('会話ラボの操作が不正です。');
      }
      if(req.method==='POST'&&url.pathname==='/admin/login'){
        budget('admin-login:'+ip,12,300000);
        if(!String(req.headers['content-type']).startsWith('application/json'))return json(res,415,{ok:false,error:'JSONが必要です。'});
        const body=await readBody(req);
        if(!safeEqual(body.password,effectiveAdminPassword))return json(res,401,{ok:false,error:'管理者パスワードが違います。'});
        const sid=token();adminSessions.set(sid,{until:Date.now()+12*60*60*1000});
        res.setHeader('Set-Cookie',`ww_admin=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
        return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/admin/logout'){
        const sid=parseCookies(req).ww_admin;if(sid)adminSessions.delete(sid);
        res.setHeader('Set-Cookie','ww_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});
      }
      if(req.method==='GET'&&url.pathname==='/admin/data'){
        if(!adminAuth(req))return json(res,401,{ok:false,error:'管理者ログインが必要です。'});
        return json(res,200,{ok:true,...adminSnapshot()});
      }
      if(req.method==='GET'&&url.pathname==='/admin/training'){
        if(!adminAuth(req))return json(res,401,{ok:false,error:'管理者ログインが必要です。'});
        const code=normalizeRoomCode(url.searchParams.get('code')),entry=rooms.get(code);
        if(!entry)return json(res,404,{ok:false,error:'部屋が見つかりません。'});
        const body=Training.toJsonl(entry);
        res.writeHead(200,{
          'Content-Type':'application/x-ndjson; charset=utf-8',
          'Content-Disposition':`attachment; filename="werewolf-training-${code}.jsonl"`,
          'Cache-Control':'no-store'
        });
        return res.end(body);
      }
      if(req.method==='POST'&&url.pathname==='/admin/action'){
        if(!adminAuth(req))return json(res,401,{ok:false,error:'管理者ログインが必要です。'});
        const body=await readBody(req),action=String(body.action||'');
        if(action==='create_cpu_watch'){
          if(rooms.size>=maxRooms)throw Error('現在部屋がいっぱいです。');
          const count=Number(body.count||8);if(!Number.isInteger(count)||count<4||count>30)throw Error('CPU人数は4〜30人で指定してください。');
          let code=normalizeRoomCode(body.code);
          if(!code){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';do{code='CPU-'+Array.from({length:4},()=>alphabet[crypto.randomInt(alphabet.length)]).join('');}while(rooms.has(code));}
          if(rooms.has(code))throw Error('その部屋コードはすでに使われています。');
          const clock=makeClock(),game=new Game({code,random:()=>crypto.randomInt(0x100000000)/0x100000000,now:()=>clock.now()});
          game.setBots(count);
          let roleOrder=null;
          if(Array.isArray(body.roles)&&body.roles.length){
            if(body.roles.length!==count||body.roles.some(r=>!ROLE_IDS.includes(String(r))))throw Error('CPUの手動配役が不正です。');
            roleOrder=body.roles.map(String);
            const counts=Object.fromEntries(ROLE_IDS.map(k=>[k,0]));for(const r of roleOrder)counts[r]++;
            game.applyConfig({...game.config,roles:counts,testRole:''});
          }else game.applyConfig({...game.config,roles:preset(count),testRole:''});
          game.start({allowBotOnly:true,roleOrder});
          rooms.set(code,{game,sessions:new Map(),clients:new Map(),revision:0,lastEmpty:Date.now(),cpuWatch:true,clock,fastMode:false});
          return json(res,200,{ok:true,code});
        }
        const code=normalizeRoomCode(body.code),entry=rooms.get(code);if(!entry)throw Error('部屋が見つかりません。');
        if(action==='toggle_fast'){
          if(!entry.cpuWatch||!entry.clock)throw Error('CPU観戦部屋だけ早送りできます。');
          entry.fastMode=body.enabled===undefined?!entry.fastMode:body.enabled===true;entry.clock.setSpeed(entry.fastMode?8:1);
          return json(res,200,{ok:true,fastMode:entry.fastMode,speed:entry.clock.getSpeed()});
        }
        if(action==='step'){
          if(!entry.cpuWatch)throw Error('CPU観戦部屋だけ進められます。');
          if(entry.game.phase==='night')entry.game.fillActions(Bots);
          if(entry.game.phase==='vote')for(const p of entry.game.living().filter(p=>entry.game.isBot(p)&&!Object.hasOwn(entry.game.votes,p.id))){const c=Bots.decide(entry.game.botView(p.id),p.brain,'vote');entry.game.submitVote(p.id,entry.game.targets(p,'vote').includes(c?.target)?c.target:null,entry.game.phaseId,true);}
          if(!['lobby','ended'].includes(entry.game.phase))entry.game.advance();
          return json(res,200,{ok:true});
        }
        if(action==='broadcast_narration'){
          const g=entry.game;
          if(g.phase==='lobby')throw Error('ゲーム開始後の部屋で送信してください。');
          const text=String(body.text||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,120);
          if(!text)throw Error('表示する文章を入力してください。');
          g.adminNarration={id:++g.adminNarrationSeq,text,at:g.now()};
          g.changed();broadcast(entry);
          return json(res,200,{ok:true,id:g.adminNarration.id});
        }
        if(action==='force_kill'||action==='force_revive'){
          const g=entry.game;if(['lobby','ended'].includes(g.phase))throw Error('ゲーム進行中の部屋で使ってください。');
          const p=g.byId(String(body.playerId||''));if(!p)throw Error('対象プレイヤーが見つかりません。');
          if(action==='force_kill'){
            if(!p.alive)throw Error('そのプレイヤーはすでに死亡しています。');
            p.alive=false;p.deathAt=g.msgId;p.deathCause='admin';
            delete g.actions[p.id];delete g.specialActions[p.id];delete g.votes[p.id];
            g.system('管理者操作により'+p.name+'が死亡状態になりました。');
          }else{
            if(p.alive)throw Error('そのプレイヤーはすでに生存しています。');
            p.alive=true;p.deathAt=null;p.deathCause=null;
            if(p.brain&&typeof p.brain==='object')p.brain.actionAt=g.now()+2500;
            g.system('管理者操作により'+p.name+'が復活しました。');
          }
          g.pendingWin=g.computeWin(null);g.changed();broadcast(entry);return json(res,200,{ok:true,alive:p.alive});
        }
        if(action==='set_cpu_votes'){
          const g=entry.game;if(g.phase!=='vote')throw Error('投票フェーズでのみCPU票を操作できます。');
          const votes=body.votes&&typeof body.votes==='object'?body.votes:{};
          for(const p of g.living().filter(p=>p.bot)){
            if(!Object.hasOwn(votes,p.id))continue;
            const v=votes[p.id];
            if(v==='auto'){delete g.votes[p.id];p.brain.actionAt=g.now()+3500;continue;}
            const target=v===null?null:String(v);
            if(target!==null&&!g.targets(p,'vote').includes(target))throw Error(p.name+'の投票先が不正です。');
            g.votes[p.id]=target;
          }
          g.changed();broadcast(entry);return json(res,200,{ok:true});
        }
        if(action==='set_cpu_attack'){
          const g=entry.game;if(g.phase!=='night')throw Error('夜フェーズでのみ襲撃先を操作できます。');
          const livingWolves=g.living().filter(p=>WOLF.has(p.role));
          if(livingWolves.some(p=>!p.bot))throw Error('人間の人狼が生存しているため、管理者から襲撃先は上書きできません。');
          const cpuWolves=livingWolves.filter(p=>p.bot);if(!cpuWolves.length)throw Error('操作できるCPU人狼がいません。');
          const target=String(body.target||'');for(const p of cpuWolves)if(!g.targets(p,'attack').includes(target))throw Error('その相手は襲撃できません。');
          for(const p of cpuWolves)g.actions[p.id]=target;
          g.system('管理者デバッグ操作によりCPU人狼の襲撃先が指定されました。');g.changed();broadcast(entry);return json(res,200,{ok:true});
        }
        if(action==='kick_player'){
          const p=entry.game.byId(String(body.playerId||''));
          if(!p)throw Error('対象プレイヤーが見つかりません。');
          if(p.bot)throw Error('追放ボタンは人間プレイヤー用です。');
          forceRemoveSeat(entry,p.id);
          return json(res,200,{ok:true,playerId:p.id,name:p.name});
        }
        if(action==='collapse_room'){
          if(entry.collapsing)throw Error('この部屋はすでに崩壊中です。');
          entry.collapsing=true;entry.collapseStartedAt=Date.now();
          const payload={code,durationMs:Math.max(20,Number(collapseDelayMs)||5000),startedAt:entry.collapseStartedAt};
          for(const client of entry.clients.values())send(client,'room_collapse',payload);
          const collapseTimer=setTimeout(()=>{
            if(rooms.get(code)!==entry)return;
            for(const client of entry.clients.values())client.end();
            rooms.delete(code);
          },payload.durationMs);
          collapseTimer.unref?.();
          return json(res,200,{ok:true,collapsing:true,durationMs:payload.durationMs});
        }
        if(action==='delete_room'){
          for(const client of entry.clients.values())client.end();rooms.delete(code);return json(res,200,{ok:true});
        }
        throw Error('不明な管理操作です。');
      }
      if(req.method==='GET'&&url.pathname==='/events'){
        const t=url.searchParams.get('ticket'),ticket=tickets.get(t);tickets.delete(t);
        const entry=ticket&&rooms.get(ticket.code),p=entry?.game.byId(ticket?.pid);
        if(!ticket||ticket.until<Date.now()||!entry||!p)return json(res,401,{ok:false,error:'接続を更新してください。'});
        const previous=entry.clients.get(p.id);
        if(previous){send(previous,'replaced',{message:'同じ席が別のタブで開かれました。'});previous.end();}
        entry.clients.set(p.id,res);entry.game.connect(p.id);
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(': connected\n\n');send(res,'state',roomView(entry,p.id));
        res.on('close',()=>{
          if(entry.clients.get(p.id)===res){entry.clients.delete(p.id);entry.game.disconnect(p.id);entry.lastEmpty=Date.now();}
        });
        broadcast(entry);return;
      }
      if(req.method==='POST'&&url.pathname==='/api'){
        apiCount++;
        const origin=req.headers.origin;
        if(origin&&new URL(origin).host!==req.headers.host)return json(res,403,{ok:false,error:'別のサイトからの操作は許可されていません。'});
        if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{ok:false,error:'Cross-site request rejected'});
        if(!String(req.headers['content-type']).startsWith('application/json'))return json(res,415,{ok:false,error:'JSONが必要です。'});
        budget('api:'+ip,1000,30000);
        const body=await readBody(req),event=body.event,data=body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:{};
        if(event==='create'){
          budget('create:'+ip,12,300000);
          if(rooms.size>=maxRooms)throw Error('現在部屋がいっぱいです。');
          const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          let code=normalizeRoomCode(data.roomCode);
          if(code){if(rooms.has(code))throw Error('その部屋コードはすでに使われています。別のコードにしてください。');}
          else do{code=Array.from({length:5},()=>alphabet[crypto.randomInt(alphabet.length)]).join('');}while(rooms.has(code));
          const game=new Game({code,random:()=>crypto.randomInt(0x100000000)/0x100000000});
          const pid=crypto.randomUUID(),secret=token();game.addPlayer({id:pid,name:data.name});
          const entry={game,sessions:new Map([[secret,pid]]),clients:new Map(),revision:0,lastEmpty:Date.now(),cpuWatch:false,clock:null,fastMode:false,solo:data.solo===true,joinRequests:new Map()};
          rooms.set(code,entry);
          if(data.solo)game.prepareSolo(data.role??'seer',8);
          else void notifyRoomCreated({code,creator:game.realName(pid)}).catch(error=>recordError('discord room notify',error));
          return json(res,200,{ok:true,code,token:secret,playerId:pid,ticket:streamTicket(entry,pid),state:roomView(entry,pid)});
        }
        const code=normalizeRoomCode(body.code||data.code),entry=rooms.get(code);
        if(!entry)throw Error('部屋がありません。サーバー再起動時には部屋が消えます。');
        const game=entry.game;
        if(event==='request_join'){
          budget('join-request:'+ip,20,300000);
          if(entry.solo||entry.cpuWatch)throw Error('この部屋には参加申請できません。');
          if(game.phase!=='lobby')throw Error('この部屋は対戦中です。');
          const name=validName(data.name);
          if(game.players.some(p=>!p.bot&&p.name===name))throw Error('同じ名前の参加者がすでにいます。');
          const existing=[...(entry.joinRequests||new Map()).values()].find(r=>r.name===name&&r.status==='pending'&&r.expiresAt>Date.now());
          if(existing)return json(res,200,{ok:true,code,requestId:existing.id,status:'pending'});
          const requestId=token(),createdAt=Date.now();
          entry.joinRequests=entry.joinRequests||new Map();
          entry.joinRequests.set(requestId,{id:requestId,name,createdAt,expiresAt:createdAt+5*60000,status:'pending',approvalToken:null,approvalUntil:0,decidedAt:0});
          broadcast(entry);
          return json(res,200,{ok:true,code,requestId,status:'pending'});
        }
        if(event==='join_status'){
          const requestId=String(data.requestId||''),r=entry.joinRequests?.get(requestId);
          if(!r)return json(res,200,{ok:true,code,status:'expired'});
          pendingJoinRequests(entry);
          return json(res,200,{ok:true,code,status:r.status,approvalToken:r.status==='approved'?r.approvalToken:null});
        }
        let pid=entry.sessions.get(body.token),secret=body.token;
        if(event==='join'){
          // A stale local token must not trap the player outside the room. Fall back to exact-name reclaim.
          if(body.token&&!pid)secret='';
          if(pid&&!game.byId(pid)){entry.sessions.delete(secret);pid=null;secret='';}
          if(!pid){
            const requestedName=validName(data.name);
            const existing=game.players.find(p=>!p.bot&&p.name===requestedName);
            if(existing){
              // Exact-name reclaim is intentionally permissive during the current multiplayer test.
              // It works in the lobby and during a match, even if the old connection still looks alive.
              pid=existing.id;secret=token();
              for(const [sessionToken,sessionPid] of entry.sessions)if(sessionPid===pid)entry.sessions.delete(sessionToken);
              entry.sessions.set(secret,pid);
              const previous=entry.clients.get(pid);
              if(previous){send(previous,'replaced',{message:'同じ名前で参加し直したため、この接続を新しい画面へ引き継ぎます。'});entry.clients.delete(pid);previous.end();}
              existing.auto=false;game.connect(pid);
              if(game.phase!=='lobby')game.system(existing.name+'が対戦に復帰しました。');
              broadcast(entry);
              return json(res,200,{ok:true,code,token:secret,playerId:pid,ticket:streamTicket(entry,pid),state:roomView(entry,pid),rejoined:true});
            }
            if(game.phase!=='lobby')throw Error('対戦中です。参加済みの名前を入力すると自分の席へ復帰できます。');
            if(entry.solo||entry.cpuWatch)throw Error('この部屋には新規参加できません。');
            const requestId=String(data.requestId||''),approvalToken=String(data.approvalToken||'');
            const request=entry.joinRequests?.get(requestId);
            if(!request||request.status!=='approved'||request.name!==requestedName||request.approvalUntil<Date.now()||!approvalToken||request.approvalToken!==approvalToken){
              throw Error('新規参加には部屋主の許可が必要です。先に参加申請を送ってください。');
            }
            pid=crypto.randomUUID();secret=token();game.addPlayer({id:pid,name:requestedName});entry.sessions.set(secret,pid);
            request.status='joined';request.decidedAt=Date.now();request.approvalToken=null;
            // 参加人数が変わっても配役は自動変更しない。必要なら部屋主が配役を調整する。
            game.configVersion++;game.system(`${game.name(pid)}が参加しました。`);
          }
          game.connect(pid);broadcast(entry);
          return json(res,200,{ok:true,code,token:secret,playerId:pid,ticket:streamTicket(entry,pid),state:roomView(entry,pid)});
        }
        if(!pid||!game.byId(pid))return json(res,401,{ok:false,error:'参加情報を確認してください。'});
        budget('seat:'+secret,100,30000);
        if(event==='approve_join'||event==='reject_join'){
          if(pid!==game.host)throw Error('参加申請を処理できるのは部屋主だけです。');
          if(game.phase!=='lobby')throw Error('参加申請は待機室でのみ処理できます。');
          const request=entry.joinRequests?.get(String(data.requestId||''));
          if(!request||request.status!=='pending')throw Error('この参加申請はすでに処理済みです。');
          request.decidedAt=Date.now();
          if(event==='approve_join'){
            if(game.players.length>=30)throw Error('部屋が満員です。');
            if(game.players.some(p=>!p.bot&&p.name===request.name))throw Error('同じ名前の参加者がすでにいます。');
            request.status='approved';request.approvalToken=token();request.approvalUntil=Date.now()+2*60000;
          }else{
            request.status='rejected';request.approvalToken=null;request.approvalUntil=0;
          }
          broadcast(entry);
          return json(res,200,{ok:true,status:request.status,name:request.name});
        }
        if(event==='bots'&&!entry.solo)throw Error('通常のオンライン部屋ではCPUを追加できません。');
        if(event==='chat'||event==='statement'){
          const previous=chatRates.get(secret)||0;
          if(Date.now()-previous<700)throw Error('連続投稿は少し間を空けてください。');
          chatRates.set(secret,Date.now());
        }
        if(event==='state')return json(res,200,{ok:true,state:roomView(entry,pid)});
        const trainingContext=Training.ACTION_EVENTS.has(event)&&Training.isHumanOnly(game)&&!game.byId(pid)?.bot
          ?Training.captureContext(game,pid):null;
        game.command(pid,event,data,Bots);
        if(trainingContext)Training.recordAction(entry,game,pid,event,data,trainingContext);
        broadcast(entry);
        return json(res,200,{ok:true});
      }
      if((req.method==='GET'||req.method==='HEAD')&&allowed[url.pathname]){
        const filename=path.join(__dirname,allowed[url.pathname]);
        if(!fs.existsSync(filename))return json(res,404,{ok:false,error:'Not built yet'});
        // The standalone page uses inline scripts by design; it has no network calls.
        if(url.pathname==='/solo.html')res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache'});
        if(req.method==='HEAD')res.end();else fs.createReadStream(filename).pipe(res);return;
      }
      if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
      json(res,404,{ok:false,error:'Not found'});
    }catch(error){recordError(`${req.method} ${req.url}`,error);json(res,400,{ok:false,error:error.message||'処理に失敗しました。'});}
  });
  server.headersTimeout=15000;server.requestTimeout=20000;
  const timer=setInterval(()=>{
    for(const [code,entry] of rooms){
      try{
        if(entry.collapsing)continue;
        entry.game.tick(Bots);
        Training.sampleSilence(entry,entry.game);
        queueAiRewrite(entry);
        if(entry.revision!==entry.game.revision)broadcast(entry);
        if((!entry.cpuWatch&&!entry.game.humans().length)||(!entry.cpuWatch&&!entry.clients.size&&Date.now()-entry.lastEmpty>30*60000)){
          for(const res of entry.clients.values())res.end();
          rooms.delete(code);
        }
      }catch(err){recordError('room tick '+code,err);console.error('Room tick failed',code,err);/* Keep other rooms alive. */}
    }
  },tickMs);
  const housekeeping=setInterval(()=>{
    for(const [key,t] of tickets)if(t.until<Date.now())tickets.delete(key);
    for(const [key,r] of rates)if(Date.now()-r.start>300000)rates.delete(key);
    for(const [key,time] of chatRates)if(Date.now()-time>60000)chatRates.delete(key);
    for(const [key,v] of adminSessions)if(v.until<Date.now())adminSessions.delete(key);
    for(const entry of rooms.values()){
      pendingJoinRequests(entry);
      for(const res of entry.clients.values())if(!res.destroyed)res.write(': heartbeat\n\n');
    }
  },15000);
  server.on('close',()=>{clearInterval(timer);clearInterval(housekeeping);});
  function close(){
    clearInterval(timer);clearInterval(housekeeping);
    for(const entry of rooms.values())for(const res of entry.clients.values())res.end();
    void talk.close?.();
    return new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  }
  return {server,rooms,close,adminPassword:effectiveAdminPassword,aiStatus:{enabled:ai.enabled,model:ai.model,cpuCount:ai.cpuCount}};
}
if(require.main===module){
  const app=createApp();const port=Number(process.env.PORT||3000),host=process.env.HOST||'0.0.0.0';
  app.server.listen(port,host,()=>{
    console.log(`Werewolf Game v${VERSION}\nGame:  http://localhost:${port}\nAdmin: http://localhost:${port}/admin\nAI CPU: ${app.aiStatus.enabled?'enabled':'disabled'} (parallel ${app.aiStatus.cpuCount} / ${app.aiStatus.model})\nCtrl+C to stop. Rooms are stored in memory.`);
    if(process.env.AI_TRAIN_ON_BOOT==='1'){
      const {trainAndStoreLatest}=require('./ai/train');
      console.log('SELF_AI_TRAIN_START');
      void trainAndStoreLatest().then(bundle=>{
        const t=bundle.training;
        console.log('SELF_AI_TRAIN_RESULT '+JSON.stringify({
          modelId:bundle.saved?.modelId||null,
          reused:!!bundle.saved?.reused,
          usableExamples:t.usableExamples,
          trainExamples:t.trainExamples,
          testExamples:t.testExamples,
          trainGames:t.trainGames,
          testGames:t.testGames,
          trainAccuracy:t.trainAccuracy,
          testAccuracy:t.testAccuracy,
          baselineLabel:t.baselineLabel,
          baselineAccuracy:t.baselineAccuracy,
          discussionSpeakSilence:t.discussionSpeakSilence,
          labelCounts:t.labelCounts,
          byLabel:t.byLabel
        }));
      }).catch(error=>console.error('SELF_AI_TRAIN_ERROR',error?.stack||error));
    }
  });
  app.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port is busy. Close the old server or set PORT to another number.':error.message);process.exit(1);});
  process.on('SIGINT',()=>app.close().then(()=>process.exit(0)));
  process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));
}
module.exports={createApp};
