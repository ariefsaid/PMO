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

  // SECURITY finding (2026-07-27 review round 2, LOW #4): `buildEventProperties` THROWS on a
  // forbidden key in dev/test — that throw is the loud dev-time PII tripwire. Swallowing it as a
  // `console.debug` inside safeTrack turns a loud guard into a whisper nobody notices in test
  // output. `console.error` (never rethrown — NFR-APH-REL-001/AC-APH-017 above is unconditional:
  // analytics must NEVER propagate into the real state transition, in ANY environment, so a
  // literal rethrow-in-dev is not an option) keeps the guard from going silent without breaking
  // that invariant.
  it('AC-APH-017 / SECURITY #4: logs the swallowed error via console.error (loud, never rethrown)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('posthog boom');
    const fn = vi.fn(() => {
      throw err;
    });
    safeTrack(fn);
    expect(errorSpy).toHaveBeenCalledWith('[analytics] tracking call failed', err);
  });

  it('does not log when the function succeeds', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeTrack(() => {});
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
