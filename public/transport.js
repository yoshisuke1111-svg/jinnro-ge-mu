/* Online transport: POST commands + one-use-ticket SSE; no CDN or client dependency. */
(()=>{
  const collapseSelector='.panel,button,input,select,h1,h2,h3,p,.room-code-label,.tag,.mini-label,.board-player,.message,.records-panel,.room-heading>*';
  const nativeQuery=Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll=function(selector){
    const result=nativeQuery.call(this,selector);
    if(this.id!=='room'||selector!==collapseSelector)return result;
    const all=[...result],preferred=all.filter(element=>element.matches('.panel,.room-heading>*,.phase-bar,.records-panel,.mobile-nav,.board-player,.message'));
    const source=preferred.length?preferred:all,max=matchMedia('(max-width:700px)').matches?14:28,stride=Math.max(1,Math.ceil(source.length/max));
    return source.filter((_,index)=>index%stride===0).slice(0,max);
  };
  const style=document.createElement('style');style.id='collapse-performance-fix';
  style.textContent=`
    .collapse-glitch #room{animation:collapse-lite-shake .11s steps(2,end) 5!important;filter:none!important}
    .collapse-fragment,.collapse-fly .collapse-fragment,.collapse-freeze .collapse-fragment,.collapse-fall .collapse-fragment{animation:none!important;filter:none!important;will-change:auto!important;transform:none!important}
    .collapse-fly #room{animation:collapse-lite-shake .12s steps(2,end) 6!important}
    .collapse-freeze #room{animation:none!important;transform:translate3d(0,-3px,0) scale(.995)!important}
    .collapse-fall #room{animation:collapse-lite-fall .82s cubic-bezier(.55,.02,.9,.42) forwards!important}
    .room-collapse-fx .collapse-noise{animation:none!important;mix-blend-mode:normal!important;opacity:.055!important;background:linear-gradient(105deg,#ef405016,#0000 34%,#40c8ef12 67%,#0000)!important}
    .room-collapse-fx .collapse-warning{animation:collapse-lite-title .16s steps(2,end) 7!important}
    @keyframes collapse-lite-shake{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(3px,-2px,0)}}
    @keyframes collapse-lite-fall{0%{transform:translate3d(0,-3px,0) scale(.995);opacity:1}100%{transform:translate3d(0,115vh,0) rotate(2deg);opacity:.06}}
    @keyframes collapse-lite-title{0%,100%{transform:translate(-50%,-50%)}50%{transform:translate(calc(-50% + 3px),calc(-50% - 2px))}}
    @media(max-width:700px){.room-collapse-fx .collapse-noise{display:none!important}.collapse-glitch #room,.collapse-fly #room{animation:collapse-lite-shake .14s steps(2,end) 3!important}}
  `;
  document.head.append(style);
})();

window.WWTransport = {
  offline:false,
  create(handlers){
    let auth=null,source=null,reconnectTimer=null,closed=false,reconnecting=false;
    async function post(event,data={},credentials=auth){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
      try{
        const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
          body:JSON.stringify({event,code:credentials?.code||data.code,token:credentials?.token||data.token,data}),signal:controller.signal});
        const res=await response.json();
        if(!res.ok)throw Error(res.error||'操作に失敗しました。');
        return res;
      }catch(e){if(e.name==='AbortError')throw Error('サーバーに接続できません。接続を確認してください。');throw e;}
      finally{clearTimeout(timer);}
    }
    function attach(res){
      if(source){source.close();source=null;}
      auth={code:res.code,token:res.token};closed=false;
      if(res.state)handlers.onState(res.state);
      source=new EventSource('/events?ticket='+encodeURIComponent(res.ticket));
      source.onopen=()=>{reconnecting=false;handlers.onStatus('connected');};
      source.addEventListener('state',event=>{try{handlers.onState(JSON.parse(event.data));}catch(e){console.error(e);}});
      source.addEventListener('removed',event=>{stop();handlers.onRemoved(JSON.parse(event.data).message);});
      source.addEventListener('replaced',event=>{stop();handlers.onRemoved(JSON.parse(event.data).message);});
      source.addEventListener('room_collapse',event=>{
        let payload={};try{payload=JSON.parse(event.data)||{};}catch{}
        stop();handlers.onRoomCollapse?.(payload);
      });
      source.onerror=()=>{
        source?.close();if(closed)return;handlers.onStatus('reconnecting');
        clearTimeout(reconnectTimer);
        reconnectTimer=setTimeout(async()=>{
          if(closed||reconnecting)return;reconnecting=true;
          try{const r=await post('join',{},auth);attach(r);}
          catch(e){reconnecting=false;handlers.onStatus('reconnecting');handlers.onError(e.message);reconnectTimer=setTimeout(retry,4000);}
        },1500);
      };
    }
    async function retry(){
      if(closed)return;
      try{attach(await post('join',{},auth));}
      catch(e){handlers.onError(e.message);reconnectTimer=setTimeout(retry,5000);}
    }
    function stop(){closed=true;source?.close();source=null;clearTimeout(reconnectTimer);handlers.onStatus('disconnected');}
    return {
      async request(event,data={}){
        const creds=(event==='create')?null:event==='join'?{code:data.code||auth?.code,token:data.token||auth?.token}:auth;
        const res=await post(event,data,creds);
        if(event==='create'||event==='join')attach(res);
        else if(res.state)handlers.onState(res.state);
        return res;
      },
      stop
    };
  }
};
