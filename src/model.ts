import type { Vote } from './types';
export interface ModelState { vote:Vote; status:'confirmed'|'waiting'|'declined'|'retracted'; position:number|null; updateId:number; applicationSeq:number|null }
/** Pure reference model used by tests; SQL in votes.ts enforces the same invariants durably. */
export class AttendanceModel {
  private sequence=0;
  private readonly users=new Map<string,ModelState>();
  constructor(private readonly max:number) {}
  apply(userId:string,vote:Vote,updateId:number):boolean {
    const old=this.users.get(userId);
    if(old && updateId<=old.updateId) return false;
    const repeated=old?.vote===vote;
    let applicationSeq=old?.applicationSeq??null;
    if(vote==='yes' && (!old || old.vote!=='yes')) applicationSeq=++this.sequence;
    if(vote!=='yes') applicationSeq=null;
    this.users.set(userId,{vote,status:vote==='no'?'declined':vote==='retracted'?'retracted':'waiting',position:null,updateId,applicationSeq});
    this.reconcile();
    return !repeated || !old;
  }
  private reconcile() {
    const active=[...this.users.entries()].filter(([,s])=>s.vote==='yes').sort((a,b)=>a[1].applicationSeq!-b[1].applicationSeq!);
    active.forEach(([id,s],i)=>this.users.set(id,{...s,status:i<this.max?'confirmed':'waiting',position:i<this.max?i+1:i-this.max+1}));
  }
  get(userId:string):ModelState|undefined { return this.users.get(userId); }
  confirmed():string[] { return [...this.users].filter(([,s])=>s.status==='confirmed').sort((a,b)=>a[1].position!-b[1].position!).map(([id])=>id); }
  waiting():string[] { return [...this.users].filter(([,s])=>s.status==='waiting').sort((a,b)=>a[1].position!-b[1].position!).map(([id])=>id); }
  yesCount():number { return [...this.users.values()].filter(s=>s.vote==='yes').length; }
}
