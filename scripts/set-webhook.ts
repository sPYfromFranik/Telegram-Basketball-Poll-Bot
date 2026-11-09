export {};
const token=process.env.TELEGRAM_BOT_TOKEN;
const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
const workerUrl=process.env.WORKER_URL?.replace(/\/$/,'');
if(!token||!secret||!workerUrl) throw new Error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and WORKER_URL in this terminal session.');
const response=await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:`${workerUrl}/webhook`,secret_token:secret,allowed_updates:['message','poll_answer'],drop_pending_updates:false,max_connections:1})});
const result=await response.json();
if(!response.ok) throw new Error(`setWebhook failed: ${JSON.stringify(result)}`);
console.log(JSON.stringify(result,null,2));
