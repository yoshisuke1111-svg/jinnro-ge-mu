/* Zero-dependency Node.js server: HTTPS proxy -> HTTP actions + SSE state updates.
 * Secrets never appear in invitation URLs or public state. Stream tickets are one-use.
 */
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const {Game,preset}=require('./shared/rules');
const Bots=require('./shared/bots');
const VERSION='0.6.2';
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

function createApp({tickMs=250,maxRooms=100,adminPassword=process.env.ADMIN_PASSWORD||null}={}) {
  const rooms=new Map(),tickets=new Map(),rates=new Map(),chatRates=new Map(),adminSessions=new Map();
  const startedReal=Date.now(),recentErrors=[];let requestCount=0,apiCount=0;
  const recordError=(scope,error)=>{recentErrors.push({at:Date.now(),scope,message:String(error?.message||error)});if(recentErrors.length>40)recentErrors.splice(0,recentErrors.length-40);};
  const effectiveAdminPassword=adminPassword||crypto.randomBytes(9).toString('base64url');
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  const allowed={
    '/':'public/index.html','/index.html':'public/index.html','/app.js':'public/app.js','/style.css':'public/style.css',
    '/transport.js':'public/transport.js','/shared/rules.js':'shared/rules.js','/solo.html':'public/solo.html',
    '/admin':'public/admin.html','/admin.html':'public/admin.html','/admin.js':'public/admin.js','/admin.css':'public/admin.css'
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
  function broadcast(entry) {
    const game=entry.game;
    for(const [pid,res] of entry.clients){
      if(!game.byId(pid)){send(res,'removed',{message:'待機室で75秒間操作がなかったため退出しました。入り直せます。'});res.end();entry.clients.delete(pid);continue;}
      send(res,'state',game.view(pid));
    }
    entry.revision=game.revision;
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
      tickets:tickets.size,adminSessions:adminSessions.size,recentErrors:recentErrors.slice().reverse()
    },rooms:[...rooms.entries()].map(([code,entry])=>{
      const g=entry.game,gameNow=g.now();
      return {code,phase:g.phase,phaseLabel:g.phase,day:g.day,createdAt:g.createdAt,startedAt:g.startedAt,deadline:g.deadline,gameNow,
        cpuWatch:!!entry.cpuWatch,fastMode:!!entry.fastMode,speed:entry.clock?.getSpeed?.()||1,connected:entry.clients.size,humans:g.humans().length,
        bots:g.players.filter(p=>p.bot).length,alive:g.living().length,total:g.players.length,winner:g.winner,host:g.host?g.name(g.host):(entry.cpuWatch?'CPU観戦':'—'),
        actions:Object.fromEntries(Object.entries(g.actions).map(([id,target])=>[g.name(id),target?g.name(target):null])),
        votes:Object.fromEntries(Object.entries(g.votes).map(([id,target])=>[g.name(id),target?g.name(target):null])),
        players:g.players.map(p=>({id:p.id,name:p.name,bot:p.bot,connected:p.connected,alive:p.alive,auto:p.auto,role:p.role,lover:p.lover?g.name(p.lover):null,
          personality:p.bot?(p.brain?.personality||null):null,botDebug:adminBotInfo(g,p),privateResults:p.privateResults.slice(-12),action:Object.hasOwn(g.actions,p.id)?(g.actions[p.id]?g.name(g.actions[p.id]):null):undefined,
          vote:Object.hasOwn(g.votes,p.id)?(g.votes[p.id]?g.name(g.votes[p.id]):null):undefined})),
        messages:g.messages.slice(-160).map(m=>({...m})),claims:g.claims.slice(-60),reports:g.reports.slice(-60),voteHistory:g.voteHistory.slice(-12)};
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
          game.setBots(count);game.applyConfig({...game.config,roles:preset(count),testRole:''});game.start({allowBotOnly:true});
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
        res.write(': connected\n\n');send(res,'state',entry.game.view(p.id));
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
          const entry={game,sessions:new Map([[secret,pid]]),clients:new Map(),revision:0,lastEmpty:Date.now(),cpuWatch:false,clock:null,fastMode:false};
          rooms.set(code,entry);
          if(data.solo)game.prepareSolo(data.role??'seer',8);
          return json(res,200,{ok:true,code,token:secret,playerId:pid,ticket:streamTicket(entry,pid),state:game.view(pid)});
        }
        const code=normalizeRoomCode(body.code||data.code),entry=rooms.get(code);
        if(!entry)throw Error('部屋がありません。サーバー再起動時には部屋が消えます。');
        const game=entry.game;
        let pid=entry.sessions.get(body.token),secret=body.token;
        if(event==='join'){
          if(body.token&&!pid)throw Error('復帰用のキーが無効です。参加画面から入り直してください。');
          if(pid&&!game.byId(pid)){entry.sessions.delete(secret);throw Error('待機室の席は退出済みです。名前を入力して参加し直してください。');}
          if(!pid){
            const prev=game.players.length,total=Object.values(game.config.roles).reduce((a,b)=>a+b,0);
            pid=crypto.randomUUID();secret=token();game.addPlayer({id:pid,name:data.name});entry.sessions.set(secret,pid);
            if(prev===total)game.config.roles.villager++;
            game.configVersion++;game.system(`${game.name(pid)}が参加しました。`);
          }
          game.connect(pid);broadcast(entry);
          return json(res,200,{ok:true,code,token:secret,playerId:pid,ticket:streamTicket(entry,pid),state:game.view(pid)});
        }
        if(!pid||!game.byId(pid))return json(res,401,{ok:false,error:'参加情報を確認してください。'});
        budget('seat:'+secret,100,30000);
        if(event==='chat'||event==='statement'){
          const previous=chatRates.get(secret)||0;
          if(Date.now()-previous<700)throw Error('連続投稿は少し間を空けてください。');
          chatRates.set(secret,Date.now());
        }
        if(event==='state')return json(res,200,{ok:true,state:game.view(pid)});
        game.command(pid,event,data,Bots);broadcast(entry);
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
        entry.game.tick(Bots);
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
    for(const entry of rooms.values())for(const res of entry.clients.values())if(!res.destroyed)res.write(': heartbeat\n\n');
  },15000);
  server.on('close',()=>{clearInterval(timer);clearInterval(housekeeping);});
  function close(){
    clearInterval(timer);clearInterval(housekeeping);
    for(const entry of rooms.values())for(const res of entry.clients.values())res.end();
    return new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  }
  return {server,rooms,close,adminPassword:effectiveAdminPassword};
}
if(require.main===module){
  const app=createApp();const port=Number(process.env.PORT||3000),host=process.env.HOST||'0.0.0.0';
  app.server.listen(port,host,()=>console.log(`Werewolf Game v${VERSION}\nGame:  http://localhost:${port}\nAdmin: http://localhost:${port}/admin\nAdmin password: ${app.adminPassword}\nCtrl+C to stop. Rooms are stored in memory.`));
  app.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port is busy. Close the old server or set PORT to another number.':error.message);process.exit(1);});
  process.on('SIGINT',()=>app.close().then(()=>process.exit(0)));
  process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));
}
module.exports={createApp};
