(()=>{
'use strict';
const $=id=>document.getElementById(id);
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').hidden=true,2400);}
async function compare(){
  const a=$('a').value.trim(),b=$('b').value.trim();
  if(!a||!b){toast('文を2つ入力してくれ');return;}
  $('compare').disabled=true;$('compare').textContent='比較中…';
  try{
    const res=await fetch('/meaning/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({a,b})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.ok===false)throw Error(data.error||'比較に失敗しました。');
    const pct=n=>Math.round(Math.max(0,Math.min(1,Number(n)||0))*100);
    $('score').textContent=pct(data.score)+'%';
    $('learned').textContent=pct(data.learned)+'%';
    $('surface').textContent=pct(data.surface)+'%';
    $('confidence').textContent=({very_low:'まだ極少',low:'低',medium:'中',growing:'成長中'})[data.confidence]||data.confidence||'—';
    const render=(id,items)=>{
      const box=$(id);box.innerHTML='';
      if(!items?.length){const s=document.createElement('span');s.textContent='まだ学習なし';box.append(s);return;}
      for(const item of items){const s=document.createElement('span');s.textContent=item.token;box.append(s);}
    };
    render('conceptA',data.left?.learnedConcepts);render('conceptB',data.right?.learnedConcepts);
    $('corpus').textContent='学習元：人間の雑談 '+Number(data.corpus?.messages||0).toLocaleString('ja-JP')+'発言 / 返答ペア '+Number(data.corpus?.pairs||0).toLocaleString('ja-JP')+'組 / 学習表現 '+Number(data.corpus?.vocab||0).toLocaleString('ja-JP');
    $('result').hidden=false;$('result').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(err){toast(err.message);}
  finally{$('compare').disabled=false;$('compare').textContent='意味の近さを比べる';}
}
$('compare').onclick=compare;
for(const id of ['a','b'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();compare();}});
})();