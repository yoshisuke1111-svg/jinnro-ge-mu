const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server');

async function api(base,event,data={}){
  const res=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event,data})});
  return {res,json:await res.json()};
}

test('normal online room sends one Discord notification',async()=>{
  const calls=[];
  const fakeFetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:204};};
  const app=createApp({tickMs:1000000,adminPassword:'x',discordWebhook:'https://discord.example/webhook',discordNotifyUserId:'123456789012345678',publicBaseUrl:'https://werewolf.example/',fetchImpl:fakeFetch});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'通知テスト',roomCode:'DISCORD1'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://discord.example/webhook');
    const body=JSON.parse(calls[0].options.body);
    assert.match(body.content,/123456789012345678/);
    assert.equal(body.embeds[0].fields[0].value,'`DISCORD1`');
    assert.equal(body.embeds[0].fields[1].value,'通知テスト');
    assert.equal(body.embeds[0].url,'https://werewolf.example/?room=DISCORD1');
  }finally{await app.close();}
});

test('solo practice does not send Discord notification',async()=>{
  const calls=[];
  const app=createApp({tickMs:1000000,adminPassword:'x',discordWebhook:'https://discord.example/webhook',fetchImpl:async(...args)=>{calls.push(args);return {ok:true,status:204};}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'ソロ',solo:true,role:'seer'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,0);
  }finally{await app.close();}
});

test('Discord 429 is retried after retry_after',async()=>{
  const calls=[],sleeps=[];
  let attempt=0;
  const fakeFetch=async(url,options)=>{
    calls.push({url,options});attempt++;
    if(attempt===1){
      return {
        ok:false,status:429,
        headers:{get:()=>null},
        clone(){return {json:async()=>({retry_after:1})};}
      };
    }
    return {ok:true,status:204,headers:{get:()=>null}};
  };
  const app=createApp({
    tickMs:1000000,
    adminPassword:'x',
    discordWebhook:'https://discord.example/webhook',
    fetchImpl:fakeFetch,
    sleepImpl:async ms=>{sleeps.push(ms);}
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const made=await api(base,'create',{name:'再試行',roomCode:'RETRY1'});
    assert.equal(made.res.status,200,JSON.stringify(made.json));
    for(let i=0;i<20&&calls.length<2;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,2);
    assert.equal(sleeps.length,1);
    assert.ok(sleeps[0]>=250);
  }finally{await app.close();}
});
