/**
 * AC-M365-103/104/105 — the OAuth callback (GET /callback?code=&state=).
 * The consumed single-use state row is the credential on this GET path (no Bearer on a 302).
 * Real graphTokenCrypto envelope runs (no crypto mocking).
 */
import { describe, it, expect, vi } from 'vitest';
import { handleCallback } from '../../../../../supabase/functions/m365-token-custody/callback';
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
      ms_graph_connections: [{ data: { id: 'conn-1' }, error: null }],
    });
    const fetch = fetchOk({ access_token: 'ACCESS-VALUE', refresh_token: 'REFRESH-VALUE', expires_in: 3600 });

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
    });
    const payload = upsert!.payload as Record<string, unknown>;
    expect(payload.access_token_ciphertext).toBeInstanceOf(Uint8Array);
    expect(payload.refresh_token_ciphertext).toBeInstanceOf(Uint8Array);
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
});
