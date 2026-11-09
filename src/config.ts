import type { Config, Env } from './types';

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`Missing required configuration: ${name}`);
  return value.trim();
}
function integer(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${name}`);
  return parsed;
}
export function config(env: Env): Config {
  const timezone = env.TIMEZONE?.trim() || 'Europe/Kyiv';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
  catch { throw new Error(`Invalid IANA timezone: ${timezone}`); }
  const botToken=required(env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN');
  const webhookSecret=required(env.TELEGRAM_WEBHOOK_SECRET, 'TELEGRAM_WEBHOOK_SECRET');
  const chatId=required(env.TELEGRAM_CHAT_ID, 'TELEGRAM_CHAT_ID');
  const organizerId=required(env.ORGANIZER_USER_ID, 'ORGANIZER_USER_ID');
  const allowedChatIds=(env.TELEGRAM_ALLOWED_CHAT_IDS?.trim() || chatId).split(',').map(value=>value.trim()).filter(Boolean);
  const location=env.POLL_LOCATION?.trim() || 'Католицький';
  const gameTime=env.GAME_TIME?.trim() || '20:30';
  if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) throw new Error('Invalid TELEGRAM_BOT_TOKEN format');
  if(!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) throw new Error('TELEGRAM_WEBHOOK_SECRET must use only A-Z, a-z, 0-9, _ and -');
  if(!/^-?\d+$/.test(chatId)) throw new Error('TELEGRAM_CHAT_ID must be an integer');
  if(!/^\d+$/.test(organizerId)) throw new Error('ORGANIZER_USER_ID must be a positive integer');
  if(!allowedChatIds.length || allowedChatIds.some(value=>!/^[-]?\d+$/.test(value))) throw new Error('TELEGRAM_ALLOWED_CHAT_IDS must be a comma-separated list of integer chat IDs');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(gameTime)) throw new Error('GAME_TIME must have HH:MM format');
  if(location.length>240) throw new Error('POLL_LOCATION is too long');
  return {
    botToken,
    webhookSecret,
    chatId,
    organizerId,
    allowedChatIds:[...new Set(allowedChatIds)],
    timezone,
    maxPlayers: integer(env.MAX_PLAYERS, 18, 'MAX_PLAYERS'),
    minPlayers: integer(env.MIN_PLAYERS, 10, 'MIN_PLAYERS'),
    location,
    gameTime
  };
}
