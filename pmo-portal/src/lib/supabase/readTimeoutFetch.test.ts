import { describe, it, expect, vi, afterEach } from 'vitest';
import { createReadTimeoutFetch } from './readTimeoutFetch';

afterEach(() => vi.useRealTimers());

const hanging = vi.fn((_i: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
  }),
);

describe('createReadTimeoutFetch', () => {
  it('fails a stalled REST read after the limit', async () => {
    vi.useFakeTimers();
    const f = createReadTimeoutFetch(hanging, 1000);
    const p = f('http://x/rest/v1/projects?select=*');
    const assertion = expect(p).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('passes a fast read through untouched', async () => {
    const ok = new Response('[]');
    const f = createReadTimeoutFetch(vi.fn(async () => ok), 1000);
    expect(await f('http://x/rest/v1/projects')).toBe(ok);
  });

  it.each([
    ['POST', 'http://x/rest/v1/projects'],
    ['POST', 'http://x/rest/v1/rpc/do_it'],
    ['GET', 'http://x/functions/v1/export'],
    ['GET', 'http://x/storage/v1/object/a'],
    ['GET', 'http://x/auth/v1/user'],
  ])('does not bound %s %s', async (method, url) => {
    const spy = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));
    await createReadTimeoutFetch(spy, 1000)(url, { method });
    expect(spy.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it('still honours the caller abort', async () => {
    const c = new AbortController();
    const p = createReadTimeoutFetch(hanging, 1000)('http://x/rest/v1/a', { signal: c.signal });
    c.abort(new Error('gone'));
    await expect(p).rejects.toThrow('gone');
  });
});
