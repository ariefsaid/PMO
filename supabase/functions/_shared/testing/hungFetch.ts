/**
 * Test helpers for the outbound-deadline proofs (#841): a fetch that never settles until its
 * AbortSignal fires, and a scope that shrinks the 20s outbound deadline to a few ms so the proof
 * runs fast. Production code takes no injection — only the timer delay is shortened here.
 */
import { OUTBOUND_FETCH_TIMEOUT_MS } from '../fetchWithDeadline.ts';

export function hungFetch(): typeof fetch {
  return ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
}

/** Run `fn` with the outbound deadline timer shortened to `ms`; restores setTimeout afterwards. */
export async function withShortOutboundDeadline<T>(fn: () => Promise<T>, ms = 10): Promise<T> {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: () => void, delay?: number) =>
    real(handler, delay === OUTBOUND_FETCH_TIMEOUT_MS ? ms : delay)) as typeof setTimeout;
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = real;
  }
}
