/**
 * AC-OUT-841 — every outbound call from m365-token-custody is bounded: a Microsoft host that never
 * answers is aborted at the deadline and takes the handler's EXISTING failure path — never a hang.
 * The shipped handlers run with an injected fetch that only settles when its AbortSignal fires.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleCallback } from '../../../../../supabase/functions/m365-token-custody/callback';
import { handleGraphProxy } from '../../../../../supabase/functions/m365-token-custody/proxy';
import { handleDisconnect } from '../../../../../supabase/functions/m365-token-custody/revoke';
import { refreshAccessToken } from '../../../../../supabase/functions/m365-token-custody/refresh';
import { OUTBOUND_FETCH_TIMEOUT_MS } from '../../../../../supabase/functions/_shared/fetchWithDeadline';
import { mockClient, deps, encryptForTest } from './m365MockDeps';
import type { ConnectionRow, PkceStateRow } from '../../../../../supabase/functions/m365-token-custody/types';

/** A fetch that never settles until the deadline's AbortSignal fires. */
function hungFetch() {
  return vi.fn((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  );
}

async function connection(overrides: Partial<ConnectionRow> = {}): Promise<ConnectionRow> {
  return {
    id: 'conn-1', org_id: 'org-1', user_id: 'user-1', entra_tenant_id: 'test-tenant-id',
    entra_user_object_id: null, scopes: ['Files.Read', 'offline_access'],
    refresh_token_ciphertext: await encryptForTest('REFRESH-TOKEN'),
    access_token_ciphertext: await encryptForTest('ACCESS-TOKEN'),
    access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    refresh_token_expires_at: null, key_id: 'kek-v1', status: 'active',
    connected_at: new Date().toISOString(), last_refresh_at: null, updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const callerClient = () =>
  mockClient({
    profiles: [{ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }],
    org_features: [{ data: { enabled: true }, error: null }],
  });

/** Drive the fake clock past the deadline. The handler reaches its fetch only after real async crypto, so
 *  tick in slices (yielding to real I/O between them) until it settles, bounded at 3x the deadline. */
async function settleAfterDeadline<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const tracked = p.finally(() => { done = true; });
  for (let waited = 0; !done && waited < 3 * OUTBOUND_FETCH_TIMEOUT_MS; waited += 1000) {
    await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(1000);
  }
  return tracked;
}

describe('AC-OUT-841 — m365-token-custody outbound calls are deadline-bounded', () => {
  afterEach(() => vi.useRealTimers());

  it('AC-OUT-841: graph_proxy rejects a hung Graph call at the deadline with the existing opaque 502 GRAPH_ERROR', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const service = mockClient({ ms_graph_connections: [{ data: await connection(), error: null }] });
    const fetch = hungFetch();
    const result = await settleAfterDeadline(
      handleGraphProxy(
        { action: 'graph_proxy', method: 'GET', path: '/me/drive/root/children' },
        deps({ service, caller: callerClient(), userId: 'user-1', fetch }),
      ),
    );
    expect(result).toMatchObject({ status: 502, body: { error: 'GRAPH_ERROR' } });
  });

  it('AC-OUT-841: the callback token exchange takes the failed-exchange path (error redirect, nothing stored) when Microsoft hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pkce: PkceStateRow = {
      id: 'pkce-1', org_id: 'org-1', user_id: 'user-1', code_verifier: 'verifier-abc', state: 'state-xyz',
      scopes: ['Files.Read'], created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const service = mockClient({ m365_pkce_states: [{ data: pkce, error: null }] });
    const result = await settleAfterDeadline(
      handleCallback(
        new Request('https://test.supabase.co/functions/v1/m365-token-custody/callback?code=c&state=state-xyz'),
        deps({ service, fetch: hungFetch() }),
      ),
    );
    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain('m365_error=');
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false);
  });

  it('AC-OUT-841: a hung refresh returns false (stale) WITHOUT marking the connection revoked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const service = mockClient({});
    const ok = await settleAfterDeadline(
      refreshAccessToken(await connection(), deps({ service, fetch: hungFetch() })),
    );
    expect(ok).toBe(false);
    expect(service.writes.some((w) => w.table === 'ms_graph_connections')).toBe(false);
  });

  it('AC-OUT-841: a hung best-effort revoke still deletes the local connection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const service = mockClient({ ms_graph_connections: [{ data: await connection(), error: null }] });
    const result = await settleAfterDeadline(
      handleDisconnect(deps({ service, caller: callerClient(), userId: 'user-1', fetch: hungFetch() })),
    );
    expect(result).toMatchObject({ status: 200, body: { success: true } });
    expect(service.writes.some((w) => w.kind === 'delete' && w.table === 'ms_graph_connections')).toBe(true);
  });
});
