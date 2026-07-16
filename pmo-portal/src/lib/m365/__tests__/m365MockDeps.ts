// m365MockDeps.ts — Vitest helpers for the m365-token-custody handler tests (ADR-0039 DI style).
// Builds injectable HandlerDeps with a flexible mock Supabase client + a REAL test KEK so the
// Phase-0 graphTokenCrypto envelope runs for real (no crypto mocking — tests assert real behavior).

import { vi } from 'vitest';
import type { HandlerDeps, M365Env } from '../../../../../supabase/functions/m365-token-custody/types';
import { encryptToken, serializeEnvelope } from '../graphTokenCrypto';

// A fixed 32-byte KEK (graphTokenCrypto requires 256-bit). base64url for the M365Env string.
const TEST_KEK_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
export const TEST_KEK_B64URL = Buffer.from(TEST_KEK_BYTES).toString('base64url');
const testKek = () => TEST_KEK_BYTES.slice();

export function testEnv(overrides: Partial<M365Env> = {}): M365Env {
  return {
    m365TenantId: 'test-tenant-id',
    m365ClientId: 'test-client-id',
    m365ClientSecret: 'test-client-secret',
    m365RedirectUri: 'https://test.supabase.co/functions/v1/m365-token-custody/callback',
    m365TokenKek: TEST_KEK_B64URL,
    supabaseUrl: 'https://test.supabase.co',
    jwtIssuer: 'https://test.supabase.co/auth/v1',
    siteUrl: 'https://app.test.example.com',
    allowedOrigin: 'https://app.test.example.com',
    ...overrides,
  };
}

/** Encrypt `plaintext` under the test KEK and serialize to the stored `iv||ciphertext` blob. */
export async function encryptForTest(plaintext: string): Promise<Uint8Array> {
  const env = await encryptToken(plaintext, testKek());
  return serializeEnvelope(env.iv, env.ciphertext);
}

export interface RecordedWrite {
  table: string;
  kind: 'insert' | 'update' | 'upsert' | 'delete';
  payload?: unknown;
  eqs: Array<[string, unknown]>;
}

export interface MockClient {
  client: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  writes: RecordedWrite[];
  /** Queue the next terminal response for `.from(table)` calls (FIFO). */
  push(table: string, resp: unknown): void;
}

/**
 * A flexible mock supabase-js client. `push(table, resp)` queues terminal responses (FIFO per
 * table); every write (insert/update/upsert/delete) is recorded with its payload + eq filters for
 * assertions. `.rpc()` resolves `{ data: null, error: null }` by default (audit always succeeds).
 */
export function mockClient(seeded: Record<string, unknown[]> = {}): MockClient {
  const queues: Record<string, unknown[]> = {};
  for (const [t, rs] of Object.entries(seeded)) queues[t] = [...rs];
  const writes: RecordedWrite[] = [];

  const from = vi.fn((table: string) => {
    let kind: RecordedWrite['kind'] | '' = '';
    let payload: unknown;
    const eqs: Array<[string, unknown]> = [];
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      if (kind) writes.push({ table, kind, payload, eqs: [...eqs] });
    };
    const next = () => {
      const list = queues[table] ?? [];
      if (list.length) {
        const resp = list.shift();
        return Promise.resolve(resp);
      }
      // Default terminal response when nothing is queued. For writes that callers inspect via
      // `.select()` (update/delete RETURNING — refresh.ts & revoke.ts), return a non-null affected
      // row so the default path models a SUCCESSFUL write (an affected row exists). Tests that need
      // a zero-row write or a guard rejection seed an explicit queued response.
      if (kind === 'update' || kind === 'delete') {
        const idEq = eqs.find(([c]) => c === 'id');
        return Promise.resolve({ data: idEq ? { id: idEq[1] } : { id: 'ok' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const self: Record<string, unknown> = {
      select: () => { kind = kind || 'select' as never; return self; },
      delete: () => { kind = 'delete'; return self; },
      insert: (p: unknown) => { kind = 'insert'; payload = p; return self; },
      update: (p: unknown) => { kind = 'update'; payload = p; return self; },
      upsert: (p: unknown) => { kind = 'upsert'; payload = p; return self; },
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return self; },
      order: () => self,
      range: () => self,
      limit: () => self,
      in: () => self,
      neq: () => self,
      single: () => { record(); return next(); },
      maybeSingle: () => { record(); return next(); },
      then: (resolve: unknown, reject?: unknown) => { record(); return next().then(resolve as never, reject as never); },
      catch: () => next(),
      finally: () => next(),
    };
    return self;
  });

  // The m365 connection-mutation RPCs (0105 — the lock-order / deadlock closure) are translated
  // here into the SAME write-record + queue shape the tests already assert on, so routing the
  // edge-fn writes through RPCs is transparent to the existing assertions (the tests check behavior
  // — what got written + the success/failure outcome — not the call mechanism). Each records a
  // synthetic write (kind upsert/update on ms_graph_connections) and pops the next queued
  // ms_graph_connections response, reducing {data:{id}} → the scalar id the real RPC returns.
  const popConnId = (table: string) => {
    const list = queues[table] ?? [];
    if (list.length) {
      const resp = list.shift() as { data?: unknown; error?: unknown } | null;
      const rowData = resp?.data;
      const id = rowData && typeof rowData === 'object' ? (rowData as { id?: unknown }).id ?? null : rowData;
      return Promise.resolve({ data: id ?? null, error: resp?.error ?? null });
    }
    // Empty queue → model a SUCCESSFUL write (a truthy affected id), mirroring the old
    // update/delete default so success-path tests that don't queue a response still pass.
    return Promise.resolve({ data: 'ok', error: null });
  };

  const rpc = vi.fn((fn: string, args?: Record<string, unknown>) => {
    if (fn === 'm365_upsert_connection' && args) {
      writes.push({
        table: 'ms_graph_connections', kind: 'upsert', eqs: [],
        payload: {
          org_id: args.p_org_id, user_id: args.p_user_id,
          entra_tenant_id: args.p_entra_tenant_id, entra_user_object_id: args.p_entra_user_object_id,
          scopes: args.p_scopes,
          refresh_token_ciphertext: args.p_refresh_token_ciphertext,
          access_token_ciphertext: args.p_access_token_ciphertext,
          access_token_expires_at: args.p_access_token_expires_at,
          key_id: args.p_key_id, status: 'active',
          connected_at: args.p_connected_at, last_refresh_at: args.p_last_refresh_at,
        },
      });
      return popConnId('ms_graph_connections');
    }
    if (fn === 'm365_refresh_connection' && args) {
      writes.push({
        table: 'ms_graph_connections', kind: 'update', eqs: [['id', args.p_connection_id]],
        payload: {
          status: 'active',
          access_token_ciphertext: args.p_access_token_ciphertext,
          refresh_token_ciphertext: args.p_refresh_token_ciphertext,
          access_token_expires_at: args.p_access_token_expires_at,
          last_refresh_at: args.p_last_refresh_at,
        },
      });
      return popConnId('ms_graph_connections');
    }
    if (fn === 'm365_set_connection_status' && args) {
      writes.push({
        table: 'ms_graph_connections', kind: 'update', eqs: [['id', args.p_connection_id]],
        payload: { status: args.p_status, updated_at: args.p_updated_at },
      });
      return popConnId('ms_graph_connections');
    }
    // audit_m365_event / recordErrorEvent / any other rpc → default success (audit is swallowed).
    return Promise.resolve({ data: null, error: null });
  });

  return {
    client: { from, rpc },
    from,
    rpc,
    writes,
    push: (t: string, resp: unknown) => {
      (queues[t] ??= []).push(resp);
    },
  };
}

/** Build HandlerDeps from a mock client + caller client + injectable fetch/clock. */
export function deps(opts: {
  service: MockClient;
  caller?: MockClient;
  userId?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  env?: Partial<M365Env>;
}): HandlerDeps {
  return {
    env: testEnv(opts.env),
    serviceClient: opts.service.client as never,
    callerClient: opts.caller?.client as never,
    userId: opts.userId ?? 'user-1',
    fetch: opts.fetch,
    now: opts.now,
  };
}
