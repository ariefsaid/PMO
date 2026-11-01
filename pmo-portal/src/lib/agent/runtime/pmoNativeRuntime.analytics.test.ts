import { it, expect, vi } from 'vitest';
import { PmoNativeRuntime } from './pmoNativeRuntime';

async function bodyOf(getAnalytics?: () => { consent: true; sessionId?: string } | undefined) {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: false, body: null, headers: new Headers() });
  const rt = new PmoNativeRuntime({ getJwt: () => 'jwt', fnUrl: 'https://x/fn', fetchImpl: fetchImpl as never, getAnalytics });
  const run = await rt.createRun({ goal: 'hi' });
  for await (const _ of rt.subscribe(run.id)) { /* drain */ }
  return JSON.parse(fetchImpl.mock.calls[0][1].body as string) as Record<string, unknown>;
}

it('AC-PHO-092 sends the analytics flag only when the callback returns one', async () => {
  expect((await bodyOf(() => ({ consent: true, sessionId: 's1' }))).analytics).toEqual({ consent: true, sessionId: 's1' });
  expect('analytics' in (await bodyOf(() => undefined))).toBe(false);
  expect('analytics' in (await bodyOf())).toBe(false);
});
