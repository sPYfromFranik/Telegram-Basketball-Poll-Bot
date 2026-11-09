import type { PollAnswer, PollRow, TelegramUser, Vote } from './types';
import { assignQueue, personName, voteFromOptions } from './domain';
import { isoNow } from './time';
import { mention } from './telegram';

function token():string { return crypto.randomUUID(); }
function optional(value:string|undefined):string|null { return value ?? null; }

export async function ingestPollAnswer(db:D1Database,updateId:number,answer:PollAnswer,receivedAt:Date):Promise<boolean> {
  const poll=await db.prepare("SELECT * FROM poll_instances WHERE telegram_poll_id=? AND status='open' AND close_deadline>?").bind(answer.poll_id,receivedAt.toISOString()).first<PollRow>();
  if (!poll || !answer.user) return false;
  const user=answer.user;
  const vote=voteFromOptions(answer.option_ids);
  const now=receivedAt.toISOString();
  const marker=token();
  const markerExists='EXISTS(SELECT 1 FROM processed_updates WHERE update_id=? AND processing_token=?)';
  const statements:D1PreparedStatement[]=[
    db.prepare("INSERT OR IGNORE INTO processed_updates(update_id,update_type,processing_token,processed_at) VALUES(?,'poll_answer',?,?)").bind(updateId,marker,now),
    db.prepare(`INSERT INTO participants(telegram_user_id,username,first_name,last_name,updated_at) SELECT ?,?,?,?,? WHERE ${markerExists} ON CONFLICT(telegram_user_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name,updated_at=excluded.updated_at`).bind(String(user.id),optional(user.username),user.first_name,optional(user.last_name),now,updateId,marker),
    db.prepare(`INSERT INTO vote_history(poll_instance_id,telegram_user_id,update_id,vote,processed_at) SELECT ?,?,?,?,? WHERE ${markerExists}`).bind(poll.id,String(user.id),updateId,vote,now,updateId,marker),
    db.prepare(`INSERT INTO current_votes(poll_instance_id,telegram_user_id,vote,status,first_yes_at,latest_change_at,last_update_id) SELECT ?,?,?,?, ?,?,? WHERE ${markerExists} ON CONFLICT(poll_instance_id,telegram_user_id) DO UPDATE SET vote=excluded.vote,status=CASE WHEN excluded.vote='no' THEN 'declined' ELSE CASE WHEN excluded.vote='retracted' THEN 'retracted' ELSE current_votes.status END END,first_yes_at=CASE WHEN excluded.vote='yes' AND current_votes.vote!='yes' THEN excluded.latest_change_at ELSE current_votes.first_yes_at END,latest_change_at=excluded.latest_change_at,last_update_id=excluded.last_update_id WHERE excluded.last_update_id>current_votes.last_update_id`).bind(poll.id,String(user.id),vote,vote==='yes'?'confirmed':vote==='no'?'declined':'retracted',vote==='yes'?now:null,now,updateId,updateId,marker),
  ];
  if (vote==='yes') {
    statements.push(db.prepare(`INSERT INTO applications(poll_instance_id,telegram_user_id,applied_at,source_update_id) SELECT ?,?,?,? WHERE ${markerExists} AND EXISTS(SELECT 1 FROM current_votes WHERE poll_instance_id=? AND telegram_user_id=? AND vote='yes' AND last_update_id=?) AND NOT EXISTS(SELECT 1 FROM applications WHERE poll_instance_id=? AND telegram_user_id=? AND active=1)`).bind(poll.id,String(user.id),now,updateId,updateId,marker,poll.id,String(user.id),updateId,poll.id,String(user.id)));
  } else {
    statements.push(db.prepare(`UPDATE applications SET active=0,ended_at=? WHERE poll_instance_id=? AND telegram_user_id=? AND active=1 AND ${markerExists} AND EXISTS(SELECT 1 FROM current_votes WHERE poll_instance_id=? AND telegram_user_id=? AND last_update_id=?)`).bind(now,poll.id,String(user.id),updateId,marker,poll.id,String(user.id),updateId));
  }
  const result=await db.batch(statements);
  return (result[0]?.meta.changes ?? 0)>0;
}

interface ActiveRow { application_id:number; telegram_user_id:string; first_name:string; last_name:string|null; username:string|null; old_status:string }
interface WithdrawalRow { application_id:number;telegram_user_id:string;first_name:string;last_name:string|null;username:string|null }
export async function reconcileQueue(db:D1Database,pollId:number,now=new Date()):Promise<void> {
  const owner=token(); const expires=new Date(now.getTime()+30000).toISOString();
  const lock=await db.prepare("UPDATE job_locks SET owner_token=?,expires_at=? WHERE lock_name='queue-reconcile' AND (expires_at IS NULL OR expires_at<?)").bind(owner,expires,now.toISOString()).run();
  if ((lock.meta.changes??0)===0) return;
  try {
    const poll=await db.prepare('SELECT chat_id,max_players FROM poll_instances WHERE id=?').bind(pollId).first<{chat_id:string;max_players:number}>();
    if(!poll) return;
    const rows=(await db.prepare(`SELECT a.id application_id,a.telegram_user_id,p.first_name,p.last_name,p.username,a.queue_status old_status FROM applications a JOIN participants p ON p.telegram_user_id=a.telegram_user_id WHERE a.poll_instance_id=? AND a.active=1 ORDER BY a.id`).bind(pollId).all<ActiveRow>()).results;
    const withdrawals=(await db.prepare(`SELECT a.id application_id,a.telegram_user_id,p.first_name,p.last_name,p.username FROM applications a JOIN participants p ON p.telegram_user_id=a.telegram_user_id WHERE a.poll_instance_id=? AND a.active=0 AND a.queue_status='confirmed' AND NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE o.kind='promotion' AND o.related_application_id=a.id) ORDER BY a.ended_at,a.id`).bind(pollId).all<WithdrawalRow>()).results;
    const assigned=assignQueue(rows.map(r=>({userId:r.telegram_user_id,name:personName(r),applicationId:r.application_id,oldStatus:r.old_status})),poll.max_players);
    const statements:D1PreparedStatement[]=[];
    for (const item of assigned) {
      statements.push(db.prepare('UPDATE current_votes SET status=?,queue_position=? WHERE poll_instance_id=? AND telegram_user_id=? AND vote=\'yes\'').bind(item.status,item.position,pollId,item.userId));
      statements.push(db.prepare('UPDATE applications SET queue_status=? WHERE id=? AND active=1').bind(item.status,item.applicationId));
      const row=rows.find(r=>r.application_id===item.applicationId)!;
      if (row.old_status!==item.status && item.status==='waiting') {
        const text=`Усі ${poll.max_players} місць уже зайняті. Ти в резерві, позиція №${item.position}. Якщо місце звільниться, я повідомлю.`;
        const groupText=`${mention(row.telegram_user_id,item.name)}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
        statements.push(db.prepare("INSERT OR IGNORE INTO notification_outbox(dedupe_key,poll_instance_id,kind,chat_id,text,available_at) VALUES(?,?,'waiting',?,?,?)").bind(`waiting:${item.applicationId}`,pollId,poll.chat_id,groupText,isoNow(now)));
      }
      if (row.old_status==='waiting' && item.status==='confirmed') {
        const withdrawn=withdrawals.shift();
        const withdrawalText=withdrawn?`${mention(withdrawn.telegram_user_id,personName(withdrawn))} більше не бере участі.\n\n`:'';
        const group=`${withdrawalText}${mention(row.telegram_user_id,item.name)} переходить із резерву в основний склад.\n\nОсновний склад: ${Math.min(assigned.length,poll.max_players)}/${poll.max_players}\nРезерв: ${Math.max(0,assigned.length-poll.max_players)}`;
        statements.push(db.prepare("INSERT OR IGNORE INTO notification_outbox(dedupe_key,poll_instance_id,kind,chat_id,text,available_at,source_application_id,related_application_id) VALUES(?,?,'promotion',?,?,?,?,?)").bind(`promotion:${item.applicationId}`,pollId,poll.chat_id,group,isoNow(now),item.applicationId,withdrawn?.application_id??null));
      }
    }
    if(statements.length) await db.batch(statements);
  } finally {
    await db.prepare("UPDATE job_locks SET owner_token=NULL,expires_at=NULL WHERE lock_name='queue-reconcile' AND owner_token=?").bind(owner).run();
  }
}
