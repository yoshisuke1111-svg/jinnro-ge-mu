/* v0.6.2 browser UI: circular village board + arrows + longer secret cards + natural CPU conversation. */
'use strict';
(()=>{
  const $=id=>document.getElementById(id),{ROLES,LOVER,ROLE_IDS,PHASES,DEFAULT_TIMES}=WW;
  const offline=WWTransport.offline;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const teams={village:'村人陣営',wolves:'人狼陣営',third:'第三陣営'};
  const storage=(type,method,key,value)=>{try{return window[type][method](key,value);}catch{return null;}};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  let state=null,channel='public',selected=null,settingsDirty=false,settingsVersion=-1,mobileView='board',boardMenuTarget=null;
  let actionSignature='',chatSignature='',recordSignature='',playerSignature='',privateSignature='';
  let timeOffset=0,toastTimer,sceneTimer,narrationTimer,lastSceneId=null,lastWinner=null,lastPrivateId=null,lastActivity=0,session=null;
  let secretFlipTimer=null,secretCloseTimer=null,secretFadeTimer=null,secretFlipped=false,secretShownPhase=null;
  const SECRET_ROLE_AUTO_FLIP=4200,SECRET_ROLE_VISIBLE=10500,SECRET_RESULT_AUTO_FLIP=1800,SECRET_RESULT_VISIBLE=7200,SECRET_FADE=720;
  const reducedPref=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
  let reduced=storage('localStorage','getItem','ww-motion')==='off'||reducedPref;
  document.body.classList.toggle('reduced-motion',reduced);
  $('motionToggle').textContent=reduced?'演出 OFF':'演出 ON';$('motionToggle').setAttribute('aria-pressed',String(reduced));

  function toast(message,error=false){
    $('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?6500:4200);
  }
  const transport=WWTransport.create({
    onState:render,
    onStatus(status){
      $('connection').textContent=({connected:'接続中',reconnecting:'再接続中',disconnected:'切断中',offline:'ソロ・通信なし'})[status]||status;
      $('connection').classList.toggle('lost',['reconnecting','disconnected'].includes(status));
    },
    onError(message){toast(message,true);},
    onRemoved(message){
      if(session)storage('sessionStorage','removeItem','ww3-'+session.code);
      session=null;state=null;$('room').hidden=true;$('entrance').hidden=false;toast(message,true);
    }
  });
  async function call(event,data={},throwError=false){
    try{return await transport.request(event,{...data,turn:state?.phaseId});}
    catch(e){toast(e.message,true);if(throwError)throw e;return null;}
  }
  function enter(res){
    if(!res)return;
    session={code:res.code,token:res.token};
    storage('sessionStorage','setItem','ww3-'+res.code,res.token);
    storage('localStorage','setItem','ww3-name',$('name').value.trim());
    if(!offline){const url=new URL(location.href);url.search='?room='+encodeURIComponent(res.code);history.replaceState(null,'',url);}
    $('entrance').hidden=true;$('room').hidden=false;
  }

  const roleOptions=ROLE_IDS.map(k=>`<option value="${k}">${esc(ROLES[k].name)}</option>`).join('');
  $('practiceRole').innerHTML='<option value="">ランダム</option>'+roleOptions+'<option value="lover">恋人（村人＋恋人）</option>';
  $('practiceRole').value='seer';$('soloRole').innerHTML=$('practiceRole').innerHTML;
  $('claimRole').innerHTML=roleOptions;$('claimRole').value='seer';
  $('name').value=storage('localStorage','getItem','ww3-name')||'';
  const urlRoom=new URLSearchParams(location.search).get('room')||'';$('code').value=urlRoom.toUpperCase();
  if(offline){
    $('onlineEntry').hidden=true;$('connection').textContent='ソロ・通信なし';
    $('entryNote').textContent='このファイルはソロ専用です。外部通信はありません。再読み込みすると対戦は最初からになります。';
    $('copy').hidden=true;
  }
  $('practice').onclick=async()=>enter(await call('create',{name:$('name').value,solo:true,role:$('practiceRole').value}));
  $('create').onclick=async()=>enter(await call('create',{name:$('name').value,roomCode:$('customCode').value.trim()}));
  $('join').onclick=async()=>enter(await call('join',{name:$('name').value,code:$('code').value.trim().toUpperCase()}));
  $('name').addEventListener('keydown',e=>{if(e.key==='Enter')$('practice').click();});
  function inviteUrl(){const url=new URL(location.href);if(state?.code)url.search='?room='+encodeURIComponent(state.code);return url.toString();}
  $('copy').onclick=async()=>{const url=inviteUrl();try{await navigator.clipboard.writeText(url);toast('招待URLをコピーしました。');}catch{window.prompt('この招待URLをコピーしてください。',url);}};
  if(navigator.share)$('shareInvite').hidden=false;
  $('shareInvite').onclick=async()=>{try{await navigator.share({title:'人狼ゲーム',text:`部屋コード ${state?.code||''} に参加`,url:inviteUrl()});}catch(e){if(e?.name!=='AbortError')toast('共有できませんでした。',true);}};

  function setMobileView(view){
    mobileView=['board','chat','self'].includes(view)?view:'board';
    document.body.dataset.mobileView=mobileView;
    document.querySelectorAll('[data-mobile-view]').forEach(b=>b.classList.toggle('active',b.dataset.mobileView===mobileView));
    requestAnimationFrame(()=>state&&renderBoard(state));
  }
  document.querySelectorAll('[data-mobile-view]').forEach(b=>b.addEventListener('click',()=>setMobileView(b.dataset.mobileView)));
  setMobileView('board');
  $('leave').onclick=()=>{
    if(state&&!['lobby','ended'].includes(state.phase)&&!confirm(offline?'練習を終了しますか？':'退出しますか？切断後はCPUが代行します。'))return;
    transport.stop();if(offline){state=null;$('room').hidden=true;$('entrance').hidden=false;}else location.assign(location.pathname);
  };
  $('motionToggle').onclick=()=>{
    reduced=!reduced;document.body.classList.toggle('reduced-motion',reduced);storage('localStorage','setItem','ww-motion',reduced?'off':'on');
    $('motionToggle').textContent=reduced?'演出 OFF':'演出 ON';$('motionToggle').setAttribute('aria-pressed',String(reduced));
  };
  $('helpOpen').onclick=()=>$('helpDialog').showModal();$('helpClose').onclick=()=>$('helpDialog').close();
  for(const id of ['helpDialog','tarotDialog'])$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).close();});
  $('helpContent').innerHTML=`
    <p class="help-intro">人間1人からCPU込み4〜30人で遊べます。盤面では発言を吹き出し、疑い・判定・投票を矢印で表示します。</p>
    <div class="rules-note"><strong>盤面の矢印</strong><br>「怪しい」「白寄り」「質問」は全員が使えます。占い・霊媒の判定矢印も全員が出せるため、騙りも可能です。矢印はあくまで発言者の主張です。投票先は投票中には他人へ公開せず、結果発表時に濃い矢印で一斉表示します。</div>
    <div class="rules-note"><strong>秘密カード</strong><br>役職・占い結果・霊媒結果は本人だけにカードで表示されます。カードはタップでめくれ、放置時も自動で確認して閉じます。必要なら「自分」画面から役職カードを再確認できます。</div>
    <div class="rules-note"><strong>CPU</strong><br>CPUは公開情報と自分の能力結果だけを使います。性格ごとに口調・発言量・慎重さ・反応速度・疑い方が異なり、質問、白寄り評価、直接返信も行います。CPU同士の返信連鎖は抑えています。</div>
    <div class="help-roles">${ROLE_IDS.map(k=>`<article class="role-help"><h3>${esc(ROLES[k].icon)} ${esc(ROLES[k].name)}<small>${teams[ROLES[k].team]}</small></h3><p>${esc(ROLES[k].text)}</p><p class="win">勝利：${esc(ROLES[k].win)}</p></article>`).join('')}<article class="role-help"><h3>♡ 恋人<small>追加状態・第三陣営</small></h3><p>${esc(LOVER.text)}</p></article></div>`;

  function markDirty(){settingsDirty=true;$('dirtyHint').textContent='未保存の変更があります';updateSum();if(state)$('start').disabled=false;}
  $('roleInputs').innerHTML=ROLE_IDS.map(k=>`<label class="role-setting"><span><i class="role-dot ${ROLES[k].team}"></i>${esc(ROLES[k].name)}</span><input id="count-${k}" type="number" min="0" max="${['fox','jester','plague','avenger'].includes(k)?1:30}" aria-label="${esc(ROLES[k].name)}の人数"></label>`).join('');
  for(const k of ROLE_IDS)$('count-'+k).addEventListener('input',markDirty);
  for(const id of ['lovers','firstNightSafe','time-discussion','time-night','time-other','time-vote'])$(id).addEventListener('input',markDirty);
  function updateSum(){if(!state)return;const n=ROLE_IDS.reduce((a,k)=>a+(Number($('count-'+k).value)||0),0);$('roleSum').textContent=`${n} / ${state.players.length}人`;$('roleSum').style.color=n===state.players.length?'var(--accent)':'var(--red)';}
  function draft(){const roles=Object.fromEntries(ROLE_IDS.map(k=>[k,Number($('count-'+k).value)]));const times={...(state?.config.times||DEFAULT_TIMES)};for(const k of ['discussion','night','other','vote'])times[k]=Number($('time-'+k).value);return {roles,times,lovers:$('lovers').checked,firstNightSafe:$('firstNightSafe').checked,testRole:state?.solo?$('soloRole').value:''};}
  async function saveDraft(){const res=await call('config',draft());if(!res)return false;settingsDirty=false;settingsVersion=-1;$('dirtyHint').textContent='保存しました';if(state)renderSettings(state);return true;}
  $('saveSettings').onclick=saveDraft;$('start').onclick=async()=>{if(settingsDirty&&!(await saveDraft()))return;await call('start');};
  $('fillVillagers').onclick=()=>{const other=ROLE_IDS.filter(k=>k!=='villager').reduce((a,k)=>a+(Number($('count-'+k).value)||0),0);$('count-villager').value=Math.max(0,state.players.length-other);markDirty();};
  $('setBots').onclick=async()=>{settingsDirty=false;settingsVersion=-1;await call('bots',{count:Number($('cpuCount').value)});};
  document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=async()=>{const [kind,n]=b.dataset.preset.split(':');settingsDirty=false;settingsVersion=-1;await call('preset',{kind,count:Number(n)});});
  $('soloRole').onchange=async()=>{settingsDirty=false;settingsVersion=-1;const role=$('soloRole').value;const n=Math.max(role==='lover'?6:4,state.players.length);const res=await call('solo',{role,count:n});if(res)toast('練習役職に合わせた基本配役に変更しました。');};
  $('shortTimes').onclick=()=>{$('time-discussion').value=20;$('time-night').value=10;$('time-other').value=8;$('time-vote').value=10;markDirty();};
  $('guestActive').onclick=()=>call('activity');$('stillHere').onclick=()=>{lastActivity=Date.now();call('activity');};$('speed').onclick=()=>{};
  $('again').onclick=async()=>{settingsVersion=-1;await call('reset');};

  $('chatForm').onsubmit=async e=>{e.preventDefault();const text=$('chatInput').value.trim();if(!text)return;const res=await call('chat',{text,channel});if(res)$('chatInput').value='';};
  $('claim').onclick=()=>call('statement',{kind:'claim',role:$('claimRole').value});
  $('report').onclick=()=>call('statement',{kind:'report',role:$('reportKind').value,target:$('reportTarget').value,black:$('reportColor').value==='true'});
  document.querySelectorAll('[data-channel]').forEach(b=>b.onclick=()=>{channel=b.dataset.channel;chatSignature='';if(state)renderChat(state);});
  $('exportLog').onclick=()=>{if(!state)return;const data={game:'人狼ゲーム',version:'0.6.2',phase:state.phase,day:state.day,players:state.players,messages:state.messages,reports:state.reports,votes:state.voteHistory,ownResults:state.me.privateResults,winner:state.winner};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`werewolf-log-${state.code}-${state.day}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('自分に見える範囲のログを保存しました。');};

  function renderSettings(s){
    $('hostControls').hidden=!s.host;$('guestControls').hidden=s.host;$('playerSummary').textContent=`人間 ${s.players.filter(p=>!p.bot).length} ＋ CPU ${s.players.filter(p=>p.bot).length}`;
    $('guestConfig').textContent=ROLE_IDS.filter(k=>s.config.roles[k]).map(k=>`${ROLES[k].name} ${s.config.roles[k]}`).join(' / ');$('cpuCount').max=30-s.players.filter(p=>!p.bot).length;
    if(!settingsDirty&&settingsVersion!==s.configVersion){for(const k of ROLE_IDS)$('count-'+k).value=s.config.roles[k];for(const k of ['discussion','night','other','vote'])$('time-'+k).value=s.config.times[k];$('lovers').checked=s.config.lovers;$('firstNightSafe').checked=s.config.firstNightSafe;$('soloRole').value=s.config.testRole||'';$('cpuCount').value=s.players.filter(p=>p.bot).length;$('dirtyHint').textContent='保存済み';settingsVersion=s.configVersion;}
    $('soloRoleLabel').hidden=!s.solo;$('configErrors').textContent=s.validation.join('\n');$('start').disabled=!settingsDirty&&s.validation.length>0;updateSum();
  }
  function playerHtml(p,s){
    const sub=[p.bot?'CPU':'HUMAN',p.id===s.me.id?'あなた':'',p.host?'部屋主':'',!p.connected&&!p.bot?'切断中':'',p.auto?'代行中':'',!p.alive?'幽霊':''].filter(Boolean).join(' · '),index=s.players.findIndex(t=>t.id===p.id)%5;
    const role=p.role?`<div class="player-sub">${esc(ROLES[p.role]?.name||p.role)}${p.lover?' ♡':''}${p.won?' <span class="win-mark">WIN</span>':''}</div>`:'';
    return `<div class="player-row ${p.id===s.me.id?'me':''} ${p.alive?'':'dead'}"><span class="avatar v${index}" aria-hidden="true">${esc([...p.name][0])}</span><div class="player-meta"><div class="player-name">${esc(p.name)}</div><div class="player-sub">${esc(sub)}</div>${role}</div></div>`;
  }
  function renderPlayers(s){
    const signature=JSON.stringify(s.players)+s.phase;
    if(playerSignature!==signature){$('lobbyPlayers').innerHTML=s.players.map(p=>playerHtml(p,s)).join('');playerSignature=signature;const target=$('reportTarget').value;$('reportTarget').innerHTML=s.players.filter(p=>p.id!==s.me.id).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.alive?'':'（死亡）'}</option>`).join('');if(s.players.some(p=>p.id===target))$('reportTarget').value=target;}
  }
  const playerName=id=>state?.players.find(p=>p.id===id)?.name||'不明';

  function roleSecrets(s){
    const bits=[];
    if(s.me.knownWolves.length){const allies=s.me.knownWolves.filter(id=>id!==s.me.id).map(playerName);bits.push(allies.length?'人狼の仲間：'+allies.join('、'):'人狼の仲間はいません');}
    if(s.me.knownMasons.length)bits.push('共有者の相方：'+s.me.knownMasons.map(playerName).join('、'));
    if(s.me.lover)bits.push('恋人：'+playerName(s.me.lover));
    if(s.me.revengeTarget)bits.push('復讐対象：'+playerName(s.me.revengeTarget)+(s.me.revengeDone?'（達成）':''));
    if(s.me.role==='plague')bits.push('感染済み：'+(s.me.infected.length?s.me.infected.map(playerName).join('、'):'まだいません'));
    return bits;
  }
  function renderIdentity(s){
    const r=ROLES[s.me.role];$('aliveStatus').textContent=s.me.auto?'CPU代行中':s.me.alive?'生存':'幽霊';
    if(s.phase==='ended'&&r){$('myRole').textContent=r.name;$('roleSymbol').textContent=r.icon;$('myRoleTeam').textContent=s.me.lover?'恋人陣営':teams[r.team];$('roleText').textContent=r.text;$('allies').textContent=roleSecrets(s).join('\n');}
    else{$('myRole').textContent='役職カードを見る';$('roleSymbol').textContent='☾';$('myRoleTeam').textContent='ゆっくり確認できます';$('roleText').textContent='役職は常時表示しません。必要な時だけカードを開けます。';$('allies').textContent='';}
  }

  function clearSecretTimers(){clearTimeout(secretFlipTimer);clearTimeout(secretCloseTimer);clearTimeout(secretFadeTimer);secretFlipTimer=secretCloseTimer=secretFadeTimer=null;}
  function scheduleSecretClose(ms){clearTimeout(secretCloseTimer);secretCloseTimer=setTimeout(closeSecret,ms);}
  function flipSecret(){if(!$('tarotDialog').open)return;if(secretFlipped){closeSecret();return;}secretFlipped=true;$('tarotCard').classList.add('flipped');clearTimeout(secretFlipTimer);scheduleSecretClose(Number($('tarotDialog').dataset.visibleMs)||SECRET_ROLE_VISIBLE);}
  function closeSecret(){
    clearTimeout(secretCloseTimer);if(!$('tarotDialog').open)return;
    $('tarotCard').classList.remove('flipped');$('tarotDialog').classList.add('fading');
    secretFadeTimer=setTimeout(()=>{if($('tarotDialog').open)$('tarotDialog').close();$('tarotDialog').classList.remove('fading');clearSecretTimers();},reduced?0:SECRET_FADE);
  }
  function showSecretCard({eyebrow='SECRET CARD',heading='あなただけに公開',name='カードをタップ',symbol='✧',result='',detail='',black=false,autoFlipMs=SECRET_ROLE_AUTO_FLIP,visibleMs=SECRET_ROLE_VISIBLE}){
    if($('helpDialog').open){toast(`${heading}。自分だけの記録から確認できます。`);return;}
    clearSecretTimers();secretFlipped=false;$('tarotDialog').dataset.visibleMs=String(visibleMs);$('tarotDialog').classList.remove('fading');$('tarotCard').className='tarot-card'+(black?' black':'');
    $('tarotEyebrow').textContent=eyebrow;$('tarotHeading').textContent=heading;$('tarotName').textContent=name;$('tarotSymbol').textContent=symbol;$('tarotResult').textContent=result;$('tarotDetail').textContent=detail;
    $('tarotAuto').textContent=`タップで確認できます。表になった後は約${Math.round(visibleMs/1000)}秒表示し、もう一度タップするとすぐ閉じます。`;
    if(!$('tarotDialog').open)$('tarotDialog').showModal();
    secretFlipTimer=setTimeout(flipSecret,autoFlipMs);
  }
  function showRoleCard(s){
    const r=ROLES[s.me.role];if(!r)return;const secrets=roleSecrets(s);showSecretCard({eyebrow:'YOUR ROLE',heading:'あなたの役職',name:'タップして役職を確認',symbol:r.icon,result:r.name,detail:[s.me.lover?'恋人陣営（能力は元のまま）':teams[r.team],r.text,...secrets].join(' / '),black:ROLES[s.me.role].team==='wolves',autoFlipMs:SECRET_ROLE_AUTO_FLIP,visibleMs:SECRET_ROLE_VISIBLE});
  }
  $('identityCard').onclick=()=>state&&showRoleCard(state);$('tarotCard').onclick=flipSecret;$('tarotClose').onclick=closeSecret;

  function actionButton(label,fn,kind='primary'){const b=document.createElement('button');b.textContent=label;b.className=kind;b.onclick=fn;$('actions').append(b);return b;}
  function currentActionInfo(s){
    const vote=s.phase==='vote',kind=vote?'vote':s.kind,done=vote?s.me.voted:s.me.acted;
    return {vote,kind,done,target:vote?s.me.voteTarget:s.me.actionTarget,targets:s.targets||[]};
  }
  function confirmCurrentAction(){if(!state)return;const {vote,kind}=currentActionInfo(state);if(vote)return call('vote',{target:selected});return call('act',{target:kind==='meet'?null:selected});}
  $('boardConfirm').onclick=confirmCurrentAction;$('boardAbstain').onclick=()=>call('vote',{target:null});

  function renderActions(s){
    const sig=JSON.stringify([s.phase,s.phaseId,s.me.acted,s.me.voted,s.me.alive,s.me.auto,s.targets,s.me.actionTarget,s.me.voteTarget,selected]);if(actionSignature===sig)return;actionSignature=sig;
    const a=$('actions');a.innerHTML='';const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;a.append(e);};
    if(s.phase==='ended'){text('h2','対戦終了');text('p','全員の役職が公開されています。','caption');return;}
    if(!s.me.alive){text('h2','幽霊として観戦中');text('p','盤面と幽霊チャットで最後まで見られます。','caption ghost-notice');return;}
    if(s.me.auto){text('h2','CPUが代行しています');text('p','次のフェーズで操作が戻ります。','caption');return;}
    if(s.phase==='reveal'){text('h2','役職カード');text('p','カードは自動表示されます。見逃した場合は上の「役職カードを見る」から再確認できます。','caption');return;}
    if(s.phase==='discussion'){text('h2','話し合い');text('p','盤面の相手をタップすると、疑い・白寄り・質問・判定主張を矢印で出せます。','caption');return;}
    if(['dawn','execution'].includes(s.phase)){text('h2',s.phase==='dawn'?'朝の発表':'投票結果');text('p','中央のナレーションと盤面を確認してください。','caption');return;}
    if(s.phase==='night'&&!s.kind){text('h2','夜の行動待ち');text('p',s.me.role==='medium'?'霊媒結果は秘密カードと自分だけの記録へ届きます。':'今夜は対象を選ぶ能力がありません。','caption');return;}
    const {vote,kind,done,target,targets}=currentActionInfo(s);const labels={vote:'処刑先への投票',divine:'占う相手',attack:'襲撃する相手',protect:'護衛する相手',infect:'感染させる相手',meet:'人狼の顔合わせ'};
    text('h2',labels[kind]||'行動');
    if(done){text('p','✓ '+(target?playerName(target)+'で確定':kind==='meet'?'顔合わせを確認済み':'確定しました'),'done-line');text('p','ほかの人の選択を待っています。','caption');return;}
    if(kind==='meet'){text('p','初夜は襲撃なしです。仲間を確認したら確定してください。','caption');actionButton('仲間を確認した',()=>call('act',{target:null}));return;}
    text('p','盤面または下の一覧から対象を選び、確定してください。','caption');
    const grid=document.createElement('div');grid.className='target-grid';a.append(grid);
    for(const id of targets){const b=document.createElement('button');b.className=`target ${kind==='divine'?'tarot-target':''} ${kind} ${selected===id?'selected':''}`;b.textContent=playerName(id);b.setAttribute('aria-pressed',String(selected===id));b.onclick=()=>{selected=id;actionSignature='';renderActions(state);renderBoard(state);};grid.append(b);}
    if(!targets.length){actionButton('対象なしで確定',()=>call(vote?'vote':'act',{target:null}));return;}
    const b=actionButton(vote?'投票を確定':kind==='divine'?'この相手を占う':'対象を確定',confirmCurrentAction);b.disabled=!targets.includes(selected);if(vote)actionButton('棄権する',()=>call('vote',{target:null}),'quiet');
  }

  function renderChat(s){
    const ghost=!s.me.alive||s.phase==='ended',wolf=['wolf','darkwolf'].includes(s.me.role)||s.phase==='ended';
    document.querySelector('[data-channel="ghost"]').hidden=!ghost;document.querySelector('[data-channel="wolves"]').hidden=!wolf;
    if(channel==='ghost'&&!ghost||channel==='wolves'&&!wolf)channel='public';document.querySelectorAll('[data-channel]').forEach(b=>b.classList.toggle('active',b.dataset.channel===channel));$('chatScope').textContent=({public:'PUBLIC',wolves:'PACK ONLY',ghost:'GHOSTS ONLY'})[channel];
    const msgs=s.messages.filter(m=>m.channel==='system'||m.channel===channel).slice(-180),sig=channel+':'+msgs.map(m=>m.id).join(',');
    if(chatSignature!==sig){const box=$('messages'),bottom=box.scrollHeight-box.scrollTop-box.clientHeight<80,changed=!chatSignature.startsWith(channel+':');box.innerHTML=msgs.length?msgs.map(m=>`<div class="message ${m.channel==='system'?'system':''} ${m.playerId===s.me.id?'self':''} ${m.meta?'structured':''}">${m.channel!=='system'?`<div class="message-head"><strong>${esc(m.name)}</strong><small>${s.players.find(p=>p.id===m.playerId)?.bot?'CPU · ':''}${m.day?m.day+'日目':'待機室'}${m.meta?' · 矢印':''}</small></div>`:''}<div class="message-text">${esc(m.text)}</div></div>`).join(''):'<p class="message empty">まだ発言はありません。</p>';if(bottom||changed)box.scrollTop=box.scrollHeight;chatSignature=sig;}
    let can=false,hint='';
    if(channel==='ghost'){can=!s.me.alive&&!['lobby','reveal','ended'].includes(s.phase);hint='死亡者だけに届きます。';}
    else if(channel==='wolves'){can=s.me.alive&&['wolf','darkwolf'].includes(s.me.role)&&s.phase==='night';hint='夜の人狼だけが見られます。';}
    else{can=['lobby','ended','discussion','vote','dawn','execution'].includes(s.phase)&&(s.me.alive||s.phase==='ended');hint=can?'公開チャットです。盤面の矢印と合わせて話せます。':'今は公開チャットに発言できません。';}
    if(s.phase==='ended')hint='試合終了。公開チャットで感想を話せます。';$('chatInput').disabled=!can;$('send').disabled=!can;$('chatHint').textContent=hint;$('chatInput').placeholder=can?(channel==='ghost'?'幽霊だけに話す…':channel==='wolves'?'仲間と相談…':'発言を入力…'):'この時間は読むだけです';$('statementBox').hidden=!(s.phase==='discussion'&&s.me.alive&&channel==='public');
  }

  function renderPrivate(s){
    const sig=JSON.stringify(s.me.privateResults);if(sig===privateSignature)return;privateSignature=sig;$('recordCount').textContent=s.me.privateResults.length;
    $('privateResults').innerHTML=s.me.privateResults.length?s.me.privateResults.slice().reverse().map(r=>{if(r.kind==='notice')return `<div class="private-item">${esc(r.text)}</div>`;return `<div class="private-item"><small>${r.day}日目 · ${r.kind==='seer'?'占い':'霊媒'}</small>${esc(r.name)}：<strong class="${r.black?'black':'white'}">${r.black?'人狼':'人狼ではない'}</strong></div>`;}).join(''):'<p class="caption" style="margin:8px 0 0">能力結果はここに残ります。</p>';
    const latest=s.me.privateResults.filter(r=>['seer','medium'].includes(r.kind)).at(-1);
    if(latest&&latest.id!==lastPrivateId){lastPrivateId=latest.id;if(['night','dawn'].includes(s.phase))showResultCard(latest);}
  }
  function showResultCard(r){const label=r.kind==='seer'?'占い結果':'霊媒結果';showSecretCard({eyebrow:r.kind==='seer'?'DIVINATION':'MEDIUM RESULT',heading:`${label} · あなたにだけ公開`,name:'タップして結果を確認',symbol:r.black?'☾':'✧',result:`${r.name}：${r.black?'人狼':'人狼ではない'}`,detail:r.kind==='seer'?'役職名そのものは分かりません':'処刑された人の判定です',black:r.black,autoFlipMs:SECRET_RESULT_AUTO_FLIP,visibleMs:SECRET_RESULT_VISIBLE});}

  function renderRecords(s){
    const sig=JSON.stringify([s.claims,s.reports,s.voteHistory]);if(recordSignature===sig)return;recordSignature=sig;
    const claims=new Map(s.claims.map(c=>[c.playerId,c])),lines=[...claims.values()].map(c=>`<div class="evidence-line">${esc(playerName(c.playerId))} <span class="tag">${esc(ROLES[c.role]?.name)} CO</span> <small>${c.day}日目</small></div>`);
    lines.push(...s.reports.slice(-30).map(r=>`<div class="evidence-line"><small>${r.day}日目 · ${esc(playerName(r.playerId))}の${r.role==='seer'?'占い':'霊媒'}主張</small><br>${esc(playerName(r.target))} → <strong>${r.black?'黒（人狼）':'白（人狼ではない）'}</strong></div>`));$('publicClaims').innerHTML=lines.join('')||'<p class="caption">まだCOや判定の主張はありません。</p>';
    $('voteRecords').innerHTML=s.voteHistory.slice().reverse().map(v=>`<details class="ballot-detail"><summary>${v.day}日目${v.round?' 決選':''} · ${v.executed?esc(playerName(v.executed))+'を処刑':'同票・処刑なし'}</summary><div class="ballot-grid">${v.ballots.map(b=>`<span>${esc(playerName(b.voter))} → ${b.target?esc(playerName(b.target)):'棄権'}</span>`).join('')}</div></details>`).join('')||'<p class="caption">投票結果のあとに全員の投票先が公開されます。</p>';
  }

  function boardPoint(index,n){const a=-Math.PI/2+index*(Math.PI*2/n),mobile=matchMedia('(max-width:700px)').matches;const rx=mobile?(n>18?42:39):(n>20?46:44),ry=mobile?(n>18?42:40):(n>20?43:40);return {x:50+Math.cos(a)*rx,y:50+Math.sin(a)*ry};}
  function renderBoardPlayers(s){
    const box=$('boardPlayers');box.innerHTML='';const n=s.players.length;
    s.players.forEach((p,i)=>{const pos=boardPoint(i,n),b=document.createElement('button');b.type='button';b.className=`board-player ${p.alive?'':'dead'} ${p.id===s.me.id?'me':''} ${p.bot?'bot':''} ${n>18?'dense':''}`;b.style.left=pos.x+'%';b.style.top=pos.y+'%';b.dataset.playerId=p.id;b.innerHTML=`<span class="board-avatar">${esc([...p.name][0])}</span><span class="board-name">${esc(p.name)}</span><small>${p.bot?'CPU':''}${p.host?(p.bot?' · ':'')+'HOST':''}${!p.alive?' · 死亡':''}</small>`;b.onclick=()=>handleBoardPlayer(p.id);box.append(b);});
  }
  function handleBoardPlayer(id){
    if(!state||id===state.me.id)return;
    if((state.phase==='vote'||state.phase==='night')&&state.me.alive&&!state.me.auto&&state.targets.includes(id)){selected=id;actionSignature='';renderActions(state);renderBoard(state);return;}
    if(state.phase==='discussion'&&state.me.alive&&!state.me.auto){boardMenuTarget=id;$('boardMenuName').textContent=playerName(id)+'について';$('boardMenu').hidden=false;$('boardMenu').scrollIntoView({block:'nearest',behavior:reduced?'auto':'smooth'});}
  }
  $('boardMenuClose').onclick=()=>{$('boardMenu').hidden=true;boardMenuTarget=null;};
  document.querySelectorAll('[data-relation]').forEach(b=>b.onclick=async()=>{if(!boardMenuTarget)return;const ok=await call('statement',{kind:b.dataset.relation,target:boardMenuTarget});if(ok){$('boardMenu').hidden=true;boardMenuTarget=null;}});
  document.querySelectorAll('[data-report]').forEach(b=>b.onclick=async()=>{if(!boardMenuTarget)return;const [role,flag]=b.dataset.report.split(':');const ok=await call('statement',{kind:'report',role,target:boardMenuTarget,black:flag==='true'});if(ok){$('boardMenu').hidden=true;boardMenuTarget=null;}});

  function svgEl(tag,attrs={}){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;}
  function arrowData(s){
    const out=[],now=Date.now()+timeOffset,seen=new Set();
    const msgs=s.messages.filter(m=>m.channel==='public'&&m.day===s.day&&m.playerId&&m.meta&&['accuse','trust','question','report'].includes(m.meta.kind)).slice().reverse();
    for(const m of msgs){const meta=m.meta,key=meta.kind==='report'?`${m.playerId}|${meta.role}|${meta.target}`:`${m.playerId}|${meta.kind}`;if(seen.has(key))continue;seen.add(key);if(meta.kind!=='report'&&now-m.at>50000)continue;const type=meta.kind==='report'?meta.role:meta.kind,label=meta.kind==='report'?(meta.black?'黒':'白'):meta.kind==='accuse'?'怪':meta.kind==='trust'?'白寄':'?';out.push({from:m.playerId,to:meta.target,type,label,opacity:meta.kind==='report'?0.9:clamp(1-(now-m.at)/65000,.2,.72),strong:false});if(out.length>=18)break;}
    if(['execution','ended'].includes(s.phase)){const v=[...s.voteHistory].reverse().find(x=>x.day===s.day)||s.voteHistory.at(-1);if(v)for(const b of v.ballots)if(b.target)out.push({from:b.voter,to:b.target,type:'vote',label:'投票',opacity:.95,strong:true});}
    if(s.phase==='vote'&&s.me.alive){const t=s.me.voted?s.me.voteTarget:selected;if(t)out.push({from:s.me.id,to:t,type:'vote',label:s.me.voted?'投票':'予定',opacity:.95,strong:true,preview:!s.me.voted});}
    if(s.phase==='night'&&s.me.alive&&!s.me.acted&&selected&&s.targets.includes(selected)){const type={divine:'seer',attack:'attack',protect:'protect',infect:'infect'}[s.kind]||'question';out.push({from:s.me.id,to:selected,type,label:{divine:'占う',attack:'襲撃',protect:'護衛',infect:'感染'}[s.kind]||'',opacity:.9,strong:true,private:true});}
    return out.filter(a=>a.from&&a.to&&a.from!==a.to);
  }
  function drawArrows(s){
    const svg=$('relationSvg'),board=$('board'),br=board.getBoundingClientRect();if(br.width<10||br.height<10)return;svg.setAttribute('viewBox',`0 0 ${br.width} ${br.height}`);svg.innerHTML='';
    const defs=svgEl('defs');for(const type of ['accuse','trust','question','seer','medium','vote','attack','protect','infect']){const m=svgEl('marker',{id:'arrow-'+type,viewBox:'0 0 10 10',refX:'8.5',refY:'5',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'}),p=svgEl('path',{d:'M 0 0 L 10 5 L 0 10 z',class:`arrow-head ${type}`});m.append(p);defs.append(m);}svg.append(defs);
    const nodes=Object.fromEntries([...$('boardPlayers').querySelectorAll('.board-player')].map(n=>[n.dataset.playerId,n]));const pairCount={};
    for(const a of arrowData(s)){const A=nodes[a.from],B=nodes[a.to];if(!A||!B)continue;const ar=A.getBoundingClientRect(),bb=B.getBoundingClientRect(),x1=ar.left-br.left+ar.width/2,y1=ar.top-br.top+ar.height/2,x2=bb.left-br.left+bb.width/2,y2=bb.top-br.top+bb.height/2,dx=x2-x1,dy=y2-y1,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d,r1=Math.min(ar.width,ar.height)*.43+5,r2=Math.min(bb.width,bb.height)*.43+7,sx=x1+ux*r1,sy=y1+uy*r1,ex=x2-ux*r2,ey=y2-uy*r2;
      const key=[a.from,a.to].sort().join('|'),idx=pairCount[key]||0;pairCount[key]=idx+1;const bend=(idx%2?1:-1)*(10+Math.floor(idx/2)*8),mx=(sx+ex)/2-uy*bend,my=(sy+ey)/2+ux*bend;
      const path=svgEl('path',{d:`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`,class:`relation-line ${a.type}${a.strong?' strong':''}${a.preview?' preview':''}${a.private?' private':''}`,'marker-end':`url(#arrow-${a.type})`});path.style.opacity=a.opacity;svg.append(path);
      if(a.label){const tx=(sx+2*mx+ex)/4,ty=(sy+2*my+ey)/4,text=svgEl('text',{x:tx,y:ty,class:`relation-label ${a.type}`});text.textContent=a.label;svg.append(text);}
    }
  }
  function renderBubbles(s){
    const box=$('bubbleLayer'),now=Date.now()+timeOffset,latest=[];const seen=new Set();
    for(const m of s.messages.slice().reverse()){if(m.channel!=='public'||m.day!==s.day||!m.playerId||now-m.at>22000||seen.has(m.playerId))continue;seen.add(m.playerId);latest.push(m);if(latest.length>=3)break;}
    box.innerHTML='';const n=s.players.length;
    for(const m of latest.reverse()){const idx=s.players.findIndex(p=>p.id===m.playerId);if(idx<0)continue;const p=boardPoint(idx,n),age=now-m.at,bx=clamp(p.x+(50-p.x)*.38,18,82),by=clamp(p.y+(50-p.y)*.38,18,82),d=document.createElement('div');d.className='board-bubble'+(m.meta?' structured':'');d.style.left=bx+'%';d.style.top=by+'%';d.style.opacity=String(clamp(1-age/26000,.18,1));const short=m.text.length>82?m.text.slice(0,81)+'…':m.text;d.innerHTML=`<strong>${esc(m.name)}</strong><span>${esc(short)}</span>`;box.append(d);}
  }
  function updateBoardDock(s){
    const dock=$('boardActionDock'),info=currentActionInfo(s);dock.hidden=true;$('boardAbstain').hidden=true;
    if(!s.me.alive||s.me.auto||!['vote','night'].includes(s.phase)||info.done||info.kind==='meet'||!info.kind)return;
    dock.hidden=false;const labels={vote:'投票',divine:'占い',attack:'襲撃',protect:'護衛',infect:'感染'};$('boardActionText').textContent=selected?`${playerName(selected)}を${labels[info.kind]}対象に選択中`:`盤面から${labels[info.kind]}対象を選んでください`;$('boardConfirm').disabled=!s.targets.includes(selected);$('boardConfirm').textContent=info.vote?'この人に投票':'この対象で確定';$('boardAbstain').hidden=!info.vote;
  }
  function renderBoard(s){
    renderBoardPlayers(s);$('boardPhase').textContent=s.phaseLabel||PHASES[s.phase]||s.phase;$('boardSub').textContent=s.phase==='discussion'?'吹き出しと薄い矢印で会議を表示':s.phase==='vote'?'自分の投票候補だけ先に表示します':s.phase==='execution'?'投票矢印を一斉公開':s.phase==='night'?'夜の秘密行動は自分にだけ表示':'進行を確認してください';
    $('boardHint').textContent=s.phase==='discussion'&&s.me.alive?'相手をタップ → 怪しい・白寄り・質問・占い/霊媒の主張':s.phase==='vote'?'相手をタップして投票先を選択。ほかの人の票は結果まで見えません。':s.phase==='night'&&s.kind?'対象をタップして夜行動を選択できます。':'公開された発言と関係を盤面で確認できます。';
    renderBubbles(s);updateBoardDock(s);requestAnimationFrame(()=>drawArrows(s));
  }
  window.addEventListener('resize',()=>state&&requestAnimationFrame(()=>drawArrows(state)));

  function narrate(text,kicker='SYSTEM',duration=3000){clearTimeout(narrationTimer);$('narrationKicker').textContent=kicker;$('narrationText').textContent=text;$('narration').hidden=false;$('narration').classList.remove('fade');narrationTimer=setTimeout(()=>{$('narration').classList.add('fade');setTimeout(()=>$('narration').hidden=true,reduced?0:450);},reduced?900:duration);}
  function playScene(scene){
    if(!scene||scene.id===lastSceneId)return;lastSceneId=scene.id;clearTimeout(sceneTimer);const box=$('scene');$('sceneTitle').textContent=scene.title;$('sceneNames').textContent=scene.victims.length?scene.victims.map(v=>v.name).join('、'):'犠牲者はいませんでした';$('sceneMark').textContent=scene.type==='execution'?'◇':scene.victims.length?'╱╱╱':'☀';box.className='board-scene '+(scene.type==='execution'?'execution':scene.victims.length?'death':'dawn');box.hidden=false;setMobileView('board');sceneTimer=setTimeout(()=>box.hidden=true,reduced?1000:3300);
  }

  function phaseAnnouncement(s){const m=[...s.messages].reverse().find(x=>x.channel==='system'&&x.phase===s.phase&&x.day===s.day);return m?.text||({reveal:'役職を確認してください。',night:'夜になりました。',dawn:'朝になりました。',discussion:'話し合いを始めます。',vote:'投票を開始します。',execution:'投票結果です。',ended:'ゲーム終了です。'})[s.phase]||'';}
  function render(s){
    const old=state;state=s;document.body.dataset.phase=s.phase;timeOffset=s.now-Date.now();
    if(s.phaseId!==old?.phaseId){selected=null;actionSignature='';boardMenuTarget=null;$('boardMenu').hidden=true;
      if(s.phase==='reveal'){lastSceneId=null;lastPrivateId=null;lastWinner=null;privateSignature='';secretShownPhase=null;}
      if(s.phase==='night'&&['wolf','darkwolf'].includes(s.me.role))channel='wolves';else if(channel==='wolves'&&s.phase!=='night'&&s.phase!=='ended')channel='public';if(old?.me.alive&&!s.me.alive)channel='ghost';if(s.phase==='ended')channel='public';
      if(['discussion','dawn','execution','ended'].includes(s.phase))setMobileView('board');else if(['reveal','night'].includes(s.phase))setMobileView('self');else if(s.phase==='vote')setMobileView('board');
      const announcement=phaseAnnouncement(s);if(announcement)narrate(announcement,s.phase==='night'?'NIGHT':s.phase==='dawn'?'MORNING':s.phase==='vote'?'VOTE':'SYSTEM',s.phase==='discussion'?2200:3000);
    }
    $('entrance').hidden=true;$('room').hidden=false;$('roomCode').textContent=offline?'LOCAL':s.code;$('roomEyebrow').textContent=offline?'SOLO PRACTICE':'PRIVATE ROOM';$('roomTitle').textContent=s.phase==='lobby'?'ゲーム設定':s.phase==='ended'?'対戦終了':'人狼ゲーム';$('lobby').hidden=s.phase!=='lobby';$('play').hidden=s.phase==='lobby';$('speed').hidden=true;
    if(s.phase==='lobby')renderSettings(s);renderPlayers(s);
    if(s.phase!=='lobby'){
      $('phaseName').textContent=s.phaseLabel;$('dayBadge').textContent=`DAY\n${String(s.day).padStart(2,'0')}`;$('phaseHint').textContent=phaseAnnouncement(s);
      renderIdentity(s);renderActions(s);renderChat(s);renderPrivate(s);renderRecords(s);renderBoard(s);
      if(s.phase==='reveal'&&secretShownPhase!==s.phaseId){secretShownPhase=s.phaseId;setTimeout(()=>state?.phaseId===s.phaseId&&showRoleCard(state),reduced?100:450);}
      if(s.lastScene&&s.lastScene.id!==lastSceneId)playScene(s.lastScene);
      $('resultBanner').hidden=!s.winner;$('endControls').hidden=!(s.phase==='ended'&&s.host);
      if(s.winner){$('resultBanner').innerHTML=`<h2>${esc(s.winner.label)}</h2><p>${s.winner.winners.includes(s.me.id)?'あなたも勝利しました。':'今回は勝利条件を満たせませんでした。'} ${s.winner.winners.length?'勝者：'+s.winner.winners.map(playerName).map(esc).join('、'):''}</p>`;if(lastWinner!==s.winner.label){lastWinner=s.winner.label;toast(s.winner.label);}}
    }
    tick();
  }
  function tick(){
    if(!state)return;const now=Date.now()+timeOffset,left=state.deadline===null?null:Math.max(0,Math.ceil((state.deadline-now)/1000));$('countdown').textContent=left===null?'—':`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;$('timeFill').style.width=state.deadline?`${clamp((state.deadline-now)/(state.deadline-state.startedAt)*100,0,100)}%`:'0%';
    if(state.phase==='night'&&state.kind&&!state.me.acted){const own=Math.max(0,Math.ceil((state.actionDeadline-now)/1000));$('phaseHint').textContent=`あなたの選択期限まで ${own}秒`;}
    const idle=(now-state.lastActive)/1000;$('idleWarning').hidden=state.phase!=='lobby'||idle<60;if(state.phase==='lobby'&&idle>=60)$('idleText').textContent=`操作がないため、あと${Math.max(0,Math.ceil(75-idle))}秒で待機室を退出します。`;
    if(!state.play&&state.phase!=='lobby'){};if(['discussion','vote','execution','dawn','night'].includes(state.phase)){renderBubbles(state);requestAnimationFrame(()=>drawArrows(state));}
  }
  setInterval(tick,500);
  const activity=()=>{if(state?.phase==='lobby'&&Date.now()-lastActivity>8000){lastActivity=Date.now();call('activity');}};
  document.addEventListener('pointerdown',activity,{passive:true});document.addEventListener('keydown',activity,{passive:true});document.addEventListener('scroll',activity,{passive:true,capture:true});
  if(!offline&&urlRoom){const oldToken=storage('sessionStorage','getItem','ww3-'+urlRoom.toUpperCase());if(oldToken)call('join',{code:urlRoom,token:oldToken,name:$('name').value}).then(res=>{if(res)enter(res);else storage('sessionStorage','removeItem','ww3-'+urlRoom.toUpperCase());});}
})();
