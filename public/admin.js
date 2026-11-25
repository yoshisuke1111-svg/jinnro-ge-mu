'use strict';
(()=>{
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const roleNames={villager:'村人',seer:'占い師',medium:'霊媒師',guard:'騎士',baker:'パン屋',cat:'猫又',mason:'共有者',wolf:'人狼',darkwolf:'黒狼',madman:'狂人',fanatic:'狂信者',fox:'妖狐',jester:'てるてる坊主',plague:'疫病神',survivor:'生存者',avenger:'復讐者',thief:'泥棒',grave_robber:'墓荒らし',cheater:'チーター',resetter:'リセッター',white_leveler:'白レベラー',black_leveler:'黒レベラー'};
const phaseNames={lobby:'待機室',reveal:'役職確認',night:'夜',dawn:'朝',discussion:'昼・議論',vote:'投票',execution:'投票結果',ended:'終了'};
const roleIds=Object.keys(roleNames);
let data=null,selected=null,tab='overview',timer=null,loading=false,lastRoomSignature='',lastDetailSignature='';

async function request(url,options={}){
  const response=await fetch(url,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const body=await response.json().catch(()=>({ok:false,error:'応答を読めませんでした。'}));
  if(!response.ok)throw Object.assign(Error(body.error||'エラー'),{status:response.status});
  return body;
}
function showLogin(){clearTimeout(timer);$('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;}
function notice(message,error=false){const box=$('roomNotice')||$('adminNotice');if(!box)return;box.textContent=message||'';box.classList.toggle('error',error);}
function fmtBytes(value){if(!Number.isFinite(value))return '—';const units=['B','KB','MB','GB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return `${n.toFixed(i?1:0)} ${units[i]}`;}
function fmtUptime(ms){ms=Math.max(0,Number(ms)||0);const d=Math.floor(ms/86400000),h=Math.floor(ms/3600000)%24,m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return [d?d+'日':'',h?h+'時間':'',m?m+'分':'',(!d&&!h)?s+'秒':''].filter(Boolean).join(' ');}
function phaseAlert(room){const now=room.gameNow||Date.now();return !!room.collapsing||(['night','vote'].includes(room.phase)&&room.deadline&&now>room.deadline+5000)||(room.players||[]).some(p=>!p.connected&&!p.bot)&&!['lobby','ended'].includes(room.phase);}
function personality(value){if(!value)return '—';const social=['無口寄り','普通','話す寄り'][value.sociability]||'',confidence=['慎重','中間','自信強め'][value.confidence]||'',verbosity=['短め','普通','長め'][value.verbosity]||'';return [value.label||value.tone,social,confidence,verbosity].filter(Boolean).join(' / ');}
function pollDelay(){if(document.hidden)return 12000;const room=data?.rooms?.find(r=>r.code===selected);return room?.cpuWatch&&room.fastMode?1800:3500;}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>load(),pollDelay());}
function detailBusy(){const active=document.activeElement;return !!(active&&active.closest&&active.closest('#detail input,#detail select,#detail textarea'));}

$('loginForm').onsubmit=async event=>{event.preventDefault();$('loginError').textContent='';try{await request('/admin/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';lastRoomSignature='';lastDetailSignature='';await load({force:true});}catch(error){$('loginError').textContent=error.message;}};
$('logout').onclick=async()=>{try{await request('/admin/logout',{method:'POST',body:'{}'});}catch{}showLogin();};

function defaultCpuRoles(count){const roles=Array(count).fill('villager');roles[0]='wolf';if(count>1)roles[1]='seer';if(count>=5)roles[2]='guard';if(count>=7)roles[3]='medium';if(count>=8)roles[4]='madman';return roles;}
function renderCpuRoleBuilder(){
  const count=Math.max(4,Math.min(30,Number($('cpuWatchCount').value)||8)),box=$('cpuRoleBuilder');
  if(!$('cpuManualRoles').checked){box.hidden=true;box.innerHTML='';return;}
  const previous=[...box.querySelectorAll('select')].map(select=>select.value),roles=previous.length===count?previous:defaultCpuRoles(count);
  box.hidden=false;box.innerHTML=roles.map((role,index)=>`<label>CPU${index+1}<select data-cpu-role>${roleIds.map(id=>`<option value="${id}" ${id===role?'selected':''}>${esc(roleNames[id])}</option>`).join('')}</select></label>`).join('');
}
$('cpuWatchCount').addEventListener('input',renderCpuRoleBuilder);
$('cpuManualRoles').addEventListener('change',renderCpuRoleBuilder);
$('cpuWatchForm').onsubmit=async event=>{
  event.preventDefault();$('adminNotice').textContent='';
  try{
    const roles=$('cpuManualRoles').checked?[...document.querySelectorAll('[data-cpu-role]')].map(select=>select.value):null;
    const result=await request('/admin/action',{method:'POST',body:JSON.stringify({action:'create_cpu_watch',count:Number($('cpuWatchCount').value),code:$('cpuWatchCode').value.trim(),roles})});
    selected=result.code;tab='watch';$('cpuWatchCode').value='';lastRoomSignature='';lastDetailSignature='';$('adminNotice').textContent=`CPU観戦部屋 ${result.code} を作成しました。`;await load({force:true});
  }catch(error){$('adminNotice').textContent=error.message;}
};
renderCpuRoleBuilder();

function renderSummary(){
  const rooms=data.rooms||[];
  $('roomCount').textContent=rooms.length;
  $('playerCount').textContent=rooms.reduce((sum,room)=>sum+room.total,0);
  $('activeCount').textContent=rooms.filter(room=>!['lobby','ended'].includes(room.phase)).length;
  $('streamCount').textContent=data.server?.openStreams??0;
  $('alertCount').textContent=rooms.filter(phaseAlert).length;
  $('updated').textContent=new Date(data.now).toLocaleTimeString('ja-JP');
}
function renderServer(){
  const server=data.server||{};
  $('serverStatus').textContent='ONLINE';$('serverUpdated').textContent=new Date(data.now).toLocaleTimeString('ja-JP');$('errorCount').textContent=(server.recentErrors||[]).length;
  const metrics=[['稼働時間',fmtUptime(server.uptimeMs)],['RSSメモリ',fmtBytes(server.rss)],['Heap',`${fmtBytes(server.heapUsed)} / ${fmtBytes(server.heapTotal)}`],['Node',server.node||'—'],['Tick',`${server.tickMs??'—'} ms`],['HTTP要求',server.requests??0],['API要求',server.apiRequests??0],['SSE接続',server.openStreams??0],['一時チケット',server.tickets??0]];
  $('serverMetrics').innerHTML=metrics.map(([key,value])=>`<div><small>${esc(key)}</small><strong>${esc(value)}</strong></div>`).join('');
  $('serverErrors').innerHTML=(server.recentErrors||[]).length?(server.recentErrors||[]).slice(0,12).map(error=>`<div class="server-error"><small>${new Date(error.at).toLocaleTimeString('ja-JP')} · ${esc(error.scope)}</small><span>${esc(error.message)}</span></div>`).join(''):'<p class="empty">記録されたエラーはありません。</p>';
}
function roomListSignature(){return JSON.stringify([selected,(data.rooms||[]).map(room=>[room.code,room.phase,room.day,room.total,room.connected,room.alive,room.fastMode,room.collapsing,phaseAlert(room)])]);}
function renderRooms(force=false){
  const signature=roomListSignature();if(!force&&signature===lastRoomSignature)return;lastRoomSignature=signature;
  const rooms=data.rooms||[];
  $('rooms').innerHTML=rooms.length?rooms.map(room=>`<button class="room-btn ${selected===room.code?'active':''} ${phaseAlert(room)?'alert':''} ${room.collapsing?'collapsing':''}" data-code="${esc(room.code)}"><strong>${esc(room.code)}</strong><span class="phase">${room.collapsing?'崩壊中':esc(phaseNames[room.phase]||room.phase)+(room.day?' · '+room.day+'日目':'')}</span><small>${room.cpuWatch?'CPU観戦 · ':''}${room.total}人（人間${room.humans} / CPU${room.bots}）</small><small>${room.connected}接続 · 生存${room.alive}${room.cpuWatch?` · ${room.speed}x`:''}</small></button>`).join(''):'<p class="empty">現在、部屋はありません。</p>';
  document.querySelectorAll('.room-btn').forEach(button=>button.onclick=()=>{selected=button.dataset.code;tab=data.rooms.find(room=>room.code===selected)?.cpuWatch?'watch':'overview';lastRoomSignature='';lastDetailSignature='';renderRooms(true);renderDetail(true);});
}
function detailSignature(room){
  const players=(room.players||[]).map(p=>[p.id,p.connected,p.alive,p.auto,p.role,p.lover,p.action,p.vote,p.levelerLevel,p.resetUsed]).join('|');
  const lastMessage=(room.messages||[]).at(-1);
  return JSON.stringify([tab,room.code,room.phase,room.phaseId,room.day,room.deadline,room.fastMode,room.collapsing,room.connected,room.alive,room.total,room.training?.examples,room.adminNarration?.id,lastMessage?.id,(room.messages||[]).length,(room.voteHistory||[]).length,(room.claims||[]).length,(room.reports||[]).length,players,room.actions,room.votes,room.specialActions]);
}
function watchPoint(index,count){const angle=-Math.PI/2+index*Math.PI*2/count;return{x:50+Math.cos(angle)*43,y:50+Math.sin(angle)*40};}
function watchArrows(room){
  const points=new Map(room.players.map((player,index)=>[player.id,watchPoint(index,room.players.length)])),items=[];
  if(room.phase==='execution'&&room.voteHistory.length)for(const ballot of room.voteHistory.at(-1).ballots||[])if(ballot.target)items.push({from:ballot.voter,to:ballot.target,type:'vote'});
  for(const message of room.messages.slice(-25)){const meta=message.meta;if(meta?.target&&message.playerId)items.push({from:message.playerId,to:meta.target,type:meta.kind||'relation'});}
  return items.slice(-15).map((item,index)=>{const from=points.get(item.from),to=points.get(item.to);if(!from||!to)return '';const bend=(index%3-1)*3;return `<line class="watch-arrow ${esc(item.type)}" x1="${from.x}" y1="${from.y}" x2="${to.x+bend}" y2="${to.y-bend}" marker-end="url(#watchHead)"/>`;}).join('');
}
function renderWatch(room){const recent=room.messages.filter(message=>message.channel==='public'&&message.playerId).slice(-4);return `<div class="watch-toolbar"><div><strong>CPU観戦</strong><span>${room.fastMode?'8倍速で進行中':'通常速度'} · ${esc(phaseNames[room.phase]||room.phase)} ${room.day}日目</span></div><div><button id="toggleFast" class="${room.fastMode?'fast-on':''}">${room.fastMode?'早送りを止める':'CPU早送り ×8'}</button><button id="stepPhase">1フェーズ進める ≫</button></div></div><div class="cpu-watch-board"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="watchHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>${watchArrows(room)}</svg>${room.players.map((player,index)=>{const point=watchPoint(index,room.players.length);return `<div class="cpu-seat ${player.alive?'':'dead'}" style="left:${point.x}%;top:${point.y}%"><b>${esc(player.name)}</b><small>${esc(roleNames[player.role]||player.role||'未配役')}</small></div>`;}).join('')}<div class="watch-center"><strong>${esc(phaseNames[room.phase]||room.phase)}</strong>${recent.map(message=>`<p><b>${esc(message.name)}</b> ${esc(message.text)}</p>`).join('')||'<p>CPUの発言を待っています。</p>'}</div></div>`;}
function renderOverview(room){return `<div class="overview-grid"><article class="overview-card"><small>進行</small><strong>${esc(phaseNames[room.phase]||room.phase)}${room.day?' · '+room.day+'日目':''}</strong><span>${room.winner?esc(room.winner.label):'対戦状態を監視中'}</span></article><article class="overview-card"><small>参加</small><strong>${room.humans} HUMAN / ${room.bots} CPU</strong><span>${room.connected} 接続 · ${room.alive} 生存</span></article><article class="overview-card"><small>学習データ</small><strong>${room.training?.examples||0} examples</strong><span>${room.training?.eligible?'人間のみ・収集対象':'現在は収集対象外'}</span></article><article class="overview-card"><small>部屋作成</small><strong>${room.createdAt?new Date(room.createdAt).toLocaleTimeString('ja-JP'):'—'}</strong><span>${room.cpuWatch?'CPU観戦用':'通常オンライン部屋'}</span></article></div>${room.collapsing?'<div class="collapse-admin-banner"><strong>禁忌処理を実行中</strong><span>参加者画面で演出後、この部屋は削除されます。</span></div>':''}`;}
function renderPlayers(room){return `<div class="table-wrap"><table class="player-table"><thead><tr><th>名前</th><th>状態</th><th>役職</th><th>恋人</th><th>CPU人格</th><th>現在の行動</th><th>管理者操作</th></tr></thead><tbody>${room.players.map(player=>{const life=!['lobby','ended'].includes(room.phase)?`<button class="${player.alive?'danger':'revive'} compact" data-life-action="${player.alive?'force_kill':'force_revive'}" data-player-id="${esc(player.id)}">${player.alive?'強制死亡':'復活'}</button>`:'';const kick=!player.bot?`<button class="danger compact kick" data-kick-player="${esc(player.id)}">追放</button>`:'';return `<tr class="${player.alive?'':'dead'}"><td><strong>${esc(player.name)}</strong>${player.bot?' <small>CPU</small>':''}</td><td>${player.alive?'生存':'死亡'} / ${player.connected||player.bot?'接続':'切断'}${player.auto?' / CPU代行':''}</td><td class="role">${esc(roleNames[player.role]||player.role||'未配役')}</td><td>${esc(player.lover||'—')}</td><td class="personality">${esc(player.bot?personality(player.personality):'—')}</td><td>${player.action!==undefined?'夜: '+esc(player.action||'対象なし'):''}${player.vote!==undefined?`${player.action!==undefined?' / ':''}投票: ${esc(player.vote||'棄権')}`:(player.action===undefined?'—':'')}</td><td><div class="admin-row-actions">${life}${kick}${!life&&!kick?'—':''}</div></td></tr>`;}).join('')}</tbody></table></div>`;}
function renderControl(room){
  const alive=room.players.filter(player=>player.alive),aliveBots=alive.filter(player=>player.bot),humanWolf=alive.some(player=>!player.bot&&['wolf','darkwolf'].includes(player.role)),botWolf=alive.some(player=>player.bot&&['wolf','darkwolf'].includes(player.role));
  const narration=`<section class="admin-narration"><div class="admin-narration-head"><div><strong>全員へナレーション</strong><small>全プレイヤーの画面中央に表示します。</small></div>${room.adminNarration?`<small>前回：${esc(room.adminNarration.text)}</small>`:''}</div><div class="admin-narration-send"><input id="adminNarrationText" maxlength="120" placeholder="例：突然、村に謎の声が響いた……" ${room.phase==='lobby'?'disabled':''}><button id="sendAdminNarration" ${room.phase==='lobby'?'disabled':''}>全員へ表示</button></div>${room.phase==='lobby'?'<p>ゲーム開始後に送信できます。</p>':''}</section>`;
  const vote=room.phase==='vote'?`<section class="admin-control"><h3>CPU投票操作</h3><p>人間の票は変更せず、CPUだけを指定します。</p><div id="cpuVoteRows">${aliveBots.map(player=>`<label>${esc(player.name)}<select data-vote-cpu="${esc(player.id)}"><option value="auto">自動</option><option value="">棄権</option>${alive.filter(target=>target.id!==player.id).map(target=>`<option value="${esc(target.id)}">${esc(target.name)}</option>`).join('')}</select></label>`).join('')}</div><div class="control-buttons"><select id="allCpuVote"><option value="">全員の投票先を選ぶ</option>${alive.map(target=>`<option value="${esc(target.id)}">${esc(target.name)}</option>`).join('')}</select><button id="applyAllCpuVote">全CPUにセット</button><button id="saveCpuVotes">CPU投票を反映</button></div></section>`:'';
  const attack=room.phase==='night'&&botWolf?`<section class="admin-control"><h3>CPU人狼の襲撃先</h3>${humanWolf?'<p class="status-bad">人間の人狼が生存しているため上書きできません。</p>':`<p>生存中の通常人狼が全員CPUの時だけ指定できます。</p><div class="control-buttons"><select id="cpuAttackTarget">${alive.filter(target=>!['wolf','darkwolf'].includes(target.role)).map(target=>`<option value="${esc(target.id)}">${esc(target.name)}</option>`).join('')}</select><button id="saveCpuAttack">襲撃先を反映</button></div>`}</section>`:'';
  const danger=`<section class="danger-zone"><div><small>DANGER ZONE</small><h3>部屋を強制崩壊</h3><p>参加者全員に禁忌演出を発生させ、終了後に部屋そのものを削除します。</p></div><button id="collapseRoom" class="collapse-room-button" ${room.collapsing?'disabled':''}>${room.collapsing?'崩壊中…':'禁忌を発動して部屋を消す'}</button></section>`;
  return narration+vote+attack+danger;
}
function renderLog(room){return `<div class="log">${room.messages.length?room.messages.map(message=>`<div class="log-line ${esc(message.channel)}"><small>${message.day||0}日目 · ${esc(phaseNames[message.phase]||message.phase)} · ${esc(message.channel)} · ${new Date(message.at).toLocaleTimeString('ja-JP')}</small><strong>${esc(message.name)}</strong>　${esc(message.text)}</div>`).join(''):'<p class="empty">ログはまだありません。</p>'}</div>`;}
function renderState(room){
  const remaining=room.deadline?Math.max(0,Math.ceil((room.deadline-(room.gameNow||Date.now()))/1000)):null;
  const cpuCards=room.players.filter(player=>player.bot).map(player=>{const debug=player.botDebug||{},suspects=(debug.suspicion||[]).map(item=>`${esc(item.name)} ${item.score}${item.reason?' — '+esc(item.reason):''}`).join('<br>')||'まだ評価なし';return `<div class="state-card"><h3>${esc(player.name)} · ${esc(roleNames[player.role]||player.role||'未配役')}</h3><div class="personality">${esc(personality(player.personality))}</div><p>発言数: ${debug.talks||0}${debug.fakeRole?` / 騙り: ${esc(roleNames[debug.fakeRole]||debug.fakeRole)}`:''}${debug.replyQueued?' / 返信待ち':''}</p><strong>疑い上位</strong><div class="personality">${suspects}</div></div>`;}).join('');
  return `<div class="state-grid"><div class="state-card"><h3>進行状態</h3><pre>フェーズ: ${esc(phaseNames[room.phase]||room.phase)}\n日数: ${room.day}\n残り: ${remaining===null?'—':remaining+'秒'}\n速度: ${room.speed||1}x\n開始: ${room.startedAt?new Date(room.startedAt).toLocaleString('ja-JP'):'—'}</pre></div><div class="state-card"><h3>夜行動</h3><pre>${esc(JSON.stringify({normal:room.actions,special:room.specialActions},null,2))}</pre></div><div class="state-card"><h3>投票</h3><pre>${esc(JSON.stringify(room.votes,null,2))}</pre></div><div class="state-card"><h3>公開主張</h3><pre>${esc(JSON.stringify({claims:room.claims,reports:room.reports},null,2))}</pre></div></div>${cpuCards?'<h3 class="subsection-title">CPU内部状態</h3><div class="state-grid">'+cpuCards+'</div>':''}`;
}

async function adminAction(action,extra={}){if(!selected)return null;try{const result=await request('/admin/action',{method:'POST',body:JSON.stringify({action,code:selected,...extra})});lastRoomSignature='';lastDetailSignature='';await load({force:true});return result;}catch(error){notice(error.message,true);return null;}}
function bindDetail(room){
  const download=$('downloadTraining');if(download)download.onclick=()=>{location.href='/admin/training?code='+encodeURIComponent(room.code);};
  document.querySelectorAll('[data-life-action]').forEach(button=>button.onclick=()=>{const player=room.players.find(item=>item.id===button.dataset.playerId);if(!player)return;const revive=button.dataset.lifeAction==='force_revive';if(revive||confirm(player.name+'を管理者操作で強制死亡させますか？'))adminAction(button.dataset.lifeAction,{playerId:player.id});});
  document.querySelectorAll('[data-kick-player]').forEach(button=>button.onclick=()=>{const player=room.players.find(item=>item.id===button.dataset.kickPlayer);if(player&&confirm(player.name+'をこの部屋から完全に追放しますか？\n席と現在の復帰キーも削除されます。'))adminAction('kick_player',{playerId:player.id});});
  if($('toggleFast'))$('toggleFast').onclick=()=>adminAction('toggle_fast',{enabled:!room.fastMode});
  if($('stepPhase'))$('stepPhase').onclick=()=>adminAction('step');
  if($('sendAdminNarration'))$('sendAdminNarration').onclick=async()=>{const input=$('adminNarrationText'),text=input.value.trim();if(!text)return;input.value='';const result=await adminAction('broadcast_narration',{text});if(result)notice('全員へナレーションを送信しました。');};
  if($('applyAllCpuVote'))$('applyAllCpuVote').onclick=()=>{const value=$('allCpuVote').value;if(value)document.querySelectorAll('[data-vote-cpu]').forEach(select=>select.value=value);};
  if($('saveCpuVotes'))$('saveCpuVotes').onclick=()=>{const votes={};document.querySelectorAll('[data-vote-cpu]').forEach(select=>votes[select.dataset.voteCpu]=select.value==='auto'?'auto':(select.value||null));adminAction('set_cpu_votes',{votes});};
  if($('saveCpuAttack'))$('saveCpuAttack').onclick=()=>adminAction('set_cpu_attack',{target:$('cpuAttackTarget').value});
  if($('collapseRoom'))$('collapseRoom').onclick=async()=>{const typed=prompt('この操作は取り消せません。\n強制崩壊させるには部屋コード「'+room.code+'」を入力してください。','');if(typed!==room.code)return;const result=await adminAction('collapse_room');if(result)notice('禁忌を発動しました。参加者画面で崩壊演出を開始しています。');};
}
function renderDetail(force=false){
  const room=data.rooms.find(item=>item.code===selected);
  if(!room){$('detail').innerHTML='<p class="empty">部屋を選ぶと詳細を表示します。</p>';lastDetailSignature='';return;}
  if(detailBusy()&&!force)return;
  const signature=detailSignature(room);if(!force&&signature===lastDetailSignature)return;lastDetailSignature=signature;
  const oldLogTop=document.querySelector('#activePane .log')?.scrollTop??0;
  const tabs=[['overview','概要'],['players','参加者'],['control','操作'],['log','会話ログ'],['state','内部状態']];if(room.cpuWatch)tabs.unshift(['watch','CPU観戦']);if(!tabs.some(([id])=>id===tab))tab=tabs[0][0];
  let body='';if(tab==='watch')body=renderWatch(room);else if(tab==='overview')body=renderOverview(room);else if(tab==='players')body=renderPlayers(room);else if(tab==='control')body=renderControl(room);else if(tab==='log')body=renderLog(room);else body=renderState(room);
  $('detail').innerHTML=`<div class="detail-head"><div><div class="room-title-line"><h2>部屋 ${esc(room.code)}</h2>${room.collapsing?'<span class="collapse-badge">崩壊中</span>':''}</div><p>${room.cpuWatch?'<strong class="cpu-badge">CPU観戦部屋</strong> · ':''}${esc(phaseNames[room.phase]||room.phase)}${room.day?' · '+room.day+'日目':''} / 部屋主 ${esc(room.host||'—')}</p></div><div class="chips"><span class="chip">${room.total}人</span><span class="chip">生存 ${room.alive}</span><span class="chip">接続 ${room.connected}</span>${room.cpuWatch?`<span class="chip">速度 ${room.speed}x</span>`:''}${room.collapsing?'<span class="chip status-bad">強制崩壊中</span>':phaseAlert(room)?'<span class="chip status-bad">要確認</span>':'<span class="chip status-ok">正常</span>'}</div></div><div class="detail-actions">${room.training?.examples?'<button id="downloadTraining">学習データ JSONL</button>':''}</div><p id="roomNotice" class="admin-notice room-notice" aria-live="polite"></p><div class="tabs">${tabs.map(([id,label])=>`<button data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('')}</div><div id="activePane" class="pane">${body}</div>`;
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;lastDetailSignature='';renderDetail(true);});
  bindDetail(room);const log=document.querySelector('#activePane .log');if(log)log.scrollTop=oldLogTop;
}

async function load({force=false}={}){
  if(loading){schedule();return;}loading=true;clearTimeout(timer);
  try{
    data=await request('/admin/data',{headers:{}});
    $('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;
    if(selected&&!data.rooms.some(room=>room.code===selected)){selected=null;lastRoomSignature='';lastDetailSignature='';}
    if(!selected&&data.rooms[0]){selected=data.rooms[0].code;tab=data.rooms[0].cpuWatch?'watch':'overview';lastRoomSignature='';lastDetailSignature='';}
    renderSummary();renderServer();renderRooms(force);renderDetail(force);
  }catch(error){if(error.status===401){showLogin();loading=false;return;}$('adminNotice').textContent=error.message;}
  finally{loading=false;schedule();}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load({force:true});else schedule();});
load({force:true});
})();
