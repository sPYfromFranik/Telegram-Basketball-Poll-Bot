export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_ALLOWED_CHAT_IDS?: string;
  ORGANIZER_USER_ID: string;
  TIMEZONE?: string;
  MAX_PLAYERS?: string;
  MIN_PLAYERS?: string;
  POLL_LOCATION?: string;
  GAME_TIME?: string;
}

export interface Config {
  botToken: string; webhookSecret: string; chatId: string; organizerId: string;
  allowedChatIds: string[];
  timezone: string; maxPlayers: number; minPlayers: number; location: string; gameTime: string;
}

export interface TelegramUser { id: number; is_bot?: boolean; first_name: string; last_name?: string; username?: string }
export interface TelegramChat { id: number; type: 'private'|'group'|'supergroup'|'channel' }
export interface PollAnswer { poll_id: string; user?: TelegramUser; voter_chat?: TelegramChat; option_ids: number[] }
export interface Message { message_id: number; from?: TelegramUser; chat: TelegramChat; text?: string }
export interface Update { update_id: number; poll_answer?: PollAnswer; message?: Message }
export type Vote = 'yes'|'no'|'retracted';

export interface PollRow {
  id: number; telegram_poll_id: string|null; message_id: number|null; chat_id: string;
  event_date: string; title: string; created_at: string|null; close_deadline: string;
  status: 'creating'|'open'|'closing'|'closed'|'create_failed'; final_summary_queued_at: string|null;
  creation_token?: string|null;
  creation_claimed_at?: string|null; closing_started_at?: string|null;
  max_players: number; min_players: number;
}
