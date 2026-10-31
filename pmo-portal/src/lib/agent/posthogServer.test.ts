import { describe, it, expect, vi, afterEach } from 'vitest';
import { emitServerEvent, sanitizeServerProps } from '../../../../supabase/functions/_shared/posthogServer';

type DenoStub = { env: { get(k: string): string | undefined } };
const setDeno = (env: Record<string, string | undefined> | null) => {
  if (env === null) delete (globalThis as { Deno?: DenoStub }).Deno;
  else (globalThis as { Deno?: DenoStub }).Deno = { env: { get: (k) => env[k] } };
};
afterEach(() => { setDeno(null); vi.unstubAllGlobals(); });

describe('sanitizeServerProps (FR-PHO-004 allowlist)', () => {
  it('drops an unknown key when not strict', () => {
    expect(sanitizeServerProps('job_run', { job: 'x', status: 'ok', $ai_input: 'secret' }, false)).toEqual({ job: 'x', status: 'ok' });
  });
  it('throws on an unknown key when strict', () => {
    expect(() => sanitizeServerProps('job_run', { job: 'x', $ai_input: 'secret' }, true)).toThrow(/\$ai_input/);
  });
  it('drops objects, arrays and over-long strings even for allowed keys', () => {
    expect(sanitizeServerProps('job_run', { job: { a: 1 } as never, status: 'x'.repeat(200) }, false)).toEqual({});
  });
  it('throws on an unsafe value for an allowed key when strict', () => {
    expect(() => sanitizeServerProps('job_run', { status: 'x'.repeat(200) }, true)).toThrow(/status/);
  });
});

describe('emitServerEvent', () => {
  it('is a no-op without Deno or key, never fetches', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await emitServerEvent('job_run', 'erpnext-sweep', { job: 'erpnext-sweep', status: 'ok' });
    setDeno({});
    await emitServerEvent('job_run', 'erpnext-sweep', { job: 'erpnext-sweep', status: 'ok' });
    expect(f).not.toHaveBeenCalled();
  });
  it('posts a person-less event with a synthetic distinct id', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: 'phc_test' });
    const f = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', f);
    await emitServerEvent('job_run', 'erpnext-sweep', { job: 'erpnext-sweep', status: 'ok', items_processed: 3 });
    const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({ event: 'job_run', distinct_id: 'edge:erpnext-sweep' });
    expect(body.properties).toMatchObject({ job: 'erpnext-sweep', items_processed: 3, $process_person_profile: false });
  });
  it('swallows a rejected fetch and a hung fetch (deadline)', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: 'phc_test' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(emitServerEvent('job_run', 'erpnext-sweep', { job: 'x' })).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('abort'))))));
    await expect(emitServerEvent('job_run', 'erpnext-sweep', { job: 'x' }, { timeoutMs: 20 })).resolves.toBeUndefined();
  });
  it('registers the send with EdgeRuntime.waitUntil when present', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: 'phc_test' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const waitUntil = vi.fn();
    vi.stubGlobal('EdgeRuntime', { waitUntil });
    await emitServerEvent('job_run', 'erpnext-sweep', { job: 'x' });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
