import { describe, it, expect, vi, afterEach } from 'vitest';
import { capturePosthogException } from '../../../../supabase/functions/_shared/posthogError';

// AC-EET-001: edge-function errors forward into PostHog Error Tracking (the server-side half of the
// "error monitoring via PostHog, not Sentry" story). The forwarder is a guarded, fire-and-forget
// no-op outside Deno / without POSTHOG_PROJECT_KEY, and never throws. IG-audit P2 (2026-07-10).

type DenoStub = { env: { get(k: string): string | undefined } };
function setDeno(env: Record<string, string | undefined> | null) {
  if (env === null) {
    delete (globalThis as { Deno?: DenoStub }).Deno;
  } else {
    (globalThis as { Deno?: DenoStub }).Deno = { env: { get: (k) => env[k] } };
  }
}

afterEach(() => {
  setDeno(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('capturePosthogException (AC-EET-001)', () => {
  it('is a no-op when Deno is undefined (Vitest default) — never fetches', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await capturePosthogException({ fn: 'agent-chat', errorCode: 'X' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when POSTHOG_PROJECT_KEY is absent', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: undefined });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await capturePosthogException({ fn: 'agent-chat', errorCode: 'X' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs a $exception event with the code, fn, and synthetic distinct_id', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: 'phc_test', POSTHOG_HOST: 'https://eu.i.posthog.com' });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);

    await capturePosthogException({ fn: 'admin-invite-user', errorCode: 'INVITE_ISSUE_FAILED', contextId: 'run-9', orgId: 'org-1' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://eu.i.posthog.com/i/v0/e/');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.api_key).toBe('phc_test');
    expect(body.event).toBe('$exception');
    expect(body.distinct_id).toBe('edge:admin-invite-user');
    expect(body.properties.$exception_list[0].type).toBe('INVITE_ISSUE_FAILED');
    expect(body.properties.error_code).toBe('INVITE_ISSUE_FAILED');
    expect(body.properties.context_id).toBe('run-9');
    expect(body.properties.org_id).toBe('org-1');
  });

  it('defaults to the us host when POSTHOG_HOST is unset', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: 'phc_test' });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    await capturePosthogException({ fn: 'compose-view', errorCode: 'X' });
    expect(fetchSpy.mock.calls[0][0]).toBe('https://us.i.posthog.com/i/v0/e/');
  });

  it('swallows a fetch rejection (fire-and-forget) — never throws', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: 'phc_test' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(capturePosthogException({ fn: 'agent-chat', errorCode: 'X' })).resolves.toBeUndefined();
  });
});
