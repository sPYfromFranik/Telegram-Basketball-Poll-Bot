import { describe,expect,it } from 'vitest';
import { parseScheduleCommand } from '../src/commands';
import type { Config } from '../src/types';

const cfg:Config={botToken:'x',webhookSecret:'s',chatId:'-1001',organizerId:'1',allowedChatIds:['-1001'],timezone:'Europe/Kyiv',maxPlayers:18,minPlayers:10,location:'Католицький',gameTime:'20:30'};
const now=new Date('2026-11-09T10:00:00Z');

describe('/schedule parameters',()=>{
  it('uses the requested fallbacks',()=>{
    expect(parseScheduleCommand('/schedule 10.11.2026 12:00 12.11.2026 11:55',now,cfg)).toMatchObject({
      location:'Католицький',gameDate:'12.11.2026',gameTime:'20:30',maxPlayers:18,minPlayers:10
    });
  });
  it('accepts named parameters and a location with spaces',()=>{
    expect(parseScheduleCommand('/schedule 10.11.2026 12:00 12.11.2026 11:55 --location "School gym 2" --game-date 13.11.2026 --game-time 19:15 --max 20 --min 12',now,cfg)).toMatchObject({
      location:'School gym 2',gameDate:'13.11.2026',gameTime:'19:15',maxPlayers:20,minPlayers:12
    });
  });
  it('accepts the five optional positional values',()=>{
    expect(parseScheduleCommand('/schedule_poll 12:00 13:00 "Main court" 09.11.2026 21:00 16 8',now,cfg)).toMatchObject({
      location:'Main court',gameDate:'09.11.2026',gameTime:'21:00',maxPlayers:16,minPlayers:8
    });
  });
  it('rejects a minimum greater than the maximum',()=>{
    expect(()=>parseScheduleCommand('/schedule 12:00 13:00 --max 9 --min 10',now,cfg)).toThrow('Мінімальна кількість');
  });
});
