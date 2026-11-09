import { TelegramClient, TelegramError } from './telegram';

interface OutboxRow { id:number;dedupe_key:string;kind:string;chat_id:string;text:string;attempts:number;fallback_chat_id:string|null;fallback_text:string|null }
function errorText(error:unknown):string { return (error instanceof Error?error.message:String(error)).slice(0,500); }
export async function drainOutbox(db:D1Database,tg:TelegramClient,now=new Date(),limit=10):Promise<number> {
  const rows=(await db.prepare("SELECT id,dedupe_key,kind,chat_id,text,attempts,fallback_chat_id,fallback_text FROM notification_outbox WHERE (state='pending' OR (state='sending' AND claimed_at<?)) AND available_at<=? ORDER BY id LIMIT ?").bind(new Date(now.getTime()-60000).toISOString(),now.toISOString(),limit).all<OutboxRow>()).results;
  let sent=0;
  for(const row of rows) {
    const claim=await db.prepare("UPDATE notification_outbox SET state='sending',claimed_at=?,attempts=attempts+1 WHERE id=? AND (state='pending' OR (state='sending' AND claimed_at<?))").bind(now.toISOString(),row.id,new Date(now.getTime()-60000).toISOString()).run();
    if((claim.meta.changes??0)===0) continue;
    try {
      await tg.sendMessage(row.chat_id,row.text);
      await db.prepare("UPDATE notification_outbox SET state='sent',sent_at=?,last_error=NULL WHERE id=?").bind(new Date().toISOString(),row.id).run(); sent++;
      if(row.kind==='final_summary') await db.prepare("UPDATE poll_instances SET final_summary_sent_at=? WHERE id=(SELECT poll_instance_id FROM notification_outbox WHERE id=?)").bind(new Date().toISOString(),row.id).run();
    } catch(error) {
      const permanent=error instanceof TelegramError && error.status!==undefined && error.status>=400 && error.status<500 && error.status!==429;
      if(permanent && row.fallback_chat_id && row.fallback_text) {
        await db.batch([
          db.prepare("UPDATE notification_outbox SET state='failed',last_error=? WHERE id=?").bind(errorText(error),row.id),
          db.prepare("INSERT OR IGNORE INTO notification_outbox(dedupe_key,kind,chat_id,text,available_at) VALUES(?,'private_fallback',?,?,?)").bind(`${row.dedupe_key}:fallback`,row.fallback_chat_id,row.fallback_text,new Date().toISOString())
        ]);
      } else {
        const attempts=row.attempts+1;
        const state=attempts>=8?'failed':'pending';
        const available=new Date(Date.now()+Math.min(3600,2**attempts*15)*1000).toISOString();
        await db.prepare("UPDATE notification_outbox SET state=?,available_at=?,last_error=? WHERE id=?").bind(state,available,errorText(error),row.id).run();
      }
    }
  }
  return sent;
}
