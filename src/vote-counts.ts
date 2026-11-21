export async function countYesAt(db:D1Database,pollId:number,deadline:string):Promise<number> {
  const row=await db.prepare(`SELECT COUNT(*) count FROM vote_history h
    WHERE h.poll_instance_id=? AND h.processed_at<=? AND h.vote='yes'
      AND h.id=(SELECT MAX(h2.id) FROM vote_history h2
        WHERE h2.poll_instance_id=h.poll_instance_id
          AND h2.telegram_user_id=h.telegram_user_id
          AND h2.processed_at<=?)`).bind(pollId,deadline,deadline).first<{count:number}>();
  return row?.count??0;
}
