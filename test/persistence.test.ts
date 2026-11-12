import { describe,expect,it,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleCommand } from '../src/commands';
import type { Config,Message } from '../src/types';

const sql=readFileSync(resolve('migrations/0001_initial.sql'),'utf8');
const scheduleSql=readFileSync(resolve('migrations/0002_poll_schedule.sql'),'utf8');
const perChatScheduleSql=readFileSync(resolve('migrations/0003_per_chat_schedule.sql'),'utf8');
const pollParametersSql=readFileSync(resolve('migrations/0004_poll_parameters.sql'),'utf8');
const closingReminderSql=readFileSync(resolve('migrations/0005_closing_reminder.sql'),'utf8');
const cfg:Config={botToken:'x',webhookSecret:'s',chatId:'-1001',organizerId:'1',allowedChatIds:['-1001'],timezone:'Europe/Kyiv',maxPlayers:18,minPlayers:10,location:'Католицький',gameTime:'20:30'};
describe('durable idempotency contracts',()=>{
  it('prevents a weekly poll from being created twice',()=>expect(sql).toMatch(/event_date TEXT NOT NULL UNIQUE/));
  it('deduplicates Telegram update IDs',()=>expect(sql).toMatch(/update_id INTEGER PRIMARY KEY/));
  it('allows only one active application per participant and poll',()=>expect(sql).toMatch(/CREATE UNIQUE INDEX idx_one_active_application/));
  it('deduplicates final summaries and every outbox intent',()=>expect(sql).toMatch(/dedupe_key TEXT NOT NULL UNIQUE/));
  it('persists a monotonic queue sequence',()=>expect(sql).toMatch(/CREATE TABLE applications[\s\S]*id INTEGER PRIMARY KEY AUTOINCREMENT/));
  it('records a recovery state for poll creation and closing',()=>{expect(sql).toContain('creation_claimed_at');expect(sql).toContain('closing_started_at');});
  it('persists the configurable weekly schedule',()=>expect(scheduleSql).toContain('CREATE TABLE poll_schedule'));
  it('scopes schedules to an allowlisted chat',()=>expect(perChatScheduleSql).toContain('chat_id TEXT PRIMARY KEY'));
  it('persists per-poll limits so later schedule edits cannot change an active poll',()=>{
    expect(pollParametersSql).toContain('poll_instances ADD COLUMN max_players');
    expect(pollParametersSql).toContain('poll_instances ADD COLUMN min_players');
  });
  it('persists the one-time closing reminder decision',()=>expect(closingReminderSql).toContain('closing_reminder_processed_at'));
  it('queues a closing reminder only within the final hour and skips an over-capacity poll',()=>{
    const polls=readFileSync(resolve('src/polls.ts'),'utf8');
    expect(polls).toContain("close_deadline>? AND close_deadline<=?");
    expect(polls).toContain("(count?.count??0)>poll.max_players");
    expect(polls).toContain("'closing_reminder'");
    expect(polls).toContain('closing-reminder:${poll.id}');
  });
  it('routes reserve and promotion notifications only to the shared chat',()=>{
    const votes=readFileSync(resolve('src/votes.ts'),'utf8');
    expect(votes).not.toContain('promotion_private');
    expect(votes).not.toContain('private_notifications');
    expect(votes).toContain("pollId,poll.chat_id,groupText");
  });
  it('rejects an unauthorized organizer command',async()=>{
    const run=vi.fn(async()=>({meta:{changes:1}}));
    const statement={bind(){return this;},run};
    const db={prepare:vi.fn(()=>statement)} as unknown as D1Database;
    const sendMessage=vi.fn(async()=>({message_id:1}));
    const tg={sendMessage} as never;
    const message:Message={message_id:1,chat:{id:-1001,type:'supergroup'},from:{id:2,first_name:'Guest'},text:'/close_poll'};
    await handleCommand(db,tg,cfg,message,44,new Date('2026-11-09T10:00:00Z'));
    expect(sendMessage).toHaveBeenCalledWith('-1001','Ця команда доступна лише організатору.');
  });
  it('enforces the close deadline in the vote lookup',()=>expect(readFileSync(resolve('src/votes.ts'),'utf8')).toContain("close_deadline>?"));
  it('makes reconciliation locks durable rather than process-local',()=>expect(sql).toContain("INSERT INTO job_locks(lock_name) VALUES ('queue-reconcile'), ('scheduler')"));
});
