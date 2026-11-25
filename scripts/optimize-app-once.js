'use strict';
const fs=require('node:fs');

function replaceOnce(source,from,to,label){
  if(!source.includes(from))throw new Error('Missing '+label);
  return source.replace(from,to);
}
function replaceSection(source,start,end,replacement,label){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  if(a<0||b<0)throw new Error('Missing section '+label);
  return source.slice(0,a)+replacement+source.slice(b);
}

const appPath='public/app.js';
let app=fs.readFileSync(appPath,'utf8');

app=replaceOnce(app,
  "  let actionSignature='',chatSignature='',recordSignature='',playerSignature='',privateSignature='';",
  "  let actionSignature='',chatSignature='',recordSignature='',playerSignature='',privateSignature='',boardPlayerSignature='',bubbleSignature='';",
  'signature variables');
app=replaceOnce(app,
  "  let secretFlipTimer=null,secretCloseTimer=null,secretFadeTimer=null,secretFlipped=false,secretShownPhase=null,collapseRunning=false;",
  "  let secretFlipTimer=null,secretCloseTimer=null,secretFadeTimer=null,secretFlipped=false,secretShownPhase=null,collapseRunning=false,arrowFrame=0,arrowTimer=0,lastArrowDrawAt=0,lastTickSecond='';",
  'render scheduler variables');

app=replaceSection(app,
  '  function renderBoardPlayers(s){',
  '  function handleBoardPlayer(id){',
`  function renderBoardPlayers(s){
    const sig=JSON.stringify([s.me.id,s.me.role,s.players.map(p=>[p.id,p.name,p.alive,p.bot,p.host,p.role||''])]);
    if(sig===boardPlayerSignature)return;
    boardPlayerSignature=sig;
    const box=$('boardPlayers');box.innerHTML='';const n=s.players.length;
    s.players.forEach((p,i)=>{const pos=boardPoint(i,n),b=document.createElement('button');b.type='button';b.className=\`board-player \${p.alive?'':'dead'} \${p.id===s.me.id?'me':''} \${p.bot?'bot':''} \${n>18?'dense':''}\`;b.style.left=pos.x+'%';b.style.top=pos.y+'%';b.dataset.playerId=p.id;const peek=s.me.role==='cheater'&&p.role?\`<em class="cheater-role">\${esc(ROLES[p.role]?.name||p.role)}</em>\`:'';b.innerHTML=\`<span class="board-avatar">\${esc([...(p.name||'?')][0]||'?')}</span><span class="board-name">\${esc(p.name)}</span>\${peek}<small>\${p.bot?'CPU':''}\${p.host?(p.bot?' · ':'')+'HOST':''}\${!p.alive?' · 死亡':''}</small>\`;b.onclick=()=>handleBoardPlayer(p.id);box.append(b);});
  }
`,
  'board players');

app=replaceOnce(app,
  '  function drawArrows(s){\n    const svg=',
  '  function drawArrows(s){\n    if(!boardVisible())return;\n    const svg=',
  'arrow visibility guard');

app=replaceOnce(app,
  '  function drawArrows(s){',
`  function boardVisible(){
    const board=$('board');
    if(document.hidden||collapseRunning||!board||board.offsetParent===null)return false;
    if(matchMedia('(max-width:700px)').matches&&mobileView!=='board')return false;
    return true;
  }
  function scheduleArrowDraw(s,force=false){
    if(!boardVisible())return;
    if(force&&arrowTimer){clearTimeout(arrowTimer);arrowTimer=0;}
    if(arrowFrame||arrowTimer)return;
    const delay=force?0:Math.max(0,1100-(performance.now()-lastArrowDrawAt));
    arrowTimer=setTimeout(()=>{
      arrowTimer=0;if(!boardVisible())return;
      arrowFrame=requestAnimationFrame(()=>{arrowFrame=0;lastArrowDrawAt=performance.now();drawArrows(state||s);});
    },delay);
  }
  function drawArrows(s){`,
  'arrow scheduler insertion');

app=replaceSection(app,
  '  function renderBubbles(s){',
  '  function updateBoardDock(s){',
`  function renderBubbles(s,force=false){
    if(document.hidden||collapseRunning)return;
    const box=$('bubbleLayer'),now=Date.now()+timeOffset,latest=[];const seen=new Set();
    const limit=matchMedia('(max-width:700px)').matches?2:3;
    for(const m of s.messages.slice().reverse()){if(m.channel!=='public'||m.day!==s.day||!m.playerId||now-m.at>22000||seen.has(m.playerId))continue;seen.add(m.playerId);latest.push(m);if(latest.length>=limit)break;}
    const sig=latest.map(m=>m.id).join(',')+'|'+Math.floor(now/4000);
    if(!force&&sig===bubbleSignature)return;
    bubbleSignature=sig;box.innerHTML='';const n=s.players.length;
    for(const m of latest.reverse()){const idx=s.players.findIndex(p=>p.id===m.playerId);if(idx<0)continue;const p=boardPoint(idx,n),age=now-m.at,bx=clamp(p.x+(50-p.x)*.38,18,82),by=clamp(p.y+(50-p.y)*.38,18,82),d=document.createElement('div');d.className='board-bubble'+(m.meta?' structured':'');d.style.left=bx+'%';d.style.top=by+'%';d.style.opacity=String(clamp(1-age/26000,.18,1));const short=m.text.length>82?m.text.slice(0,81)+'…':m.text;d.innerHTML=\`<strong>\${esc(m.name)}</strong><span>\${esc(short)}</span>\`;box.append(d);}
  }
`,
  'board bubbles');

app=replaceSection(app,
  '  function renderBoard(s){',
  '  function narrate(',
`  function renderBoard(s){
    renderBoardPlayers(s);$('boardPhase').textContent=s.phaseLabel||PHASES[s.phase]||s.phase;$('boardSub').textContent=s.phase==='discussion'?'吹き出しと薄い矢印で会議を表示':s.phase==='vote'?'自分の投票候補だけ先に表示します':s.phase==='execution'?'投票矢印を一斉公開':s.phase==='night'?'夜の秘密行動は自分にだけ表示':'進行を確認してください';
    $('boardHint').textContent=s.phase==='discussion'&&s.me.alive?'相手をタップ → 怪しい・白寄り・質問・占い/霊媒の主張':s.phase==='vote'?'相手をタップして投票先を選択。ほかの人の票は結果まで見えません。':s.phase==='night'&&s.kind?'対象をタップして夜行動を選択できます。':'公開された発言と関係を盤面で確認できます。';
    renderBubbles(s);updateBoardDock(s);scheduleArrowDraw(s);
  }
  let resizeTimer=0;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>state&&scheduleArrowDraw(state,true),180);},{passive:true});

`,
  'board render');

app=replaceOnce(app,
  "    if(s.phaseId!==old?.phaseId){selected=null;actionSignature='';boardMenuTarget=null;$('boardMenu').hidden=true;",
  "    if(s.phaseId!==old?.phaseId){selected=null;actionSignature='';bubbleSignature='';lastTickSecond='';boardMenuTarget=null;$('boardMenu').hidden=true;",
  'phase reset');

app=replaceSection(app,
  '  function tick(){',
  '  const activity=',
`  function tick(){
    if(!state||document.hidden||collapseRunning)return;
    const now=Date.now()+timeOffset,left=state.deadline===null?null:Math.max(0,Math.ceil((state.deadline-now)/1000));
    const own=state.phase==='night'&&state.kind&&!state.me.acted?Math.max(0,Math.ceil((state.actionDeadline-now)/1000)):null;
    const tickKey=state.phaseId+'|'+left+'|'+own;
    if(tickKey!==lastTickSecond){
      lastTickSecond=tickKey;
      $('countdown').textContent=left===null?'—':\`\${String(Math.floor(left/60)).padStart(2,'0')}:\${String(left%60).padStart(2,'0')}\`;
      $('timeFill').style.width=state.deadline?\`\${clamp((state.deadline-now)/(state.deadline-state.startedAt)*100,0,100)}%\`:'0%';
      if(own!==null)$('phaseHint').textContent=\`あなたの選択期限まで \${own}秒\`;
    }
    $('idleWarning').hidden=true;
    if(['discussion','vote','execution','dawn','night'].includes(state.phase)&&boardVisible()){
      renderBubbles(state);scheduleArrowDraw(state);
    }
  }
  setInterval(tick,1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state){lastTickSecond='';tick();scheduleArrowDraw(state,true);}});
`,
  'main tick');

fs.writeFileSync(appPath,app,'utf8');

const stylePath='public/style.css';
let style=fs.readFileSync(stylePath,'utf8');
const marker='/* v0.8.5 normal-game performance guard */';
if(!style.includes(marker))style+=`\n\n${marker}\n.relation-svg,.bubble-layer{contain:layout paint}\n@media(max-width:700px){\n  .cheater-active .player-name{animation:none!important;will-change:auto!important}\n  .cheater-active .board-name{animation-duration:.72s!important;will-change:auto!important}\n  .chat-form{backdrop-filter:none!important}\n}\n@media(prefers-reduced-motion:reduce){.cheater-active .board-name,.cheater-active .player-name{animation:none!important}}\n`;
fs.writeFileSync(stylePath,style,'utf8');
