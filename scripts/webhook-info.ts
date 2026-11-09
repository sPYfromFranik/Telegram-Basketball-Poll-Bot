export {};
const token=process.env.TELEGRAM_BOT_TOKEN;
if(!token) throw new Error('Set TELEGRAM_BOT_TOKEN in this terminal session.');
const response=await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const result=await response.json();
if(!response.ok) throw new Error(`getWebhookInfo failed: ${JSON.stringify(result)}`);
console.log(JSON.stringify(result,null,2));
