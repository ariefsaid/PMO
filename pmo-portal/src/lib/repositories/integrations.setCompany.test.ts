/**
 * AC-EAC-115 — the Company-selection seam surfaces the edge function's own message.
 * `FunctionsHttpError` does not parse the body; without this the admin sees
 * "Edge Function returned a non-2xx status code" instead of the reason activation was refused.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const invoke = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

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
    const { repositories } = await import('./index');
    invoke.mockResolvedValue({
      data: null,
      error: httpError(422, {
        error: 'config-rejected',
        message: 'ERPNext 14 is not supported (PMO supports 15 and 16). No connection was activated.',
      }),
    });
    await expect(repositories.integrations.setCompany('org-1', 'erpnext', 'ACME')).rejects.toMatchObject({
      message: 'ERPNext 14 is not supported (PMO supports 15 and 16). No connection was activated.',
      code: 'config-rejected',
    });
  });

  it('AC-EAC-115 a network failure (no .context) still throws an AppError', async () => {
    const { repositories } = await import('./index');
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to send a request to the Edge Function') });
    await expect(repositories.integrations.setCompany('org-1', 'erpnext', 'ACME')).rejects.toBeInstanceOf(AppError);
  });
});
