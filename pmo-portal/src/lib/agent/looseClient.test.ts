import { describe, expect, it, vi } from 'vitest';
import { asFunctions, readOne, readRows, toLikeTerm, withTimeout } from '../../../../supabase/functions/agent-chat/looseClient';

describe('looseClient (#787)', () => {
  it('NFR-AIN-SEC-002 strips PostgREST pattern characters from a search term', () => {
    expect(toLikeTerm('WO-1%_*\\x')).toBe('WO-1 x');
    expect(toLikeTerm('  a   b ')).toBe('a b');
  });
  it('reads rows / one, and throws on a db error without echoing data', async () => {
    expect(await readRows(Promise.resolve({ data: [{ a: 1 }], error: null }))).toEqual([{ a: 1 }]);
    expect(await readRows(Promise.resolve({ data: null, error: null }))).toEqual([]);
    expect(await readOne(Promise.resolve({ data: { a: 1 }, error: null }))).toEqual({ a: 1 });
    await expect(readRows(Promise.resolve({ data: null, error: { code: '42501', message: 'x' } }))).rejects.toThrow('read failed (42501)');
  });
  it('asFunctions finds a functions.invoke client, else null', () => {
    expect(asFunctions({ functions: { invoke: vi.fn() } })).not.toBeNull();
    expect(asFunctions({ from: vi.fn() })).toBeNull();
  });
  it('withTimeout rejects after the deadline', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 1000);
    const assertion = expect(p).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    vi.useRealTimers();
  });
});
