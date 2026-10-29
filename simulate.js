/* All seats are driven through the same information-limited CPU API; no forced winners. */
'use strict';
const {simulate}=require('./helpers');
const fs=require('node:fs'),path=require('node:path');
const total=Number(process.env.SIM_GAMES||120);
const sizes=[4,6,8,10,12,24,30],out={games:0,bySize:{},winners:{},maxDay:0,draws:0,publicMessages:0,selfWolfReveals:0};
for(let i=0;i<total;i++){
  const n=sizes[i%sizes.length],kind=n>=24?'all':n>=10?'third':'basic';
  const {g,steps}=simulate({seed:1009+i*131,n,kind});
  out.games++;out.bySize[n]=(out.bySize[n]||0)+1;out.winners[g.winner.kind]=(out.winners[g.winner.kind]||0)+1;
  out.maxDay=Math.max(out.maxDay,g.day);if(g.winner.kind==='draw')out.draws++;
  for(const m of g.messages.filter(m=>m.channel==='public'&&m.playerId)){
    out.publicMessages++;
    if(/(?:私は|自分は|僕は)人狼(?:です|だ|$)/.test(m.text))out.selfWolfReveals++;
  }
  if(i===2)fs.writeFileSync(path.join(__dirname,'../docs/sample-game-log.json'),JSON.stringify(g.view('human'),null,2));
  if((i+1)%20===0)console.log(`Finished ${i+1}/${total}`);
}
if(out.selfWolfReveals)throw Error('Unexpected public self-reveal');
console.log(JSON.stringify(out,null,2));
fs.writeFileSync(path.join(__dirname,'../docs/simulation-results.json'),JSON.stringify(out,null,2)+'\n');
