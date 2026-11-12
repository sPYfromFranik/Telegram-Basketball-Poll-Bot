import type { Config, PollRow } from './types';
import { currentWeekSchedule, isoNow, weeklySchedule, type PollScheduleOccurrence } from './time';
import { TelegramClient, TelegramError } from './telegram';
import { closingReminder, finalSummary } from './domain';

interface ScheduleRow {
  chat_id:string; enabled:number; create_local:string|null; close_local:string|null;
  location:string|null; game_date_local:string|null; game_time:string|null;
  max_players:number|null; min_players:number|null;
}
interface PollParameters { location:string;gameDate:string;gameTime:string;maxPlayers:number;minPlayers:number }
interface ScheduleTarget { chatId:string;schedule:PollScheduleOccurrence;parameters:PollParameters }

function defaultParameters(cfg:Config,schedule:PollScheduleOccurrence):PollParameters {
  return {location:cfg.location,gameDate:schedule.eventDate,gameTime:cfg.gameTime,maxPlayers:cfg.maxPlayers,minPlayers:cfg.minPlayers};
}
function dateDifferenceDays(left:string,right:string):number {
  return Math.round((Date.parse(`${left}T00:00:00Z`)-Date.parse(`${right}T00:00:00Z`))/86400000);
}
function shiftDate(isoDate:string,days:number):string {
  const date=new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
function parameters(cfg:Config,row:ScheduleRow,schedule:PollScheduleOccurrence):PollParameters {
  const baseClose=row.close_local?.slice(0,10);
  const gameDate=row.game_date_local&&baseClose?shiftDate(schedule.eventDate,dateDifferenceDays(row.game_date_local,baseClose)):schedule.eventDate;
  return {
    location:row.location?.trim()||cfg.location,
    gameDate,
    gameTime:row.game_time||cfg.gameTime,
    maxPlayers:row.max_players??cfg.maxPlayers,
    minPlayers:row.min_players??cfg.minPlayers
  };
}

async function occurrence(db:D1Database,cfg:Config,chatId:string,now:Date):Promise<PollScheduleOccurrence|null> {
  const row=await db.prepare('SELECT * FROM poll_schedule WHERE chat_id=?').bind(chatId).first<ScheduleRow>();
  if(!row) return chatId===cfg.chatId?currentWeekSchedule(now,cfg.timezone):null;
  if(!row.enabled) return null;
  if(!row.create_local || !row.close_local) throw new Error('Configured poll schedule is incomplete');
  return weeklySchedule(now,row.create_local,row.close_local,cfg.timezone);
}

export async function saveWeeklySchedule(db:D1Database,chatId:string,createLocal:string,closeLocal:string,settings:PollParameters,userId:string,now=new Date()):Promise<void> {
  await db.prepare(`INSERT INTO poll_schedule(chat_id,enabled,create_local,close_local,updated_at,updated_by,location,game_date_local,game_time,max_players,min_players)
    VALUES(?,1,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=1,create_local=excluded.create_local,close_local=excluded.close_local,updated_at=excluded.updated_at,updated_by=excluded.updated_by,location=excluded.location,game_date_local=excluded.game_date_local,game_time=excluded.game_time,max_players=excluded.max_players,min_players=excluded.min_players`)
    .bind(chatId,createLocal,closeLocal,isoNow(now),userId,settings.location,settings.gameDate,settings.gameTime,settings.maxPlayers,settings.minPlayers).run();
}
export async function disableWeeklySchedule(db:D1Database,chatId:string,userId:string,now=new Date()):Promise<void> {
  await db.prepare(`INSERT INTO poll_schedule(chat_id,enabled,create_local,close_local,updated_at,updated_by)
    VALUES(?,0,NULL,NULL,?,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=0,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
    .bind(chatId,isoNow(now),userId).run();
}

async function createPoll(db:D1Database,tg:TelegramClient,chatId:string,s:PollScheduleOccurrence,settings:PollParameters,now:Date):Promise<PollRow> {
  const [,month,day]=settings.gameDate.split('-');
  const title=`${settings.location} (${day}.${month}), ${settings.gameTime}`; const owner=crypto.randomUUID();
  const eventKey=`${chatId}:${s.eventKey}`;
  await db.prepare("INSERT OR IGNORE INTO poll_instances(chat_id,event_date,title,close_deadline,status,creation_token,creation_claimed_at,max_players,min_players) VALUES(?,?,?,?,'creating',?,?,?,?)").bind(chatId,eventKey,title,s.closeAt.toISOString(),owner,isoNow(now),settings.maxPlayers,settings.minPlayers).run();
  let row=await db.prepare('SELECT * FROM poll_instances WHERE chat_id=? AND event_date=?').bind(chatId,eventKey).first<PollRow>();
  if(!row) throw new Error('Failed to reserve weekly poll');
  const staleClaim=!row.creation_claimed_at || new Date(row.creation_claimed_at).getTime()<now.getTime()-120000;
  if(row.status==='create_failed' || (row.status==='creating' && staleClaim)) {
    const claim=await db.prepare("UPDATE poll_instances SET status='creating',creation_token=?,creation_claimed_at=? WHERE id=? AND (status='create_failed' OR (status='creating' AND (creation_claimed_at IS NULL OR creation_claimed_at<?)))").bind(owner,isoNow(now),row.id,new Date(now.getTime()-120000).toISOString()).run();
    if((claim.meta.changes??0)>0) row={...row,status:'creating',creation_token:owner};
  }
  if(row.creation_token!==owner) return row;
  try {
    const message=await tg.sendPoll(chatId,title,Math.floor(s.closeAt.getTime()/1000));
    await db.prepare("UPDATE poll_instances SET telegram_poll_id=?,message_id=?,created_at=?,status='open',creation_token=NULL,creation_claimed_at=NULL WHERE id=? AND creation_token=?").bind(message.poll.id,message.message_id,isoNow(now),row.id,owner).run();
  } catch(error) {
    await db.prepare("UPDATE poll_instances SET status='create_failed',creation_token=NULL,creation_claimed_at=NULL WHERE id=? AND creation_token=?").bind(row.id,owner).run(); throw error;
  }
  return (await db.prepare('SELECT * FROM poll_instances WHERE id=?').bind(row.id).first<PollRow>())!;
}

export async function createWeeklyPoll(db:D1Database,tg:TelegramClient,cfg:Config,chatId:string,now=new Date()):Promise<PollRow> {
  const s=await occurrence(db,cfg,chatId,now);
  if(!s) throw new Error('Для цього чату спочатку налаштуйте /schedule.');
  const row=await db.prepare('SELECT * FROM poll_schedule WHERE chat_id=?').bind(chatId).first<ScheduleRow>();
  return createPoll(db,tg,chatId,s,row?parameters(cfg,row,s):defaultParameters(cfg,s),now);
}

export async function closePoll(db:D1Database,tg:TelegramClient,cfg:Config,poll:PollRow,now=new Date()):Promise<boolean> {
  const claim=await db.prepare("UPDATE poll_instances SET status='closing',closing_started_at=? WHERE id=? AND status='open'").bind(isoNow(now),poll.id).run();
  if((claim.meta.changes??0)===0) return false;
  try {
    if(poll.message_id!==null) {
      try { await tg.stopPoll(poll.chat_id,poll.message_id); }
      catch(error) { if(!(error instanceof TelegramError && error.status===400)) throw error; }
    }
    const count=await db.prepare("SELECT COUNT(*) count FROM current_votes WHERE poll_instance_id=? AND vote='yes'").bind(poll.id).first<{count:number}>();
    const text=finalSummary(cfg.organizerId,count?.count??0,poll.max_players,poll.min_players);
    await db.batch([
      db.prepare("UPDATE poll_instances SET status='closed',closing_started_at=NULL,final_summary_queued_at=COALESCE(final_summary_queued_at,?) WHERE id=? AND status='closing'").bind(isoNow(now),poll.id),
      db.prepare("INSERT OR IGNORE INTO notification_outbox(dedupe_key,poll_instance_id,kind,chat_id,text,available_at) VALUES(?,?,'final_summary',?,?,?)").bind(`final:${poll.id}`,poll.id,poll.chat_id,text,isoNow(now))
    ]);
    return true;
  } catch(error) {
    await db.prepare("UPDATE poll_instances SET status='open',closing_started_at=NULL WHERE id=? AND status='closing'").bind(poll.id).run(); throw error;
  }
}

export async function queueClosingReminders(db:D1Database,now=new Date()):Promise<void> {
  const reminderWindowEnd=new Date(now.getTime()+60*60*1000).toISOString();
  const polls=(await db.prepare("SELECT * FROM poll_instances WHERE status='open' AND closing_reminder_processed_at IS NULL AND close_deadline>? AND close_deadline<=? ORDER BY id").bind(now.toISOString(),reminderWindowEnd).all<PollRow>()).results;
  for(const poll of polls) {
    const count=await db.prepare("SELECT COUNT(*) count FROM current_votes WHERE poll_instance_id=? AND vote='yes'").bind(poll.id).first<{count:number}>();
    if((count?.count??0)>poll.max_players) {
      await db.prepare("UPDATE poll_instances SET closing_reminder_processed_at=? WHERE id=? AND status='open' AND closing_reminder_processed_at IS NULL").bind(isoNow(now),poll.id).run();
      continue;
    }
    await db.batch([
      db.prepare("UPDATE poll_instances SET closing_reminder_processed_at=? WHERE id=? AND status='open' AND closing_reminder_processed_at IS NULL").bind(isoNow(now),poll.id),
      db.prepare("INSERT OR IGNORE INTO notification_outbox(dedupe_key,poll_instance_id,kind,chat_id,text,available_at) VALUES(?,?,'closing_reminder',?,?,?)").bind(`closing-reminder:${poll.id}`,poll.id,poll.chat_id,closingReminder(),isoNow(now))
    ]);
  }
}

export async function reconcileLifecycle(db:D1Database,tg:TelegramClient,cfg:Config,now=new Date()):Promise<void> {
  const rows=(await db.prepare('SELECT * FROM poll_schedule WHERE enabled=1').all<ScheduleRow>()).results;
  const targets:ScheduleTarget[]=rows.flatMap(row=>{
    if(!row.create_local||!row.close_local) return [];
    const schedule=weeklySchedule(now,row.create_local,row.close_local,cfg.timezone);
    return [{chatId:row.chat_id,schedule,parameters:parameters(cfg,row,schedule)}];
  });
  if(!rows.length) {
    const schedule=currentWeekSchedule(now,cfg.timezone);
    targets.push({chatId:cfg.chatId,schedule,parameters:defaultParameters(cfg,schedule)});
  }
  for(const target of targets) if(now>=target.schedule.createAt && now<target.schedule.closeAt) await createPoll(db,tg,target.chatId,target.schedule,target.parameters,now);
  await queueClosingReminders(db,now);
  await db.prepare("UPDATE poll_instances SET status='open',closing_started_at=NULL WHERE status='closing' AND final_summary_queued_at IS NULL AND closing_started_at<?").bind(new Date(now.getTime()-120000).toISOString()).run();
  const due=(await db.prepare("SELECT * FROM poll_instances WHERE status='open' AND close_deadline<=? ORDER BY id").bind(now.toISOString()).all<PollRow>()).results;
  for(const poll of due) await closePoll(db,tg,cfg,poll,now);
}
