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

describe('Luna round-4 MED-2 — revoke routes the delete through the m365_delete_connection RPC (not a direct .from())', () => {
  it('MED-2: a successful disconnect calls the m365_delete_connection RPC and synthesizes a delete write', async () => {
    const conn = await connection();
    const service = mockClient({
      ms_graph_connections: [
        { data: conn, error: null },            // SELECT
        { data: { id: 'conn-1' }, error: null }, // m365_delete_connection RETURNING → the deleted id
      ],
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));

    expect(result).toMatchObject({ status: 200, body: { success: true } });
    // The delete went through the parent-first identity-bound RPC (0106), not a direct .from().
    expect(service.rpc).toHaveBeenCalledWith('m365_delete_connection', expect.objectContaining({
      p_org_id: 'org-1', p_user_id: 'user-1', p_connection_id: 'conn-1',
    }));
    // The RPC-synthesized write keeps the existing behavioral assertion (a delete on ms_graph_connections).
    expect(service.writes.some((w) => w.kind === 'delete' && w.table === 'ms_graph_connections')).toBe(true);
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.revoked' }));
  });

  it('MED-2 + LOW-5: the mock FORBIDS a direct .from(ms_graph_connections).delete() (regression guard against the child→parent deadlock order)', async () => {
    // A regression that reintroduces a direct connection write must FAIL LOUD, not pass silently.
    const service = mockClient({ ms_graph_connections: [{ data: await connection(), error: null }] });
    // The mock's `from` builder is typed loosely (a vi.fn union); cast to the chainable write shape
    // for this regression guard. At runtime `from(...)` returns the chainable self whose write
    // methods (delete/insert/update/upsert) throw the contract error; select stays allowed.
    const connFrom = service.client.from as unknown as (table: string) => {
      delete: () => unknown; update: (p: unknown) => unknown;
      insert: (p: unknown) => unknown; upsert: (p: unknown) => unknown; select: () => unknown;
    };
    expect(() => connFrom('ms_graph_connections').delete()).toThrow();
    expect(() => connFrom('ms_graph_connections').update({ status: 'stale' })).toThrow();
    expect(() => connFrom('ms_graph_connections').insert({})).toThrow();
    expect(() => connFrom('ms_graph_connections').upsert({})).toThrow();
    // SELECTs stay allowed (the edge fn loads connection rows).
    expect(() => connFrom('ms_graph_connections').select()).not.toThrow();
  });
});

describe('Luna round-4 MED-3 — status-RPC failure ignores the returned identity (fail closed, not audit success)', () => {
  it('MED-3 reuse: a zero-row status RPC does NOT emit reuse_detected, but records the security-event detection + INTERNAL_ERROR', async () => {
    const conn = await connection({ entra_tenant_id: '11111111-2222-3333-4444-555555555555' });
    // Microsoft reports reuse; the status RPC returns NO row (row deleted under us / identity
    // mismatch). Previously the code still audited reuse_detected as if the row was marked revoked.
    const service = mockClient({
      ms_graph_connections: [{ data: null, error: null }], // m365_set_connection_status('revoked') → zero rows
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant', error_description: 'token reuse detected' }),
    });

    const ok = await refreshAccessToken(conn, deps({ service, fetch }));

    expect(ok).toBe(false);
    // CRUCIAL: no reuse_detected state-change audit for a row that was NOT marked revoked.
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.token.reuse_detected' }));
    // The DETECTION is still a fact — the security event is recorded.
    expect(service.writes.some((w) => (w.payload as { error_code?: string } | undefined)?.error_code === 'M365_SECURITY_EVENT_REUSE')).toBe(true);
    // FAIL CLOSED: the persistence failure is surfaced.
    expect(service.writes.some((w) => (w.payload as { error_code?: string } | undefined)?.error_code === 'INTERNAL_ERROR')).toBe(true);
  });

  it('MED-3 reuse: a status RPC ERROR does NOT emit reuse_detected (fail closed on error too)', async () => {
    const conn = await connection({ entra_tenant_id: '11111111-2222-3333-4444-555555555555' });
    const service = mockClient({
      ms_graph_connections: [{ data: null, error: { code: '42501', message: 'user_not_active' } }], // guard rejection
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant', error_description: 'token reuse detected' }),
    });

    const ok = await refreshAccessToken(conn, deps({ service, fetch }));

    expect(ok).toBe(false);
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.token.reuse_detected' }));
    expect(service.writes.some((w) => (w.payload as { error_code?: string } | undefined)?.error_code === 'M365_SECURITY_EVENT_REUSE')).toBe(true);
    expect(service.writes.some((w) => (w.payload as { error_code?: string } | undefined)?.error_code === 'INTERNAL_ERROR')).toBe(true);
  });

  it('MED-3 stale: a zero-row status RPC does NOT emit refresh_failed (no stale-marking happened)', async () => {
    const conn = await connection({ entra_tenant_id: '11111111-2222-3333-4444-555555555555' });
    const service = mockClient({
      ms_graph_connections: [{ data: null, error: null }], // m365_set_connection_status('stale') → zero rows
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant', error_description: 'consent revoked' }),
    });

    const ok = await refreshAccessToken(conn, deps({ service, fetch }));

    expect(ok).toBe(false);
    // CRUCIAL: no refresh_failed state-change audit for a row that was NOT marked stale.
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.token.refresh_failed' }));
    // The classification is still a fact (invalid_grant) + the persistence failure is surfaced.
    expect(service.writes.some((w) => (w.payload as { error_code?: string } | undefined)?.error_code === 'M365_REFRESH_FAILED')).toBe(true);
    expect(service.writes.some((w) => (w.payload as { error_code?: string } | undefined)?.error_code === 'INTERNAL_ERROR')).toBe(true);
  });
});
