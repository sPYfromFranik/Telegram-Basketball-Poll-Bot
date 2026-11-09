import type { Config, Message, PollRow } from './types';
import { TelegramClient, escapeHtml } from './telegram';
import { currentWeekSchedule, isoNow, localDateText, localDateTime } from './time';
import { closePoll, createWeeklyPoll, disableWeeklySchedule, reconcileLifecycle, saveWeeklySchedule } from './polls';
import { reconcileQueue } from './votes';
import { personName, statusText } from './domain';

interface StatusRow { telegram_user_id:string;username:string|null;first_name:string;last_name:string|null;vote:string;status:string;queue_position:number|null;latest_change_at:string }
async function activePoll(db:D1Database,chatId:string,now:Date):Promise<PollRow|null> {
  void now;
  return db.prepare("SELECT * FROM poll_instances WHERE chat_id=? AND status='open' ORDER BY id DESC LIMIT 1").bind(chatId).first<PollRow>();
}
function pollLink(poll:PollRow):string|undefined {
  if(!poll.message_id) return undefined;
  if(poll.chat_id.startsWith('-100')) return `https://t.me/c/${poll.chat_id.slice(4)}/${poll.message_id}`;
  return undefined;
}
interface ScheduleCommandArgs {
  startDate:string; startTime:string; closeDate:string; closeTime:string;
  location:string; gameDate:string; gameTime:string; maxPlayers:number; minPlayers:number;
}
function commandTokens(text:string):string[] {
  const tokens:string[]=[];
  for(const match of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) tokens.push(match[1]??match[2]??match[3]!);
  return tokens;
}
export function parseScheduleCommand(text:string,now:Date,cfg:Config):ScheduleCommandArgs {
  const tokens=commandTokens(text).slice(1);
  const optionAt=tokens.findIndex(token=>token.startsWith('--'));
  const positional=optionAt<0?tokens:tokens.slice(0,optionAt);
  const optionTokens=optionAt<0?[]:tokens.slice(optionAt);
  let base:string[]; let extra:string[]=[];
  if(positional.length===2||positional.length===4) base=positional;
  else if(positional.length===7||positional.length===9) { base=positional.slice(0,positional.length-5); extra=positional.slice(-5); }
  else throw new Error('Неправильний формат команди /schedule.');
  let startDate:string,startTime:string,closeDate:string,closeTime:string;
  if(base.length===2) { startDate=localDateText(now,cfg.timezone); closeDate=startDate; [startTime,closeTime]=base as [string,string]; }
  else [startDate,startTime,closeDate,closeTime]=base as [string,string,string,string];
  const values:Record<string,string>={};
  if(extra.length) {
    values.location=extra[0]!; values['game-date']=extra[1]!; values['game-time']=extra[2]!;
    values['max-players']=extra[3]!; values['min-players']=extra[4]!;
  }
  const aliases:Record<string,string>={location:'location','game-date':'game-date','game-time':'game-time',max:'max-players','max-players':'max-players',min:'min-players','min-players':'min-players'};
  for(let i=0;i<optionTokens.length;i++) {
    const token=optionTokens[i]!;
    const equal=token.indexOf('=');
    const rawName=token.slice(2,equal<0?undefined:equal);
    const name=aliases[rawName];
    if(!token.startsWith('--')||!name) throw new Error(`Невідомий параметр: ${token}`);
    const value=equal>=0?token.slice(equal+1):optionTokens[++i];
    if(!value||value.startsWith('--')) throw new Error(`Параметр --${rawName} потребує значення.`);
    values[name]=value;
  }
  const location=(values.location||cfg.location).trim();
  const gameDate=values['game-date']||closeDate;
  const gameTime=values['game-time']||cfg.gameTime;
  const maxPlayers=Number(values['max-players']??cfg.maxPlayers);
  const minPlayers=Number(values['min-players']??cfg.minPlayers);
  if(!location||location.length>100) throw new Error('Місце має містити від 1 до 100 символів.');
  if(!Number.isInteger(maxPlayers)||maxPlayers<1||maxPlayers>1000) throw new Error('Максимальна кількість гравців має бути цілим числом від 1 до 1000.');
  if(!Number.isInteger(minPlayers)||minPlayers<1||minPlayers>maxPlayers) throw new Error('Мінімальна кількість має бути від 1 до максимальної.');
  localDateTime(gameDate,gameTime,cfg.timezone);
  return {startDate,startTime,closeDate,closeTime,location,gameDate,gameTime,maxPlayers,minPlayers};
}
async function sendStatus(db:D1Database,tg:TelegramClient,cfg:Config,chatId:string,now:Date) {
  const poll=await activePoll(db,chatId,now);
  if(!poll) return tg.sendMessage(chatId,'Цього тижня голосування ще не створено.');
  const rows=(await db.prepare(`SELECT cv.*,p.username,p.first_name,p.last_name FROM current_votes cv JOIN participants p ON p.telegram_user_id=cv.telegram_user_id WHERE cv.poll_instance_id=? ORDER BY CASE cv.status WHEN 'confirmed' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,cv.queue_position,cv.latest_change_at`).bind(poll.id).all<StatusRow>()).results;
  const confirmed=rows.filter(r=>r.status==='confirmed').map(personName);
  const waiting=rows.filter(r=>r.status==='waiting').map(personName);
  const declined=rows.filter(r=>r.vote==='no').length;
  return tg.sendMessage(chatId,statusText(poll.title,new Date(poll.close_deadline).toLocaleString('uk-UA',{timeZone:cfg.timezone}),confirmed,waiting,declined,pollLink(poll)));
}
function help():string { return `<b>Команди</b>\n/start — показати цю довідку\n/help — ця довідка\n/status — склад і резерв\n/my_status — мій статус\n\n<b>Організатор</b>\n/chat_id — показати ID групи для allowlist\n/schedule ГГ:ХХ ГГ:ХХ — старт і закриття сьогодні, далі щотижня\n/schedule ДД.ММ.РРРР ГГ:ХХ ДД.ММ.РРРР ГГ:ХХ — повний розклад\nДодатково: <code>--location "Назва залу" --game-date ДД.ММ.РРРР --game-time ГГ:ХХ --max 18 --min 10</code>\n/disable_poll — вимкнути майбутні автоматичні опитування\n/create_poll — створити вручну\n/close_poll — закрити активне\n/history, /reconcile\n\n/schedule_poll — сумісний аліас. Без додаткових параметрів використовуються місце з конфігурації, дата закриття голосування, час 20:30 та ліміти 18/10. Час — київський. Кожна дозволена група має незалежний розклад.`; }
export async function handleCommand(db:D1Database,tg:TelegramClient,cfg:Config,message:Message,updateId:number,now=new Date()):Promise<void> {
  if(!message.text?.startsWith('/') || !message.from) return;
  const marker=crypto.randomUUID();
  const inserted=await db.prepare("INSERT OR IGNORE INTO processed_updates(update_id,update_type,processing_token,processed_at) VALUES(?,'command',?,?)").bind(updateId,marker,isoNow(now)).run();
  if((inserted.meta.changes??0)===0) return;
  const command=message.text.split(/\s/,1)[0]!.split('@',1)[0]!.toLowerCase();
  const reply=String(message.chat.id); const userId=String(message.from.id); const organizer=userId===cfg.organizerId;
  if(command==='/start') {
    await tg.sendMessage(reply,help()); return;
  }
  if(command==='/help') { await tg.sendMessage(reply,help()); return; }
  if(command==='/status') { await sendStatus(db,tg,cfg,reply,now); return; }
  if(command==='/my_status') {
    const poll=await activePoll(db,reply,now);
    if(!poll) { await tg.sendMessage(reply,'Активного голосування немає.'); return; }
    const row=await db.prepare('SELECT vote,status,queue_position FROM current_votes WHERE poll_instance_id=? AND telegram_user_id=?').bind(poll.id,userId).first<{vote:string;status:string;queue_position:number|null}>();
    const labels:Record<string,string>={confirmed:'в основному складі',waiting:'у резерві',declined:'не беру участі',retracted:'голос відкликано'};
    await tg.sendMessage(reply,row?`Ваш статус: <b>${labels[row.status]??escapeHtml(row.status)}</b>${row.status==='waiting'?`, позиція №${row.queue_position}`:''}.`:'Ви ще не голосували.'); return;
  }
  const adminCommands=new Set(['/history','/create_poll','/close_poll','/reconcile','/schedule','/schedule_poll','/disable_poll','/chat_id']);
  if(adminCommands.has(command) && !organizer) { await tg.sendMessage(reply,'Ця команда доступна лише організатору.'); return; }
  if(command==='/chat_id') { await tg.sendMessage(reply,`ID цієї групи: <code>${escapeHtml(reply)}</code>`); return; }
  if(command==='/create_poll') { try { const p=await createWeeklyPoll(db,tg,cfg,reply,now); await tg.sendMessage(reply,p.status==='open'?'Голосування активне.':'Створення голосування вже обробляється.'); } catch(error) { await tg.sendMessage(reply,error instanceof Error?escapeHtml(error.message):'Не вдалося створити голосування.'); } return; }
  if(command==='/schedule'||command==='/schedule_poll') {
    if(message.chat.type!=='group' && message.chat.type!=='supergroup') { await tg.sendMessage(reply,'Налаштовуйте розклад безпосередньо в потрібній групі.'); return; }
    try {
      const {startDate,startTime,closeDate,closeTime,location,gameDate,gameTime,maxPlayers,minPlayers}=parseScheduleCommand(message.text,now,cfg);
      const start=localDateTime(startDate!,startTime!,cfg.timezone); const close=localDateTime(closeDate!,closeTime!,cfg.timezone);
      const game=localDateTime(gameDate,gameTime,cfg.timezone);
      const duration=close.utc.getTime()-start.utc.getTime();
      if(duration<=0 || duration>7*86400000) throw new Error('Закриття має бути після старту, але не пізніше ніж через 7 днів.');
      if(close.utc.getTime()<=now.getTime()+5000) throw new Error('Час закриття має бути в майбутньому.');
      if(game.utc<=close.utc||game.utc.getTime()-close.utc.getTime()>7*86400000) throw new Error('Гра має починатися після закриття голосування, але не пізніше ніж через 7 днів.');
      await saveWeeklySchedule(db,reply,start.stamp,close.stamp,{location,gameDate:game.stamp.slice(0,10),gameTime,maxPlayers,minPlayers},userId,now);
      await reconcileLifecycle(db,tg,cfg,now);
      await tg.sendMessage(reply,`Щотижневий розклад увімкнено.\nСтарт голосування: <b>${startDate} ${startTime}</b>\nЗакриття: <b>${closeDate} ${closeTime}</b>\nГра: <b>${escapeHtml(location)}, ${gameDate} ${gameTime}</b>\nГравців: <b>${minPlayers}–${maxPlayers}</b>\nЧасовий пояс: ${escapeHtml(cfg.timezone)}.`);
    } catch(error) { await tg.sendMessage(reply,error instanceof Error?escapeHtml(error.message):'Не вдалося зберегти розклад.'); }
    return;
  }
  if(command==='/disable_poll') { await disableWeeklySchedule(db,reply,userId,now); await tg.sendMessage(reply,'Автоматичне створення наступних опитувань у цій групі вимкнено. Активне опитування, якщо є, продовжує працювати — його можна закрити через /close_poll.'); return; }
  if(command==='/close_poll') { const p=await activePoll(db,reply,now); if(!p||p.status!=='open') await tg.sendMessage(reply,'Відкритого голосування немає.'); else { await closePoll(db,tg,cfg,p,now); await tg.sendMessage(reply,'Голосування закрито; підсумок поставлено в чергу.'); } return; }
  if(command==='/reconcile') { await reconcileLifecycle(db,tg,cfg,now); const p=await activePoll(db,reply,now); if(p) await reconcileQueue(db,p.id,now); await tg.sendMessage(reply,'Звірку завершено.'); return; }
  if(command==='/history') {
    const p=await activePoll(db,reply,now); if(!p) { await tg.sendMessage(reply,'Голосування ще не створено.'); return; }
    const rows=(await db.prepare(`SELECT h.vote,h.processed_at,p.first_name,p.last_name,p.username FROM vote_history h JOIN participants p ON p.telegram_user_id=h.telegram_user_id WHERE h.poll_instance_id=? ORDER BY h.id DESC LIMIT 100`).bind(p.id).all<{vote:string;processed_at:string;first_name:string;last_name:string|null;username:string|null}>()).results;
    const labels:Record<string,string>={yes:'Буду',no:'Не буду',retracted:'відкликано'};
    const text=rows.length?rows.map(r=>`${escapeHtml(new Date(r.processed_at).toLocaleString('uk-UA',{timeZone:cfg.timezone}))} — ${escapeHtml(personName(r))}: ${labels[r.vote]}`).join('\n'):'Історія порожня.';
    await tg.sendMessage(reply,`<b>Останні зміни</b>\n${text}`); return;
  }
}
