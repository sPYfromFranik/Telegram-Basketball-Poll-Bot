import { describe,expect,it } from 'vitest';
import { AttendanceModel } from '../src/model';
import { assignQueue,finalSummary } from '../src/domain';

function filled(count:number,max=18){const m=new AttendanceModel(max);for(let i=1;i<=count;i++)m.apply(String(i),'yes',i);return m;}
describe('attendance queue',()=>{
  it('keeps exactly 18 confirmed players',()=>expect(filled(19).confirmed()).toHaveLength(18));
  it('places player 19 first on the waiting list',()=>expect(filled(19).waiting()).toEqual(['19']));
  it('orders multiple waiting players chronologically',()=>expect(filled(21).waiting()).toEqual(['19','20','21']));
  it('promotes the earliest waiter after a confirmed withdrawal',()=>{const m=filled(20);m.apply('3','no',100);expect(m.confirmed()).toContain('19');expect(m.waiting()).toEqual(['20']);});
  it('changes Буду to Не буду',()=>{const m=filled(1);m.apply('1','no',2);expect(m.get('1')?.status).toBe('declined');});
  it('puts a returning player at the end',()=>{const m=filled(3,2);m.apply('1','no',4);m.apply('1','yes',5);expect(m.confirmed()).toEqual(['2','3']);expect(m.waiting()).toEqual(['1']);});
  it('handles a retracted vote',()=>{const m=filled(1);m.apply('1','retracted',2);expect(m.get('1')?.status).toBe('retracted');});
  it('removes a waiting participant without disturbing confirmed players',()=>{const m=filled(20);m.apply('19','no',30);expect(m.waiting()).toEqual(['20']);expect(m.confirmed()).toHaveLength(18);});
  it('does not reset position for a repeated Буду vote',()=>{const m=filled(3,2);m.apply('1','yes',10);expect(m.confirmed()).toEqual(['1','2']);expect(m.waiting()).toEqual(['3']);});
  it('ignores duplicate webhook delivery',()=>{const m=filled(1);expect(m.apply('1','no',2)).toBe(true);expect(m.apply('1','yes',2)).toBe(false);expect(m.get('1')?.vote).toBe('no');});
  it('ignores an out-of-order older update',()=>{const m=new AttendanceModel(18);m.apply('1','no',20);m.apply('1','yes',19);expect(m.get('1')?.vote).toBe('no');});
  it('deterministically breaks identical timestamps with sequence',()=>expect(assignQueue([{userId:'a',name:'A',applicationId:8},{userId:'b',name:'B',applicationId:9}],1).map(x=>x.status)).toEqual(['confirmed','waiting']));
});
describe('closing decisions',()=>{
  it('cancels with fewer than 10 applicants',()=>expect(finalSummary('1',9,18,10)).toContain('Зал скасовується'));
  it('books with exactly 10 applicants',()=>expect(finalSummary('1',10,18,10)).toContain('Зал бронюється'));
  it('counts reserve applicants above 18',()=>expect(finalSummary('1',21,18,10)).toContain('Резерв: 3'));
});
