import { describe,expect,it } from 'vitest';
import { currentWeekSchedule,localDateTime,localParts,weeklySchedule,zonedDateToUtc } from '../src/time';

describe('Kyiv weekly schedule',()=>{
  it('calculates the upcoming Wednesday from Monday',()=>expect(currentWeekSchedule(new Date('2026-11-09T10:01:00Z'),'Europe/Kyiv').eventDate).toBe('2026-11-11'));
  it('formats a zero-padded month and day',()=>expect(currentWeekSchedule(new Date('2026-01-05T10:00:00Z'),'Europe/Kyiv').eventMonthDay).toBe('01.07'));
  it('creates at Monday 12:00 Kyiv in winter',()=>expect(currentWeekSchedule(new Date('2026-11-09T10:00:00Z'),'Europe/Kyiv').createAt.toISOString()).toBe('2026-11-09T10:00:00.000Z'));
  it('creates at Monday 12:00 Kyiv in summer',()=>expect(currentWeekSchedule(new Date('2026-07-06T09:00:00Z'),'Europe/Kyiv').createAt.toISOString()).toBe('2026-07-06T09:00:00.000Z'));
  it('handles the spring daylight-saving transition',()=>expect(zonedDateToUtc(2026,3,30,12,0,'Europe/Kyiv').toISOString()).toBe('2026-03-30T09:00:00.000Z'));
  it('handles the autumn daylight-saving transition',()=>expect(zonedDateToUtc(2026,10,26,12,0,'Europe/Kyiv').toISOString()).toBe('2026-10-26T10:00:00.000Z'));
  it('closes Wednesday at 11:55 Kyiv',()=>{const s=currentWeekSchedule(new Date('2026-11-09T12:00:00Z'),'Europe/Kyiv');expect(localParts(s.closeAt,'Europe/Kyiv')).toMatchObject({weekday:'Wed',hour:11,minute:55});});
});

describe('configurable weekly schedule',()=>{
  it('parses a Kyiv local date and time',()=>expect(localDateTime('06.11.2026','19:30','Europe/Kyiv').utc.toISOString()).toBe('2026-11-06T17:30:00.000Z'));
  it('keeps the same Kyiv wall-clock time after DST changes',()=>{
    const s=weeklySchedule(new Date('2027-04-02T00:00:00Z'),'2026-11-06T19:30','2026-11-06T19:45','Europe/Kyiv');
    expect(localParts(s.createAt,'Europe/Kyiv')).toMatchObject({weekday:'Fri',hour:19,minute:30});
  });
  it('moves to the next occurrence after closing',()=>{
    const s=weeklySchedule(new Date('2026-11-06T18:00:00Z'),'2026-11-06T19:30','2026-11-06T19:45','Europe/Kyiv');
    expect(s.createAt.toISOString()).toBe('2026-11-13T17:30:00.000Z');
  });
  it('rejects a closing time before the start',()=>expect(()=>weeklySchedule(new Date(),'2026-11-06T20:00','2026-11-06T19:00','Europe/Kyiv')).toThrow());
});
