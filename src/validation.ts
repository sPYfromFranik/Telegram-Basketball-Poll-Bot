import type { Update, TelegramUser } from './types';

function user(value:unknown): value is TelegramUser {
  if (!value || typeof value!=='object') return false;
  const u=value as Record<string,unknown>;
  return Number.isSafeInteger(u.id) && typeof u.first_name==='string' && u.first_name.length>0;
}
export function parseUpdate(value:unknown):Update|null {
  if (!value || typeof value!=='object') return null;
  const u=value as Record<string,unknown>;
  if (!Number.isSafeInteger(u.update_id)) return null;
  if (u.poll_answer && typeof u.poll_answer==='object') {
    const p=u.poll_answer as Record<string,unknown>;
    if (typeof p.poll_id!=='string' || !Array.isArray(p.option_ids) || !p.option_ids.every(Number.isSafeInteger)) return null;
    if (!user(p.user)) return null; // anonymous voter_chat answers are irrelevant to non-anonymous user attendance
  }
  if (u.message && typeof u.message==='object') {
    const m=u.message as Record<string,unknown>;
    if (!Number.isSafeInteger(m.message_id) || !m.chat || typeof m.chat!=='object') return null;
  }
  return value as Update;
}
