(()=>{
'use strict';
const $=id=>document.getElementById(id);
let sessionId=null,busy=false,startBusy=false,sessionMode='general',teacherMode=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').hidden=true,2800);}
async function api(body){
  const res=await fetch('/talk/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const json=await res.json().catch(()=>({}));
  if(!res.ok||json.ok===false)throw Error(json.error||'通信に失敗しました。');
  return json;
}
function meaningPanel(meaning){
  if(!meaning)return null;
  const box=document.createElement('details');box.className='meaning';
  const summary=document.createElement('summary');summary.textContent='AIの意味解析を見る';box.append(summary);
  const desc=document.createElement('p');desc.className='meaning-summary';desc.textContent=meaning.summary||'';box.append(desc);
  const grid=document.createElement('div');grid.className='meaning-grid';
  const entries=[
    ['領域',meaning.domain==='werewolf'?'人狼':'一般会話'],
    ['話題',meaning.topic],
    ['意図',meaning.speechAct],
    ['対象',meaning.target],
    ['時制',meaning.tense],
    ['調子',meaning.tone],
    ['前文依存',meaning.contextDependence]
  ];
  for(const [key,value] of entries){
    if(!value)continue;
    const item=document.createElement('span');
    item.innerHTML='<b>'+esc(key)+'</b>'+esc(value);
    grid.append(item);
  }
  box.append(grid);
  if(meaning.usesHistory){
    const used=document.createElement('small');used.textContent='直前の会話も解釈に使用';box.append(used);
  }
  return box;
}
function teacherBox(turnId){
  const box=document.createElement('div');box.className='teacher-box';
  const title=document.createElement('strong');title.textContent='本当はどう返す？';box.append(title);
  const note=document.createElement('small');note.textContent='人間なら自然だと思う返答を1つ教える。即学習はせず、再学習用に保存する。';box.append(note);
  const row=document.createElement('div');row.className='teacher-row';
  const input=document.createElement('textarea');input.rows=2;input.maxLength=400;input.placeholder='例：そうだな、なんとかなると思う。';
  const button=document.createElement('button');button.type='button';button.textContent='教師データとして保存';
  button.onclick=async()=>{
    const correction=input.value.trim();
    if(!correction){toast('自然だと思う返答を入力してくれ');return;}
    button.disabled=true;input.disabled=true;
    try{
      const result=await api({action:'teach',sessionId,turnId,correction});
      button.textContent=result.stored===false?'保存できず':'保存済み';
      box.classList.add(result.stored===false?'save-failed':'saved');
      toast(result.stored===false?'教師データを一時的に保存できませんでした':'教師データとして保存した');
    }catch(err){
      button.disabled=false;input.disabled=false;toast(err.message);
    }
  };
  row.append(input,button);box.append(row);
  return box;
}
function addMessage(kind,text,extra={}){
  const wrap=document.createElement('div');wrap.className='msg '+kind+(extra.thinking?' thinking':'');
  const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=text;wrap.append(bubble);
  if(extra.meta){const meta=document.createElement('div');meta.className='meta';meta.textContent=extra.meta;wrap.append(meta);}
  if(kind==='ai'&&extra.turnId){
    if(extra.meaning&&teacherMode){
      const panel=meaningPanel(extra.meaning);
      if(panel)wrap.append(panel);
    }
    const rating=document.createElement('div');rating.className='rating';
    const label=document.createElement('span');label.className='meta';label.textContent='この返答は？';rating.append(label);
    for(const [value,labelText,cls] of [[1,'👍','good'],[-1,'👎','bad']]){
      const b=document.createElement('button');b.type='button';b.textContent=labelText;b.className=cls;
      b.onclick=async()=>{try{const result=await api({action:'feedback',sessionId,turnId:extra.turnId,value});[...rating.querySelectorAll('button')].forEach(x=>x.disabled=true);b.classList.add('selected');toast(result.stored===false?'評価は一時的に保存できませんでした':'評価を記録した（即学習には未反映）');}catch(err){toast(err.message);}};
      rating.append(b);
    }
    wrap.append(rating);
    if(teacherMode)wrap.append(teacherBox(extra.turnId));
  }
  $('messages').append(wrap);$('messages').scrollTop=$('messages').scrollHeight;return wrap;
}
function updateCorpus(data){
  if(sessionMode==='general'){
    $('corpus').textContent='旧・一般会話 · 人狼実戦ログは返答に未使用'+(teacherMode?' · 教師モード':'');
  }else{
    $('corpus').textContent='旧・人狼会話 · 実戦会話 '+Number(data.corpusSize||0).toLocaleString('ja-JP')+'件'+(teacherMode?' · 教師モード':'');
  }
}
async function start(){
  if(startBusy)return;
  startBusy=true;
  const submit=$('startForm').querySelector('button[type="submit"]');
  if(submit)submit.disabled=true;
  try{
    const name=$('name').value.trim()||'あなた';
    sessionMode=document.querySelector('input[name="labMode"]:checked')?.value==='werewolf'?'werewolf':'general';
    teacherMode=$('teacherMode').checked;
    $('status').textContent='接続中';
    const data=await api({action:'start',name,mode:sessionMode});
    sessionId=data.sessionId;
    sessionMode=data.mode||sessionMode;
    $('messages').innerHTML='';
    $('startPanel').hidden=true;$('chatPanel').hidden=false;
    updateCorpus(data);
    $('status').textContent=data.learningActive?'LEARNING':'PAUSED';
    const intro=sessionMode==='general'
      ?'ここでは普通の会話だけを試す。人狼の実戦ログには頼らず、文の意味と直前の流れを見て返す。'
      :'ここでは人狼会話を試す。意味判定に加えて、条件が合う時だけ実戦会話も参考にする。';
    addMessage('ai',intro,{meta:'旧方式 baseline · 意味AI未接続'});
    $('input').focus();
  }finally{
    startBusy=false;
    if(submit)submit.disabled=false;
  }
}
$('startForm').addEventListener('submit',e=>{e.preventDefault();start().catch(err=>{toast(err.message);$('status').textContent='ERROR';});});
$('newChat').onclick=()=>{sessionId=null;busy=false;startBusy=false;sessionMode='general';teacherMode=false;$('messages').innerHTML='';$('chatPanel').hidden=true;$('startPanel').hidden=false;$('status').textContent='準備完了';$('startForm').querySelector('button[type="submit"]')?.removeAttribute('disabled');};
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
    if(data.sessionMode==='general')meta='一般会話 · '+(data.intentLabel||'意味判定');
    else if(data.mode==='intent')meta='意図判定：'+(data.intentLabel||'会話');
    else if(data.mode==='fallback')meta='一致する実戦会話が少ないため安全返答';
    else meta=data.lowConfidence?'実戦会話との一致が弱い · '+pct+'%':'実戦会話との近さ '+pct+'%';
    addMessage('ai',data.reply,{turnId:data.aiTurnId,meta,meaning:data.meaning});
    updateCorpus(data);
  }catch(err){thinking.remove();addMessage('ai','エラー：'+err.message,{meta:'SYSTEM'});}
  finally{busy=false;$('send').disabled=false;$('input').focus();}
});
$('input').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(120,e.target.scrollHeight)+'px';});
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('chatForm').requestSubmit();}});
$('status').textContent='準備完了';
})();
