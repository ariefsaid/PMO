/**
 * AC-M365-103/104/105 — the OAuth callback (GET /callback?code=&state=).
 * The consumed single-use state row is the credential on this GET path (no Bearer on a 302).
 * Real graphTokenCrypto envelope runs (no crypto mocking).
 */
import { describe, it, expect, vi } from 'vitest';
import { handleCallback } from '../../../../../supabase/functions/m365-token-custody/callback';
import { fromByteaValue, toByteaParam } from '../../../../../supabase/functions/m365-token-custody/crypto';
import { mockClient, deps } from './m365MockDeps';
import type { PkceStateRow } from '../../../../../supabase/functions/m365-token-custody/types';

const TOKEN_URL = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/token';

function callbackReq(params: Record<string, string>): Request {
  const qs = new URLSearchParams(params).toString();
  return new Request(`https://test.supabase.co/functions/v1/m365-token-custody/callback?${qs}`);
}

function fetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

/** Mint a fake id_token JWT (header.payload.sig) carrying the given claims. No signature — the
 * callback does NOT verify the id_token signature (it arrives over direct server→Microsoft TLS in
 * the token response); only the base64url payload claims (tid/oid) are read (HIGH-1). */
function mintIdToken(claims: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claims)}.sig`;
}

function pkceRow(overrides: Partial<PkceStateRow> = {}): PkceStateRow {
  return {
    id: 'pkce-1', org_id: 'org-1', user_id: 'user-1', code_verifier: 'verifier-abc',
    state: 'state-xyz', scopes: ['Files.Read', 'offline_access'], created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(), ...overrides,
  };
}

describe('AC-M365-103/104/105 — handleCallback', () => {
  it('AC-M365-103: valid state+code → exchanges, encrypts BOTH tokens, upserts an active connection, audits, redirects', async () => {
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
      // C1(c) pre-check (status + entitlement) — both must pass for the upsert to proceed.
      profiles: [{ data: { status: 'active' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
      // TOFU identity SELECT (no existing row → pinnedOid null → proceed) THEN the upsert RPC (conn-1).
      ms_graph_connections: [
        { data: null, error: null },
        { data: { id: 'conn-1' }, error: null },
      ],
    });
    const fetch = fetchOk({
      access_token: 'ACCESS-VALUE',
      refresh_token: 'REFRESH-VALUE',
      expires_in: 3600,
      id_token: mintIdToken({ tid: 'test-tenant-id', oid: 'user-oid-123' }),
    });

    const result = await handleCallback(
      callbackReq({ code: 'auth-code', state: 'state-xyz' }),
      deps({ service, fetch }),
    );

    // Redirects to the FE success page — NO token in the URL (AC-M365-140).
    expect(result.status).toBe(302);
    expect(result.headers?.Location).toMatch(/m365_connected=true$/);

    // Token exchange hit Microsoft with the PKCE verifier + confidential-client secret.
    expect(fetch).toHaveBeenCalledWith(TOKEN_URL, expect.objectContaining({ method: 'POST' }));
    const body = (fetch.mock.calls[0]![1] as { body: URLSearchParams }).body;
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('code_verifier')).toBe('verifier-abc');
    expect(body.get('client_secret')).toBe('test-client-secret');

    // Connection upserted as active with BOTH ciphertexts + the v1 key id (never plaintext).
    const upsert = service.writes.find((w) => w.kind === 'upsert' && w.table === 'ms_graph_connections');
    expect(upsert).toBeTruthy();
    expect(upsert!.payload).toMatchObject({
      org_id: 'org-1', user_id: 'user-1', status: 'active', key_id: 'kek-v1',
      scopes: ['Files.Read', 'offline_access'], entra_tenant_id: 'test-tenant-id',
      // HIGH-1: the REAL token tid + oid are stored (entra_user_object_id from the id_token oid —
      // fixes spec Minor / FR-M365-110; it was never populated before).
      entra_user_object_id: 'user-oid-123',
    });
    const payload = upsert!.payload as Record<string, unknown>;
    // REGRESSION — HIGH-A1 (live security audit 2026-07-24). This assertion previously required a
    // Uint8Array, which ENCODED THE BUG: supabase-js JSON-encodes RPC args, so a Uint8Array bytea
    // param serializes to `{"0":12,"1":255,…}` and Postgres stores that literal ASCII. The live row
    // was 14,709 bytes of printable text starting `{"0"` — genuine AES-GCM output, but wrapped so
    // the IV could never be recovered, making disconnect silently fail to revoke at Microsoft.
    // The wire contract is Postgres hex format, and it must round-trip to the exact bytes.
    for (const col of ['access_token_ciphertext', 'refresh_token_ciphertext'] as const) {
      const wire = payload[col];
      expect(typeof wire).toBe('string');
      expect(wire as string).toMatch(/^\\x[0-9a-f]+$/);
      const bytes = fromByteaValue(wire);
      expect(bytes).toBeInstanceOf(Uint8Array);
      // iv(12) + at least the 16-byte GCM tag; and never a JSON object's opening brace.
      expect(bytes.byteLength).toBeGreaterThanOrEqual(28);
      expect(bytes[0]).not.toBe(0x7b);
      expect(toByteaParam(bytes)).toBe(wire);
    }
    expect(payload.access_token_expires_at).toBeTruthy();

    // Audited via the audit_m365_event RPC (EF7 — NOT log_audit).
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({
      p_action: 'm365.connection.initiated', p_org_id: 'org-1', p_actor_id: 'user-1', p_entity_id: 'conn-1',
    }));
  });

  it('AC-M365-104: a missing/expired/replayed state is rejected — NO token exchange, NO connection stored', async () => {
    const service = mockClient({ m365_pkce_states: [{ data: null, error: { code: 'PGRST116' } }] });
    const fetch = vi.fn();

    const result = await handleCallback(
      callbackReq({ code: 'auth-code', state: 'stale-state' }),
      deps({ service, fetch }),
    );

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    expect(fetch).not.toHaveBeenCalled(); // no token exchange
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false); // no partial store
    // An error_event was recorded with the INVALID_STATE code.
    expect(service.writes.some((w) => w.table === 'error_events')).toBe(true);
  });

  it('AC-M365-105: a Microsoft exchange failure records an error_event and stores NOTHING', async () => {
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
      ms_graph_connections: [{ data: { id: 'conn-1' }, error: null }],
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant', error_description: 'bad code' }),
    });

    const result = await handleCallback(
      callbackReq({ code: 'auth-code', state: 'state-xyz' }),
      deps({ service, fetch }),
    );

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    // No connection written on failure (no partial store).
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false);
    // An error_event with TOKEN_EXCHANGE_FAILED was recorded.
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect(ev).toBeTruthy();
    expect((ev!.payload as { error_code: string }).error_code).toBe('TOKEN_EXCHANGE_FAILED');
  });

  it('AC-M365-103 (HIGH-1): an id_token whose tid does not match env.m365TenantId is rejected — NO upsert, TOKEN_EXCHANGE_FAILED error_event', async () => {
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
    });
    // Exchange succeeds (200) but issues tokens for a FOREIGN tenant — the attacker phished a victim
    // in another Entra tenant. The callback must bind to the EXPECTED tenant and refuse to store.
    const fetch = fetchOk({
      access_token: 'FOREIGN-ACCESS',
      refresh_token: 'FOREIGN-REFRESH',
      expires_in: 3600,
      id_token: mintIdToken({ tid: 'foreign-tenant-999', oid: 'victim-oid' }),
    });

    const result = await handleCallback(
      callbackReq({ code: 'auth-code', state: 'state-xyz' }),
      deps({ service, fetch }),
    );

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    // NO connection stored — the foreign tokens are not persisted into the initiator's connection.
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false);
    // An error_event was recorded (no token material in it).
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect(ev).toBeTruthy();
    expect((ev!.payload as { error_code: string }).error_code).toBe('TOKEN_EXCHANGE_FAILED');
  });

  it('AC-M365-103 (HIGH-1): a token response with NO id_token is rejected — NO upsert (openid/profile make Microsoft return one)', async () => {
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
    });
    // Exchange succeeds but Microsoft returned no id_token (unexpected, since initiate requests
    // openid+profile). Missing id_token → cannot assert tid → reject, store nothing.
    const fetch = fetchOk({ access_token: 'ACCESS-VALUE', refresh_token: 'REFRESH-VALUE', expires_in: 3600 });

    const result = await handleCallback(
      callbackReq({ code: 'auth-code', state: 'state-xyz' }),
      deps({ service, fetch }),
    );

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false);
    expect(service.writes.some((w) => w.table === 'error_events')).toBe(true);
  });

  it('AC-M365-104: a Microsoft redirect with ?error= aborts before any token exchange', async () => {
    const service = mockClient();
    const fetch = vi.fn();
    const result = await handleCallback(
      callbackReq({ error: 'access_denied', state: 'state-xyz' }),
      deps({ service, fetch }),
    );
    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('AC-M365-103 (C1c): a disabled user (pre-check) is rejected before the upsert — error_event, no token material, FE error redirect', async () => {
    // The user was offboarded after initiate but before callback. The pre-check surfaces a clear
    // CONNECTION_NOT_ALLOWED; the authoritative write-guard (0103) would also reject the upsert.
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
      profiles: [{ data: { status: 'disabled' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
    });
    const fetch = fetchOk({
      access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600,
      id_token: mintIdToken({ tid: 'test-tenant-id', oid: 'user-oid-123' }),
    });

    const result = await handleCallback(callbackReq({ code: 'auth-code', state: 'state-xyz' }), deps({ service, fetch }));

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    // NO connection stored — resurrection is impossible.
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false);
    // A CONNECTION_NOT_ALLOWED error_event was recorded with NO token material.
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect(ev).toBeTruthy();
    expect((ev!.payload as { error_code: string }).error_code).toBe('CONNECTION_NOT_ALLOWED');
    // No token MATERIAL leaked: the actual access/refresh values + the code verifier are absent.
    const evJson = JSON.stringify(ev!.payload);
    expect(evJson).not.toMatch(/ACCESS|REFRESH|verifier-abc/i);
  });

  it('AC-M365-103 (C1c): a disentitled org (pre-check) is rejected before the upsert — error_event, no store', async () => {
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
      profiles: [{ data: { status: 'active' }, error: null }],
      org_features: [{ data: { enabled: false }, error: null }],
    });
    const fetch = fetchOk({
      access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600,
      id_token: mintIdToken({ tid: 'test-tenant-id', oid: 'user-oid-123' }),
    });

    const result = await handleCallback(callbackReq({ code: 'auth-code', state: 'state-xyz' }), deps({ service, fetch }));

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false);
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect((ev!.payload as { error_code: string }).error_code).toBe('CONNECTION_NOT_ALLOWED');
  });

  it('AC-M365-103 (C1c): a write-guard upsert rejection (race) is NOT reported as success — error_event + redirect, no token stored', async () => {
    // The pre-check passed (active + entitled) but a race disabled the user / disentitled the org
    // between the pre-check and the upsert; the BEFORE trigger (0103) rejects the upsert. This is
    // the authoritative backstop — the rejection must surface as an error, never success.
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
      profiles: [{ data: { status: 'active' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
      // TOFU identity SELECT (no existing row → pinnedOid null → proceed) THEN the upsert RPC, which
      // the write-guard rejects (42501 user_not_active) — the authoritative backstop path.
      ms_graph_connections: [
        { data: null, error: null },
        { data: null, error: { code: '42501', message: 'user_not_active' } },
      ],
    });
    const fetch = fetchOk({
      access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600,
      id_token: mintIdToken({ tid: 'test-tenant-id', oid: 'user-oid-123' }),
    });

    const result = await handleCallback(callbackReq({ code: 'auth-code', state: 'state-xyz' }), deps({ service, fetch }));

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    // The upsert was attempted but rejected — still NO successful connection stored.
    const upserts = service.writes.filter((w) => w.kind === 'upsert' && w.table === 'ms_graph_connections');
    expect(upserts).toHaveLength(1); // attempted
    // No token material leaked into the error_event.
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect((ev!.payload as { error_code: string }).error_code).toBe('CONNECTION_NOT_ALLOWED');
    expect(JSON.stringify(ev!.payload)).not.toMatch(/ACCESS|REFRESH|verifier-abc/i);
    // No success audit.
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.initiated' }));
  });

  it('AC-M365-103 (M3): a malformed env tenant (dot-segment) is rejected before the token URL is built', async () => {
    // A dot-segment tenant is path-confusion; validate it before building the secret-bearing URL.
    const service = mockClient({ m365_pkce_states: [{ data: pkceRow(), error: null }] });
    const fetch = vi.fn();

    const result = await handleCallback(
      callbackReq({ code: 'auth-code', state: 'state-xyz' }),
      deps({ service, fetch, env: { m365TenantId: '..' } }),
    );

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    expect(fetch).not.toHaveBeenCalled(); // no token URL built
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect((ev!.payload as { error_code: string }).error_code).toBe('TOKEN_EXCHANGE_FAILED');
  });

  // ==========================================================================
  // AC-M365-171/172/173 — TOFU + enforce-on-reconnect (owner design decision, 2026-07-17).
  // The FIRST connect for (org, user) PINS the id_token's `oid` as entra_user_object_id (trust-on-
  // first-use); every RECONNECT (an existing row with a NON-NULL entra_user_object_id) MUST present
  // the SAME `oid`. A mismatch is a same-tenant consent-phishing indicator (a PMO Admin phished the
  // authorize URL to a DIFFERENT person in the SAME Entra tenant — tid matches, so the tenant check
  // passes, but the victim's oid differs from the pinned value). The structural authority is the
  // m365_connection_oid_write_once BEFORE UPDATE trigger (0107, AC-M365-174); this callback pre-check
  // is the best-effort detection that rejects BEFORE any encrypt/upsert.
  // ==========================================================================

  it('AC-M365-171 (TOFU first-write): a pre-existing connection with a NULL entra_user_object_id is ACCEPTED and the id_token oid is pinned', async () => {
    // Models the "row whose entra_user_object_id IS NULL" first-connect case: a legacy / pre-feature
    // row exists but no identity was pinned yet. The callback ACCEPTS and stores the presented oid
    // (trust-on-first-use). pinnedOid (null) !== non-null is false, so the mismatch guard does NOT
    // fire and the upsert proceeds with the new oid.
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
      profiles: [{ data: { status: 'active' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
      // identity SELECT → existing row with a NULL oid (TOFU first-write) → proceed; then upsert.
      ms_graph_connections: [
        { data: { id: 'conn-legacy', entra_user_object_id: null }, error: null },
        { data: { id: 'conn-legacy' }, error: null },
      ],
    });
    const fetch = fetchOk({
      access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600,
      id_token: mintIdToken({ tid: 'test-tenant-id', oid: 'user-oid-123' }),
    });

    const result = await handleCallback(callbackReq({ code: 'auth-code', state: 'state-xyz' }), deps({ service, fetch }));

    // Accepted — success redirect.
    expect(result.status).toBe(302);
    expect(result.headers?.Location).toMatch(/m365_connected=true$/);
    // The upsert PINNED the presented oid (TOFU first-write).
    const upsert = service.writes.find((w) => w.kind === 'upsert' && w.table === 'ms_graph_connections');
    expect(upsert).toBeTruthy();
    expect((upsert!.payload as Record<string, unknown>).entra_user_object_id).toBe('user-oid-123');
    // Initiated audit emitted.
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({
      p_action: 'm365.connection.initiated', p_org_id: 'org-1', p_entity_id: 'conn-legacy',
    }));
    // No identity-mismatch audit (this was an accepted first-write).
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.identity_mismatch' }));
  });

  it('AC-M365-172 (enforce-on-reconnect): a reconnect presenting the SAME pinned oid SUCCEEDS — tokens rotated, identity unchanged', async () => {
    // A legitimate reconnect: the same PMO user re-consents (e.g. after a stale). The pinned oid
    // equals the presented oid → ACCEPTED → upsert rotates the tokens, identity stays pinned.
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
      profiles: [{ data: { status: 'active' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
      // identity SELECT → existing row ALREADY pinned to 'user-oid-123' (matches presented) → proceed; then upsert.
      ms_graph_connections: [
        { data: { id: 'conn-1', entra_user_object_id: 'user-oid-123' }, error: null },
        { data: { id: 'conn-1' }, error: null },
      ],
    });
    const fetch = fetchOk({
      access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH', expires_in: 3600,
      id_token: mintIdToken({ tid: 'test-tenant-id', oid: 'user-oid-123' }),
    });

    const result = await handleCallback(callbackReq({ code: 'auth-code', state: 'state-xyz' }), deps({ service, fetch }));

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toMatch(/m365_connected=true$/);
    const upsert = service.writes.find((w) => w.kind === 'upsert' && w.table === 'ms_graph_connections');
    expect(upsert).toBeTruthy();
    expect((upsert!.payload as Record<string, unknown>).entra_user_object_id).toBe('user-oid-123');
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.initiated' }));
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.identity_mismatch' }));
  });

  it('AC-M365-173 (enforce-on-reconnect): a reconnect presenting a DIFFERENT oid is REJECTED — no upsert, M365_IDENTITY_MISMATCH error_event + m365.connection.identity_mismatch audit, no oid/token leak', async () => {
    // The same-tenant consent-phishing exploit: a PMO Admin (pinned oid 'user-oid-123') initiates a
    // connect and phishes the authorize URL to a victim in the SAME Entra tenant. The victim
    // consents; Microsoft issues tokens with tid = test-tenant-id (matches!) but oid = 'victim-oid'
    // (differs from the pinned value). The callback MUST reject before any encrypt/upsert.
    const service = mockClient({
      m365_pkce_states: [{ data: pkceRow(), error: null }],
      profiles: [{ data: { status: 'active' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
      // identity SELECT → existing row pinned to 'user-oid-123'; presented 'victim-oid' → MISMATCH → reject.
      ms_graph_connections: [{ data: { id: 'conn-1', entra_user_object_id: 'user-oid-123' }, error: null }],
    });
    const fetch = fetchOk({
      access_token: 'VICTIM-ACCESS', refresh_token: 'VICTIM-REFRESH', expires_in: 3600,
      id_token: mintIdToken({ tid: 'test-tenant-id', oid: 'victim-oid' }),
    });

    const result = await handleCallback(callbackReq({ code: 'auth-code', state: 'state-xyz' }), deps({ service, fetch }));

    // Rejected — FE error redirect (NOT success).
    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    expect(result.headers?.Location).not.toMatch(/m365_connected=true$/);
    // NO connection mutation stored — the victim's tokens are not persisted into the attacker's row.
    // (Pure reads are not recorded by the mock, so this is an honest no-mutation check.)
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false);
    // A SANITIZED error_event with the distinct, greppable M365_IDENTITY_MISMATCH code.
    const ev = service.writes.find((w) => w.table === 'error_events');
    expect(ev).toBeTruthy();
    expect((ev!.payload as { error_code: string }).error_code).toBe('M365_IDENTITY_MISMATCH');
    // The error_event carries NO token material and NO raw oid.
    const evJson = JSON.stringify(ev!.payload);
    expect(evJson).not.toMatch(/VICTIM-ACCESS|VICTIM-REFRESH|user-oid-123|victim-oid|verifier-abc|auth-code/i);
    // A forensic m365.connection.identity_mismatch audit row (server-side) — records stored vs
    // presented oid (public MS identifiers, not secrets) for the security trail. NO token material.
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({
      p_action: 'm365.connection.identity_mismatch',
      p_org_id: 'org-1',
      p_entity_id: 'conn-1',
      p_detail: expect.objectContaining({
        stored_entra_user_object_id: 'user-oid-123',
        presented_entra_user_object_id: 'victim-oid',
        entra_tenant_id: 'test-tenant-id',
      }),
    }));
    const auditJson = JSON.stringify(service.rpc.mock.calls.filter((c) => c[0] === 'audit_m365_event'));
    expect(auditJson).not.toMatch(/VICTIM-ACCESS|VICTIM-REFRESH|verifier-abc|auth-code/i);
    // The CLIENT-FACING redirect message leaks NO oid and NO token.
    expect(JSON.stringify(result.headers)).not.toMatch(/victim-oid|user-oid-123|VICTIM-ACCESS|VICTIM-REFRESH/i);
    // No success audit.
    expect(service.rpc).not.toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.initiated' }));
  });
});
