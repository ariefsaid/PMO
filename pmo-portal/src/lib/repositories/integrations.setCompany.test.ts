/**
 * AC-EAC-115 — the Company-selection seam surfaces the edge function's own message.
 * `FunctionsHttpError` does not parse the body; without this the admin sees
 * "Edge Function returned a non-2xx status code" instead of the reason activation was refused.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';
import { erpActivationRefusalOf } from './erpActivationRefusal';

const invoke = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
// Imported once at module load (vi.mock above is hoisted, so the seam still sees the mocked client) —
// a per-test dynamic import put the cold load of this large module inside each test's timeout.
import { repositories } from './index';

function httpError(status: number, body: unknown) {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context?: Response };
  err.context = new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
  return err;
}

describe('repositories.integrations.setCompany', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('AC-EAC-115 surfaces the endpoint message and code on a 422', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(422, {
        // The EXACT body the endpoint sends on an unsupported major (review #650: CONFIG_REJECTED,
        // aligned with the handler's other 422 bodies).
        error: 'CONFIG_REJECTED',
        message: 'ERPNext 14 is not supported (PMO supports 15 and 16). No connection was activated.',
      }),
    });
    await expect(repositories.integrations.setCompany('org-1', 'erpnext', 'ACME')).rejects.toMatchObject({
      message: 'ERPNext 14 is not supported (PMO supports 15 and 16). No connection was activated.',
      code: 'CONFIG_REJECTED',
    });
  });

  it('AC-EAC-115 a network failure (no .context) still throws an AppError', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to send a request to the Edge Function') });
    await expect(repositories.integrations.setCompany('org-1', 'erpnext', 'ACME')).rejects.toBeInstanceOf(AppError);
  });

  it('#656 a missing-read-permissions refusal carries the unreadable doctypes to the UI', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(422, {
        error: 'CONFIG_REJECTED', reason: 'erpnext-missing-read-permissions', missing: ['Timesheet', 'GL Entry'],
        message: 'The ERPNext integration user cannot read: Timesheet, GL Entry. …',
      }),
    });
    const err = await repositories.integrations.setCompany('org-1', 'erpnext', 'ACME').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(erpActivationRefusalOf(err)).toEqual({ kind: 'missing-reads', doctypes: ['Timesheet', 'GL Entry'] });
  });

  it('#656 an unsupported-version refusal carries the version to the UI', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(422, {
        error: 'CONFIG_REJECTED', reason: 'erpnext-unsupported-version', versionMajor: 14, supportedMajors: [15, 16],
        message: 'ERPNext 14 is not supported (PMO supports 15 and 16). No connection was activated.',
      }),
    });
    const err = await repositories.integrations.setCompany('org-1', 'erpnext', 'ACME').catch((e: unknown) => e);
    expect(erpActivationRefusalOf(err)).toEqual({ kind: 'unsupported-version', versionMajor: 14, supportedMajors: [15, 16] });
  });

  it('#656 a refusal with no recognised reason (or a malformed one) carries none — the UI falls back to the generic copy', async () => {
    for (const body of [
      { error: 'CONFIG_REJECTED', message: 'ERPNext binding is not active' },
      { error: 'CONFIG_REJECTED', reason: 'erpnext-missing-read-permissions', missing: 'Timesheet', message: 'x' },
      { error: 'CONFIG_REJECTED', reason: 'erpnext-missing-read-permissions', missing: [], message: 'x' },
      { error: 'CONFIG_REJECTED', reason: 'erpnext-unsupported-version', versionMajor: '14', supportedMajors: [15, 16], message: 'x' },
      { error: 'CONFIG_REJECTED', reason: 'erpnext-unsupported-version', versionMajor: 14, message: 'x' },
      { error: 'CONFIG_REJECTED', reason: 'erpnext-unsupported-version', versionMajor: 14, supportedMajors: [], message: 'x' },
      { error: 'CONFIG_REJECTED', reason: 'erpnext-unsupported-version', versionMajor: 14, supportedMajors: ['15'], message: 'x' },
    ]) {
      invoke.mockResolvedValue({ data: null, error: httpError(422, body) });
      const err = await repositories.integrations.setCompany('org-1', 'erpnext', 'ACME').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(erpActivationRefusalOf(err)).toBeNull();
    }
    expect(erpActivationRefusalOf(new Error('plain'))).toBeNull();
  });
});
