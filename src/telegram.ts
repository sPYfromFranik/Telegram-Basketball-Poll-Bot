import type { Config } from './types';

export class TelegramError extends Error {
  constructor(message:string, readonly retryAfter?:number, readonly status?:number) { super(message); }
}
export class TelegramClient {
  constructor(
    private readonly cfg:Config,
    private readonly fetcher:typeof fetch = (input, init) => fetch(input, init),
  ) {}
  private async call<T>(method:string, body:Record<string,unknown>, attempts=3):Promise<T> {
    let last:unknown;
    for (let attempt=0;attempt<attempts;attempt++) {
      try {
        const response = await this.fetcher(`https://api.telegram.org/bot${this.cfg.botToken}/${method}`, {
          method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(8_000)
        });
        const data = await response.json() as {ok:boolean;result?:T;description?:string;parameters?:{retry_after?:number}};
        if (data.ok && data.result !== undefined) return data.result;
        const retryAfter=data.parameters?.retry_after;
        const error=new TelegramError(data.description ?? `Telegram HTTP ${response.status}`,retryAfter,response.status);
        if (response.status<500 && response.status!==429) throw error;
        last=error;
        await new Promise(r=>setTimeout(r, Math.min((retryAfter ?? 2**attempt)*1000, 5000)));
      } catch (error) {
        if (error instanceof TelegramError && error.status && error.status<500 && error.status!==429) throw error;
        last=error;
        if (attempt<attempts-1) await new Promise(r=>setTimeout(r,250*2**attempt));
      }
    }
    throw last instanceof Error ? last : new TelegramError('Telegram request failed');
  }
  sendMessage(chatId:string,text:string,extra:Record<string,unknown>={}) {
    return this.call<{message_id:number}>('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,...extra});
  }
  sendPoll(chatId:string,question:string,closeDate:number) {
    return this.call<{message_id:number;poll:{id:string}}>('sendPoll',{
      chat_id:chatId,question,options:[{text:'Буду'},{text:'Не буду'}],is_anonymous:false,
      allows_multiple_answers:false,allows_revoting:true,close_date:closeDate
    });
  }
  stopPoll(chatId:string,messageId:number) { return this.call('stopPoll',{chat_id:chatId,message_id:messageId}); }
}

export function escapeHtml(value:string):string { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
export function mention(userId:string,name:string):string { return `<a href="tg://user?id=${encodeURIComponent(userId)}">${escapeHtml(name)}</a>`; }
