/* Online transport: POST commands + one-use-ticket SSE; no CDN or client dependency. */
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
