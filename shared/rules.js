/* Shared authoritative rules. No DOM, sockets, timers or hidden-state access from bots.
 * In online play this runs on the server. The standalone practice build uses the SAME engine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WW = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ROLES = {
    villager: { name:'村人', team:'village', icon:'◇', text:'特別な夜能力はありません。発言・占いの主張・投票履歴から人狼を探します。', win:'人狼と黒狼を全滅させる。第三陣営の優先勝利に注意。' },
    seer: { name:'占い師', team:'village', icon:'✧', text:'毎晩1人を占います。「人狼」か「人狼ではない」の二択。黒狼・狂人・狂信者は白。妖狐を占うと夜明けに呪殺します。', win:'村人陣営と同じ。' },
    medium: { name:'霊媒師', team:'village', icon:'◉', text:'次の夜の開始時に、直前の投票で処刑された人の判定を自動で受け取ります。人狼・黒狼は黒、それ以外は白。対象選択はありません。', win:'村人陣営と同じ。' },
    guard: { name:'騎士', team:'village', icon:'♜', text:'毎晩、自分以外の生存者1人を人狼の襲撃から守ります。連続護衛は可能。占いによる呪殺・道連れ・後追いは防げません。', win:'村人陣営と同じ。' },
    baker: { name:'パン屋', team:'village', icon:'♧', text:'生存していれば朝に「パンが届きました」と告知されます。誰がパン屋かは公開されません。', win:'村人陣営と同じ。' },
    cat: { name:'猫又', team:'village', icon:'♤', text:'人狼の襲撃で死ぬと襲撃先に投票した人狼1人を道連れにします。投票処刑なら生存者1人をランダムに道連れに。後追い・道連れでは能力は発動しません。', win:'村人陣営と同じ。' },
    mason: { name:'共有者', team:'village', icon:'∞', text:'開始時に他の共有者を知ることができます。2人以上で設定します。恋人が付いた共有者は恋人勝利を目指します。', win:'村人陣営と同じ。恋人になった場合は恋人勝利。' },
    wolf: { name:'人狼', team:'wolves', icon:'☾', text:'仲間の人狼・黒狼を知り、夜の専用チャットで相談できます。各自が襲撃先を確定し、多数決で毎晩1人を襲撃。同票はランダムです。', win:'生存する人狼＋黒狼が、それ以外の生存者以上になる。' },
    darkwolf: { name:'黒狼', team:'wolves', icon:'☽', text:'占いでは「人狼ではない」と判定される人狼です。霊媒では人狼。人狼の人数・夜の会話・襲撃投票に含まれます。', win:'人狼陣営と同じ。' },
    madman: { name:'狂人', team:'wolves', icon:'♢', text:'人狼の味方ですが、人狼が誰かは知りません。占い・霊媒とも白。襲撃能力はなく、勝敗の人数計算では人狼以外に数えます。', win:'人狼陣営の勝利。死亡していてもよい。' },
    fanatic: { name:'狂信者', team:'wolves', icon:'♧', text:'人狼・黒狼の名前を最初から知っています。人狼側からは狂信者の正体は分かりません。夜の人狼チャットには入れません。判定は白。', win:'人狼陣営と同じ。' },
    fox: { name:'妖狐', team:'third', icon:'♆', text:'人狼の襲撃では死にません。占われると夜明けに死亡します。占い・霊媒の表示は白。通常決着時に生存していれば勝利を奪います。', win:'通常決着時に生存。恋人ペアの優先勝利には負けます。' },
    jester: { name:'てるてる坊主', team:'third', icon:'♙', text:'昼の投票で直接処刑されると、その場で単独勝利します。襲撃・道連れ・後追いでは勝てません。', win:'自分が投票で直接処刑される。' },
    plague: { name:'疫病神', team:'third', icon:'✣', text:'毎晩、自分以外の未感染者1人を感染させます。感染は本人以外には見えず、能力を妨げません。', win:'自分が生きていて、他の生存者全員が感染した時に単独勝利。' },
    survivor: { name:'生存者', team:'third', icon:'△', text:'夜能力はありません。村人や人狼に固執せず、生き残ることを目指します。', win:'通常決着・恋人勝利・妖狐勝利の時に生存していれば追加勝利。てるてる坊主・疫病神の単独勝利時は不可。' },
    avenger: { name:'復讐者', team:'third', icon:'⚑', text:'開始時に復讐対象が1人指定されます。その人を昼の投票で直接処刑させることを目指します。対象が襲撃・道連れで死んでも達成にはなりません。', win:'対象の投票処刑を達成していれば通常決着時に追加勝利。達成後に自分が死んでも有効。単独勝利が発生した時は不可。' },
    thief: { name:'泥棒', team:'third', icon:'♜', text:'夜に1度だけ、生存者1人から役職そのものを奪います。奪われた相手は村人になり、自分は奪った役職と陣営へ移ります。', win:'奪った役職の勝利条件を引き継ぐ。盗まずに終わった場合は勝利なし。' },
    grave_robber: { name:'墓荒らし', team:'third', icon:'†', text:'夜に1度だけ、死亡者1人の役職を奪います。墓を荒らされた死者は村人扱いになり、自分は奪った役職と陣営へ移ります。', win:'奪った役職の勝利条件を引き継ぐ。盗まずに終わった場合は勝利なし。' },
    cheater: { name:'チーター', team:'third', icon:'⌁', text:'全員の本当の役職が見え、夜に人狼陣営以外を1人殺害できます。処刑を1回、人狼の通常襲撃を1回の両方を受けるまで死亡しません。生存中は占い結果をチーター判定へ改変し、他陣営の勝利を止めます。', win:'自分が生存し、人狼陣営以外の他プレイヤーが全滅する。' },
    resetter: { name:'リセッター', team:'third', icon:'↶', text:'ゲーム中1回だけ、夜に直前の朝まで時間を巻き戻せます。死亡・投票・役職変化などが朝の状態へ戻り、リセッター自身だけ巻き戻し前を経験したまま残ります。', win:'通常決着時に生存していれば追加勝利。' },
    white_leveler: { name:'白レベラー', team:'village', icon:'⬆', text:'一夜明けるたびに成長する村人陣営。Lv2完全占い、Lv3聖職者進化（護衛・蘇生・浄化）、Lv4二重占い、Lv5不死、Lv6名前消失、Lv7で生存中の黒レベラーと相打ち。', win:'村人陣営と同じ。' },
    black_leveler: { name:'黒レベラー', team:'wolves', icon:'⬆', text:'一夜明けるたびに成長する人狼陣営。Lv2人狼を匿う、Lv3人狼植え付け、Lv4一晩に2人を殺害、Lv5不死、Lv6名前消失、Lv7で生存中の白レベラーと相打ち。', win:'人狼陣営と同じ。' }
  };
  const LOVER = { name:'恋人', icon:'♡', text:'基本役職とは別に2人へ付く追加状態です。相方の名前だけ分かり、能力は元の役職のまま。一方が死ぬともう一方も後追いします。元の陣営勝利を失い、通常決着時に2人とも生きていれば最優先で恋人勝利となります。' };
  const WOLF = new Set(['wolf','darkwolf']);
  const PACK = new Set(['wolf','darkwolf','black_leveler']);
  const LEVELER = new Set(['white_leveler','black_leveler']);
  const ROLE_IDS = Object.keys(ROLES);
  const MAX_PLAYERS = 30;
  const MIN_PLAYERS = 4;
  const PHASES = {lobby:'待機室',reveal:'役職確認',night:'夜の行動',dawn:'夜明け',discussion:'昼の話し合い',vote:'投票',execution:'投票結果',ended:'ゲーム終了'};
  const DEFAULT_TIMES = {reveal:20, night:30, other:20, dawn:8, discussion:120, vote:30, execution:8};
  const BOT_NAMES = ['アオイ','シオン','ミオ','レン','ユズ','カナタ','ナギ','ハル','スイ','ツキ','アキ','リク','コハク','イオ','ソラ','ヒナ','トワ','アサヒ','サク','リン','ノア','カイ','セナ','メイ','イズミ','リオ','フウ','チセ','ルカ','ミナト'];
  const emptyRoles = () => Object.fromEntries(ROLE_IDS.map(k=>[k,0]));
  function preset(n, kind='basic') {
    const r=emptyRoles(); r.wolf=Math.max(1,Math.floor(n/4)); r.seer=1;
    if(n>=5)r.guard=1; if(n>=7)r.medium=1; if(n>=8)r.madman=1;
    if(kind==='third' && n>=10) {r.fox=1;r.jester=1;r.baker=1;}
    if(kind==='all' && n>=20) {
      for(const k of ROLE_IDS.filter(k=>!['thief','grave_robber','cheater','resetter','white_leveler','black_leveler'].includes(k)))r[k]=1;
      r.mason=2; r.wolf=Math.max(2,Math.floor(n/6));
    }
    r.villager += n-Object.values(r).reduce((a,b)=>a+b,0);
    return r;
  }
  function checkConfig(config, n) {
    const errors=[];
    if(n<MIN_PLAYERS||n>MAX_PLAYERS)errors.push(`合計${MIN_PLAYERS}〜${MAX_PLAYERS}人にしてください。1人の場合はCPUを追加できます。`);
    const r=config.roles||{};
    for(const k of ROLE_IDS) if(!Number.isInteger(r[k])||r[k]<0||r[k]>MAX_PLAYERS)errors.push(`${ROLES[k].name}の人数が不正です。`);
    if(Object.keys(r).some(k=>!ROLE_IDS.includes(k)))errors.push('不明な役職が含まれています。');
    if(Object.values(r).reduce((a,b)=>a+b,0)!==n)errors.push('役職の合計と参加人数を一致させてください。');
    const w=(r.wolf||0)+(r.darkwolf||0);
    if(w<1)errors.push('人狼か黒狼を1人以上入れてください。');
    if(w>=n-w)errors.push('開始直後に決着しないよう、人狼＋黒狼は半数未満にしてください。');
    if(r.mason===1)errors.push('共有者は0人か2人以上にしてください。');
    for(const k of ['fox','jester','plague','avenger','thief','grave_robber','cheater','resetter','white_leveler','black_leveler'])if(r[k]>1)errors.push(`${ROLES[k].name}は1人までです。`);
    if((r.white_leveler||0)!==(r.black_leveler||0))errors.push('白レベラーと黒レベラーは必ず1人ずつセットで入れてください。');
    if(config.lovers&&n<6)errors.push('恋人は合計6人以上の部屋で使えます。');
    for(const [k,min,max] of [['reveal',3,60],['night',5,120],['other',3,120],['dawn',2,20],['discussion',10,600],['vote',5,120],['execution',2,20]]) {
      const v=config.times?.[k];if(!Number.isInteger(v)||v<min||v>max)errors.push(`${PHASES[k]||'その他の能力'}の時間は${min}〜${max}秒です。`);
    }
    if(config.times?.other>config.times?.night)errors.push('その他の能力の締切は夜全体の締切以下にしてください。');
    return errors;
  }
  function seeded(seed) {let s=seed>>>0;return ()=>{s+=0x6D2B79F5;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
  const clone=o=>JSON.parse(JSON.stringify(o));
  const cleanName=s=>String(s||'').normalize('NFC').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').trim();
  function validName(s) {s=cleanName(s);if([...s].length<1||[...s].length>16)throw Error('名前は1〜16文字で入力してください。');return s;}
  function cleanText(s) {return String(s||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').trim().slice(0,400);}

  const PERSONALITY_LABELS={casual:'くだけた話し方',soft:'やわらかい話し方',polite:'丁寧な話し方',blunt:'短く率直',analytical:'理屈っぽい'};

  class Game {
    constructor({code='SOLO',seed=Date.now(),random=null,now=()=>Date.now()}={}) {
      this.code=code;this.random=random||seeded(seed);this.now=now;this.players=[];this.host=null;
      this.config={roles:preset(8),times:{...DEFAULT_TIMES},lovers:false,firstNightSafe:true,testRole:''};
      this.configVersion=1;this.phase='lobby';this.phaseId=0;this.day=0;this.startedAt=0;this.deadline=null;
      this.messages=[];this.msgId=0;this.revision=0;this.actions={};this.specialActions={};this.votes={};this.ready=new Set();
      this.reports=[];this.claims=[];this.voteHistory=[];this.winner=null;this.pendingWin=null;
      this.lastScene=null;this.sceneId=0;this.lastExecuted=null;this.infected=new Set();this.round=0;this.dawnSnapshot=null;this.hiddenWolves=new Set();
      this.botTalkAt=0;this.botDiscussionTalks=0;this.wolfTalkAt=0;this.wolfTalkCount=0;this.wasBakerAlive=false;this.createdAt=now();this.changed();
    }
    changed(){this.revision++;}
    pick(a){return a.length?a[Math.floor(this.random()*a.length)]:null;}
    shuffled(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
    makePersonality(id='cpu'){
      const tones=['casual','soft','soft','casual','blunt','analytical','polite'];
      let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}h>>>=0;
      const tone=tones[h%tones.length],sociability=(h>>>3)%3,confidence=(h>>>7)%3,verbosity=(h>>>11)%3;
      const suspicion=(h>>>14)%3,reactivity=(h>>>17)%3,humor=(h>>>20)%3,tempo=(h>>>23)%3;
      return {tone,label:PERSONALITY_LABELS[tone],sociability,confidence,verbosity,suspicion,reactivity,humor,tempo};
    }
    byId(id){return this.players.find(p=>p.id===id);}
    living(){return this.players.filter(p=>p.alive);}
    humans(){return this.players.filter(p=>!p.bot);}
    isSolo(){return this.humans().length===1;}
    name(id){
      const p=this.byId(id);
      if(!p)return '不明';
      return LEVELER.has(p.role)&&(p.levelerLevel||0)>=6&&p.alive?'？？？':p.name;
    }
    realName(id){return this.byId(id)?.name||'不明';}
    roleState(p){return {levelerLevel:p.levelerLevel||0,cheaterExecutionHit:!!p.cheaterExecutionHit,cheaterAttackHit:!!p.cheaterAttackHit,resetUsed:!!p.resetUsed,implantedFrom:p.implantedFrom||null};}
    clearRoleState(p){p.levelerLevel=0;p.cheaterExecutionHit=false;p.cheaterAttackHit=false;p.resetUsed=false;p.implantedFrom=null;}
    giveRole(p,role,state={}){
      this.clearRoleState(p);p.role=role;
      if(LEVELER.has(role))p.levelerLevel=Math.max(1,Number(state.levelerLevel)||1);
      if(role==='cheater'){p.cheaterExecutionHit=!!state.cheaterExecutionHit;p.cheaterAttackHit=!!state.cheaterAttackHit;}
      if(role==='resetter')p.resetUsed=!!state.resetUsed;
      p.implantedFrom=state.implantedFrom||null;
    }
    stealRole(taker,donor){
      const role=donor.role,state=this.roleState(donor);
      this.giveRole(taker,role,state);this.giveRole(donor,'villager');
      taker.privateResults.push({id:'role-steal-'+this.phaseId+'-'+taker.id,kind:'notice',day:this.day,text:donor.name+'から「'+ROLES[role].name+'」を奪いました。以後はその役職と陣営になります。'});
      donor.privateResults.push({id:'role-lost-'+this.phaseId+'-'+donor.id,kind:'notice',day:this.day,text:'役職を奪われ、村人になりました。'});
    }
    system(text){this.message(null,text,'system');}
    message(p,text,channel='public',meta=null) {
      const m={id:++this.msgId,day:this.day,phase:this.phase,at:this.now(),playerId:p?.id||null,name:p?.name||'村の記録',channel,text:cleanText(text)};
      if(meta)m.meta=clone(meta);
      this.messages.push(m);if(this.messages.length>1800)this.messages.splice(0,200);
      this.changed();return m;
    }
    addPlayer({id,name,bot=false}) {
      if(this.phase!=='lobby')throw Error('対戦中は新規参加できません。');
      if(this.players.length>=MAX_PLAYERS)throw Error('満員です。');
      name=validName(name);if(this.players.some(p=>p.name===name))throw Error('同じ名前の人がいます。別の名前にしてください。');
      if(!id||this.byId(id))throw Error('プレイヤーIDが不正です。');
      const p={id,name,bot,connected:true,alive:true,role:null,lastActive:this.now(),disconnectedAt:null,auto:false,
        privateResults:[],lover:null,revengeTarget:null,revengeDone:false,brain:bot?{personality:this.makePersonality(id)}:{},deathAt:null,claimed:null,
        levelerLevel:0,cheaterExecutionHit:false,cheaterAttackHit:false,resetUsed:false,implantedFrom:null};
      this.players.push(p);if(!this.host&&!bot)this.host=id;
      if(this.humans().length>1)this.config.testRole='';
      this.changed();return p;
    }
    removePlayer(id) {
      const p=this.byId(id);if(!p)return;
      if(this.phase!=='lobby')throw Error('ゲーム中の席は削除できません。');
      this.players=this.players.filter(p=>p.id!==id);
      if(this.host===id)this.host=this.humans().find(p=>p.connected)?.id||this.humans()[0]?.id||null;
      this.configVersion++;this.system(`${p.name}が待機室を退出しました。`);
    }
    setBots(count) {
      if(!Number.isInteger(count)||count<0||count>MAX_PLAYERS-this.humans().length)throw Error('CPUの人数が不正です。');
      if(this.phase!=='lobby')throw Error('CPUの変更は待機室で行ってください。');
      const old=this.players.filter(p=>p.bot);
      if(old.length>count){const ids=new Set(old.slice(count).map(p=>p.id));this.players=this.players.filter(p=>!ids.has(p.id));}
      for(let i=old.length;i<count;i++){
        let name=BOT_NAMES[i]||`村人${i+1}`;let suffix=2;
        while(this.players.some(p=>p.name===name))name=(BOT_NAMES[i]||'CPU')+suffix++;
        this.addPlayer({id:`cpu-${this.code}-${i}-${Math.floor(this.random()*1e9)}`,name,bot:true});
      }
      if(this.players.length>=MIN_PLAYERS)this.config.roles=preset(this.players.length);
      this.config.testRole='';this.configVersion++;this.changed();
    }
    applyConfig(input) {
      if(this.phase!=='lobby')throw Error('設定は待機室で変更してください。');
      const c={roles:{},times:{},lovers:input?.lovers===true,firstNightSafe:input?.firstNightSafe!==false,testRole:String(input?.testRole||'')};
      for(const k of ROLE_IDS)c.roles[k]=Number(input?.roles?.[k]);
      for(const k of Object.keys(DEFAULT_TIMES))c.times[k]=Number(input?.times?.[k]??DEFAULT_TIMES[k]);
      const errors=checkConfig(c,this.players.length);
      if(c.testRole&&!ROLE_IDS.includes(c.testRole)&&c.testRole!=='lover')errors.push('練習役職が不正です。');
      if(c.testRole&&!this.isSolo())errors.push('役職を指定できるのは人間が1人の練習時だけです。');
      if(c.testRole&&c.testRole!=='lover'&&!c.roles[c.testRole])errors.push('練習する役職を配役に入れてください。');
      if(c.testRole==='lover'&&(!c.lovers||!c.roles.villager))errors.push('恋人の練習には恋人ONと村人1人以上が必要です。');
      if(errors.length)throw Error(errors.join('\n'));
      this.config=c;this.configVersion++;this.changed();
    }
    prepareSolo(role='seer',n=8) {
      if(!this.isSolo()||this.phase!=='lobby')throw Error('ソロ練習用の操作です。');
      if(!ROLE_IDS.includes(role)&&role!==''&&role!=='lover')throw Error('不明な練習役職です。');
      this.setBots(n-1);
      const r=preset(n);
      if(role&&role!=='lover'&&!r[role]) {
        if(role==='mason'){r.mason=2;r.villager-=2;}else{r[role]=1;r.villager--;}
      }
      this.applyConfig({...this.config,roles:r,lovers:role==='lover',testRole:role});
    }
    touch(id) {const p=this.byId(id);if(p){p.lastActive=this.now();if(this.phase==='lobby')this.changed();}}
    connect(id) {
      const p=this.byId(id);if(!p)throw Error('席が見つかりません。');
      p.connected=true;p.disconnectedAt=null;p.lastActive=this.now();
      if(this.phase==='lobby'||this.phase==='ended')p.auto=false;
      // A proxy that already acted keeps its action. Control returns at the next phase boundary.
      this.changed();
    }
    disconnect(id) {const p=this.byId(id);if(p&&!p.bot){p.connected=false;p.disconnectedAt=this.now();this.changed();}}
    beginPhase(phase) {
      this.phase=phase;this.phaseId++;this.startedAt=this.now();this.deadline=phase==='ended'||phase==='lobby'?null:this.startedAt+this.config.times[phase]*1000;
      this.ready=new Set();
      for(const p of this.players){
        if(!p.bot&&p.connected)p.auto=false;
        p.brain.phaseId=this.phaseId;p.brain.talks=0;p.brain.nightSaid=false;
        p.brain.replyMessageId=null;p.brain.replyAt=0;p.brain.lastSeenPublicId=this.msgId;
        const social=p.brain.personality?.sociability??1,tempo=p.brain.personality?.tempo??1;
        p.brain.nextTalk=this.startedAt+3000+(2-social)*1900+(2-tempo)*900+Math.floor(this.random()*(6200+(2-social)*1700));
        p.brain.actionAt=this.startedAt+2600+(2-tempo)*800+Math.floor(this.random()*5200);
      }
      this.botDiscussionTalks=0;this.botTalkAt=this.startedAt+4000+Math.floor(this.random()*2500);
      this.wolfTalkCount=0;this.wolfTalkAt=this.startedAt+1800+Math.floor(this.random()*1800);
      this.changed();
    }
    start({allowBotOnly=false}={}) {
      if(this.phase!=='lobby')throw Error('すでに開始しています。');
      const e=checkConfig(this.config,this.players.length);if(e.length)throw Error(e.join('\n'));
      if(!this.humans().length&&!allowBotOnly)throw Error('人間が1人以上必要です。');
      if(this.config.testRole&&!this.isSolo())throw Error('複数人では役職指定は使えません。');
      this.messages=[];this.msgId=0;this.reports=[];this.claims=[];this.voteHistory=[];
      this.infected=new Set();this.lastExecuted=null;this.winner=null;this.pendingWin=null;this.lastScene=null;
      this.day=1;this.round=0;this.actions={};this.specialActions={};this.votes={};this.dawnSnapshot=null;this.hiddenWolves=new Set();
      let deck=ROLE_IDS.flatMap(k=>Array(this.config.roles[k]).fill(k));
      const pinned=this.isSolo()?this.config.testRole:'';
      const human=this.humans()[0];
      if(pinned){const role=pinned==='lover'?'villager':pinned;const i=deck.indexOf(role);if(i<0)throw Error('指定した役職がありません。');deck.splice(i,1);human.role=role;}
      deck=this.shuffled(deck);
      for(const p of this.players){
        if(!(pinned&&p.id===human.id))p.role=deck.pop();
        p.alive=true;p.privateResults=[];p.lover=null;p.revengeTarget=null;p.revengeDone=false;p.auto=!p.connected;
        const personality=p.bot?(p.brain?.personality||this.makePersonality(p.id)):null;p.brain=personality?{personality}:{};p.deathAt=null;p.claimed=null;p.implantedFrom=null;
        p.levelerLevel=LEVELER.has(p.role)?1:0;p.cheaterExecutionHit=false;p.cheaterAttackHit=false;p.resetUsed=false;
      }
      if(this.config.lovers){
        const a=pinned==='lover'?human:this.pick(this.players);
        const b=this.pick(this.players.filter(p=>p.id!==a.id));a.lover=b.id;b.lover=a.id;
      }
      for(const p of this.players.filter(p=>p.role==='avenger'))p.revengeTarget=this.pick(this.players.filter(x=>x.id!==p.id&&x.id!==p.lover))?.id||null;
      this.wasBakerAlive=this.players.some(p=>p.role==='baker');
      this.beginPhase('reveal');
      this.system(`ゲームを開始します。役職を確認してください。${this.config.times.reveal}秒後に自動で夜へ進みます。`);
      if(pinned)this.system('ソロ練習：あなたの役職を指定しています。複数人では役職指定は使えません。');
    }
    reset() {
      if(this.phase!=='ended')throw Error('終了後に待機室へ戻れます。');
      for(const p of this.players){p.role=null;p.alive=true;p.lover=null;p.brain={};p.auto=false;p.privateResults=[];p.lastActive=this.now();p.claimed=null;p.levelerLevel=0;p.cheaterExecutionHit=false;p.cheaterAttackHit=false;p.resetUsed=false;p.implantedFrom=null;}
      this.messages=[];this.msgId=0;this.day=0;this.winner=null;this.pendingWin=null;this.lastScene=null;this.actions={};this.specialActions={};this.votes={};this.reports=[];this.claims=[];this.voteHistory=[];this.dawnSnapshot=null;this.hiddenWolves=new Set();
      this.beginPhase('lobby');this.configVersion++;this.system('新しいゲームを準備できます。');
    }
    requireTurn(turn) {if(turn!==undefined&&turn!==this.phaseId)throw Error('画面が次のフェーズに進みました。表示を確認してください。');}
    requirePlayer(id,alive=false) {const p=this.byId(id);if(!p)throw Error('参加してください。');if(alive&&!p.alive)throw Error('幽霊は行動できません。');return p;}
    nightKind(p) {
      if(!p.alive)return null;
      if(WOLF.has(p.role))return this.day===1&&this.config.firstNightSafe?'meet':'attack';
      return ({seer:'divine',guard:'protect',plague:'infect'})[p.role]||null;
    }
    specialKinds(p){
      if(!p?.alive)return [];const out=[];
      if(p.role==='thief')out.push('steal_live');
      if(p.role==='grave_robber')out.push('steal_dead');
      if(p.role==='cheater')out.push('cheat_kill');
      if(p.role==='resetter'&&!p.resetUsed&&this.dawnSnapshot)out.push('reset');
      if(p.role==='white_leveler'){
        const lv=p.levelerLevel||1;if(lv>=2)out.push('leveler_divine');if(lv>=3)out.push('priest');
      }
      if(p.role==='black_leveler'){
        const lv=p.levelerLevel||1;if(lv>=2)out.push('hide_wolf');if(lv>=3)out.push('implant_wolf');if(lv>=4)out.push('leveler_kill');
      }
      return out;
    }
    specialLimit(p,kind){
      if(kind==='leveler_divine')return (p.levelerLevel||1)>=4?2:1;
      if(kind==='leveler_kill')return 2;
      return 1;
    }
    specialTargets(p,kind){
      if(kind==='reset')return [];
      if(kind==='steal_dead')return this.players.filter(t=>!t.alive&&t.id!==p.id).map(t=>t.id);
      if(kind==='priest_revive')return this.players.filter(t=>!t.alive).map(t=>t.id);
      return this.living().filter(t=>{
        if(t.id===p.id)return false;
        if(kind==='hide_wolf')return PACK.has(t.role);
        if(kind==='implant_wolf')return ROLES[t.role]?.team!=='wolves'&&t.role!=='cheater';
        if(kind==='cheat_kill')return ROLES[t.role]?.team!=='wolves';
        if(kind==='priest_purify')return t.role!=='black_leveler'&&(!!t.implantedFrom||WOLF.has(t.role));
        return true;
      }).map(t=>t.id);
    }
    specialCount(id,kind){return (this.specialActions[id]?.[kind]||[]).length;}
    submitSpecialAction(id,kind,target=null,mode=null,turn){
      this.requireTurn(turn);const p=this.requirePlayer(id,true);
      if(this.phase!=='night')throw Error('特殊能力は夜だけ使えます。');
      const available=this.specialKinds(p);
      if(kind==='priest'){
        if(!available.includes('priest'))throw Error('聖職者能力はまだ使えません。');
        kind=String(mode||'');if(!['priest_protect','priest_revive','priest_purify'].includes(kind))throw Error('聖職者能力を選んでください。');
        if(Object.keys(this.specialActions[id]||{}).some(k=>k.startsWith('priest_')))throw Error('聖職者能力は一晩に1つです。');
      }else if(!available.includes(kind))throw Error('今夜はその能力を使えません。');
      const arr=(this.specialActions[id]||(this.specialActions[id]={}))[kind]||(this.specialActions[id][kind]=[]);
      if(arr.length>=this.specialLimit(p,kind))throw Error('この能力は今夜の上限まで使っています。');
      if(kind==='reset'){arr.push(null);this.changed();return;}
      const valid=this.specialTargets(p,kind);if(!valid.includes(target))throw Error('その相手は選べません。');
      if(arr.includes(target))throw Error('同じ相手は選べません。');arr.push(target);this.changed();
    }
    actionDeadline(p) {
      const kind=this.nightKind(p);
      return this.startedAt+(kind==='protect'||kind==='infect'?this.config.times.other:this.config.times.night)*1000;
    }
    targets(p,kind=this.nightKind(p)) {
      if(!kind||kind==='meet')return [];
      return this.living().filter(t=>{
        if(t.id===p.id)return false;
        if(kind==='attack'&&PACK.has(t.role))return false;
        if(kind==='infect'&&this.infected.has(t.id))return false;
        if(kind==='vote'&&this.round>0&&!this.runoff.includes(t.id))return false;
        return true;
      }).map(t=>t.id);
    }
    submitAction(id,target,turn,automatic=false) {
      this.requireTurn(turn);const p=this.requirePlayer(id,true);
      if(this.phase!=='night'||!this.nightKind(p))throw Error('今は夜の選択がありません。');
      if(Object.hasOwn(this.actions,id))throw Error('行動は確定済みです。');
      if(!automatic&&this.now()>this.actionDeadline(p))throw Error('選択時間が終了しました。');
      const kind=this.nightKind(p),valid=this.targets(p,kind);
      if(kind==='meet')target=null;
      else if(!valid.includes(target)&&!(kind==='infect'&&valid.length===0&&target===null))throw Error('その相手は選択できません。');
      if(kind==='divine'&&p.privateResults.some(r=>r.kind==='seer'&&r.day===this.day))throw Error('占いは1日に1回だけです。');
      this.actions[id]=target;this.changed();
    }
    submitVote(id,target,turn,automatic=false) {
      this.requireTurn(turn);const p=this.requirePlayer(id,true);
      if(this.phase!=='vote')throw Error('投票時間ではありません。');
      if(Object.hasOwn(this.votes,id))throw Error('投票は確定済みです。');
      if(!automatic&&this.now()>this.deadline)throw Error('投票時間が終了しました。');
      if(target!==null&&!this.targets(p,'vote').includes(target))throw Error('その相手には投票できません。');
      this.votes[id]=target;this.changed();
    }
    markReady(id,turn) {
      this.requireTurn(turn);const p=this.requirePlayer(id);
      if(!['reveal','discussion','dawn','execution'].includes(this.phase))throw Error('このフェーズはスキップできません。');
      if(this.phase==='discussion'&&!p.alive)throw Error('幽霊は議論を終了できません。');
      this.ready.add(id);this.changed();
    }
    chat(id,text,channel='public',turn) {
      this.requireTurn(turn);const p=this.requirePlayer(id);text=cleanText(text);
      if(!text)throw Error('メッセージを入力してください。');
      if(channel==='ghost'){
        if(p.alive||['lobby','reveal','ended'].includes(this.phase))throw Error('幽霊だけの会話です。');
      } else if(channel==='wolves'){
        if(!p.alive||!WOLF.has(p.role)||this.phase!=='night')throw Error('夜の人狼だけの会話です。');
      } else {
        channel='public';
        if(!['lobby','ended','discussion','vote','dawn','execution'].includes(this.phase)||(!p.alive&&!['lobby','ended'].includes(this.phase)))throw Error('生存者への発言は今はできません。');
      }
      if(channel==='public'&&this.phase==='discussion'&&p.alive){
        const parsed=this.parseStatement(p,text);if(parsed){this.publish(id,parsed,turn,text);return;}
      }
      this.message(p,text,channel);
    }
    parseStatement(p,text) {
      let claim=null;
      for(const k of ['seer','medium','guard','mason','villager','baker','cat']){
        const name=ROLES[k].name;
        if(new RegExp(`(?:^|私は|自分は|CO[:：\\s]*)${name}(?:CO|ＣＯ|です|だよ|だ|をCO|$)|${name}(?:CO|ＣＯ)`).test(text)){claim=k;break;}
      }
      const knownClaim=claim||p.claimed;
      if(['seer','medium'].includes(knownClaim)){
        const target=this.players.filter(x=>x.id!==p.id).sort((a,b)=>b.name.length-a.name.length).find(x=>text.includes(x.name));
        if(target) {
          const after=text.slice(text.indexOf(target.name)+target.name.length);
          const white=/白|人狼では(?:ない|ありません)|人狼じゃない/.test(after);
          const black=!white&&/黒|人狼(?:です|だった|だ|でした|$)/.test(after);
          if(white||black)return {kind:'report',role:knownClaim,target:target.id,black,claim:!!claim};
        }
      }
      if(claim)return {kind:'claim',role:claim};
      const target=this.players.find(x=>x.id!==p.id&&text.includes(x.name));
      if(target&&/疑|怪し|黒寄り|投票/.test(text))return {kind:'accuse',target:target.id};
      if(target&&/白寄り|村っぽ|信用|信じ/.test(text))return {kind:'trust',target:target.id};
      if(target&&/[?？]|聞きたい|どうして|なぜ|理由/.test(text))return {kind:'question',target:target.id};
      return null;
    }
    publish(id,statement,turn,customText=null) {
      this.requireTurn(turn);const p=this.requirePlayer(id,true);
      if(this.phase!=='discussion')throw Error('主張を出せるのは昼の議論中です。');
      const s={kind:statement?.kind};let text;
      if(s.kind==='claim'){
        if(!ROLE_IDS.includes(statement.role))throw Error('役職を選んでください。');
        s.role=statement.role;p.claimed=s.role;
        this.claims.push({playerId:id,role:s.role,day:this.day});
        text=`${ROLES[s.role].name}をCOします。`;
      }else if(s.kind==='report'){
        if(!['seer','medium'].includes(statement.role))throw Error('占いか霊媒を選んでください。');
        if(!this.byId(statement.target))throw Error('対象が見つかりません。');
        s.role=statement.role;s.target=statement.target;s.black=statement.black===true;
        p.claimed=s.role;this.claims.push({playerId:id,role:s.role,day:this.day});
        this.reports.push({playerId:id,...s,day:this.day});
        text=`${ROLES[s.role].name}CO。${this.name(s.target)}は「${s.black?'人狼':'人狼ではない'}」でした。`;
      }else if(['accuse','trust','question'].includes(s.kind)){
        if(!this.byId(statement.target)||statement.target===id)throw Error('相手を選んでください。');
        s.target=statement.target;
        text=s.kind==='accuse'?`${this.name(s.target)}を疑っています。`:s.kind==='trust'?`${this.name(s.target)}は今のところ白寄りに見ています。`:`${this.name(s.target)}に理由を聞きたいです。`;
      }else throw Error('不明な主張です。');
      this.message(p,customText||text,'public',s);
    }
    startNight() {
      this.actions={};this.specialActions={};this.hiddenWolves=new Set();this.beginPhase('night');
      this.system(`${this.day}日目の夜です。能力を持つ人は対象を選んでください。全員同時進行です。${this.day===1&&this.config.firstNightSafe?'初夜は人狼の顔合わせのみで、襲撃はありません。':''}`);
      if(this.lastExecuted){
        const t=this.byId(this.lastExecuted);
        for(const p of this.living().filter(p=>p.role==='medium'))
          p.privateResults.push({id:`medium-${this.day}-${p.id}`,kind:'medium',day:this.day,target:t.id,name:t.name,black:WOLF.has(t.role)});
      }
      this.changed();
    }
    killMany(initial,attackers=[]) {
      const queue=initial.slice(),deaths=[];
      while(queue.length){
        const {id,cause}=queue.shift();const p=this.byId(id);if(!p?.alive)continue;
        if(LEVELER.has(p.role)&&(p.levelerLevel||0)>=5&&cause!=='leveler_duel')continue;
        if(p.role==='cheater'&&cause!=='leveler_duel'){
          if(cause==='execution')p.cheaterExecutionHit=true;
          else if(cause==='attack')p.cheaterAttackHit=true;
          if(!(p.cheaterExecutionHit&&p.cheaterAttackHit)){this.changed();continue;}
        }
        p.alive=false;p.deathAt=this.msgId;p.deathCause=cause;deaths.push(p.id);
        if(p.lover&&this.byId(p.lover)?.alive)queue.push({id:p.lover,cause:'lover'});
        if(p.role==='cat'&&(cause==='attack'||cause==='execution')){
          const pending=new Set(queue.map(x=>x.id));
          const candidates=this.living().filter(t=>!pending.has(t.id)&&(cause!=='attack'||attackers.includes(t.id)));
          const t=this.pick(candidates);if(t)queue.push({id:t.id,cause:'cat'});
        }
      }
      this.changed();return deaths;
    }
    captureDawnSnapshot(){
      this.dawnSnapshot={day:this.day,messageCount:this.messages.length,msgId:this.msgId,voteHistory:clone(this.voteHistory),reports:clone(this.reports),claims:clone(this.claims),
        infected:[...this.infected],lastExecuted:this.lastExecuted,wasBakerAlive:this.wasBakerAlive,players:this.players.map(p=>({id:p.id,role:p.role,alive:p.alive,privateResults:clone(p.privateResults),lover:p.lover,revengeDone:p.revengeDone,deathAt:p.deathAt,deathCause:p.deathCause,claimed:p.claimed,...this.roleState(p)}))};
    }
    restoreDawnSnapshot(resetterId){
      const s=this.dawnSnapshot;if(!s)return false;
      this.day=s.day;this.messages=this.messages.slice(0,s.messageCount);this.msgId=s.msgId;this.voteHistory=clone(s.voteHistory);this.reports=clone(s.reports);this.claims=clone(s.claims);
      this.infected=new Set(s.infected);this.lastExecuted=s.lastExecuted;this.wasBakerAlive=s.wasBakerAlive;this.pendingWin=null;this.winner=null;this.actions={};this.specialActions={};this.votes={};
      for(const row of s.players){const p=this.byId(row.id);if(!p)continue;p.role=row.role;p.alive=row.alive;p.privateResults=clone(row.privateResults);p.lover=row.lover;p.revengeDone=row.revengeDone;p.deathAt=row.deathAt;p.deathCause=row.deathCause;p.claimed=row.claimed;p.levelerLevel=row.levelerLevel||0;p.cheaterExecutionHit=!!row.cheaterExecutionHit;p.cheaterAttackHit=!!row.cheaterAttackHit;p.resetUsed=!!row.resetUsed;p.implantedFrom=row.implantedFrom||null;}
      const r=this.byId(resetterId);if(r){r.resetUsed=true;r.privateResults.push({id:'reset-'+this.phaseId+'-'+r.id,kind:'notice',day:this.day,text:'時間を直前の朝まで巻き戻しました。あなただけが巻き戻しを覚えています。'});}
      this.beginPhase('dawn');this.system('時間軸に異常が発生し、直前の朝まで巻き戻りました。');this.changed();return true;
    }
    resolveNight() {
      if(this.phase!=='night')return;
      const active=this.living().slice();
      const resetter=active.find(p=>p.role==='resetter'&&(this.specialActions[p.id]?.reset||[]).length);
      if(resetter&&this.restoreDawnSnapshot(resetter.id))return;
      const initial=[],guards=new Set(),attackCount={};this.hiddenWolves=new Set();
      for(const p of active){
        const specials=this.specialActions[p.id]||{};
        for(const id of specials.hide_wolf||[])this.hiddenWolves.add(id);
      }
      for(const p of active){
        const specials=this.specialActions[p.id]||{};
        for(const id of specials.steal_live||[]){const t=this.byId(id);if(t?.alive)this.stealRole(p,t);}
        for(const id of specials.steal_dead||[]){const t=this.byId(id);if(t&&!t.alive)this.stealRole(p,t);}
        for(const id of specials.implant_wolf||[]){const t=this.byId(id);if(t?.alive&&t.role!=='cheater'&&ROLES[t.role]?.team!=='wolves'){const old={role:t.role,state:this.roleState(t)};this.giveRole(t,'wolf',{implantedFrom:old});t.privateResults.push({id:'implant-'+this.phaseId+'-'+t.id,kind:'notice',day:this.day,text:'人狼の力を植え付けられました。あなたは人狼陣営になりました。'});}}
        for(const id of specials.priest_purify||[]){const t=this.byId(id);if(!t?.alive||t.role==='black_leveler')continue;if(t.implantedFrom?.role){const old=t.implantedFrom;this.giveRole(t,old.role,old.state||{});t.privateResults.push({id:'purify-'+this.phaseId+'-'+t.id,kind:'notice',day:this.day,text:'浄化され、元の役職に戻りました。'});}else if(WOLF.has(t.role)){this.giveRole(t,'villager');t.privateResults.push({id:'purify-'+this.phaseId+'-'+t.id,kind:'notice',day:this.day,text:'浄化され、村人になりました。'});}}
        for(const id of specials.priest_revive||[]){const t=this.byId(id);if(t&&!t.alive){t.alive=true;t.deathAt=null;t.deathCause=null;t.privateResults.push({id:'revive-'+this.phaseId+'-'+t.id,kind:'notice',day:this.day,text:'白レベラーの力で蘇生しました。'});}}
        for(const id of specials.priest_protect||[])guards.add(id);
      }
      const cheaterAlive=this.living().some(p=>p.role==='cheater');
      for(const p of this.living().slice()){
        const t=this.actions[p.id];
        if(t&&p.role==='guard')guards.add(t);
        if(t&&p.role==='plague')this.infected.add(t);
        if(t&&p.role==='seer'){
          const q=this.byId(t);if(q){const row={id:'seer-'+this.day+'-'+p.id,kind:'seer',day:this.day,target:q.id,name:q.name};if(cheaterAlive){row.mode='cheater';row.cheater=q.role==='cheater';row.black=false;}else{row.black=q.role==='wolf'&&!this.hiddenWolves.has(q.id);}p.privateResults.push(row);if(!cheaterAlive&&q.role==='fox')initial.push({id:q.id,cause:'divination'});}
        }
        if(t&&WOLF.has(p.role)&&!(this.day===1&&this.config.firstNightSafe))attackCount[t]=(attackCount[t]||0)+1;
        const specials=this.specialActions[p.id]||{};
        for(const id of specials.leveler_divine||[]){const q=this.byId(id);if(!q)continue;const row={id:'leveler-seer-'+this.day+'-'+p.id+'-'+id,kind:'leveler_seer',day:this.day,target:q.id,name:q.name};if(cheaterAlive){row.mode='cheater';row.cheater=q.role==='cheater';}else if(this.hiddenWolves.has(q.id)){row.role='unknown';}else row.role=q.role;p.privateResults.push(row);}
        for(const id of specials.cheat_kill||[])initial.push({id,cause:'cheater'});
        for(const id of specials.leveler_kill||[])initial.push({id,cause:'leveler_kill'});
      }
      const max=Math.max(0,...Object.values(attackCount));
      const target=max?this.pick(Object.keys(attackCount).filter(k=>attackCount[k]===max)):null;
      const attackers=this.living().filter(p=>WOLF.has(p.role)&&this.actions[p.id]===target).map(p=>p.id);
      if(target&&!guards.has(target)&&this.byId(target)?.role!=='fox')initial.push({id:target,cause:'attack'});
      let deaths=this.killMany(initial,attackers);
      for(const p of this.living().filter(p=>LEVELER.has(p.role)))p.levelerLevel=Math.min(7,(p.levelerLevel||1)+1);
      const white=this.living().find(p=>p.role==='white_leveler'&&(p.levelerLevel||0)>=7),black=this.living().find(p=>p.role==='black_leveler'&&(p.levelerLevel||0)>=7);
      if(white&&black)deaths=deaths.concat(this.killMany([{id:white.id,cause:'leveler_duel'},{id:black.id,cause:'leveler_duel'}]));
      this.beginPhase('dawn');
      this.lastScene={id:++this.sceneId,type:'dawn',victims:deaths.map(id=>({id,name:this.name(id)})),title:deaths.length?'夜が明けました':'穏やかな朝'};
      this.system(deaths.length?`朝、${deaths.map(id=>this.name(id)).join('、')}が亡くなっているのが見つかりました。`:'昨夜の犠牲者はいませんでした。');
      const baker=this.living().some(p=>p.role==='baker');
      if(baker)this.system('パンが届きました。パン屋はまだ生きています。');
      else if(this.wasBakerAlive)this.system('今日はパンが届きませんでした。');
      this.wasBakerAlive=baker;
      this.pendingWin=this.computeWin(null);this.changed();
    }
    startDiscussion() {this.captureDawnSnapshot();this.beginPhase('discussion');this.system(`${this.day}日目の話し合いを開始します。制限時間は${this.config.times.discussion}秒です。終了すると自動で投票へ進みます。`);}
    startVote(runoff=null) {
      this.votes={};this.runoff=runoff||[];this.round=runoff?1:0;this.beginPhase('vote');
      this.system(runoff?`最多票が同数です。${runoff.map(id=>this.name(id)).join('・')}で決選投票を行います。`:`投票を開始します。${this.config.times.vote}秒以内に1人を選んでください。時間切れは棄権です。`);
    }
    resolveVote() {
      if(this.phase!=='vote')return;
      const ballots=this.living().map(p=>({voter:p.id,target:this.votes[p.id]||null}));
      const count={};for(const b of ballots)if(b.target)count[b.target]=(count[b.target]||0)+1;
      const max=Math.max(0,...Object.values(count)),top=max?Object.keys(count).filter(k=>count[k]===max):[];
      this.voteHistory.push({day:this.day,round:this.round,ballots,count:clone(count),executed:top.length===1?top[0]:null});
      if(top.length>1&&this.round===0){this.startVote(top);return;}
      let deaths=[];this.lastExecuted=null;
      if(top.length===1){
        this.lastExecuted=top[0];
        for(const p of this.players)if(p.role==='avenger'&&p.revengeTarget===top[0])p.revengeDone=true;
        deaths=this.killMany([{id:top[0],cause:'execution'}]);
      }
      this.beginPhase('execution');
      this.lastScene={id:++this.sceneId,type:'execution',victims:deaths.map(id=>({id,name:this.name(id)})),title:this.lastExecuted?'投票が確定しました':'処刑なし'};
      this.system(this.lastExecuted?`${this.name(this.lastExecuted)}が投票で処刑されました。${deaths.length>1?' 他にも死亡者が出ました：'+deaths.slice(1).map(id=>this.name(id)).join('、')+'。':''}`:'同票または全員棄権のため、今日は誰も処刑されません。');
      this.pendingWin=this.computeWin(this.lastExecuted);this.changed();
    }
    computeWin(executed=null) {
      const alive=this.living(),exe=this.byId(executed);
      const result=(kind,label,ids,exclusive=false)=>{
        const winners=new Set(ids);
        if(!exclusive){
          for(const p of this.players)if(!p.lover&&((p.role==='survivor'&&p.alive)||(p.role==='avenger'&&p.revengeDone)))winners.add(p.id);
        }
        return {kind,label,winners:[...winners],day:this.day};
      };
      if(exe?.role==='jester'&&!exe.lover)return result('jester','てるてる坊主の単独勝利',[exe.id],true);
      const plague=alive.find(p=>p.role==='plague'&&!p.lover);
      if(plague&&alive.filter(p=>p.id!==plague.id).every(p=>this.infected.has(p.id)))return result('plague','疫病神の単独勝利',[plague.id],true);
      const wolves=alive.filter(p=>WOLF.has(p.role)).length;
      const normal=wolves===0||wolves>=alive.length-wolves;
      if(!normal)return null;
      const lovers=alive.filter(p=>p.lover&&this.byId(p.lover)?.alive);
      if(lovers.length===2)return result('lovers','恋人たちの勝利',lovers.map(p=>p.id));
      const fox=alive.find(p=>p.role==='fox'&&!p.lover);
      if(fox)return result('fox','妖狐の勝利',[fox.id]);
      if(!alive.length)return {kind:'draw',label:'生存者なし・引き分け',winners:[],day:this.day};
      const team=wolves?'wolves':'village';
      return result(team,team==='wolves'?'人狼陣営の勝利':'村人陣営の勝利',this.players.filter(p=>!p.lover&&ROLES[p.role].team===team).map(p=>p.id));
    }
    finish(winner) {this.winner=winner;this.pendingWin=null;this.beginPhase('ended');this.system(winner.label+'。全員の役職を公開します。');}
    advance() {
      if(this.phase==='reveal')this.startNight();
      else if(this.phase==='night')this.resolveNight();
      else if(this.phase==='dawn'){if(this.pendingWin)this.finish(this.pendingWin);else this.startDiscussion();}
      else if(this.phase==='discussion')this.startVote();
      else if(this.phase==='vote')this.resolveVote();
      else if(this.phase==='execution'){
        if(this.pendingWin)this.finish(this.pendingWin);
        else if(this.day>=30)this.finish({kind:'draw',label:'30日経過・引き分け',winners:[],day:this.day});
        else {this.day++;this.startNight();}
      }
    }
    isBot(p){return p.bot||p.auto;}
    checkEarly() {
      if(this.now()-this.startedAt<1800)return;
      if(this.phase==='night'){
        if(this.living().filter(p=>this.nightKind(p)).every(p=>Object.hasOwn(this.actions,p.id)))this.advance();
      }else if(this.phase==='vote'){
        if(this.living().every(p=>Object.hasOwn(this.votes,p.id)))this.advance();
      }else if(['reveal','dawn','execution'].includes(this.phase)){
        // The normal UI is announcer-driven and simply waits for the timer. `ready`
        // remains for compatibility/testing, but the player is never asked to run the game.
        const required=this.players.filter(p=>p.connected||p.auto);
        if(required.length&&required.every(p=>this.ready.has(p.id)))this.advance();
        else if(!required.length&&this.now()-this.startedAt>3000)this.advance();
      }
    }
    forceAdvance(id,bot) {
      if(id!==this.host||!this.isSolo()||['lobby','ended'].includes(this.phase))throw Error('早送りは1人練習時だけ使えます。');
      if(this.phase==='night')this.fillActions(bot);
      // In solo fast-forward, let CPU votes happen before ending the phase, without voting for the human.
      if(this.phase==='vote')for(const p of this.living().filter(p=>this.isBot(p)&&!Object.hasOwn(this.votes,p.id))){
        const choice=bot.decide(this.botView(p.id),p.brain,'vote');this.submitVote(p.id,choice.target??null,this.phaseId,true);
      }
      this.advance();
    }
    fillActions(bot,onlyExpired=false) {
      if(this.phase!=='night')return;
      for(const p of this.living().filter(p=>this.nightKind(p)&&!Object.hasOwn(this.actions,p.id))){
        if(onlyExpired&&this.now()<this.actionDeadline(p))continue;
        const choice=bot.decide(this.botView(p.id),p.brain,'night');
        const targets=this.targets(p);
        const t=this.nightKind(p)==='meet'?null:(targets.includes(choice?.target)?choice.target:targets[0]||null);
        this.submitAction(p.id,t,this.phaseId,true);
        if(!p.bot)p.privateResults.push({id:`auto-${this.phaseId}-${p.id}`,kind:'notice',day:this.day,text:'時間切れのため、この夜の行動はCPUが代行しました。'});
      }
    }
    tick(bot) {
      const now=this.now();
      if(this.phase==='lobby'){
        for(const p of this.humans().slice())if(now-p.lastActive>=75000)this.removePlayer(p.id);
        return;
      }
      const oldHost=this.byId(this.host);
      if(oldHost&&!oldHost.connected&&oldHost.disconnectedAt!==null&&now-oldHost.disconnectedAt>=15000){
        const next=this.humans().find(p=>p.connected);
        if(next){this.host=next.id;this.system(`部屋主を${next.name}に引き継ぎました。`);}
      }
      if(this.phase==='ended')return;
      for(const p of this.humans())if(!p.connected&&p.disconnectedAt!==null&&now-p.disconnectedAt>=15000&&!p.auto){p.auto=true;this.changed();}
      const bots=this.players.filter(p=>this.isBot(p));
      const botWolves=bots.filter(p=>p.alive&&WOLF.has(p.role));
      for(const p of bots){
        const b=p.brain;
        if(['reveal','dawn','execution'].includes(this.phase)&&now>=b.actionAt)this.ready.add(p.id);
        if(!p.alive){
          if(this.phase==='discussion'&&now>=b.actionAt&&b.ghostDay!==this.day){
            const c=bot.decide(this.botView(p.id),b,'ghost');
            if(c?.text)this.message(p,c.text,'ghost');
            b.ghostDay=this.day;
          }
          continue;
        }
        if(this.phase==='night'){
          if(WOLF.has(p.role)&&!b.nightSaid&&this.wolfTalkCount<Math.min(2,botWolves.length)&&now>=this.wolfTalkAt){
            const msg=bot.decide(this.botView(p.id),b,'wolfChat');
            if(msg?.text)this.message(p,msg.text,'wolves');
            b.nightSaid=true;this.wolfTalkCount++;this.wolfTalkAt=now+3500+Math.floor(this.random()*2500);
          }
          if(this.nightKind(p)&&!Object.hasOwn(this.actions,p.id)&&now>=b.actionAt){
            const c=bot.decide(this.botView(p.id),b,'night');
            const valid=this.targets(p),target=this.nightKind(p)==='meet'?null:(valid.includes(c?.target)?c.target:valid[0]||null);
            this.submitAction(p.id,target,this.phaseId,true);
          }
        }
        if(this.phase==='vote'&&!Object.hasOwn(this.votes,p.id)&&now>=b.actionAt){
          const c=bot.decide(this.botView(p.id),b,'vote');
          this.submitVote(p.id,this.targets(p,'vote').includes(c?.target)?c.target:null,this.phaseId,true);
        }
      }
      if(this.phase==='discussion'){
        const aliveBots=bots.filter(p=>p.alive);
        // A CPU only reacts when a public message actually points at it. The response is
        // queued for a few seconds later so it does not look like an instant chatbot.
        for(const p of aliveBots){
          const b=p.brain;
          const unseen=this.messages.filter(m=>m.channel==='public'&&m.day===this.day&&m.playerId&&m.playerId!==p.id&&m.id>(b.lastSeenPublicId||0));
          for(const m of unseen){
            const sender=this.byId(m.playerId);
            // Avoid CPU-to-CPU reply chains. CPU opinions can still react to public evidence,
            // but conversational replies are reserved for human messages so the chat stays readable.
            if(sender&&!sender.bot&&(m.meta?.target===p.id||m.text.includes(p.name))&&m.id!==b.repliedTo){
              const react=b.personality?.reactivity??1,tempo=b.personality?.tempo??1;
              b.replyMessageId=m.id;b.replyAt=now+1800+(2-react)*1000+(2-tempo)*450+Math.floor(this.random()*3600);
            }
          }
          if(unseen.length)b.lastSeenPublicId=Math.max(...unseen.map(m=>m.id));
        }
        if(now>=this.botTalkAt){
          const replies=aliveBots.filter(p=>p.brain.replyMessageId&&now>=p.brain.replyAt&&p.brain.talks<2)
            .sort((a,b)=>a.brain.replyAt-b.brain.replyAt||a.id.localeCompare(b.id));
          if(replies.length){
            const p=replies[0],b=p.brain,response=bot.decide(this.botView(p.id),b,'reply');
            if(response?.statement)this.publish(p.id,response.statement,this.phaseId,response.text);
            else if(response?.text)this.message(p,response.text,'public');
            b.repliedTo=b.replyMessageId;b.replyMessageId=null;b.replyAt=0;
            if(response?.text||response?.statement)b.talks++;
            this.botTalkAt=now+6500+Math.floor(this.random()*5000);
          }else{
            const limit=Math.max(3,Math.min(9,Math.ceil(this.config.times.discussion/16)));
            if(this.botDiscussionTalks<limit){
              const candidates=aliveBots.filter(p=>now>=p.brain.nextTalk&&((p.brain.talks<1)||(bot.priority?.(this.botView(p.id),p.brain)>0&&p.brain.talks<2)))
                .map(p=>({p,priority:bot.priority?.(this.botView(p.id),p.brain)||0}))
                .sort((a,b)=>b.priority-a.priority||a.p.brain.nextTalk-b.p.brain.nextTalk||a.p.id.localeCompare(b.p.id));
              if(candidates.length){
                const p=candidates[0].p,b=p.brain,response=bot.decide(this.botView(p.id),b,'talk');
                if(response?.statement)this.publish(p.id,response.statement,this.phaseId,response.text);
                else if(response?.text)this.message(p,response.text,'public');
                if(response?.text||response?.statement){b.talks++;this.botDiscussionTalks++;}
                b.nextTalk=now+18000+Math.floor(this.random()*18000);
                this.botTalkAt=now+(candidates[0].priority>=5?5500:8500)+Math.floor(this.random()*5000);
              }else this.botTalkAt=now+2500;
            }
          }
        }
      }
      this.fillActions(bot,true);
      const before=this.phaseId;this.checkEarly();
      if(before===this.phaseId&&this.deadline&&now>=this.deadline){if(this.phase==='night')this.fillActions(bot);this.advance();}
    }
    command(id,event,data={},bot=null) {
      const p=this.requirePlayer(id);this.touch(id);
      if(p.auto&&p.connected&&!['activity','chat'].includes(event)&&!['lobby','ended'].includes(this.phase))throw Error('このフェーズはCPU代行中です。次のフェーズから操作が戻ります。');
      if(['bots','config','start','reset','preset','solo'].includes(event)&&id!==this.host)throw Error('部屋主だけが操作できます。');
      switch(event){
        case 'activity':break;
        case 'bots':this.setBots(Number(data.count));break;
        case 'config':this.applyConfig(data);break;
        case 'solo':this.prepareSolo(data.role,Number(data.count)||8);break;
        case 'preset':{
          if(this.phase!=='lobby')throw Error('待機室で選んでください。');
          const n=Number(data.count);if(!Number.isInteger(n)||n<4||n>30||n<this.humans().length)throw Error('人数が不正です。');
          this.setBots(n-this.humans().length);
          this.applyConfig({...this.config,roles:preset(n,String(data.kind)),lovers:data.kind==='all',testRole:''});break;
        }
        case 'start':this.start();break;
        case 'reset':this.reset();break;
        case 'ready':this.markReady(id,data.turn);break;
        case 'act':this.submitAction(id,data.target??null,data.turn);break;
        case 'vote':this.submitVote(id,data.target??null,data.turn);break;
        case 'chat':this.chat(id,data.text,data.channel,data.turn);break;
        case 'statement':this.publish(id,data,data.turn);break;
        case 'speed':if(!bot)throw Error('CPUが利用できません。');this.forceAdvance(id,bot);break;
        default:throw Error('不明な操作です。');
      }
      this.changed();
    }
    view(id,forBot=false) {
      const p=this.requirePlayer(id);const ended=this.phase==='ended';
      const knownWolves=WOLF.has(p.role)||p.role==='fanatic'?this.players.filter(t=>WOLF.has(t.role)).map(t=>t.id):[];
      const knownMasons=p.role==='mason'?this.players.filter(t=>t.role==='mason'&&t.id!==p.id).map(t=>t.id):[];
      const publicPlayers=this.players.map(t=>{
        const row={id:t.id,name:t.name,bot:t.bot,connected:t.connected,alive:t.alive,auto:t.auto,host:t.id===this.host};
        if(ended){row.role=t.role;row.lover=t.lover;row.won=this.winner?.winners.includes(t.id)||false;}
        return row;
      });
      const messages=this.messages.filter(m=>{
        if(m.channel==='public'||m.channel==='system')return true;
        if(m.channel==='ghost')return !p.alive||ended;
        if(m.channel==='wolves')return ended||(WOLF.has(p.role)&&(p.alive||m.id<=p.deathAt));
        return false;
      }).slice(-300);
      const me={id:p.id,name:p.name,role:p.role,alive:p.alive,bot:p.bot,auto:p.auto,lover:p.lover,revengeTarget:p.revengeTarget,revengeDone:p.revengeDone,
        privateResults:clone(p.privateResults),knownWolves,knownMasons,
        infected:p.role==='plague'?[...this.infected]:[],
        acted:Object.hasOwn(this.actions,p.id),actionTarget:this.actions[p.id]??null,
        voted:Object.hasOwn(this.votes,p.id),voteTarget:this.votes[p.id]??null,ready:this.ready.has(p.id)};
      const out={code:this.code,phase:this.phase,phaseId:this.phaseId,phaseLabel:PHASES[this.phase],day:this.day,host:this.host===id,solo:this.isSolo(),
        now:this.now(),startedAt:this.startedAt,deadline:this.deadline,revision:this.revision,configVersion:this.configVersion,
        config:clone(this.config),me,players:publicPlayers,messages:clone(messages),reports:clone(this.reports),claims:clone(this.claims),
        voteHistory:clone(this.voteHistory),winner:clone(this.winner),lastScene:clone(this.lastScene),
        kind:this.phase==='night'?this.nightKind(p):null,
        targets:this.phase==='night'?this.targets(p):this.phase==='vote'?this.targets(p,'vote'):[],
        actionDeadline:this.phase==='night'&&this.nightKind(p)?this.actionDeadline(p):null,
        runoff:this.phase==='vote'?this.runoff||[]:[],
        lastActive:p.lastActive,validation:this.phase==='lobby'?checkConfig(this.config,this.players.length):[]};
      if(forBot||p.id!==this.host||this.phase!=='lobby')out.config.testRole='';
      if(!forBot)out.catalog={roles:ROLES,lover:LOVER};
      return out;
    }
    botView(id){return this.view(id,true);}
  }
  return {Game,ROLES,LOVER,ROLE_IDS,WOLF,MAX_PLAYERS,MIN_PLAYERS,PHASES,DEFAULT_TIMES,BOT_NAMES,preset,checkConfig,seeded,cleanName,validName,cleanText};
});
