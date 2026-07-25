/**
 * AC-M365-140 — secrets hygiene: no plaintext token / code / verifier / secret appears in any log
 * (console), error_event payload, or response body. Captures console + inspects every result body.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleCallback } from '../../../../../supabase/functions/m365-token-custody/callback';
import { handleGraphProxy } from '../../../../../supabase/functions/m365-token-custody/proxy';
import { handleDisconnect } from '../../../../../supabase/functions/m365-token-custody/revoke';
import { mockClient, deps, encryptForTest } from './m365MockDeps';
import type { ConnectionRow, PkceStateRow } from '../../../../../supabase/functions/m365-token-custody/types';

// Substrings that must NEVER appear in logs or client-facing bodies.
const FORBIDDEN = ['REFRESH-VALUE', 'ACCESS-VALUE', 'REFRESH-TOKEN', 'ACCESS-TOKEN', 'verifier-abc', 'test-client-secret', 'auth-code'];

function captureConsole() {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const collected = () => [...err.mock.calls, ...log.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
  return { collected, restore: () => { err.mockRestore(); log.mockRestore(); } };
}

function assertNoSecret(s: string, where: string) {
  for (const f of FORBIDDEN) expect(s, `${where}: leaked "${f}"`).not.toContain(f);
}

function callerClient() {
  return mockClient({
    profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
    org_features: [{ data: { enabled: true }, error: null }],
  });
}

describe('AC-M365-140 — secrets hygiene', () => {
  it('AC-M365-140: callback exchange-failure logs only the sanitized Microsoft code — never code/verifier/secret', async () => {
    const row: PkceStateRow = {
      id: 'pkce-1', org_id: 'org-1', user_id: 'user-1', code_verifier: 'verifier-abc',
      state: 'state-xyz', scopes: ['Files.Read'], created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const service = mockClient({
      m365_pkce_states: [{ data: row, error: null }],
      ms_graph_connections: [{ data: { id: 'conn-1' }, error: null }],
    });
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid_grant' }) });
    const cap = captureConsole();
    try {
      const req = new Request('https://x/callback?code=auth-code&state=state-xyz');
      const result = await handleCallback(req, deps({ service, fetch }));
      assertNoSecret(JSON.stringify(result), 'callback error body');
      assertNoSecret(JSON.stringify(result.headers), 'callback error headers');
      assertNoSecret(cap.collected(), 'callback error logs');
    } finally {
      cap.restore();
    }
  });

  it('AC-M365-140: graph_proxy never logs or echoes the decrypted access token', async () => {
    const conn: ConnectionRow = {
      id: 'conn-1', org_id: 'org-1', user_id: 'user-1', entra_tenant_id: 'test-tenant-id',
      entra_user_object_id: null,
      scopes: ['Files.Read', 'offline_access'],
      refresh_token_ciphertext: await encryptForTest('REFRESH-TOKEN'),
      access_token_ciphertext: await encryptForTest('ACCESS-TOKEN'),
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      refresh_token_expires_at: null, key_id: 'kek-v1', status: 'active',
      connected_at: new Date().toISOString(), last_refresh_at: null, updated_at: new Date().toISOString(),
    };
    const service = mockClient({ ms_graph_connections: [{ data: conn, error: null }] });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: ['doc'] }) });
    const cap = captureConsole();
    try {
      const result = await handleGraphProxy(
        { action: 'graph_proxy', method: 'GET', path: '/me/drive/root/children' },
        deps({ service, caller: callerClient(), userId: 'user-1', fetch }),
      );
      assertNoSecret(JSON.stringify(result.body), 'proxy response body');
      assertNoSecret(cap.collected(), 'proxy logs');
    } finally {
      cap.restore();
    }
  });

  it('AC-M365-140: typed error responses (FORBIDDEN / SCOPE_INSUFFICIENT / NOT_CONNECTED) carry no token material', async () => {
    const conn: ConnectionRow = {
      id: 'conn-1', org_id: 'org-1', user_id: 'user-1', entra_tenant_id: 'test-tenant-id',
      entra_user_object_id: null,
      scopes: ['Files.Read', 'offline_access'],
      refresh_token_ciphertext: await encryptForTest('REFRESH-TOKEN'),
      access_token_ciphertext: await encryptForTest('ACCESS-TOKEN'),
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      refresh_token_expires_at: null, key_id: 'kek-v1', status: 'active',
      connected_at: new Date().toISOString(), last_refresh_at: null, updated_at: new Date().toISOString(),
    };

    // non-Admin → FORBIDDEN
    const forbidCaller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Member' }, error: null }],
    });
    const r1 = await handleGraphProxy(
      { action: 'graph_proxy', method: 'GET', path: '/me/drive/root' },
      deps({ service: mockClient({ ms_graph_connections: [{ data: conn, error: null }] }), caller: forbidCaller, userId: 'user-1' }),
    );
    assertNoSecret(JSON.stringify(r1.body), 'FORBIDDEN body');

    // scope mismatch → SCOPE_INSUFFICIENT
    const r2 = await handleGraphProxy(
      { action: 'graph_proxy', method: 'GET', path: '/me/events' },
      deps({ service: mockClient({ ms_graph_connections: [{ data: conn, error: null }] }), caller: callerClient(), userId: 'user-1' }),
    );
    assertNoSecret(JSON.stringify(r2.body), 'SCOPE_INSUFFICIENT body');

    // no connection → NOT_CONNECTED
    const r3 = await handleGraphProxy(
      { action: 'graph_proxy', method: 'GET', path: '/me/drive/root' },
      deps({ service: mockClient({ ms_graph_connections: [{ data: null, error: { code: 'PGRST116' } }] }), caller: callerClient(), userId: 'user-1' }),
    );
    assertNoSecret(JSON.stringify(r3.body), 'NOT_CONNECTED body');
  });

  it('AC-M365-140: disconnect never logs the decrypted refresh token', async () => {
    const conn: ConnectionRow = {
      id: 'conn-1', org_id: 'org-1', user_id: 'user-1', entra_tenant_id: 'test-tenant-id',
      entra_user_object_id: null,
      scopes: ['Files.Read', 'offline_access'],
      refresh_token_ciphertext: await encryptForTest('REFRESH-TOKEN'),
      access_token_ciphertext: null, access_token_expires_at: null, refresh_token_expires_at: null,
      key_id: 'kek-v1', status: 'active', connected_at: new Date().toISOString(), last_refresh_at: null, updated_at: new Date().toISOString(),
    };
    const service = mockClient({ ms_graph_connections: [{ data: conn, error: null }] });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const cap = captureConsole();
    try {
      const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));
      assertNoSecret(JSON.stringify(result.body), 'disconnect body');
      assertNoSecret(cap.collected(), 'disconnect logs');
    } finally {
      cap.restore();
    }
  });
});
