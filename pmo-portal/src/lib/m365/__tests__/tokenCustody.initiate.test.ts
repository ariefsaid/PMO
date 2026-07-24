/**
 * AC-M365-101/102/142 — PKCE state store + initiate_connect.
 * AC-M365-101: storePkceState inserts the single-use row; initiate_connect returns the authorize URL.
 * AC-M365-102: initiate_connect denies non-Admin / non-entitled callers.
 * AC-M365-104: consumePkceState returns null for a missing state (replay/expiry → no token exchange).
 * AC-M365-142: consumePkceState is single-use (deletes the row).
 */
import { describe, it, expect } from 'vitest';
import { handleInitiateConnect } from '../../../../../supabase/functions/m365-token-custody/initiate';
import {
  storePkceState,
  consumePkceState,
  type PkceStateRow,
} from '../../../../../supabase/functions/m365-token-custody/stateStore';
import { mockClient, deps } from './m365MockDeps';

function entitledCaller(role = 'Admin') {
  return mockClient({
    profiles: [{ data: { org_id: 'org-1', role }, error: null }],
    org_features: [{ data: { enabled: true }, error: null }],
  });
}

describe('AC-M365-101/142 — storePkceState / consumePkceState', () => {
  it('AC-M365-101: storePkceState inserts org_id, user_id, code_verifier, state, scopes, expires_at', async () => {
    const service = mockClient();
    const now = new Date('2026-07-15T12:00:00Z');
    await storePkceState(
      service.client as never,
      { orgId: 'org-1', userId: 'user-1', codeVerifier: 'verifier-abc', state: 'state-xyz', scopes: ['Files.Read', 'offline_access'] },
      () => now,
    );
    expect(service.from).toHaveBeenCalledWith('m365_pkce_states');
    expect(service.writes).toHaveLength(1);
    const row = service.writes[0];
    expect(row).toMatchObject({
      kind: 'insert',
      payload: expect.objectContaining({
        org_id: 'org-1',
        user_id: 'user-1',
        code_verifier: 'verifier-abc',
        state: 'state-xyz',
        scopes: ['Files.Read', 'offline_access'],
      }),
    });
    // TTL = 10 minutes from `now`.
    expect((row!.payload as { expires_at: string }).expires_at).toBe('2026-07-15T12:10:00.000Z');
  });

  it('AC-M365-142: consumePkceState returns the bound verifier+scopes and DELETES the row (single-use)', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const row: PkceStateRow = {
      id: 'pkce-1', org_id: 'org-1', user_id: 'user-1', code_verifier: 'verifier-abc',
      state: 'state-xyz', scopes: ['Files.Read', 'offline_access'], created_at: new Date().toISOString(),
      expires_at: future,
    };
    const service = mockClient({
      m365_pkce_states: [{ data: row, error: null }],
    });
    const result = await consumePkceState(service.client as never, 'state-xyz');
    expect(result).toEqual({
      codeVerifier: 'verifier-abc', scopes: ['Files.Read', 'offline_access'], orgId: 'org-1', userId: 'user-1',
    });
    // The row was deleted (single-use enforcement).
    expect(service.writes.some((w) => w.kind === 'delete' && w.table === 'm365_pkce_states')).toBe(true);
  });

  it('AC-M365-104: consumePkceState returns null for a missing/expired state (no verifier leaked)', async () => {
    const service = mockClient({ m365_pkce_states: [{ data: null, error: { code: 'PGRST116' } }] });
    const result = await consumePkceState(service.client as never, 'bad-state');
    expect(result).toBeNull();
  });
});

describe('AC-M365-101/102 — handleInitiateConnect', () => {
  it('AC-M365-101: an entitled Admin receives an authorize URL + state and the PKCE state is stored', async () => {
    const service = mockClient();
    const caller = entitledCaller('Admin');
    const result = await handleInitiateConnect(deps({ service, caller, userId: 'user-1' }));

    expect(result.status).toBe(200);
    const body = result.body as { authorizeUrl: string; state: string };
    expect(body.state).toBeTruthy();
    // authorize URL is pinned to the Microsoft host + the env tenant (never caller-supplied).
    expect(body.authorizeUrl).toMatch(/^https:\/\/login\.microsoftonline\.com\/test-tenant-id\/oauth2\/v2\.0\/authorize/);
    expect(body.authorizeUrl).toContain('response_type=code');
    expect(body.authorizeUrl).toContain('code_challenge_method=S256');
    expect(body.authorizeUrl).toContain('scope=Files.Read+offline_access+openid+profile');
    // The single-use state row was written for this org+user.
    expect(service.writes).toContainEqual(
      expect.objectContaining({ table: 'm365_pkce_states', kind: 'insert' }),
    );
  });

  it('AC-M365-102: a non-Operator caller is forbidden (403 FORBIDDEN, no state stored)', async () => {
    // ADR-0058 §3 amendment (2026-07-24): the gate is Operator, NOT org-Admin. An org Admin who is
    // not a platform Operator must be rejected — the Entra app registration is vendor-owned.
    const service = mockClient({ platform_operators: [{ data: null, error: null }] });
    const caller = entitledCaller('Admin');
    const result = await handleInitiateConnect(deps({ service, caller, userId: 'user-1' }));
    expect(result).toMatchObject({ status: 403, body: { error: 'FORBIDDEN' } });
    expect(service.writes).toHaveLength(0);
  });

  it('AC-M365-102: an org without the entitlement is rejected (403 NOT_ENTITLED, no state stored)', async () => {
    const service = mockClient();
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
      org_features: [{ data: { enabled: false }, error: null }],
    });
    const result = await handleInitiateConnect(deps({ service, caller, userId: 'user-1' }));
    expect(result).toMatchObject({ status: 403, body: { error: 'NOT_ENTITLED' } });
    expect(service.writes).toHaveLength(0);
  });
});
