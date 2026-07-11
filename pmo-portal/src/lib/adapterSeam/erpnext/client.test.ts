/**
 * AC-ENA-011 — erpnext/client.ts: token auth, exc_type/_server_messages classifier (incl. the
 * 500-TypeError non-retryable bucket), 429/Retry-After backoff with a no-blind-retry guard for
 * non-idempotent POSTs. Every call injects `fetchImpl` — no real ERPNext bench is ever required.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDoc, callMethod, erpnextRequest, ErpError, getDoc, submitDoc, cancelDoc, type ErpClientDeps } from './client.ts';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** Types the mock's inferred call signature as `(url, init)` (matching `typeof fetch`) so
 *  `.mock.calls[n]` destructures correctly — same idiom as clickup/commands.test.ts. */
function fetchDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): ErpClientDeps {
  return {
    apiKey: 'a-key',
    apiSecret: 'a-secret',
    baseUrl: 'https://erp.example.com',
    sleep: vi.fn(async () => {}),
    fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch,
  };
}

describe('erpnext/client', () => {
  it('AC-ENA-011 sends Authorization: token <key>:<secret> and URL-encodes doctype spaces', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { name: 'ACC-PINV-2026-00001' }));
    await createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' });
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://erp.example.com/api/resource/Purchase%20Invoice');
    expect((init.headers as Record<string, string>).Authorization).toBe('token a-key:a-secret');
  });

  it('AC-ENA-011 maps 417 exc_type=MandatoryError to commit-rejected', async () => {
    const deps = fetchDeps(async () =>
      jsonResponse(417, { exc_type: 'MandatoryError', _server_messages: JSON.stringify([JSON.stringify({ message: 'supplier_name is mandatory' })]) }),
    );
    await expect(createDoc(deps, 'Supplier', {})).rejects.toMatchObject({ name: 'ErpError', code: 'commit-rejected' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('AC-ENA-011 maps 417 exc_type=LinkExistsError (cancel blocked) to commit-rejected', async () => {
    const deps = fetchDeps(async () => jsonResponse(417, { exc_type: 'LinkExistsError', _server_messages: '["blocked by Purchase Receipt"]' }));
    await expect(cancelDoc(deps, 'Purchase Order', 'PUR-ORD-2026-00001')).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-ENA-011 maps 404 exc_type=DoesNotExistError to commit-rejected', async () => {
    const deps = fetchDeps(async () =>
      jsonResponse(404, { exc_type: 'DoesNotExistError', exception: 'frappe.exceptions.DoesNotExistError: Supplier None not found' }),
    );
    await expect(createDoc(deps, 'Purchase Invoice', {})).rejects.toMatchObject({ code: 'commit-rejected', status: 404 });
  });

  it('AC-ENA-011/FR-ENA-042 maps a raw 500 TypeError body to the distinct non-retryable commit-rejected bucket', async () => {
    const deps = fetchDeps(async () =>
      jsonResponse(500, { exception: "TypeError: unsupported operand type(s) for -: 'NoneType' and 'float'" }),
    );
    let caught: ErpError | undefined;
    try {
      await createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' });
    } catch (err) {
      caught = err as ErpError;
    }
    expect(caught).toBeInstanceOf(ErpError);
    expect(caught?.code).toBe('commit-rejected');
    expect(caught?.retryable).toBe(false);
    // never blindly retried — a single POST attempt, even though 500 is normally transient.
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('AC-ENA-011 retries a 429 honoring Retry-After, then succeeds (idempotent GET)', async () => {
    let call = 0;
    const deps = fetchDeps(async () => {
      call += 1;
      return call === 1
        ? jsonResponse(429, { exc_type: 'RateLimitExceededError' }, { 'Retry-After': '1' })
        : jsonResponse(200, { name: 'Spike Supplier' });
    });
    const result = await erpnextRequest(deps, { method: 'GET', path: '/api/resource/Supplier/Spike%20Supplier' });
    expect(result).toEqual({ name: 'Spike Supplier' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledWith(1000);
  });

  it('AC-ENA-011 an exhausted 5xx (idempotent GET) surfaces external-unreachable', async () => {
    const deps = fetchDeps(async () => jsonResponse(503, { exception: 'Service Unavailable' }));
    await expect(erpnextRequest(deps, { method: 'GET', path: '/api/resource/Supplier/X' })).rejects.toMatchObject({
      code: 'external-unreachable',
    });
    // bounded retry budget (default 3) — not infinite
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('FR-ENA-042 no-blind-retry guard: a non-idempotent POST on a retryable transport failure never re-POSTs', async () => {
    const deps = fetchDeps(async () => {
      throw new Error('network reset');
    });
    await expect(createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' })).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('FR-ENA-042 no-blind-retry guard: a non-idempotent POST on a retryable 5xx never re-POSTs', async () => {
    const deps = fetchDeps(async () => jsonResponse(503, { exception: 'temporarily unavailable' }));
    await expect(createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' })).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('getDoc/submitDoc/cancelDoc build the expected resource paths + docstatus bodies', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { name: 'PUR-ORD-2026-00001', docstatus: 1 }));
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;

    await getDoc(deps, 'Purchase Order', 'PUR-ORD-2026-00001');
    expect(fetchMock.mock.calls[0][0]).toBe('https://erp.example.com/api/resource/Purchase%20Order/PUR-ORD-2026-00001');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');

    await submitDoc(deps, 'Purchase Order', 'PUR-ORD-2026-00001');
    const submitInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(submitInit.method).toBe('PUT');
    expect(JSON.parse(submitInit.body as string)).toEqual({ docstatus: 1 });

    await cancelDoc(deps, 'Purchase Order', 'PUR-ORD-2026-00001');
    const cancelInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect(cancelInit.method).toBe('PUT');
    expect(JSON.parse(cancelInit.body as string)).toEqual({ docstatus: 2 });
  });

  it('callMethod GETs /api/method/<rpc>', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { erpnext: { version: '15.94.3' } }));
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const result = await callMethod(deps, 'frappe.utils.change_log.get_versions');
    expect(fetchMock.mock.calls[0][0]).toBe('https://erp.example.com/api/method/frappe.utils.change_log.get_versions');
    expect(result).toEqual({ erpnext: { version: '15.94.3' } });
  });

  it('FR-ENA-014 awaits an injected rate limiter once per attempt (worker-pool-sized token bucket, off by default)', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { name: 'X' }));
    const acquire = vi.fn(async () => {});
    await createDoc({ ...deps, rateLimiter: { acquire } }, 'Purchase Invoice', { supplier: 'Acme' });
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});
