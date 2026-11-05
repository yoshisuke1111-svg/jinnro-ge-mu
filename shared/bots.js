/* Information-limited CPU. Receives the SAME redacted view as a player, never a Game.
 * No API, no language-model call, and no hidden-role lookup.
 * Public claims are evidence, not truth. Only this player's private results are trusted.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./rules'));
  else root.WWBots=factory(root.WW);
})(typeof globalThis!=='undefined'?globalThis:this,function(WW){
  'use strict';
  const {ROLES,WOLF,PACK}=WW;
  const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
  const name=(v,id)=>v.players.find(p=>p.id===id)?.name||'その人';
  const live=v=>v.players.filter(p=>p.alive);
  const last=(a)=>a[a.length-1];
  function ownKnowledge(v,kind,target){
    if(target===v.me.id)return kind==='medium'?WOLF.has(v.me.role):v.me.role==='wolf';
    const a=v.me.privateResults.filter(r=>r.kind===kind&&r.target===target);
    return a.length?last(a).black:undefined;
  }
  function reliability(v,who,kind='seer'){
    if(who===v.me.id&&v.me.role===kind)return 2.2;
    let r=1;
    const reports=v.reports.filter(q=>q.playerId===who&&q.role===kind);
    for(const a of reports){
      const own=ownKnowledge(v,kind,a.target);
      if(own!==undefined&&a.black!==own)r-=1.5;
      if(reports.some(b=>b.target===a.target&&b.black!==a.black))r-=1;
    }
    if(v.me.role===kind&&v.config.roles[kind]===1&&who!==v.me.id)r-=1.2;
    // Statements by known pack members are useful to wolves, but not objective truth.
    return Math.max(-1,Math.min(2.2,r));
  }
  function evaluate(v){
    const score={},reasons={};
    for(const p of live(v)){
      score[p.id]=(hash(v.me.id+'|'+p.id)%100)/25;
      reasons[p.id]=[];
    }
    const add=(id,amount,reason)=>{
      if(score[id]===undefined)return;
      score[id]+=amount;if(reason)reasons[id].push({weight:Math.abs(amount),text:reason});
    };
    for(const r of new Map(v.reports.map(r=>[r.playerId+'|'+r.role+'|'+r.target,r])).values()){
      const cred=reliability(v,r.playerId,r.role);
      if(cred<0)add(r.playerId,45,'自分が確認した判定と食い違う主張がある');
      if(r.role==='seer'&&cred>0){
        add(r.target,(r.black?25:-11)*cred,`${name(v,r.playerId)}から${r.black?'黒':'白'}判定の主張がある`);
      }
    }
    const latestClaims=[...new Map(v.claims.map(c=>[c.playerId,c])).values()];
    for(const c of latestClaims){
      if(!v.config.roles[c.role])add(c.playerId,100,'この配役にない役職を名乗っている');
      if(['seer','medium'].includes(c.role)&&v.me.role===c.role&&v.config.roles[c.role]===1&&c.playerId!==v.me.id){
        add(c.playerId,65,`私と同じ${ROLES[c.role].name}を名乗っているが、この配役では1人だけ`);
      }
    }
    for(const r of v.me.privateResults){
      if(r.kind==='seer'&&r.mode!=='cheater')add(r.target,r.black?250:(v.config.roles.darkwolf?-28:-95),`自分の占いで${r.black?'人狼':'人狼ではない'}と確認した`);
      if(r.kind==='leveler_seer'&&r.mode!=='cheater'&&r.role)add(r.target,ROLES[r.role]?.team==='wolves'?180:-55,`白レベラーの完全占いで${ROLES[r.role]?.name||r.role}と確認した`);
    }
    for(const id of v.me.knownMasons)add(id,-75,'共有者の相方として知っている');
    if(v.me.lover)add(v.me.lover,-1000,'相方を守りたい');
    // Only public ballot records and privately known / publicly CLAIMED medium results.
    const vote=last(v.voteHistory);
    if(vote?.executed){
      const personal=last(v.me.privateResults.filter(r=>r.kind==='medium'&&r.target===vote.executed));
      const publicReport=last(v.reports.filter(r=>r.role==='medium'&&r.target===vote.executed&&reliability(v,r.playerId,'medium')>0));
      const result=personal||publicReport;
      if(result?.black){
        for(const b of vote.ballots){
          add(b.voter,b.target===vote.executed?-12:7,b.target===vote.executed?'黒判定が出た処刑先に投票していた':'黒判定が出た処刑先には投票していなかった');
        }
      }
    }
    const opinions=new Map();
    for(const m of v.messages.filter(m=>m.channel==='public'&&m.day===v.day&&['accuse','trust'].includes(m.meta?.kind))){
      if(m.playerId!==v.me.id)opinions.set(m.playerId+'|'+m.meta.kind,m);
    }
    const rumorWeights={};
    for(const m of opinions.values()){
      const k=m.meta.target+'|'+m.meta.kind;
      if((rumorWeights[k]||0)<1){
        add(m.meta.target,m.meta.kind==='accuse'?.25:-.12,m.meta.kind==='accuse'?`${m.name}も疑いを向けている`:`${m.name}は白寄りに見ている`);
        rumorWeights[k]=(rumorWeights[k]||0)+1;
      }
    }
    if(PACK.has(v.me.role)||v.me.role==='fanatic'){
      for(const id of v.me.knownWolves)add(id,-600,'仲間を外す');
    }
    if(v.me.role==='avenger'&&!v.me.lover&&!v.me.revengeDone)add(v.me.revengeTarget,75,'投票先として注目している');
    return {score,reasons};
  }
  function ranked(v,targets=null){
    const e=evaluate(v),ids=targets||live(v).filter(p=>p.id!==v.me.id).map(p=>p.id);
    return ids.map(id=>({id,score:e.score[id]??0,reason:(e.reasons[id]||[]).sort((a,b)=>b.weight-a.weight)[0]?.text||null})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  }
  function nightChoice(v,b){
    const ids=['attack','divine'].includes(v.kind)?v.targets.filter(id=>id!==v.me.lover):v.targets.slice();
    const choices=ids.length?ids:v.targets.slice();
    if(v.kind==='meet'||!choices.length)return null;
    if(v.kind==='attack'){
      const s={};for(const id of choices)s[id]=(hash(`${id}:${v.day}:pack`)%100)/100;
      for(const c of v.claims){
        if(s[c.playerId]===undefined)continue;
        s[c.playerId]+=({seer:35,medium:22,guard:26,mason:13,baker:4})[c.role]||0;
      }
      for(const r of v.reports)if(r.role==='seer'&&r.black&&v.me.knownWolves.includes(r.target)&&s[r.playerId]!==undefined)s[r.playerId]+=20;
      const noDeath=v.messages.some(m=>m.channel==='system'&&m.day===v.day-1&&m.text==='昨夜の犠牲者はいませんでした。');
      if(noDeath&&b.lastAttack&&s[b.lastAttack]!==undefined)s[b.lastAttack]-=30;
      const target=choices.sort((a,c)=>s[c]-s[a])[0];b.lastAttack=target;return target;
    }
    if(v.kind==='divine'){
      const examined=new Set(v.me.privateResults.filter(r=>r.kind==='seer').map(r=>r.target));
      const unknown=choices.filter(id=>!examined.has(id));
      const rs=ranked(v,unknown.length?unknown:choices);
      const target=rs[0]?.id;
      return target||choices[0];
    }
    if(v.kind==='protect'){
      let best=null,bestScore=-Infinity;
      for(const id of choices){
        let score=hash(id+v.day)%10;
        if(id===v.me.lover)score+=250;
        if(v.me.knownMasons.includes(id))score+=12;
        const claims=v.claims.filter(c=>c.playerId===id);
        for(const c of claims)score+=({seer:40*reliability(v,id),medium:24,mason:16})[c.role]||0;
        const evalScore=evaluate(v).score[id]||0;score-=Math.max(0,evalScore)*.3;
        if(score>bestScore){bestScore=score;best=id;}
      }
      return best;
    }
    if(v.kind==='infect')return choices.sort((a,c)=>(hash(c+v.day)%100)-(hash(a+v.day)%100))[0];
    return choices[0];
  }
  function whiteCaveat(v,b={}){
    const uncertain=['darkwolf','madman','fanatic','fox','jester','plague','survivor','avenger'].filter(k=>v.config.roles[k]>0).map(k=>ROLES[k].name);
    if(v.config.lovers)uncertain.push('恋人');
    const roles=uncertain.slice(0,2).join('・')+(uncertain.length>2?'など':'');
    if(!uncertain.length)return {casual:'白は手掛かりにするけど、発言と投票も見たい。',soft:'白は手掛かりにするけど、発言と投票も合わせて見たいかな。',polite:'白判定は手掛かりにしますが、発言と投票も合わせて見たいです。',blunt:'白は材料。発言と票も見る。',analytical:'白判定だけでは決めず、発言と投票も合わせて見る。'}[tone(b)];
    return {casual:`白でも${roles}はあるから、村人陣営確定までは置かない。`,soft:`白でも${roles}はあり得るから、村人陣営確定とまでは見ないかな。`,polite:`白でも${roles}はあり得るので、村人陣営確定とは見ません。`,blunt:`白でも${roles}は残る。村確定では見ない。`,analytical:`白でも${roles}は残るので、陣営確定とは扱わない。`}[tone(b)];
  }
  function choose(v,key,items){return items[hash(v.me.id+'|'+v.day+'|'+key)%items.length];}
  function tone(b){return b.personality?.tone||'soft';}
  function spokenName(v,b,id){const n=name(v,id);return tone(b)==='polite'?`${n}さん`:n;}
  function reportSentence(v,b,role,target,black){
    const label=role==='seer'?'占い':'霊媒',result=black?'黒':'白',p=tone(b),n=p==='polite'?`${target}さん`:target;
    const first={
      casual:[`${label}出る。${n}は${result}だった。`,`${label}結果。${n}、${result}だったよ。`,`${n}を見た。結果は${result}。`],
      soft:[`${label}結果出たよ。${n}は${result}だった。`,`${label}で${n}を見たんだけど、${result}だった。`,`${label}結果共有するね。${n}は${result}。`],
      polite:[`${label}結果を出しますね。${n}は${result}でした。`,`${n}を${label==='占い'?'占いました':'見ました'}。結果は${result}です。`],
      blunt:[`${label}。${n}は${result}。`,`${n}、${result}だった。${label}結果。`],
      analytical:[`${label}結果を共有する。${n}は${result}。`,`${n}の判定は${result}。いったん材料にしてほしい。`]
    }[p];
    return choose(v,'report-'+role+'-'+target+'-'+(b.talks||0),first);
  }
  function claimSentence(v,b,role,detail=''){
    const n=ROLES[role].name,p=tone(b);
    const heads={
      casual:[`${n}で出る。`,`${n}CO。`],soft:[`${n}で出るね。`,`${n}COしておくね。`],
      polite:[`${n}で出ます。`,`${n}COしておきます。`],blunt:[`${n}CO。`,`${n}。出る。`],analytical:[`${n}で出る。情報は順に出す。`,`${n}CO。必要な情報だけ共有する。`]
    }[p];
    const head=choose(v,'claim-'+role+'-'+(b.talks||0),heads);
    return (head+(detail?' '+detail:'')).trim();
  }
  function opinionSentence(v,b,target,kind,reason=''){
    const id=target.id,n=spokenName(v,b,id),p=tone(b),conf=b.personality?.confidence??1,key=`op-${kind}-${id}-${b.talks||0}`;
    let heads;
    if(kind==='trust'){
      heads={
        casual:[`${n}は今のところそんなに疑ってない。`,`${n}は今は白めかな。`,`自分は${n}をいったん外して見てる。`],
        soft:[`${n}は今のところ白寄りかな。`,`今は${n}をそこまで疑ってないよ。`,`${n}は一回置いて、ほかを見たいかな。`],
        polite:[`${n}は今のところ白寄りで見ています。`,`今は${n}を強く疑ってはいません。`,`${n}はいったん候補から外して見ています。`],
        blunt:[`${n}は今は白寄り。`,`${n}は後回しでいい。`,`今は${n}じゃない。`],
        analytical:[`今の材料なら${n}の優先度は低め。`,`${n}は現時点では白寄りに置く。`,`${n}より先に見たい相手がいる。`]
      }[p];
    }else if(kind==='question'){
      heads={
        casual:[`${n}、そこどういう理由？`,`${n}、さっきの判断もう少し聞いていい？`,`${n}は何を一番怪しいと思ってる？`],
        soft:[`${n}の考え、もう少し聞きたいな。`,`${n}、その判断の理由って何だった？`,`${n}は今どこを一番気にしてる？`],
        polite:[`${n}、その判断の理由をもう少し聞いてもいいですか？`,`${n}は今、誰を一番気にしていますか？`,`${n}の考えをもう少し聞きたいです。`],
        blunt:[`${n}、理由は？`,`${n}、どこが怪しい？`,`${n}、その判断の根拠は？`],
        analytical:[`${n}に確認。いちばん大きい根拠は何？`,`${n}の判断材料を聞きたい。`,`${n}は今、何を重く見てる？`]
      }[p];
    }else{
      heads={
        casual:[`${n}がちょっと気になる。`,`今は${n}を見てる。`,`自分は${n}が少し怪しく見える。`],
        soft:[`${n}が少し引っかかってるかな。`,`今のところ${n}が気になってる。`,`${n}をもう少し見たいかな。`],
        polite:[`今は${n}が少し気になっています。`,`${n}をもう少し見たいです。`,`現時点では${n}を少し疑っています。`],
        blunt:[`今は${n}を疑ってる。`,`${n}が気になる。`,`自分なら${n}を見る。`],
        analytical:[`今の材料だと${n}を先に見たい。`,`${n}の動きが少し気になる。`,`現状は${n}を疑い寄りに置く。`]
      }[p];
    }
    let head=choose(v,key,heads);
    if(kind==='accuse'&&conf===0&&p!=='polite')head=choose(v,key+'-weak',[`まだ決め切ってないけど、${n}が気になる。`,`今のところは${n}かな。まだ変わるかも。`,head]);
    if(kind==='accuse'&&conf===2&&p==='casual')head=choose(v,key+'-strong',[`${n}はかなり気になってる。`,`${n}にはちゃんと理由を聞きたい。`,head]);
    if(kind==='question'||(b.personality?.verbosity??1)===0)return head;
    return reason?`${head} ${reason}`:head;
  }
  function fakeReport(v,b){
    const eligible=live(v).filter(p=>p.id!==v.me.id);
    if(!eligible.length)return null;
    b.fakeHistory=b.fakeHistory||[];
    let choices=eligible.filter(p=>!b.fakeHistory.some(r=>r.target===p.id));
    if(!choices.length)choices=eligible;
    const allies=choices.filter(p=>v.me.knownWolves.includes(p.id));
    let target;
    if(allies.length&&v.day===1)target=allies[0];
    else target=choices.sort((a,c)=>(hash(c.id+v.me.id+v.day)%100)-(hash(a.id+v.me.id+v.day)%100))[0];
    const prior=b.fakeHistory.find(r=>r.target===target.id);
    let black=prior?.black??(v.day>=2&&hash(v.me.id+v.day)%3!==0);
    if(v.me.knownWolves.includes(target.id)||target.id===v.me.lover)black=false;
    if(v.me.role==='madman'&&(evaluate(v).score[target.id]||0)>35)black=false;
    const statement={kind:'report',role:'seer',target:target.id,black};
    b.fakeHistory.push({...statement,day:v.day});b.reportDay=v.day;b.fakeRole='seer';
    const follow=black?choose(v,'fake-black',['今日はここをちゃんと見てほしい。','自分はこの黒を投票材料にする。','対抗がいるなら結果も聞きたい。']):choose(v,'fake-white',['白だったから、いったん外して考える。','白。発言まで全部信用するわけじゃないけど、今日は別を見たい。','白だった。ほかの候補を見ようと思う。']);
    return {statement,text:`${reportSentence(v,b,'seer',target.name,black)} ${follow}`};
  }
  function emotion(v,b){
    const recent=v.messages.filter(m=>m.channel==='public'&&m.day===v.day&&m.playerId!==v.me.id);
    const pressure=recent.filter(m=>m.meta?.kind==='accuse'&&m.meta.target===v.me.id).length+recent.filter(m=>m.meta?.kind==='report'&&m.meta.target===v.me.id&&m.meta.black).length*2;
    if(!pressure)return '';
    const p=tone(b),react=b.personality?.reactivity??1;
    if(react===0)return '';
    if(pressure>=3)return {casual:'だいぶ自分に集まってるな。',soft:'けっこう自分に疑い集まってるね。',polite:'かなり自分に疑いが集まっていますね。',blunt:'かなり疑われてるな。',analytical:'自分に疑いが集まってるのは分かった。'}[p];
    return {casual:'自分が疑われてるのは分かってる。',soft:'自分が気にされてるのは分かってるよ。',polite:'自分が疑われているのは分かっています。',blunt:'疑われてるのは分かってる。',analytical:'自分への疑いは把握してる。'}[p];
  }
  function hasFreshReport(v,b){
    if(!['seer','medium'].includes(v.me.role))return false;
    return v.me.privateResults.some(r=>['seer','medium'].includes(r.kind)&&!(b.reported||[]).includes(r.id));
  }
  function shouldFake(v,b){
    if(v.config.roles.seer<=0||b.reportDay===v.day)return false;
    if(b.fakeRole==='seer')return true;
    if(v.day!==1)return false;
    const leader=v.me.knownWolves.slice().sort()[0];
    let chance=0;
    if(PACK.has(v.me.role)&&v.me.id===leader)chance=55;
    else if(v.me.role==='madman')chance=40;
    else if(v.me.role==='fanatic')chance=30;
    else if(v.me.role==='jester'&&!v.me.lover)chance=20;
    return chance>0&&(hash(v.me.id+'|fake-seer')%100)<chance;
  }
  function priority(v,b){
    if(b.replyMessageId)return 7;
    if(hasFreshReport(v,b))return 8;
    if(shouldFake(v,b))return 5;
    if(v.me.role==='mason'&&!b.announcedRole)return 4;
    if(v.me.role==='medium'&&!b.announcedRole)return 3;
    return 0;
  }
  function speech(v,b){
    const me=v.me,p=tone(b);
    const reports=me.privateResults.filter(r=>['seer','medium'].includes(r.kind));
    const fresh=reports.filter(r=>!(b.reported||[]).includes(r.id));
    if(['seer','medium'].includes(me.role)&&fresh.length){
      const r=last(fresh);b.reported=(b.reported||[]).concat(r.id);b.announcedRole=me.role;
      const follow=r.black?choose(v,'real-black',['ここは今日の投票候補に入れてほしい。','黒だった。自分は今日はここを重く見る。','対抗の結果も聞きたいけど、この黒は無視しないでほしい。']):choose(v,'real-white',['白だったから、いったん疑いは下げる。','白。村確定とまでは言わないけど、今日は優先度を下げたい。',whiteCaveat(v,b)]);
      return {statement:{kind:'report',role:r.kind,target:r.target,black:r.black},text:`${reportSentence(v,b,r.kind,r.name,r.black)} ${follow}`};
    }
    if(shouldFake(v,b))return fakeReport(v,b);
    if(me.role==='mason'&&!b.announcedRole){
      b.announcedRole='mason';
      const mates=me.knownMasons.map(id=>name(v,id)).join('、');
      return {statement:{kind:'claim',role:'mason'},text:claimSentence(v,b,'mason',`相方は${mates}。`)};
    }
    if(me.role==='medium'&&!b.announcedRole){
      b.announcedRole='medium';
      return {statement:{kind:'claim',role:'medium'},text:claimSentence(v,b,'medium',p==='polite'?'まだ結果は出ていません。':'まだ結果は出てない。')};
    }
    const accusations=v.messages.filter(m=>m.day===v.day&&m.channel==='public'&&m.meta?.kind==='accuse'&&m.meta.target===me.id);
    if(['cat','guard','baker'].includes(me.role)&&!b.announcedRole&&accusations.length>=2){
      b.announcedRole=me.role;
      const detail={cat:'吊るなら道連れが出るから、それだけ覚えておいて。',guard:'護衛先はまだ伏せる。',baker:'朝のパンも一緒に見て判断してほしい。'}[me.role];
      return {statement:{kind:'claim',role:me.role},text:claimSentence(v,b,me.role,detail)};
    }
    const list=ranked(v),target=list[0],safe=list.at(-1);
    if(!target)return null;
    const roll=hash(me.id+'|speech-kind|'+v.day+'|'+(b.talks||0)+'|'+(b.topicSalt||0))%100,suspicion=b.personality?.suspicion??1;
    const trustCut=[30,19,9][suspicion],questionCut=[61,43,27][suspicion];
    let kind='accuse',chosen=target;
    if(roll<trustCut&&safe&&safe.id!==me.id&&safe.score<15){kind='trust';chosen=safe;}
    else if(roll<questionCut&&target.score<70){kind='question';chosen=target;}
    // 村全体で直近に同じ「誰をどう見るか」が出ていたら、別の論点を優先する。
    const recentTopicKeys=new Set(v.messages.filter(m=>m.channel==='public'&&m.day===v.day&&m.playerId&&v.players.find(p=>p.id===m.playerId)?.bot&&['accuse','trust','question'].includes(m.meta?.kind)).slice(-7).map(m=>m.meta.kind+':'+m.meta.target));
    if(recentTopicKeys.has(kind+':'+chosen.id)){
      const pool=kind==='trust'?[...list].reverse():list;
      const alt=pool.find(x=>x.id!==me.id&&!recentTopicKeys.has(kind+':'+x.id)&&(kind!=='trust'||x.score<20));
      if(alt)chosen=alt;
    }
    b.announcedTarget=kind==='accuse'?chosen.id:b.announcedTarget;
    const reason=safeReason(v,chosen,b),prefix=emotion(v,b),body=opinionSentence(v,b,chosen,kind,reason);
    return {statement:{kind,target:chosen.id},text:prefix?`${prefix} ${body}`:body};
  }
  function ownLastVote(v){
    for(let i=v.voteHistory.length-1;i>=0;i--){const ballot=v.voteHistory[i].ballots?.find(x=>x.voter===v.me.id);if(ballot)return ballot.target||null;}
    return null;
  }
  function freeIntent(v,msg,me=v.me){
    const text=String(msg?.text||''),compact=text.replace(/\s+/g,'');
    const subject=v.players.filter(p=>p.id!==me.id&&p.id!==msg?.playerId).sort((a,b)=>b.name.length-a.name.length).find(p=>compact.includes(p.name));
    const direct=msg?.meta?.target===me.id||compact.includes(me.name);
    const question=/[?？]|どう思|どう見|どうする|誰|どこ|教えて|聞きたい|意見|なんで|なぜ|理由|本物|偽/.test(compact);
    let kind='none';
    if(/^(おは|こんにちは|こんばんは|よろしく|やあ|どうも)/.test(compact))kind='greeting';
    if(/投票|票先|吊り|処刑/.test(compact)&&question)kind='vote';
    else if(/役職|何者|CO|ＣＯ|カミングアウト/.test(compact)&&question)kind='role';
    else if(/占い|占い師|霊媒|判定/.test(compact)&&question)kind='seer';
    else if(subject&&(/怪し|白|黒|村っぽ|人狼|信用|信じ|どう思|どう見/.test(compact)))kind='target';
    else if(/怪し|人狼|黒い|疑って|誰|どこ/.test(compact)&&question)kind='suspect';
    else if(question)kind='opinion';
    return {kind,direct,subject,question,text:compact};
  }
  function replyInterest(v,b,msg){
    if(!msg||msg.channel!=='public'||msg.playerId===v.me.id)return 0;
    const sender=v.players.find(p=>p.id===msg.playerId);if(!sender||sender.bot)return 0;
    const namedBot=v.players.filter(p=>p.alive&&p.bot).sort((a,b)=>b.name.length-a.name.length).find(p=>String(msg.text||'').includes(p.name));
    if(namedBot)return namedBot.id===v.me.id?3:0;
    const i=freeIntent(v,msg);
    if(i.direct)return 3;
    if(i.kind==='none')return 0;
    const candidates=v.players.filter(p=>p.alive&&p.bot).map(p=>p.id).sort();
    if(!candidates.length)return 0;
    return candidates[hash(String(msg.id)+'|free-reply')%candidates.length]===v.me.id?1:0;
  }
  function replySpeech(v,b){
    const me=v.me,msg=v.messages.find(m=>m.id===b.replyMessageId&&m.channel==='public');
    if(!msg)return null;
    const list=ranked(v),target=list[0],reason=target?safeReason(v,target,b):'',p=tone(b),intent=freeIntent(v,msg,me);
    if(msg.meta?.kind==='report'&&msg.meta.target===me.id){
      if(msg.meta.black){
        const lead={casual:`${msg.name}の黒は違う。少なくとも自分視点では偽。`,soft:`${msg.name}の黒判定は違うよ。自分視点ではそこははっきりしてる。`,polite:`${msg.name}さんの黒判定は違います。少なくとも自分視点では偽です。`,blunt:`${msg.name}の黒は偽。`,analytical:`${msg.name}の黒判定は自分視点で成立しない。`}[p];
        return {statement:target?{kind:'accuse',target:target.id}:undefined,text:target?`${lead} ${opinionSentence(v,b,target,'accuse',reason)}`:lead};
      }
      return {text:{casual:`${msg.name}の白は見た。でも、その占いまで真だとはまだ思ってない。`,soft:`${msg.name}の白判定は確認したよ。占い自体はもう少し見たいかな。`,polite:`${msg.name}さんの白判定は確認しました。ただ、その占いが真かどうかはもう少し見たいです。`,blunt:`${msg.name}の白は確認。占い真とはまだ決めない。`,analytical:`${msg.name}から白判定。判定と占い師の真偽は分けて考える。`}[p]};
    }
    if(msg.meta?.kind==='question'&&msg.meta.target===me.id)intent.kind=/投票|票/.test(msg.text||'')?'vote':intent.kind==='none'?'opinion':intent.kind;
    if(msg.meta?.kind==='accuse'&&msg.meta.target===me.id){
      const lead={casual:'そこ疑われるのか。まあ理由は分かった。',soft:'そこを気にされてるのは分かったよ。',polite:'そこを疑われているのは分かりました。',blunt:'疑われてるのは分かった。',analytical:'自分への疑いは把握した。'}[p];
      if(target)return {statement:{kind:'accuse',target:target.id},text:`${lead} ただ、自分は${spokenName(v,b,target.id)}の方を見てる。${reason}`};
      return {text:`${lead} まだ返せる材料は少ない。`};
    }
    if(msg.meta?.kind==='trust'&&msg.meta.target===me.id){
      return {text:choose(v,'reply-trust-'+msg.id,[`${msg.name}がそう見てるのは分かった。自分もまだ決め打ちはしない。`,`白く見てくれるのはありがたいけど、そこだけで固めなくていいと思う。`,`了解。自分は引き続き発言と投票を見てる。`])};
    }
    if(intent.kind==='greeting'){
      return {text:choose(v,'reply-greeting-'+msg.id,{
        casual:['おはよう。今日も発言と票を見ながら考える。','おはよう。まだ決め打ちはせず見ていくよ。'],
        soft:['おはよう。今日もゆっくり材料を見ていこう。','おはよう。まずはみんなの話を聞きたいかな。'],
        polite:['おはようございます。今日も発言と投票を見て考えます。','おはようございます。まずは皆さんの意見を聞きたいです。'],
        blunt:['おはよう。まず発言を見る。','おはよう。今日も材料から見る。'],
        analytical:['おはよう。今日も公開情報から整理する。','おはよう。まず昨日までの票と発言を確認する。']
      }[p])};
    }
    if(intent.kind==='vote'){
      const voted=ownLastVote(v);
      if(voted){
        const vt=ranked(v,[voted])[0],why=vt?safeReason(v,vt,b):'その時点では一番気になった';
        return {text:choose(v,'reply-vote-'+msg.id,[`昨日は${spokenName(v,b,voted)}に入れた。${why}`,`${spokenName(v,b,voted)}に投票したよ。理由は、${why}`,`票は${spokenName(v,b,voted)}。その時は${why}`])};
      }
      if(target)return {statement:{kind:'accuse',target:target.id},text:choose(v,'reply-next-vote-'+msg.id,[`今投票するなら${spokenName(v,b,target.id)}かな。${reason}`,`まだ確定じゃないけど、今は${spokenName(v,b,target.id)}を候補にしてる。${reason}`])};
    }
    if(intent.kind==='role'){
      const claimed=b.fakeRole||b.announcedRole;
      if(claimed)return {text:choose(v,'reply-role-known-'+msg.id,[`自分はもう${ROLES[claimed]?.name||claimed}で出てる。`,`${ROLES[claimed]?.name||claimed}として話してるよ。`])};
      return {text:choose(v,'reply-role-hidden-'+msg.id,{casual:['役職は今は伏せておく。必要になったら出る。','今はまだ役職を出す場面じゃないと思ってる。'],soft:['今はまだ役職は伏せたいかな。必要なら出るよ。','今のところは役職を伏せて、発言を見たいかな。'],polite:['今はまだ役職は伏せておきたいです。必要になれば出ます。','現時点では役職は伏せておきます。'],blunt:['今は伏せる。必要なら出る。','役職はまだ言わない。'],analytical:['現時点では役職公開の利益が薄いので伏せる。','役職はまだ公開しない。必要性が出たら考える。']}[p])};
    }
    if(intent.kind==='seer'){
      const reports=v.reports.filter(r=>r.role==='seer'&&r.day===v.day);
      if(!reports.length)return {text:choose(v,'reply-seer-empty-'+msg.id,['まだ占い結果が少ないから、真偽は決められない。','占いはまだ材料不足。結果とその後の発言を見たい。','今は占い師を決め打つ段階ではないと思う。'])};
      const latest=reports.at(-1),who=name(v,latest.playerId),t=name(v,latest.target);
      return {text:choose(v,'reply-seer-'+msg.id,[`${who}の${t}${latest.black?'黒':'白'}は見てる。ただ、結果だけで真偽は決めない。`,`占いは${who}の結果を材料にしてる。出した後の発言と投票も見たい。`,`${who}の判定は確認した。対抗や票の動きまで見てから判断したい。`])};
    }
    if(intent.kind==='target'&&intent.subject){
      const item=ranked(v,[intent.subject.id])[0];if(item){
        const why=safeReason(v,item,b);
        if(item.score>=35)return {statement:{kind:'accuse',target:item.id},text:opinionSentence(v,b,item,'accuse',why)};
        if(item.score<=8)return {statement:{kind:'trust',target:item.id},text:opinionSentence(v,b,item,'trust',why)};
        return {text:choose(v,'reply-target-neutral-'+msg.id,[`${spokenName(v,b,item.id)}はまだ白黒どちらにも寄せ切ってない。${why}`,`${spokenName(v,b,item.id)}は保留寄り。もう少し発言と票を見たい。`])};
      }
    }
    if(['suspect','opinion'].includes(intent.kind)||intent.direct){
      if(target)return {statement:{kind:'accuse',target:target.id},text:choose(v,'reply-opinion-'+msg.id,[`今いちばん気になってるのは${spokenName(v,b,target.id)}。${reason}`,`今の考えなら${opinionSentence(v,b,target,'accuse',reason)}`,`まだ固めてないけど、${opinionSentence(v,b,target,'accuse',reason)}`])};
      return {text:choose(v,'reply-empty-'+msg.id,['まだ決め切ってない。もう少し発言を見たい。','今はまだ保留かな。投票理由が出たら考えたい。','材料が少ないから、今の時点では決めてない。'])};
    }
    return null;
  }
  function safeReason(v,target,b={}){
    // NEVER expose pack/lover/revenge knowledge as a public rationale.
    const p=tone(b),pick=(key,items)=>choose(v,'reason-'+key+'-'+target.id+'-'+(b.talks||0),items);
    if(target.reason?.includes('疑いを向けている')){
      return pick('rumor',{
        casual:['何人か気にしてるけど、便乗だけでは決めたくない。本人の話も聞きたい。','疑いが集まってるのは見える。でも、それだけじゃまだ弱い。'],
        soft:['何人か気にしてるみたいだけど、それだけで決めるのは早いかな。本人の話も聞きたい。','疑いが集まってるのは気になる。でも、もう少し理由がほしいかな。'],
        polite:['何人かが気にしていますが、それだけで決めるのは早いと思います。本人の話も聞きたいです。','疑いが集まっているのは気になりますが、もう少し理由を確認したいです。'],
        blunt:['疑いは集まってる。でもそれだけじゃ決めない。','周りも見てる。本人の説明待ち。'],
        analytical:['疑いが集まってるのは事実だけど、それ自体を根拠にはしない。本人の説明を見たい。','周りの疑いは参考程度。本人の発言を見て決めたい。']
      }[p]);
    }
    if(target.reason&&!/仲間|相方|共有者の相方|投票先として/.test(target.reason)){
      if(target.reason.includes('自分が確認した判定と食い違う'))return pick('own-conflict',{casual:['自分の結果と食い違ってるのが気になる。','自分が持ってる結果と合わない。そこは見過ごせない。'],soft:['自分の結果と食い違ってるのが気になってる。','自分で確認した結果と合わないから、そこは気になるかな。'],polite:['自分で確認した結果と食い違っているのが気になります。','自分の結果と合わないので、そこは確認したいです。'],blunt:['自分の結果と合わない。そこが気になる。','自分の結果と矛盾してる。'],analytical:['自分の確認結果と矛盾してる。ここは重く見る。','自分の結果と整合しない。理由を確認したい。']}[p]);
      if(target.reason.includes('この配役にない役職'))return pick('impossible-claim',{casual:['その役職、この配役にはいないはず。そこはおかしい。'],soft:['その役職はこの配役にいないはずだから、そこが気になる。'],polite:['その役職はこの配役にいないはずなので、そこが気になります。'],blunt:['その役職はいない。そこはおかしい。'],analytical:['配役に存在しない役職CO。ここは明確な矛盾。']}[p]);
      if(target.reason.includes('私と同じ')&&target.reason.includes('1人だけ'))return pick('counter-role',{casual:['自分と同じ役職で出てるけど、この配役だと1人だけ。対抗として見てる。'],soft:['自分と同じ役職で出てるけど、1人配役だから対抗になるね。'],polite:['自分と同じ役職で出ていますが、1人配役なので対抗として見ています。'],blunt:['同役職の対抗。1人配役だから両方はない。'],analytical:['同役職COが重複してる。1人配役なので対抗関係。']}[p]);
      if(target.reason.startsWith('自分の占い')&&v.me.role==='seer')return pick('own-seer',{casual:['自分で占った結果がある。ここはかなり重く見てる。'],soft:['自分の占い結果があるから、ここはかなり重く見てるよ。'],polite:['自分の占い結果があるので、ここはかなり重く見ています。'],blunt:['自分の占い結果。ここは重い。'],analytical:['自分の占いで確認済み。最優先で見る。']}[p]);
      if(target.reason.startsWith('自分の占い')&&v.me.role!=='seer')return pick('claim',['公開されている占い主張と、その後の発言がつながってるか見たい。','占い主張だけじゃなく、その後の発言も見たい。']);
      const publicMatch=target.reason.match(/^(.+?)から(黒|白)判定の主張がある$/);
      if(publicMatch){const who=publicMatch[1],color=publicMatch[2];return pick('public-report',{casual:[`${who}が${color}を出してる。判定だけじゃなく、出した側の動きも見たい。`,`${who}の${color}判定は見てる。そこだけで決める気はない。`],soft:[`${who}が${color}を出してるね。判定と一緒に、出した人の動きも見たいかな。`,`${who}の${color}判定は確認したよ。まだそれだけでは決めない。`],polite:[`${who}さんが${color}判定を出しています。判定だけでなく、出した側の動きも見たいです。`,`${who}さんの${color}判定は確認していますが、それだけでは決めません。`],blunt:[`${who}の${color}は見てる。でも判定だけでは決めない。`,`${who}が${color}出し。出した側も見る。`],analytical:[`${who}の${color}判定は材料にする。ただし発言と投票も合わせて見る。`,`${who}が${color}判定。判定元の動きも評価する。`]}[p]);}
      let base=target.reason.replace(/からです。$/,'').replace(/から$/,'').replace(/^自分の占いで/,'自分の占いでは');
      if(p!=='polite')base=base.replace(/しています/g,'してる').replace(/ありません/g,'ない');
      const tails=target.score<50?{
        casual:['。まだ決め打ちはしない。','。今は材料の一つって感じ。'],soft:['。まだ断定まではしないかな。','。今のところはそれが気になってる。'],polite:['。まだ断定はしません。','。今のところは判断材料の一つです。'],blunt:['。まだ確定じゃない。','。今はそこが気になる。'],analytical:['。まだ仮置き。','。これだけで決めるつもりはない。']
      }[p]:{
        casual:['。ここは一回説明ほしい。','。反応を見たい。'],soft:['。ここは少し説明を聞きたいかな。','。本人の反応も見ておきたい。'],polite:['。ここは少し説明を聞きたいです。','。本人の反応も確認したいです。'],blunt:['。説明は聞きたい。','。反応を見る。'],analytical:['。追加の説明を聞きたい。','。次の反応まで見て判断する。']
      }[p];
      return base+pick('tail',tails);
    }
    const seerReports=v.reports.filter(r=>r.role==='seer');
    if(seerReports.length)return pick('seer',['占い結果が割れてるし、発言と投票も一緒に見たい。','占いだけで決める気はない。本人の発言と票も見たい。','判定は材料にするけど、占いを出した人の動きも見たい。']);
    return pick('open',['まだ決め手はない。発言が増えたら変わるかも。','今は仮置き。投票理由が出たら見直したい。','材料が薄いから、まだ様子見寄り。','今のところの候補。本人の反応を見てから決めたい。']);
  }
  function voiced(v,b,out){
    if(!out?.text)return out;
    const p=b.personality||{tone:'soft',sociability:1,confidence:1,verbosity:1,humor:0};
    let t=String(out.text).replace(/\s+/g,' ').replace(/。\s*。/g,'。').trim();
    // Keep each personality's own sentence templates. Do not mechanically convert every line to です/ます.
    if(p.tone==='blunt'||p.verbosity===0){
      const sentences=t.match(/[^。！？]+[。！？]?/g)||[t];t=sentences.slice(0,p.verbosity===0?2:3).join('');
    }
    if(p.verbosity===2&&out.statement?.kind==='accuse'&&t.length<125){
      const extra=choose(v,'extra-detail-'+(b.talks||0),[' 票を入れる前に本人の反応も見たい。',' 昨日の投票も合わせて考えたい。',' ほかの人がどう見てるかも聞きたい。']);t+=extra;
    }
    if(p.humor===2&&p.tone==='casual'&&out.statement?.kind==='question'&&t.length<105)t+=' 深い意味はなくて、そこだけ気になった。';
    return {...out,text:t.trim()};
  }

  function statementTopic(out){
    const s=out?.statement;if(!s)return '';
    if(s.kind==='report')return 'report:'+s.role+':'+s.target+':'+Boolean(s.black);
    if(s.kind==='claim')return 'claim:'+s.role;
    if(['accuse','trust','question'].includes(s.kind))return s.kind+':'+s.target;
    return s.kind||'';
  }
  function normalizedSpeech(v,text){
    let t=String(text||'').toLowerCase();
    for(const p of [...v.players].sort((a,b)=>b.name.length-a.name.length))t=t.split(String(p.name).toLowerCase()).join('<player>');
    return t.replace(/[\s。、，,.!！?？「」『』（）()・:：;；ー~〜]/g,'').replace(/\d+/g,'#');
  }
  function grams(text){
    const s=String(text||'');if(s.length<3)return new Set(s?[s]:[]);
    const out=new Set();for(let i=0;i<=s.length-3;i++)out.add(s.slice(i,i+3));return out;
  }
  function textSimilarity(a,b){
    const A=grams(a),B=grams(b);if(!A.size||!B.size)return a===b?1:0;
    let hit=0;for(const x of A)if(B.has(x))hit++;
    return hit/(A.size+B.size-hit);
  }
  function novelTalk(v,b,out){
    if(!out?.text&&!out?.statement)return out;
    // CO・新しい判定結果は重要情報なので、重複抑制で消さない。
    if(['claim','report'].includes(out.statement?.kind))return out;
    const key=statementTopic(out),norm=normalizedSpeech(v,out.text);
    const own=b.recentSpeechTopics||[];
    if(key&&own.slice(-5).includes(key)){b.topicSalt=(b.topicSalt||0)+1;return null;}
    const recent=v.messages.filter(m=>m.channel==='public'&&m.day===v.day&&m.playerId&&v.players.find(p=>p.id===m.playerId)?.bot).slice(-8);
    if(key&&recent.some(m=>statementTopic({statement:m.meta})===key)){b.topicSalt=(b.topicSalt||0)+1;return null;}
    if(norm&&recent.some(m=>textSimilarity(norm,normalizedSpeech(v,m.text))>=.72)){b.topicSalt=(b.topicSalt||0)+1;return null;}
    if(key){b.recentSpeechTopics=(own.concat(key)).slice(-8);}
    b.topicSalt=0;
    return out;
  }

  function decide(v,b,mode){
    if(!v?.me)throw Error('A redacted player view is required.');
    if(mode==='night')return {target:nightChoice(v,b)};
    if(mode==='vote'){
      const r=ranked(v,v.targets);
      if(!r.length)return {target:null};
      const announced=r.find(x=>x.id===b.announcedTarget);
      return {target:announced&&announced.score>=r[0].score-8?announced.id:r[0].id};
    }
    if(mode==='wolfChat'){
      if(v.kind==='meet')return {text:choose(v,'wolf-meet',{casual:['初夜は顔合わせだけだね。明日、占いの出方を見てから噛み先決めよう。'],soft:['今日は顔合わせだけだね。明日の占いと投票の流れを見て、噛み先を決めよう。'],polite:['今夜は顔合わせだけですね。明日の占いと投票の流れを見て、襲撃先を決めましょう。'],blunt:['今日は顔合わせだけ。明日、占いを見て噛み先決めよう。'],analytical:['初夜は襲撃なし。明日は占いの出方と投票理由を見てから噛み先を決める。']}[tone(b)])};
      const target=nightChoice(v,b);if(!target)return null;
      const claim=last(v.claims.filter(c=>c.playerId===target));
      return {text:claim?choose(v,'wolf-attack-claim',[`${name(v,target)}を噛みたい。${ROLES[claim.role].name}で出てるし、残すと情報が増えそう。護衛だけ少し気になる。`,`${name(v,target)}を候補にしたい。${ROLES[claim.role].name}を名乗ってるから、村の情報源になりそう。`]):choose(v,'wolf-attack-open',[`今夜は${name(v,target)}を噛みたい。発言と投票の流れを見ると、ここを残したくない。`,`自分は${name(v,target)}を候補にする。昨日の流れだと、ここを消すのがよさそう。`])};
    }
    if(mode==='ghost'){
      const result=last(v.me.privateResults.filter(r=>['seer','medium'].includes(r.kind)));
      if(result)return {text:`生きてる間に見た${result.kind==='seer'?'占い':'霊媒'}だと、${result.name}は${result.black?'人狼':'人狼ではなかった'}。あとは村がどう見るかだね。`};
      const vote=last(v.voteHistory);
      if(vote?.executed)return {text:`${name(v,vote.executed)}が処刑されたか。次は、そこに入れた人と外した人の理由を見たいな。`};
      return {text:'ここからは観戦だね。占い結果と投票の流れを見ながら、最後まで見てる。'};
    }
    if(mode==='talk')return novelTalk(v,b,voiced(v,b,speech(v,b)));
    if(mode==='reply')return voiced(v,b,replySpeech(v,b));
    return null;
  }
  return {decide,evaluate,ranked,reliability,priority,replyInterest,freeIntent};
});
