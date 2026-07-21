/**
 * AC-M365-120 — explicit disconnect (POST /disconnect): best-effort Microsoft revoke, then delete
 * the local connection row and audit. Real graphTokenCrypto decrypt runs on the stored refresh token.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleDisconnect } from '../../../../../supabase/functions/m365-token-custody/revoke';
import { mockClient, deps, encryptForTest } from './m365MockDeps';
import type { ConnectionRow } from '../../../../../supabase/functions/m365-token-custody/types';

const REVOKE_URL = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/revoke';

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

describe('AC-M365-120 — handleDisconnect', () => {
  it('AC-M365-120: best-effort revokes at Microsoft (sends the decrypted refresh token), deletes the row, audits reason=user_disconnect', async () => {
    const conn = await connection();
    const service = mockClient({ ms_graph_connections: [{ data: conn, error: null }] });
    const fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));

    expect(result).toMatchObject({ status: 200, body: { success: true } });

    // Microsoft revoke attempted with the DECRYPTED refresh token + confidential-client secret.
    expect(fetch).toHaveBeenCalledWith(REVOKE_URL, expect.objectContaining({ method: 'POST' }));
    const body = (fetch.mock.calls[0]![1] as { body: URLSearchParams }).body;
    expect(body.get('token')).toBe('REFRESH-TOKEN');
    expect(body.get('client_secret')).toBe('test-client-secret');

    // Local row deleted (source of truth) and audited.
    expect(service.writes.some((w) => w.kind === 'delete' && w.table === 'ms_graph_connections')).toBe(true);
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({
      p_action: 'm365.connection.revoked', p_org_id: 'org-1', p_actor_id: 'user-1', p_entity_id: 'conn-1',
      p_detail: expect.objectContaining({ reason: 'user_disconnect' }),
    }));
  });

  it('AC-M365-120: a Microsoft revoke failure is ignored — the row is still deleted and audited', async () => {
    const conn = await connection();
    const service = mockClient({ ms_graph_connections: [{ data: conn, error: null }] });
    const fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));

    expect(result).toMatchObject({ status: 200, body: { success: true } });
    expect(service.writes.some((w) => w.kind === 'delete' && w.table === 'ms_graph_connections')).toBe(true);
    expect(service.rpc).toHaveBeenCalledWith('audit_m365_event', expect.objectContaining({ p_action: 'm365.connection.revoked' }));
  });

  it('AC-M365-120: no connection → NOT_CONNECTED (no revoke, no audit)', async () => {
    const service = mockClient({ ms_graph_connections: [{ data: null, error: { code: 'PGRST116' } }] });
    const fetch = vi.fn();
    const result = await handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch }));
    expect(result).toMatchObject({ status: 404, body: { error: 'NOT_CONNECTED' } });
    expect(fetch).not.toHaveBeenCalled();
    expect(service.rpc).not.toHaveBeenCalled();
  });
});
