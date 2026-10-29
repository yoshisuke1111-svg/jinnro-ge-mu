/* Offline adapter. All state remains in this tab. Same rules and CPU as the server. */
window.WWTransport = {
  offline:true,
  create(handlers){
    let game=null,pid='you',timer=null,lastRevision=-1;
    function emit(){
      if(game?.byId(pid)){lastRevision=game.revision;handlers.onState(game.view(pid));}
    }
    function stop(){clearInterval(timer);timer=null;}
    return {
      async request(event,data={}){
        if(event==='join')throw Error('このHTMLはソロ練習専用です。友達との対戦はオンライン版を起動してください。');
        if(event==='create'){
          stop();
          const seed=crypto.getRandomValues(new Uint32Array(1))[0];
          game=new WW.Game({code:'SOLO',seed});game.addPlayer({id:pid,name:data.name});
          game.prepareSolo(data.role??'seer',8);emit();handlers.onStatus('offline');
          timer=setInterval(()=>{
            try{
              game.tick(WWBots);
              if(!game.byId(pid)){stop();handlers.onRemoved('待機室で75秒間操作がなかったため退出しました。入り直せます。');return;}
              if(lastRevision!==game.revision)emit();
            }catch(e){console.error(e);handlers.onError(e.message);}
          },250);
          return {ok:true,code:'SOLO',token:'local-only',playerId:pid};
        }
        if(!game)throw Error('まず名前を入力して参加してください。');
        game.command(pid,event,data,WWBots);emit();return {ok:true};
      },
      stop
    };
  }
};
