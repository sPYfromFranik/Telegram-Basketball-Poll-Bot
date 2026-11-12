import { describe,expect,it,vi } from 'vitest';
import { queueClosingReminders } from '../src/polls';
import type { PollRow } from '../src/types';

function reminderDb(yesCount:number,maxPlayers=18) {
  const poll:PollRow={
    id:7,telegram_poll_id:'poll-7',message_id:70,chat_id:'-1001',event_date:'event-7',title:'Game',
    created_at:'2026-11-12T09:00:00.000Z',close_deadline:'2026-11-12T12:00:00.000Z',status:'open',
    final_summary_queued_at:null,closing_reminder_processed_at:null,max_players:maxPlayers,min_players:10
  };
  const statements:{sql:string;params:unknown[]}[]=[];
  const update=vi.fn(async()=>({meta:{changes:1}}));
  const batch=vi.fn(async(_items:unknown[])=>[]);
  const db={
    prepare(sql:string) {
      const statement={sql,params:[] as unknown[],bind(...params:unknown[]){this.params=params;statements.push(this);return this;},
        async all(){return {results:[poll]};},async first(){return {count:yesCount};},run:update};
      return statement;
    },
    batch
  } as unknown as D1Database;
  return {db,batch,update,statements};
}

describe('one-hour closing reminder',()=>{
  const now=new Date('2026-11-12T11:00:00.000Z');

  it('queues the reminder when Буду is below the maximum',async()=>{
    const {db,batch,statements}=reminderDb(17);
    await queueClosingReminders(db,now);
    expect(batch).toHaveBeenCalledOnce();
    const insert=statements.find(item=>item.sql.includes("'closing_reminder'"));
    expect(insert?.params).toContain('closing-reminder:7');
    expect(insert?.params).toContain('-1001');
    expect(insert?.params.some(value=>typeof value==='string'&&value.includes('залишилася година'))).toBe(true);
  });

  it.each([18,19])('records the decision without queuing when Буду is %i',async yesCount=>{
    const {db,batch,update}=reminderDb(yesCount);
    await queueClosingReminders(db,now);
    expect(update).toHaveBeenCalledOnce();
    expect(batch).not.toHaveBeenCalled();
  });
});

