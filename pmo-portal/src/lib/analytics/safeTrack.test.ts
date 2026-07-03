/**
 * safeTrack — the shared fire-and-forget guard for `trackAgent*` call sites
 * (review round item 3: factors the 9 duplicated `try { trackAgentX(...) }
 * catch {}` blocks into one helper). NFR-APH-REL-001: a thrown/rejected
 * analytics call must never propagate to the caller (the real state
 * transition it sits alongside must be unaffected).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeTrack } from './safeTrack';

describe('safeTrack', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes the given function', () => {
    const fn = vi.fn();
    safeTrack(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('AC-APH-017 swallows a thrown error and does not propagate to the caller', () => {
    const fn = vi.fn(() => {
      throw new Error('posthog boom');
    });
    expect(() => safeTrack(fn)).not.toThrow();
  });

  it('logs the swallowed error via console.debug (not silent)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const err = new Error('posthog boom');
    const fn = vi.fn(() => {
      throw err;
    });
    safeTrack(fn);
    expect(debugSpy).toHaveBeenCalledWith('[analytics] agent event failed', err);
  });

  it('does not log when the function succeeds', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    safeTrack(() => {});
    expect(debugSpy).not.toHaveBeenCalled();
  });
});
