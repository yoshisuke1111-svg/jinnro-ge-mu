'use strict';

/*
 * 自作AIの「目」の部分。
 * 人狼ゲームの盤面(context)を、学習しやすい数値の並びに変換する。
 *
 * 重要:
 * - ここで使うのは、そのプレイヤー本人に見えていた context だけ。
 * - truth_json（本当の役職など）は入力に混ぜない。混ぜるとチートAIになる。
 */

const ROLE_BUCKETS=8;

const FEATURE_NAMES=[
  'bias',
  'phase_night',
  'phase_discussion',
  'phase_vote',
  'phase_other',
  'day',
  'remaining_time',
  'player_count',
  'alive_count',
  'connected_count',
  'message_count',
  'own_message_count',
  'claim_count',
  'report_count',
  'vote_round_count',
  'private_result_count',
  'known_wolf_count',
  'known_mason_count',
  'already_acted',
  'already_voted',
  'legal_target_count',
  'legal_special_count',
  'self_alive',
  'self_auto',
  ...Array.from({length:ROLE_BUCKETS},(_,i)=>'role_bucket_'+i)
];

function clamp01(value){
  const n=Number(value);
  if(!Number.isFinite(n))return 0;
  return Math.max(0,Math.min(1,n));
}

function hash32(text){
  let h=2166136261;
  for(const c of String(text||'')){
    h^=c.charCodeAt(0);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}

function extractFeatures(context={}){
  const self=context.self||{};
  const players=Array.isArray(context.players)?context.players:[];
  const messages=Array.isArray(context.messages)?context.messages:[];
  const claims=Array.isArray(context.claims)?context.claims:[];
  const reports=Array.isArray(context.reports)?context.reports:[];
  const voteHistory=Array.isArray(context.voteHistory)?context.voteHistory:[];
  const legal=context.legal||{};
  const phase=String(context.phase||'');

  const roleBuckets=Array(ROLE_BUCKETS).fill(0);
  if(self.role){
    roleBuckets[hash32(self.role)%ROLE_BUCKETS]=1;
  }

  const ownMessageCount=messages.filter(m=>m&&m.playerId===self.id).length;

  return [
    1,
    phase==='night'?1:0,
    phase==='discussion'?1:0,
    phase==='vote'?1:0,
    !['night','discussion','vote'].includes(phase)?1:0,
    clamp01(Number(context.day||0)/10),
    clamp01(Number(context.remainingMs||0)/120000),
    clamp01(players.length/30),
    clamp01(players.filter(p=>p?.alive).length/30),
    clamp01(players.filter(p=>p?.connected).length/30),
    clamp01(messages.length/120),
    clamp01(ownMessageCount/30),
    clamp01(claims.length/30),
    clamp01(reports.length/30),
    clamp01(voteHistory.length/10),
    clamp01((self.privateResults||[]).length/20),
    clamp01((self.knownWolves||[]).length/10),
    clamp01((self.knownMasons||[]).length/10),
    self.acted?1:0,
    self.voted?1:0,
    clamp01((legal.targets||[]).length/30),
    clamp01((legal.specials||[]).length/10),
    self.alive?1:0,
    self.auto?1:0,
    ...roleBuckets
  ];
}

module.exports={FEATURE_NAMES,ROLE_BUCKETS,extractFeatures,hash32};
