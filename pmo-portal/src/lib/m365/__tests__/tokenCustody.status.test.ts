/**
 * AC-M365-150/151/152 — `connection_status`: a server-side read of the caller's OWN connection
 * row returning ONLY non-sensitive metadata (connected / status / connected_at / last_refresh_at
 * / scopes). Mirrors the existing mocked-deps style (m365MockDeps); real graphTokenCrypto runs so
 * the seeded ciphertext blobs are real (the no-leak assertion scans for the real plaintext markers).
 *
 *   AC-M365-150 — returns the allowed shape for an active / stale / revoked / absent connection.
 *   AC-M365-151 — enforces the SAME gate as the other user-initiated actions (non-Admin →
 *                 FORBIDDEN, unentitled → NOT_ENTITLED) — no relaxation.
 *   AC-M365-152 — the response body leaks NO ciphertext / key_id / entra oid / entra tenant /
 *                 expiry — scanned for the forbidden KEYS and the seeded secret VALUES (mirrors
 *                 tokenCustody.secrets.test.ts), AND the read is read-only (no writes / no RPCs).
 *
 * The own-row `.eq('org_id', orgId).eq('user_id', userId)` scoping is proven by code inspection
 * of status.ts (same chain proxy.ts/revoke.ts use) + the RLS / unique(org,user) guarantees in
 * pgTAP 0146 — not re-proven here (the mock does not model RLS).
 */
import { describe, it, expect } from 'vitest';
import { handleConnectionStatus } from '../../../../../supabase/functions/m365-token-custody/status';
import { mockClient, deps, encryptForTest } from './m365MockDeps';
import type { ConnectionStatusResponse } from '../../../../../supabase/functions/m365-token-custody/types';

function callerClient() {
  return mockClient({
    profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
    org_features: [{ data: { enabled: true }, error: null }],
  });
}

/** A full sensitive-bearing connection row. The handler MUST return only the allow-list fields. */
async function fullConnectionRow(status: 'active' | 'stale' | 'revoked') {
  return {
    // allow-list (what the response is permitted to surface)
    status,
    connected_at: '2026-07-15T10:00:00.000Z',
    last_refresh_at: '2026-07-20T09:00:00.000Z',
    scopes: ['Files.Read', 'offline_access'],
    // FORBIDDEN — seeded with real ciphertext + distinctive markers so any leak is LOUD
    id: 'conn-secret-id',
    org_id: 'org-1',
    user_id: 'user-1',
    entra_tenant_id: 'entra-tid-status-456',
    entra_user_object_id: 'entra-oid-status-789',
    refresh_token_ciphertext: await encryptForTest('REFRESH-STATUS-SECRET'),
    access_token_ciphertext: await encryptForTest('ACCESS-STATUS-SECRET'),
    access_token_expires_at: '2026-07-20T10:00:00.000Z',
    refresh_token_expires_at: '2026-09-18T10:00:00.000Z',
    key_id: 'kek-status-key-id',
    updated_at: '2026-07-20T09:00:00.000Z',
  };
}

// Keys that must NEVER appear in a connection_status response (the whole point of the surface).
const FORBIDDEN_KEYS = [
  'refresh_token_ciphertext',
  'access_token_ciphertext',
  'key_id',
  'entra_user_object_id',
  'entra_tenant_id',
  'access_token_expires_at',
  'refresh_token_expires_at',
];

// Seeded secret VALUES that must never reach a client (ciphertext plaintext markers + the
// distinctive oid/tenant/key-id strings). Mirrors the FORBIDDEN substring approach in
// tokenCustody.secrets.test.ts — if the handler decrypted AND echo'd, or echo'd a raw ciphertext
// field, one of these would surface in the serialized body.
const FORBIDDEN_VALUES = [
  'REFRESH-STATUS-SECRET',
  'ACCESS-STATUS-SECRET',
  'entra-oid-status-789',
  'entra-tid-status-456',
  'kek-status-key-id',
  'conn-secret-id',
];

function assertNoSecret(serialized: string, where: string) {
  for (const k of FORBIDDEN_KEYS) expect(serialized, `${where}: leaked key "${k}"`).not.toContain(k);
  for (const v of FORBIDDEN_VALUES) expect(serialized, `${where}: leaked value "${v}"`).not.toContain(v);
}

describe('AC-M365-150 — connection_status returns the allowed non-sensitive shape', () => {
  it('AC-M365-150: an active connection → { connected:true, status:"active", … } (allow-list only)', async () => {
    const row = await fullConnectionRow('active');
    const service = mockClient({ ms_graph_connections: [{ data: row, error: null }] });

    const result = await handleConnectionStatus(
      deps({ service, caller: callerClient(), userId: 'user-1' }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      connected: true,
      status: 'active',
      connected_at: '2026-07-15T10:00:00.000Z',
      last_refresh_at: '2026-07-20T09:00:00.000Z',
      scopes: ['Files.Read', 'offline_access'],
    } satisfies ConnectionStatusResponse);
    assertNoSecret(JSON.stringify(result.body), 'active body');
  });

  it('AC-M365-150: a stale connection → { connected:true, status:"stale" } (Needs reconnect)', async () => {
    const row = await fullConnectionRow('stale');
    const service = mockClient({ ms_graph_connections: [{ data: row, error: null }] });
    const result = await handleConnectionStatus(deps({ service, caller: callerClient(), userId: 'user-1' }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ connected: true, status: 'stale' });
    assertNoSecret(JSON.stringify(result.body), 'stale body');
  });

  it('AC-M365-150: a revoked connection → { connected:true, status:"revoked" }', async () => {
    const row = await fullConnectionRow('revoked');
    const service = mockClient({ ms_graph_connections: [{ data: row, error: null }] });
    const result = await handleConnectionStatus(deps({ service, caller: callerClient(), userId: 'user-1' }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ connected: true, status: 'revoked' });
    assertNoSecret(JSON.stringify(result.body), 'revoked body');
  });

  it('AC-M365-150: no row → { connected:false, status:null, … } (Not connected)', async () => {
    const service = mockClient({ ms_graph_connections: [{ data: null, error: null }] });
    const result = await handleConnectionStatus(deps({ service, caller: callerClient(), userId: 'user-1' }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      connected: false,
      status: null,
      connected_at: null,
      last_refresh_at: null,
      scopes: [],
    } satisfies ConnectionStatusResponse);
  });
});

describe('AC-M365-151 — connection_status enforces the SAME gate (Operator + entitlement)', () => {
  it('AC-M365-151: a non-Operator caller is rejected FORBIDDEN (no row read, same as graph_proxy)', async () => {
    // ADR-0058 §3 amendment (2026-07-24): even an org Admin is rejected without Operator.
    const row = await fullConnectionRow('active');
    const service = mockClient({
      ms_graph_connections: [{ data: row, error: null }],
      platform_operators: [{ data: null, error: null }],
    });
    const memberCaller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
    });

    const result = await handleConnectionStatus(deps({ service, caller: memberCaller, userId: 'user-1' }));

    expect(result).toMatchObject({ status: 403, body: { error: 'FORBIDDEN' } });
    // The connection row was NEVER read (the gate rejected before the SELECT).
    expect(service.from).not.toHaveBeenCalledWith('ms_graph_connections');
    // And nothing was written (read-only — no audit, no mutation).
    expect(service.writes).toHaveLength(0);
    expect(service.rpc).not.toHaveBeenCalled();
    assertNoSecret(JSON.stringify(result.body), 'FORBIDDEN body');
  });

  it('AC-M365-151: an unentitled caller is rejected NOT_ENTITLED (no row read)', async () => {
    const row = await fullConnectionRow('active');
    const service = mockClient({ ms_graph_connections: [{ data: row, error: null }] });
    const unentitledCaller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
      org_features: [{ data: { enabled: false }, error: null }],
    });

    const result = await handleConnectionStatus(deps({ service, caller: unentitledCaller, userId: 'user-1' }));

    expect(result).toMatchObject({ status: 403, body: { error: 'NOT_ENTITLED' } });
    expect(service.from).not.toHaveBeenCalledWith('ms_graph_connections');
    expect(service.writes).toHaveLength(0);
    expect(service.rpc).not.toHaveBeenCalled();
  });
});

describe('AC-M365-152 — connection_status leaks NO ciphertext / key_id / oid / tenant', () => {
  it('AC-M365-152: an active row seeded with real ciphertext + oid/tenant/key_id surfaces NONE of it', async () => {
    const row = await fullConnectionRow('active');
    const service = mockClient({ ms_graph_connections: [{ data: row, error: null }] });

    const result = await handleConnectionStatus(deps({ service, caller: callerClient(), userId: 'user-1' }));

    expect(result.status).toBe(200);
    const serialized = JSON.stringify(result.body);
    assertNoSecret(serialized, 'body');
    // The response body has EXACTLY the five allow-list keys — no extra field can sneak through.
    expect(Object.keys(result.body as object).sort()).toEqual(
      ['connected', 'connected_at', 'last_refresh_at', 'scopes', 'status'],
    );
  });

  it('AC-M365-152: the read is READ-ONLY — exactly one ms_graph_connections SELECT, no writes, no RPCs (no audit, no locks)', async () => {
    const row = await fullConnectionRow('active');
    const service = mockClient({ ms_graph_connections: [{ data: row, error: null }] });

    await handleConnectionStatus(deps({ service, caller: callerClient(), userId: 'user-1' }));

    // Exactly one read of the connection table (the SELECT).
    const connReads = service.from.mock.calls.filter((c) => c[0] === 'ms_graph_connections');
    expect(connReads).toHaveLength(1);
    // Read-only: NO mutations recorded (insert/update/upsert/delete) on any table, and NO RPCs
    // (no audit_m365_event, no m365_*_connection lock-order RPC — a status read takes no locks).
    expect(service.writes).toHaveLength(0);
    expect(service.rpc).not.toHaveBeenCalled();
  });
});
