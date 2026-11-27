'use strict';

const crypto=require('node:crypto');

function cleanText(value,max=400){
  return String(value||'').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,max);
}

function cleanName(value){
  const name=cleanText(value,16);
  if(!name)throw Error('名前を入力してください。');
  if(/[<>]/.test(name))throw Error('その名前は使えません。');
  return name;
}

function normalizeCode(value){
  const code=String(value||'').normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase();
  if(!code)return '';
  if([...code].length<3||[...code].length>16)throw Error('部屋コードは3〜16文字で入力してください。');
  if(!/^[\p{L}\p{N}_-]+$/u.test(code))throw Error('部屋コードは文字・数字・-・_だけ使えます。');
  return code;
}

function createCasualChat({
  url=process.env.TURSO_DATABASE_URL||'',
  authToken=process.env.TURSO_AUTH_TOKEN||'',
  client=null,
  clientFactory=null,
  logger=console
}={}){
  const enabled=Boolean(client||(String(url).trim()&&String(authToken).trim()));
  let db=client,readyPromise=null,lastError=null;
  const rooms=new Map();
  const sessions=new Map();

  async function init(){
    if(readyPromise)return readyPromise;
    readyPromise=(async()=>{
      if(!enabled)return false;
      try{
        if(!db){
          const factory=clientFactory||(async config=>{
            const mod=await import('@libsql/client');
            return mod.createClient(config);
          });
          db=await factory({url:String(url),authToken:String(authToken)});
        }
        await db.executeMultiple(`
          CREATE TABLE IF NOT EXISTS casual_chat_rooms (
            room_code TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS casual_chat_messages (
            message_id TEXT PRIMARY KEY,
            room_code TEXT NOT NULL,
            sequence_no INTEGER NOT NULL,
            sent_at INTEGER NOT NULL,
            participant_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            text TEXT NOT NULL,
            reply_to TEXT,
            reply_delay_ms INTEGER,
            context_json TEXT NOT NULL,
            training_consent INTEGER NOT NULL DEFAULT 1
          );
          CREATE INDEX IF NOT EXISTS idx_casual_chat_room_sequence
            ON casual_chat_messages(room_code, sequence_no);
          CREATE INDEX IF NOT EXISTS idx_casual_chat_sent
            ON casual_chat_messages(sent_at);
          CREATE INDEX IF NOT EXISTS idx_casual_chat_reply
            ON casual_chat_messages(reply_to);
        `);
        await db.execute('SELECT 1 AS ok');
        lastError=null;
        return true;
      }catch(error){
        lastError=String(error?.message||error);
        logger.error?.('Casual chat store init failed',lastError);
        try{db?.close?.();}catch{}
        db=null;readyPromise=null;
        return false;
      }
    })();
    return readyPromise;
  }

  async function softDb(label,work,fallback=false){
    try{return await work();}
    catch(error){
      lastError=String(error?.message||error);
      logger.warn?.('Casual chat '+label+' failed',lastError);
      return fallback;
    }
  }

  function generateCode(){
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code='';
    do{
      code='CHAT-'+Array.from({length:4},()=>alphabet[crypto.randomInt(alphabet.length)]).join('');
    }while(rooms.has(code));
    return code;
  }

  function publicMessage(m){
    return {
      id:m.id,seq:m.seq,at:m.at,name:m.name,text:m.text,
      participantId:m.participantId,replyTo:m.replyTo||null,replyPreview:m.replyPreview||null
    };
  }

  function roomState(sessionToken){
    const session=sessions.get(String(sessionToken||''));
    if(!session)throw Error('雑談セッションが見つかりません。入り直してください。');
    const room=rooms.get(session.roomCode);
    if(!room)throw Error('雑談部屋が見つかりません。');
    const participant=room.participants.get(session.participantId);
    if(!participant)throw Error('参加情報が見つかりません。');
    participant.lastSeen=Date.now();
    return {
      code:room.code,
      createdAt:room.createdAt,
      me:{id:participant.id,name:participant.name},
      participants:[...room.participants.values()].map(p=>({id:p.id,name:p.name})),
      messages:room.messages.slice(-200).map(publicMessage),
      storageAvailable:!!db
    };
  }

  async function enter({name,code='',create=false,consent=false}={}){
    if(consent!==true)throw Error('会話を学習用に保存することへの同意が必要です。');
    const displayName=cleanName(name);
    let roomCode=normalizeCode(code);
    let room;

    if(create){
      if(!roomCode)roomCode=generateCode();
      if(rooms.has(roomCode))throw Error('その雑談部屋コードはすでに使われています。');
      room={code:roomCode,createdAt:Date.now(),participants:new Map(),messages:[],sequence:0};
      rooms.set(roomCode,room);
      if(await init())await softDb('room save',()=>db.execute({
        sql:'INSERT OR IGNORE INTO casual_chat_rooms (room_code,created_at) VALUES (?,?)',
        args:[roomCode,room.createdAt]
      }));
    }else{
      if(!roomCode)throw Error('部屋コードを入力してください。');
      room=rooms.get(roomCode);
      if(!room)throw Error('その雑談部屋は現在開いていません。');
    }

    if([...room.participants.values()].some(p=>p.name===displayName))throw Error('同じ名前の参加者がいます。');
    if(room.participants.size>=20)throw Error('この雑談部屋は満員です。');

    const participantId=crypto.randomUUID();
    const sessionToken=crypto.randomBytes(24).toString('base64url');
    room.participants.set(participantId,{id:participantId,name:displayName,joinedAt:Date.now(),lastSeen:Date.now(),lastSentAt:0});
    sessions.set(sessionToken,{roomCode,participantId});
    return {sessionToken,...roomState(sessionToken)};
  }

  async function send({sessionToken,text,replyTo=null}={}){
    const session=sessions.get(String(sessionToken||''));
    if(!session)throw Error('雑談セッションが見つかりません。');
    const room=rooms.get(session.roomCode);
    const participant=room?.participants.get(session.participantId);
    if(!room||!participant)throw Error('雑談部屋が見つかりません。');

    const now=Date.now();
    if(now-participant.lastSentAt<450)throw Error('連続投稿は少し間を空けてください。');
    const clean=cleanText(text,400);
    if(!clean)throw Error('メッセージを入力してください。');

    const source=replyTo?room.messages.find(m=>m.id===String(replyTo)):null;
    const previous=room.messages.at(-1)||null;
    const reference=source||previous;
    const context=room.messages.slice(-8).map(publicMessage);
    const message={
      id:crypto.randomUUID(),
      seq:++room.sequence,
      at:now,
      participantId:participant.id,
      name:participant.name,
      text:clean,
      replyTo:source?.id||null,
      replyPreview:source?{name:source.name,text:source.text.slice(0,80)}:null
    };
    room.messages.push(message);
    if(room.messages.length>500)room.messages.splice(0,room.messages.length-500);
    participant.lastSentAt=now;participant.lastSeen=now;

    let stored=false;
    if(await init()){
      const result=await softDb('message save',()=>db.execute({
        sql:`INSERT INTO casual_chat_messages
             (message_id,room_code,sequence_no,sent_at,participant_id,display_name,text,reply_to,reply_delay_ms,context_json,training_consent)
             VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
        args:[
          message.id,room.code,message.seq,message.at,message.participantId,message.name,message.text,
          message.replyTo,reference?Math.max(0,now-reference.at):null,JSON.stringify(context)
        ]
      }),null);
      stored=Boolean(result);
    }
    return {message:publicMessage(message),stored,state:roomState(sessionToken)};
  }

  function leave(sessionToken){
    const key=String(sessionToken||''),session=sessions.get(key);
    if(!session)return {ok:true};
    const room=rooms.get(session.roomCode);
    if(room)room.participants.delete(session.participantId);
    sessions.delete(key);
    if(room&&!room.participants.size)rooms.delete(room.code);
    return {ok:true};
  }

  async function stats(){
    let storedMessages=0;
    if(await init()){
      const result=await softDb('stats',()=>db.execute('SELECT COUNT(*) AS count FROM casual_chat_messages'),null);
      storedMessages=Number(result?.rows?.[0]?.count||0);
    }
    return {enabled,openRooms:rooms.size,sessions:sessions.size,storedMessages,lastError};
  }

  async function close(){
    try{db?.close?.();}catch{}
  }

  return {init,enter,send,roomState,leave,stats,close,_rooms:rooms};
}

module.exports={createCasualChat,cleanText,cleanName,normalizeCode};
