import { describe,expect,it,vi } from 'vitest';
import { countYesAt } from '../src/vote-counts';

describe('quorum snapshot',()=>{
  it('counts each participant latest vote no later than the checkpoint',async()=>{
    const first=vi.fn(async()=>({count:10}));
    const bind=vi.fn(function(this:{first:typeof first}){ return this; });
    const prepare=vi.fn((sql:string)=>({bind,first,sql}));
    const db={prepare} as unknown as D1Database;
    const deadline='2026-11-11T09:55:00.000Z';

    await expect(countYesAt(db,7,deadline)).resolves.toBe(10);
    expect(prepare.mock.calls[0]?.[0]).toContain('MAX(h2.id)');
    expect(bind).toHaveBeenCalledWith(7,deadline,deadline);
  });
});
