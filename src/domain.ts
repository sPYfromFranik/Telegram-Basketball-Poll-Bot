import type { Vote } from './types';
import { escapeHtml, mention } from './telegram';

export interface QueueMember { userId:string; name:string; applicationId:number; oldStatus?:string }
export function voteFromOptions(ids:number[]):Vote { return ids.length===0?'retracted':ids.includes(0)?'yes':'no'; }
export function assignQueue(members:QueueMember[],max:number) {
  return members.map((m,i)=>({...m,status:i<max?'confirmed' as const:'waiting' as const,position:i<max?i+1:i-max+1}));
}
export function personName(p:{first_name?:string|null;last_name?:string|null;username?:string|null}):string {
  const full=[p.first_name,p.last_name].filter(Boolean).join(' ').trim();
  return full || (p.username?`@${p.username}`:'Учасник');
}
export function finalSummary(organizerId:string,yes:number,max:number,min:number):string {
  const org=mention(organizerId,'Організатор');
  if (yes<min) return `${org}, голосування завершено.\n\nЗаявок «Буду»: ${yes}\n\nНедостатньо учасників для гри.\nЗал скасовується.`;
  return `${org}, голосування завершено.\n\nЗаявок «Буду»: ${yes}\nОсновний склад: ${Math.min(yes,max)}\nРезерв: ${Math.max(0,yes-max)}\n\nДостатньо учасників для гри.\nЗал бронюється.`;
}
export function statusText(title:string,close:string,confirmed:string[],waiting:string[],declined:number,link?:string):string {
  const lines=[`<b>${escapeHtml(title)}</b>`,`Закриття: ${escapeHtml(close)}`,'',`<b>Основний склад (${confirmed.length})</b>`,...confirmed.map((n,i)=>`${i+1}. ${escapeHtml(n)}`),'',`<b>Резерв (${waiting.length})</b>`,...waiting.map((n,i)=>`${i+1}. ${escapeHtml(n)}`),'',`«Не буду»: ${declined}`];
  if (link) lines.push('',`<a href="${escapeHtml(link)}">Відкрити голосування</a>`);
  return lines.join('\n');
}
