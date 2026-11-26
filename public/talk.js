(()=>{
'use strict';
const $=id=>document.getElementById(id);
let sessionId=null,busy=false,startBusy=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').hidden=true,2600);}
async function api(body){
  const res=await fetch('/talk/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const json=await res.json().catch(()=>({}));
  if(!res.ok||json.ok===false)throw Error(json.error||'通信に失敗しました。');
  return json;
}
function addMessage(kind,text,extra={}){
  const wrap=document.createElement('div');wrap.className='msg '+kind+(extra.thinking?' thinking':'');
  const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=text;wrap.append(bubble);
  if(extra.meta){const meta=document.createElement('div');meta.className='meta';meta.textContent=extra.meta;wrap.append(meta);}
  if(kind==='ai'&&extra.turnId){
    const rating=document.createElement('div');rating.className='rating';
    const label=document.createElement('span');label.className='meta';label.textContent='この返答は？';rating.append(label);
    for(const [value,labelText,cls] of [[1,'👍','good'],[-1,'👎','bad']]){
      const b=document.createElement('button');b.type='button';b.textContent=labelText;b.className=cls;
      b.onclick=async()=>{try{const result=await api({action:'feedback',sessionId,turnId:extra.turnId,value});[...rating.querySelectorAll('button')].forEach(x=>x.disabled=true);b.classList.add('selected');toast(result.stored===false?'評価は一時的に保存できませんでした':'評価を記録した（学習には未反映）');}catch(err){toast(err.message);}};
      rating.append(b);
    }
    wrap.append(rating);
  }
  $('messages').append(wrap);$('messages').scrollTop=$('messages').scrollHeight;return wrap;
}
async function start(){
  if(startBusy)return;
  startBusy=true;
  const submit=$('startForm').querySelector('button[type="submit"]');
  if(submit)submit.disabled=true;
  try{
    const name=$('name').value.trim()||'あなた';
    $('status').textContent='接続中';
    const data=await api({action:'start',name});
    sessionId=data.sessionId;
    $('messages').innerHTML='';
    $('startPanel').hidden=true;$('chatPanel').hidden=false;
    $('corpus').textContent='参照できる実戦会話 '+data.corpusSize.toLocaleString('ja-JP')+'件 · 学習停止中';
    $('status').textContent=data.learningActive?'LEARNING':'PAUSED';
    addMessage('ai','ここは会話AIだけを試す実験室じゃ。挨拶や雑談への反応と、人狼の実戦会話から探す返答を分けている。今の会話は評価として保存するが、即学習には使わない。',{meta:'意図判定＋文脈絞り込み型会話AI v0.4 · 学習停止中'});
    $('input').focus();
  }finally{
    startBusy=false;
    if(submit)submit.disabled=false;
  }
}
$('startForm').addEventListener('submit',e=>{e.preventDefault();start().catch(err=>{toast(err.message);$('status').textContent='ERROR';});});
$('newChat').onclick=()=>{sessionId=null;busy=false;startBusy=false;$('messages').innerHTML='';$('chatPanel').hidden=true;$('startPanel').hidden=false;$('status').textContent='準備完了';$('startForm').querySelector('button[type="submit"]')?.removeAttribute('disabled');};
$('chatForm').addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!sessionId)return;
  const text=$('input').value.trim();if(!text)return;
  $('input').value='';$('input').style.height='auto';addMessage('user',text);
  const thinking=addMessage('ai','考え中',{thinking:true});busy=true;$('send').disabled=true;
  try{
    const data=await api({action:'send',sessionId,text});
    thinking.remove();
    const pct=Math.round((Number(data.confidence)||0)*100);
    let meta;
    if(data.mode==='intent')meta='意図判定：'+(data.intentLabel||'会話');
    else if(data.mode==='fallback')meta='一致する実戦会話が少ないため安全返答';
    else meta=data.lowConfidence?'実戦会話との一致が弱い · '+pct+'%':'実戦会話との近さ '+pct+'%';
    addMessage('ai',data.reply,{turnId:data.aiTurnId,meta});
    $('corpus').textContent='参照できる実戦会話 '+Number(data.corpusSize||0).toLocaleString('ja-JP')+'件 · 学習停止中'+(data.aliases?' · 別名'+data.aliases+'件':'');
  }catch(err){thinking.remove();addMessage('ai','エラー：'+err.message,{meta:'SYSTEM'});}
  finally{busy=false;$('send').disabled=false;$('input').focus();}
});
$('input').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(120,e.target.scrollHeight)+'px';});
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('chatForm').requestSubmit();}});
$('status').textContent='準備完了';
})();