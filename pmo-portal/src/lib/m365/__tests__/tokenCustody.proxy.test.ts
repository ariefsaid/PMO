/**
 * AC-M365-110/111/112/113/114 — graph_proxy: decrypt → call Graph, auto-refresh, scope enforcement.
 * Real graphTokenCrypto decrypt runs against connection rows seeded with REAL encrypted tokens.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleGraphProxy } from '../../../../../supabase/functions/m365-token-custody/proxy';
import { scopeCoversPath } from '../../../../../supabase/functions/m365-token-custody/proxy';
import { mockClient, deps, encryptForTest } from './m365MockDeps';
import type { ConnectionRow, GraphProxyRequest } from '../../../../../supabase/functions/m365-token-custody/types';

const GRAPH_URL = 'https://graph.microsoft.com/v1.0/me/drive/root/children';
const TOKEN_URL = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/token';

function callerClient() {
  return mockClient({
    profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
    org_features: [{ data: { enabled: true }, error: null }],
  });
}

async function connection(overrides: Partial<ConnectionRow> = {}): Promise<ConnectionRow> {
  return {
    id: 'conn-1',
    org_id: 'org-1',
    user_id: 'user-1',
    entra_tenant_id: 'test-tenant-id',
    entra_user_object_id: null,
    scopes: ['Files.Read', 'offline_access'],
    refresh_token_ciphertext: await encryptForTest('REFRESH-TOKEN'),
    access_token_ciphertext: await encryptForTest('ACCESS-TOKEN'),
    access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    refresh_token_expires_at: null,
    key_id: 'kek-v1',
    status: 'active',
    connected_at: new Date().toISOString(),
    last_refresh_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const graphReq = (path: string): GraphProxyRequest => ({ action: 'graph_proxy', method: 'GET', path });

describe('AC-M365-110/111/112/113/114 — handleGraphProxy', () => {
  it('AC-M365-110: an unexpired active connection decrypts the access token and returns Graph data (no token echoed)', async () => {
    const conn = await connection();
    const service = mockClient({ ms_graph_connections: [{ data: conn, error: null }] });
    const graphFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: ['doc1'] }) });

    const result = await handleGraphProxy(
      graphReq('/me/drive/root/children'),
      deps({ service, caller: callerClient(), userId: 'user-1', fetch: graphFetch }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ value: ['doc1'] });
    // Graph was called with the DECRYPTED Bearer (proves decrypt ran), never the ciphertext.
    const authHeader = (graphFetch.mock.calls[0]![1] as { headers: Record<string, string> }).headers.Authorization;
    expect(authHeader).toBe('Bearer ACCESS-TOKEN');
  });

  it('AC-M365-111: an expired access token is refreshed (rotated pair persisted), then Graph is called with the new token', async () => {
    const expired = await connection({
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(), // expired → triggers refresh
    });
    // Queue order: load(q0) → refresh's update(q1) → re-load fresh ciphertext(q2).
    const freshBlob = await encryptForTest('NEW-ACCESS-TOKEN');
    const service = mockClient({
      ms_graph_connections: [
        { data: expired, error: null },
        { data: null, error: null }, // update result (ignored)
        { data: { access_token_ciphertext: freshBlob, key_id: 'kek-v1' }, error: null },
      ],
    });
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url === TOKEN_URL) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'NEW-ACCESS-TOKEN', refresh_token: 'NEW-REFRESH', expires_in: 3600 }) });
      return Promise.resolve({ ok: true, json: async () => ({ value: ['doc2'] }) });
    });

    const result = await handleGraphProxy(
      graphReq('/me/drive/root/children'),
      deps({ service, caller: callerClient(), userId: 'user-1', fetch }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ value: ['doc2'] });
    // The rotated pair was persisted (status reset to active).
    const update = service.writes.find((w) => w.kind === 'update' && w.table === 'ms_graph_connections');
    expect(update).toBeTruthy();
    expect(update!.payload).toMatchObject({ status: 'active' });
    expect((update!.payload as Record<string, unknown>).access_token_ciphertext).toBeInstanceOf(Uint8Array);
    expect((update!.payload as Record<string, unknown>).refresh_token_ciphertext).toBeInstanceOf(Uint8Array);
    // Audited as refreshed.
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.token.refreshed' }));
  });

  it('AC-M365-112: refresh invalid_grant → status=stale, audit refresh_failed, error_event REFRESH_FAILED, no Graph call', async () => {
    const expired = await connection({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() });
    const service = mockClient({
      ms_graph_connections: [
        { data: expired, error: null },
        { data: null, error: null }, // update to stale
      ],
    });
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url === TOKEN_URL) return Promise.resolve({ ok: false, json: async () => ({ error: 'invalid_grant', error_description: 'consent revoked' }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    const graphFetch = fetch;

    const result = await handleGraphProxy(
      graphReq('/me/drive/root/children'),
      deps({ service, caller: callerClient(), userId: 'user-1', fetch: graphFetch }),
    );

    expect(result).toMatchObject({ status: 409, body: { error: 'CONNECTION_STALE' } });
    // Graph (graph.microsoft.com) was never reached — only the token refresh was attempted.
    expect(graphFetch.mock.calls.every((c) => !String(c[0]).includes('graph.microsoft.com'))).toBe(true);
    const update = service.writes.find((w) => w.kind === 'update' && w.table === 'ms_graph_connections');
    expect(update!.payload).toMatchObject({ status: 'stale' });
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.token.refresh_failed' }));
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect((ev!.payload as { error_code: string }).error_code).toBe('REFRESH_FAILED');
  });

  it('AC-M365-113: refresh-token reuse → status=revoked, audit reuse_detected, error_event SECURITY_EVENT_REUSE', async () => {
    const expired = await connection({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() });
    const service = mockClient({
      ms_graph_connections: [
        { data: expired, error: null },
        { data: null, error: null }, // update to revoked
      ],
    });
    const fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({ ok: false, json: async () => ({ error: 'invalid_grant', error_description: 'token reuse detected' }) }),
    );
    void fetch;

    const result = await handleGraphProxy(
      graphReq('/me/drive/root/children'),
      deps({ service, caller: callerClient(), userId: 'user-1', fetch }),
    );

    expect(result).toMatchObject({ status: 409, body: { error: 'CONNECTION_STALE' } });
    const update = service.writes.find((w) => w.kind === 'update' && w.table === 'ms_graph_connections');
    expect(update!.payload).toMatchObject({ status: 'revoked' });
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.token.reuse_detected' }));
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect((ev!.payload as { error_code: string }).error_code).toBe('SECURITY_EVENT_REUSE');
  });

  it('AC-M365-114: a Files.Read-only connection requesting /me/events is rejected SCOPE_INSUFFICIENT (no Graph call)', async () => {
    const conn = await connection({ scopes: ['Files.Read', 'offline_access'] });
    const service = mockClient({ ms_graph_connections: [{ data: conn, error: null }] });
    const graphFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await handleGraphProxy(
      graphReq('/me/events'),
      deps({ service, caller: callerClient(), userId: 'user-1', fetch: graphFetch }),
    );

    expect(result).toMatchObject({ status: 403, body: { error: 'SCOPE_INSUFFICIENT' } });
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it('AC-M365-114 (matrix): scopeCoversPath — OneDrive paths covered by Files.*, everything else rejected', () => {
    expect(scopeCoversPath(['Files.Read', 'offline_access'], '/me/drive/root/children')).toBe(true);
    expect(scopeCoversPath(['Files.Read'], '/drives/x/items')).toBe(true);
    expect(scopeCoversPath(['Files.Read'], '/me/events')).toBe(false);
    expect(scopeCoversPath(['Files.Read'], '/me/messages')).toBe(false);
    expect(scopeCoversPath([], '/me/drive/root')).toBe(false);
  });

  it('AC-M365-110 (gates): a stale connection returns CONNECTION_STALE; a revoked one returns CONNECTION_REVOKED', async () => {
    const stale = await connection({ status: 'stale' });
    const service1 = mockClient({ ms_graph_connections: [{ data: stale, error: null }] });
    const r1 = await handleGraphProxy(graphReq('/me/drive/root'), deps({ service: service1, caller: callerClient(), userId: 'user-1' }));
    expect(r1).toMatchObject({ status: 409, body: { error: 'CONNECTION_STALE' } });

    const revoked = await connection({ status: 'revoked' });
    const service2 = mockClient({ ms_graph_connections: [{ data: revoked, error: null }] });
    const r2 = await handleGraphProxy(graphReq('/me/drive/root'), deps({ service: service2, caller: callerClient(), userId: 'user-1' }));
    expect(r2).toMatchObject({ status: 410, body: { error: 'CONNECTION_REVOKED' } });
  });

  it('AC-M365-110: no connection → NOT_CONNECTED', async () => {
    const service = mockClient({ ms_graph_connections: [{ data: null, error: { code: 'PGRST116' } }] });
    const r = await handleGraphProxy(graphReq('/me/drive/root'), deps({ service, caller: callerClient(), userId: 'user-1' }));
    expect(r).toMatchObject({ status: 404, body: { error: 'NOT_CONNECTED' } });
  });
});
