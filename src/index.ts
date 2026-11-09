import type { Env } from './types';
import { config } from './config';
import { parseUpdate } from './validation';
import { TelegramClient } from './telegram';
import { ingestPollAnswer, reconcileQueue } from './votes';
import { handleCommand } from './commands';
import { drainOutbox } from './outbox';
import { reconcileLifecycle } from './polls';

async function webhook(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
  const cfg=config(env);
  if(request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==cfg.webhookSecret) return new Response('Unauthorized',{status:401});
  const length=Number(request.headers.get('content-length')??0);
  if(length>1_000_000) return new Response('Payload too large',{status:413});
  let raw:unknown; try { raw=await request.json(); } catch { return new Response('Invalid JSON',{status:400}); }
  const update=parseUpdate(raw); if(!update) return new Response('Invalid update',{status:400});
  if(update.message) {
    const chatId=String(update.message.chat.id);
    const command=update.message.text?.split(/\s/,1)[0]?.split('@',1)[0]?.toLowerCase();
    const organizerDiscovery=command==='/chat_id' && String(update.message.from?.id??'')===cfg.organizerId;
    if(!cfg.allowedChatIds.includes(chatId) && !organizerDiscovery) return new Response('OK');
  }
  const tg=new TelegramClient(cfg); const now=new Date();
  try {
    if(update.poll_answer) {
      const changed=await ingestPollAnswer(env.DB,update.update_id,update.poll_answer,now);
      if(changed) {
        const poll=await env.DB.prepare('SELECT id FROM poll_instances WHERE telegram_poll_id=?').bind(update.poll_answer.poll_id).first<{id:number}>();
        if(poll) ctx.waitUntil(reconcileQueue(env.DB,poll.id,now).then(()=>drainOutbox(env.DB,tg)).catch(e=>console.error('async poll processing failed',e instanceof Error?e.message:String(e))));
      }
    } else if(update.message?.text?.startsWith('/')) await handleCommand(env.DB,tg,cfg,update.message,update.update_id,now);
    ctx.waitUntil(drainOutbox(env.DB,tg).catch(e=>console.error('outbox drain failed',e instanceof Error?e.message:String(e))));
    return new Response('OK');
  } catch(error) {
    console.error('webhook processing failed',error instanceof Error?error.message:String(error));
    return new Response('Temporary failure',{status:500});
  }
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health') return Response.json({ok:true,service:'basketball-attendance-bot'});
    if(request.method==='POST'&&url.pathname==='/webhook') return webhook(request,env,ctx);
    return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
  },
  async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext):Promise<void> {
    const cfg=config(env); const tg=new TelegramClient(cfg); const now=new Date();
    ctx.waitUntil(reconcileLifecycle(env.DB,tg,cfg,now).then(()=>drainOutbox(env.DB,tg,now)).catch(e=>console.error('scheduled reconciliation failed',e instanceof Error?e.message:String(e))));
  }
} satisfies ExportedHandler<Env>;
