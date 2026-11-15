import { describe, expect, it } from 'vitest';
import { mapInOrderBounded, memoiseRead } from './boundedPool.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('erpnext/boundedPool (#2120)', () => {
  it('AC-2120-2 rejects with the EARLIEST failing item even when a later one fails first, and starts nothing after a failure', async () => {
    const started: number[] = [];
    const run = mapInOrderBounded([0, 1, 2, 3, 4, 5, 6, 7], 4, async (n) => {
      started.push(n);
      if (n === 3) { await sleep(1); throw new Error('item 3'); }
      if (n === 1) { await sleep(10); throw new Error('item 1'); }
      await sleep(20);
      return n;
    });
    await expect(run).rejects.toThrow('item 1');
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('AC-2120-2 returns results in input order and handles fewer items than the limit', async () => {
    expect(await mapInOrderBounded([30, 10, 20], 4, async (ms) => { await sleep(ms); return ms; })).toEqual([30, 10, 20]);
    expect(await mapInOrderBounded([], 4, async () => 1)).toEqual([]);
  });

  it('AC-2120-1 memoiseRead shares one read per key and forgets a failed one', async () => {
    let calls = 0;
    const read = memoiseRead(async (key: string) => { calls += 1; if (calls === 1) throw new Error('down'); return key; });
    await expect(read('a')).rejects.toThrow('down');
    expect(await Promise.all([read('a'), read('a')])).toEqual(['a', 'a']);
    expect(await read('b')).toBe('b');
    expect(calls).toBe(3);
  });
});
