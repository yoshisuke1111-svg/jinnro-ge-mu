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
    .collapse-fall #room{animation:none!important;transform:none!important;filter:none!important}
    .collapse-fragment{transform-origin:center top!important;backface-visibility:hidden}
    .collapse-fall .collapse-fragment{
      animation:collapse-topdown-piece 1.05s cubic-bezier(.42,.02,.88,.4) var(--fall-delay,0ms) forwards!important;
      filter:none!important;
      will-change:transform,opacity!important
    }
    .room-collapse-fx .collapse-noise{
      animation:none!important;
      mix-blend-mode:normal!important;
      opacity:.045!important;
      background:linear-gradient(180deg,#0000 0,#1112 44%,#0003 100%)!important
    }
    @keyframes collapse-topdown-piece{
      0%{transform:translate3d(0,0,0) rotate(0);opacity:1}
      10%{transform:translate3d(0,3px,0) rotate(.4deg);opacity:1}
      24%{transform:translate3d(calc(var(--fall-x,0px) * .08),10px,0) rotate(calc(var(--fall-r,0deg) * .08));opacity:1}
      100%{transform:translate3d(var(--fall-x,0px),118vh,0) rotate(var(--fall-r,0deg));opacity:.03}
    }
    @media(max-width:700px){
      .room-collapse-fx .collapse-noise{display:none!important}
      .collapse-fall .collapse-fragment{animation-duration:.92s!important}
    }
  `;
  document.head.append(style);
})();

window.WWTransport = {
  offline:false,
  create(handlers){
    let auth=null,source=null,reconnectTimer=null,closed=false,reconnecting=false;
    let pendingState=null,stateTimer=null,lastStateAt=0;
    const flushState=()=>{
      stateTimer=null;
      if(!pendingState||closed)return;
      const value=pendingState;pendingState=null;lastStateAt=performance.now();handlers.onState(value);
    };
    function deliverState(value,immediate=false){
      pendingState=value;
      if(immediate){if(stateTimer){clearTimeout(stateTimer);stateTimer=null;}flushState();return;}
      if(stateTimer)return;
      const gap=document.hidden?1800:260,delay=Math.max(0,gap-(performance.now()-lastStateAt));
      stateTimer=setTimeout(flushState,delay);
    }
    const onVisibility=()=>{if(!document.hidden&&pendingState)deliverState(pendingState,true);};
    document.addEventListener('visibilitychange',onVisibility);
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
      if(res.state)deliverState(res.state,true);
      source=new EventSource('/events?ticket='+encodeURIComponent(res.ticket));
      source.onopen=()=>{reconnecting=false;handlers.onStatus('connected');};
      source.addEventListener('state',event=>{try{deliverState(JSON.parse(event.data));}catch(e){console.error(e);}});
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
    function stop(){
      closed=true;source?.close();source=null;clearTimeout(reconnectTimer);clearTimeout(stateTimer);stateTimer=null;pendingState=null;
      document.removeEventListener('visibilitychange',onVisibility);handlers.onStatus('disconnected');
    }
    return {
      async request(event,data={}){
        const creds=(event==='create')?null:event==='join'?{code:data.code||auth?.code,token:data.token||auth?.token}:auth;
        const res=await post(event,data,creds);
        if(event==='create'||event==='join')attach(res);
        else if(res.state)deliverState(res.state,true);
        return res;
      },
      stop
    };
  }
};
