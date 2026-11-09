import { describe,expect,it,vi } from 'vitest';
import { escapeHtml,mention,TelegramClient } from '../src/telegram';
import { parseUpdate } from '../src/validation';
import type { Config } from '../src/types';
const cfg:Config={botToken:'token',webhookSecret:'secret',chatId:'-1001',organizerId:'1',allowedChatIds:['-1001'],timezone:'Europe/Kyiv',maxPlayers:18,minPlayers:10,location:'Католицький',gameTime:'20:30'};
describe('Telegram safety and reliability',()=>{
  it('creates ID mentions for users without usernames',()=>expect(mention('42','Імʼя')).toContain('tg://user?id=42'));
  it('escapes untrusted Telegram HTML',()=>expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;'));
  it('rejects malformed updates',()=>expect(parseUpdate({update_id:'bad'})).toBeNull());
  it('accepts poll vote retractions',()=>expect(parseUpdate({update_id:1,poll_answer:{poll_id:'p',option_ids:[],user:{id:1,first_name:'A'}}})).not.toBeNull());
  it('retries transient Telegram failures',async()=>{let n=0;const f=vi.fn(async()=>{n++;return new Response(JSON.stringify(n<3?{ok:false,description:'temporary'}:{ok:true,result:{message_id:1}}),{status:n<3?500:200,headers:{'content-type':'application/json'}})});await new TelegramClient(cfg,f as typeof fetch).sendMessage('1','x');expect(f).toHaveBeenCalledTimes(3);});
  it('does not retry permanent Telegram errors',async()=>{const f=vi.fn(async()=>new Response(JSON.stringify({ok:false,description:'forbidden'}),{status:403,headers:{'content-type':'application/json'}}));await expect(new TelegramClient(cfg,f as typeof fetch).sendMessage('1','x')).rejects.toThrow('forbidden');expect(f).toHaveBeenCalledOnce();});
});
