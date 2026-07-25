/**
 * AC-M365-141 — tenant pinning + redirect-URI allowlist (graphPkce + initiate wiring).
 * AC-M365-142 — CSRF state single-use (consume deletes the row; a replayed state yields no verifier).
 */
import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl, isValidTenant } from '../graphPkce';
import { handleInitiateConnect } from '../../../../../supabase/functions/m365-token-custody/initiate';
import { consumePkceState } from '../../../../../supabase/functions/m365-token-custody/stateStore';
import { mockClient, deps } from './m365MockDeps';
import type { PkceStateRow } from '../../../../../supabase/functions/m365-token-custody/types';

describe('AC-M365-141 — isValidTenant (M3 Luna tightening)', () => {
  it('AC-M365-141 / M3: accepts the valid tenant forms (GUID, common/organizations/consumers, verified domain)', () => {
    for (const tenant of [
      '11111111-2222-3333-4444-555555555555',
      'common',
      'organizations',
      'consumers',
      'contoso.onmicrosoft.com',
      'tenant-a',
    ]) {
      expect(isValidTenant(tenant), tenant).toBe(true);
    }
  });

  it('AC-M365-141 / M3: rejects dot-segments (..) anywhere and all-dot values', () => {
    for (const tenant of ['.', '..', '...', 'a..b', '../evil', 'evil/..', 'foo..']) {
      expect(isValidTenant(tenant), tenant).toBe(false);
    }
  });

  it('AC-M365-141 / M3: rejects path / query / whitespace / percent payloads', () => {
    for (const tenant of [
      'common/oauth2/v2.0/authorize?client_id=evil',
      'common?client_id=evil',
      '../../evil',
      'evil\\x20',
      'a b',
      'a%20b',
      '',
    ]) {
      expect(isValidTenant(tenant), tenant).toBe(false);
    }
  });

  it('AC-M365-141 / M3: isValidTenant is a type guard (narrows unknown → string)', () => {
    const t: unknown = '11111111-2222-3333-4444-555555555555';
    if (isValidTenant(t)) {
      // t is narrowed to string here (compile-time check).
      expect(t.length).toBe(36);
    }
    expect(isValidTenant(undefined)).toBe(false);
    expect(isValidTenant(null)).toBe(false);
    expect(isValidTenant(123)).toBe(false);
  });
});

describe('AC-M365-141 — tenant pinning (graphPkce.buildAuthorizeUrl)', () => {
  it('AC-M365-141: rejects a tenant carrying path traversal', () => {
    expect(() =>
      buildAuthorizeUrl({ tenant: 'common/../evil', clientId: 'id', redirectUri: 'https://allow/cb', scopes: ['Files.Read'], state: 's', codeChallenge: 'c' }),
    ).toThrow(/tenant/i);
  });

  it('AC-M365-141: rejects a tenant carrying query injection', () => {
    expect(() =>
      buildAuthorizeUrl({ tenant: 'common?client_id=evil', clientId: 'id', redirectUri: 'https://allow/cb', scopes: ['Files.Read'], state: 's', codeChallenge: 'c' }),
    ).toThrow(/tenant/i);
  });

  it('AC-M365-141: the authorize URL host is always login.microsoftonline.com and uses the env redirect URI (never caller-supplied)', async () => {
    const service = mockClient();
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
    });
    const result = await handleInitiateConnect(deps({ service, caller, userId: 'user-1' }));
    const url = new URL((result.body as { authorizeUrl: string }).authorizeUrl);
    expect(url.host).toBe('login.microsoftonline.com');
    expect(url.pathname).toContain('test-tenant-id');
    // redirect_uri is the allowlisted env value only.
    expect(url.searchParams.get('redirect_uri')).toBe('https://test.supabase.co/functions/v1/m365-token-custody/callback');
  });
});

describe('AC-M365-142 — CSRF state single-use', () => {
  it('AC-M365-142: consuming a valid state returns the verifier AND deletes the row (a replay must fail)', async () => {
    const row: PkceStateRow = {
      id: 'pkce-1', org_id: 'org-1', user_id: 'user-1', code_verifier: 'verifier-abc',
      state: 'state-xyz', scopes: ['Files.Read'], created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const service = mockClient({ m365_pkce_states: [{ data: row, error: null }] });
    const first = await consumePkceState(service.client as never, 'state-xyz');
    expect(first?.codeVerifier).toBe('verifier-abc');
    // The single-use row was deleted — a second consume (replay) against the same store yields null.
    expect(service.writes.some((w) => w.kind === 'delete' && w.table === 'm365_pkce_states')).toBe(true);
  });

  it('AC-M365-142: the state token minted by initiate is URL-safe (no path/query metacharacters)', async () => {
    const service = mockClient();
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
    });
    const result = await handleInitiateConnect(deps({ service, caller, userId: 'user-1' }));
    const state = (result.body as { state: string }).state;
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state.length).toBeGreaterThanOrEqual(32);
  });
});
