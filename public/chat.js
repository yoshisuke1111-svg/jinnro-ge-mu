(()=>{
'use strict';
const $=id=>document.getElementById(id);
let sessionToken=localStorage.getItem('casualChatSession')||'',pollTimer=null,currentState=null,replyTo=null,busy=false;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').hidden=true,2500);}
async function api(body){
  const res=await fetch('/chat/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const json=await res.json().catch(()=>({}));
  if(!res.ok||json.ok===false)throw Error(json.error||'通信に失敗しました。');
  return json;
}
function setReply(message){
  replyTo=message||null;
  $('replyBar').hidden=!replyTo;
  if(replyTo){
    $('replyName').textContent=replyTo.name;
    $('replyText').textContent=replyTo.text;
    $('messageInput').focus();
  }
}
function render(state){
  currentState=state;
  $('entry').hidden=true;$('room').hidden=false;
  $('activeCode').textContent=state.code;
  $('members').textContent='参加者 '+state.participants.map(p=>p.name).join(' · ');
  const box=$('messages'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<100;
  const existing=new Set([...box.querySelectorAll('[data-message-id]')].map(x=>x.dataset.messageId));
  for(const m of state.messages){
    if(existing.has(m.id))continue;
    const wrap=document.createElement('article');
    wrap.className='message'+(m.participantId===state.me.id?' mine':'');
    wrap.dataset.messageId=m.id;
    const head=document.createElement('div');head.className='message-head';
    const name=document.createElement('strong');name.textContent=m.name;
    const time=document.createElement('span');time.textContent=new Date(m.at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
    head.append(name,time);wrap.append(head);
    if(m.replyPreview){
      const rp=document.createElement('div');rp.className='reply-preview';
      rp.textContent='↳ '+m.replyPreview.name+'：'+m.replyPreview.text;wrap.append(rp);
    }
    const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=m.text;wrap.append(bubble);
    const actions=document.createElement('div');actions.className='message-actions';
    const reply=document.createElement('button');reply.type='button';reply.className='reply-btn';reply.textContent='↩ 返信';
    reply.onclick=()=>setReply(m);actions.append(reply);wrap.append(actions);
    box.append(wrap);
  }
  if(nearBottom)box.scrollTop=box.scrollHeight;
}
async function poll(){
  if(!sessionToken)return;
  try{
    const data=await api({action:'state',sessionToken});
    render(data.state);
  }catch(err){
    clearInterval(pollTimer);pollTimer=null;
    if(/見つかりません|入り直して/.test(err.message)){
      localStorage.removeItem('casualChatSession');sessionToken='';
      $('room').hidden=true;$('entry').hidden=false;
    }
  }
}
function beginPolling(){
  clearInterval(pollTimer);pollTimer=setInterval(poll,1200);
}
async function enter(create){
  $('entryError').textContent='';
  if(!$('consent').checked){$('entryError').textContent='学習用保存への同意が必要です。';return;}
  const name=$('name').value.trim(),code=$('roomCode').value.trim();
  try{
    const data=await api({action:create?'create':'join',name,code,consent:true});
    sessionToken=data.sessionToken;localStorage.setItem('casualChatSession',sessionToken);
    history.replaceState(null,'','/chat?room='+encodeURIComponent(data.state.code));
    render(data.state);beginPolling();$('messageInput').focus();
  }catch(err){$('entryError').textContent=err.message;}
}
$('create').onclick=()=>enter(true);
$('join').onclick=()=>enter(false);
$('copyInvite').onclick=async()=>{
  if(!currentState)return;
  const url=location.origin+'/chat?room='+encodeURIComponent(currentState.code);
  try{await navigator.clipboard.writeText(url);toast('招待リンクをコピーした');}
  catch{toast(url);}
};
$('leave').onclick=async()=>{
  if(sessionToken){try{await api({action:'leave',sessionToken});}catch{}}
  clearInterval(pollTimer);pollTimer=null;sessionToken='';currentState=null;replyTo=null;
  localStorage.removeItem('casualChatSession');
  $('messages').innerHTML='';$('room').hidden=true;$('entry').hidden=false;
};
$('cancelReply').onclick=()=>setReply(null);
$('chatForm').addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!sessionToken)return;
  const text=$('messageInput').value.trim();if(!text)return;
  busy=true;$('send').disabled=true;
  try{
    const data=await api({action:'send',sessionToken,text,replyTo:replyTo?.id||null});
    $('messageInput').value='';$('messageInput').style.height='auto';setReply(null);render(data.state);
    if(data.stored===false)toast('会話は届いたが、学習DBへの保存に失敗した');
  }catch(err){toast(err.message);}
  finally{busy=false;$('send').disabled=false;$('messageInput').focus();}
});
$('messageInput').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(120,e.target.scrollHeight)+'px';});
$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chatForm').requestSubmit();}});
const roomFromUrl=new URLSearchParams(location.search).get('room');
if(roomFromUrl)$('roomCode').value=roomFromUrl;
if(sessionToken){poll().then(()=>{if(sessionToken)beginPolling();});}
})();