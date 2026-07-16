/**
 * Luna BLOCK fixes — runtime hardening for refresh (M3 tenant re-validation) and revoke
 * (M3 tenant re-validation + H6: the local delete error must not be reported as success).
 * Real graphTokenCrypto decrypt runs on the seeded refresh token (no crypto mocking).
 */
import { describe, it, expect, vi } from 'vitest';
import { refreshAccessToken } from '../../../../../supabase/functions/m365-token-custody/refresh';
import { handleDisconnect } from '../../../../../supabase/functions/m365-token-custody/revoke';
import { mockClient, deps, encryptForTest } from './m365MockDeps';
import type { ConnectionRow } from '../../../../../supabase/functions/m365-token-custody/types';

function callerClient() {
  return mockClient({
    profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
    org_features: [{ data: { enabled: true }, error: null }],
  });
}

async function connection(overrides: Partial<ConnectionRow> = {}): Promise<ConnectionRow> {
  return {
    id: 'conn-1', org_id: 'org-1', user_id: 'user-1', entra_tenant_id: 'test-tenant-id',
    entra_user_object_id: null,
    scopes: ['Files.Read', 'offline_access'],
    refresh_token_ciphertext: await encryptForTest('REFRESH-TOKEN'),
    access_token_ciphertext: null, access_token_expires_at: null, refresh_token_expires_at: null,
    key_id: 'kek-v1', status: 'active', connected_at: new Date().toISOString(),
    last_refresh_at: null, updated_at: new Date().toISOString(), ...overrides,
  };
}

describe('M3 — refresh re-validates the DB-sourced tenant before the token URL', () => {
  it('M3: a dot-segment tenant is rejected before any token URL is built — error_event + false, no Microsoft call', async () => {
    const conn = await connection({ entra_tenant_id: '..' });
    const service = mockClient();
    const fetch = vi.fn();

    const ok = await refreshAccessToken(conn, deps({ service, fetch }));

    expect(ok).toBe(false);
    // No token URL constructed with the bad tenant.
    expect(fetch).not.toHaveBeenCalled();
    // An error_event was recorded (the column CHECK would also reject this; runtime is defense-in-depth).
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect(ev).toBeTruthy();
  });

  it('M3: a valid tenant proceeds to the Microsoft token endpoint (regression guard)', async () => {
    const conn = await connection({ entra_tenant_id: '11111111-2222-3333-4444-555555555555' });
    const service = mockClient();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'NEW-A', refresh_token: 'NEW-R', expires_in: 3600 }),
    });

    const ok = await refreshAccessToken(conn, deps({ service, fetch }));

    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('H6 — revoke reports failure (not success) when the local delete fails', () => {
  it('H6: a DB delete error returns a retryable 503 + error_event, and NO success audit is written', async () => {
    const conn = await connection();
    // SELECT returns the connection; the DELETE returns an error (e.g. transient DB failure).
    const service = mockClient({
      ms_graph_connections: [
        { data: conn, error: null },                       // SELECT
        { data: null, error: { code: 'PGRST', message: 'db down' } }, // DELETE → error
      ],
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));

    // Retryable failure — NOT 200.
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: 'INTERNAL_ERROR' });
    // The delete was attempted.
    expect(service.writes.some((w) => w.kind === 'delete' && w.table === 'ms_graph_connections')).toBe(true);
    // An error_event was recorded.
    expect(service.writes.some((w) => w.table === 'error_events')).toBe(true);
    // CRUCIAL: no success 'revoked' audit was written for a failed delete.
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.revoked' }));
  });

  it('H6: a successful delete still writes the success audit and returns 200 (regression guard)', async () => {
    const conn = await connection();
    const service = mockClient({
      ms_graph_connections: [
        { data: conn, error: null },          // SELECT
        { data: { id: 'conn-1' }, error: null }, // DELETE … RETURNING → the deleted row
      ],
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));

    expect(result).toMatchObject({ status: 200, body: { success: true } });
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({
      p_action: 'm365.connection.revoked', p_detail: expect.objectContaining({ reason: 'user_disconnect' }),
    }));
  });
});

describe('M3 — revoke re-validates the tenant before the revoke URL (best-effort, never blocks the delete)', () => {
  it('M3: a malformed tenant skips the Microsoft revoke but STILL deletes locally + audits (best-effort)', async () => {
    const conn = await connection({ entra_tenant_id: '..' });
    const service = mockClient({
      ms_graph_connections: [
        { data: conn, error: null },          // SELECT
        { data: { id: 'conn-1' }, error: null }, // DELETE … RETURNING → the deleted row
      ],
    });
    const fetch = vi.fn();

    const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));

    // No revoke URL built with the bad tenant (defense-in-depth).
    expect(fetch).not.toHaveBeenCalled();
    // The authoritative local delete + audit still happened.
    expect(result).toMatchObject({ status: 200, body: { success: true } });
    expect(service.writes.some((w) => w.kind === 'delete' && w.table === 'ms_graph_connections')).toBe(true);
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.revoked' }));
  });
});

describe('Luna-Med — refresh reports failure (not success) when token persistence fails', () => {
  it('Luna-Med: a write-guard rejection (42501) on the refresh UPDATE returns false + error_event, and NO success audit', async () => {
    const conn = await connection({ entra_tenant_id: '11111111-2222-3333-4444-555555555555' });
    // Microsoft returns a fresh pair; the persistence UPDATE is REJECTED (42501) — the lifecycle
    // write-guard (0104) blocks the write because the user was just disabled / the org disentitled.
    const service = mockClient({
      ms_graph_connections: [
        { data: null, error: { code: '42501', message: 'user_not_active' } }, // UPDATE … RETURNING → rejected
      ],
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'NEW-A', refresh_token: 'NEW-R', expires_in: 3600 }),
    });

    const ok = await refreshAccessToken(conn, deps({ service, fetch }));

    // NOT reported as success.
    expect(ok).toBe(false);
    // No 'refreshed' audit was written for a row that was never persisted.
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.token.refreshed' }));
    // An error_event was recorded (no token material).
    expect(service.writes.some((w) => w.table === 'error_events')).toBe(true);
  });

  it('Luna-Med: a zero-row UPDATE (row deleted under us) returns false + error_event, no success audit', async () => {
    const conn = await connection({ entra_tenant_id: '11111111-2222-3333-4444-555555555555' });
    // The UPDATE returned no error AND no row — the connection was deleted between the caller's
    // SELECT and this write (a just-fired lifecycle cascade). Must NOT be treated as refreshed.
    const service = mockClient({
      ms_graph_connections: [{ data: null, error: null }], // UPDATE … RETURNING → zero rows
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'NEW-A', refresh_token: 'NEW-R', expires_in: 3600 }),
    });

    const ok = await refreshAccessToken(conn, deps({ service, fetch }));

    expect(ok).toBe(false);
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.token.refreshed' }));
    expect(service.writes.some((w) => w.table === 'error_events')).toBe(true);
  });
});

describe('Luna-Low — revoke treats a concurrent zero-row DELETE as NOT_CONNECTED (not success)', () => {
  it('Luna-Low: a concurrent zero-row DELETE (row already gone) → 404 NOT_CONNECTED, no success audit', async () => {
    const conn = await connection();
    // SELECT returns the connection; the DELETE returns NO row — a lifecycle cascade fired between
    // the SELECT and the DELETE. Previously this was reported as success (200 + revoked audit).
    const service = mockClient({
      ms_graph_connections: [
        { data: conn, error: null },          // SELECT
        { data: null, error: null },          // DELETE … RETURNING → zero rows (already gone)
      ],
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));

    expect(result).toMatchObject({ status: 404, body: { error: 'NOT_CONNECTED' } });
    // CRUCIAL: no success 'revoked' audit for a row that was never deleted by this call.
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.revoked' }));
    // An error_event was recorded so the zero-row outcome is observable.
    expect(service.writes.some((w) => w.table === 'error_events')).toBe(true);
  });
});
