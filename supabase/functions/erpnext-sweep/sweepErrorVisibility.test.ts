/**
 * AC-998 sweep failure visibility — exercises the shipped sweep wiring, not copied orchestration.
 */
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepOrgDoctypesLive, sweepWatermarkDomain } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import { contactDb } from '../_shared/erpnextContacts.fixtures.ts';

const ORG = '00000000-0000-4000-8000-000000009980';
const SECRET_REF = 'synthetic-sweep-binding';
const ERROR_TEXT = 'Upstream failed at https://upstream.example.test/private?token=query-secret#fragment secret_abcdef0123456789abcdef0123456789';
const SUPPLIER_DOMAIN = sweepWatermarkDomain('supplier');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Watermark {
  org_id: string;
  external_tier: string;
  domain: string;
  watermark_cursor: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  updated_at?: string | null;
}

function fakeDb(seed: Watermark[] = []) {
  const base = contactDb({
    companies: [],
    profiles: [{ id: 'synthetic-admin', org_id: ORG, status: 'active', role: 'Admin' }],
    notifications: [],
  });
  const watermarks = new Map(seed.map((row) => [row.domain, { ...row }]));
  const watermarkUpserts: Watermark[] = [];
  const errorEvents: Array<Record<string, unknown>> = [];
  let failErrorEventInsert = false;
  const baseFrom = base.client.from.bind(base.client);

  const watermarkQuery = () => {
    let action: 'select' | 'update' = 'select';
    let patch: Partial<Watermark> = {};
    const filters = new Map<string, unknown>();
    const inFilters = new Map<string, unknown[]>();
    const matches = (row: Watermark) =>
      [...filters].every(([key, value]) => row[key as keyof Watermark] === value)
      && [...inFilters].every(([key, values]) => values.includes(row[key as keyof Watermark]));
    const matchingRows = () => [...watermarks.values()].filter(matches);
    const execute = () => {
      if (action === 'update') {
        for (const row of matchingRows()) Object.assign(row, patch);
      }
      return { data: matchingRows(), error: null };
    };
    type QueryBuilder = {
      select: () => QueryBuilder;
      eq: (key: string, value: unknown) => QueryBuilder;
      in: (key: string, values: unknown[]) => QueryBuilder;
      update: (value: Partial<Watermark>) => QueryBuilder;
      upsert: (value: Watermark) => Promise<{ data: null; error: null }>;
      maybeSingle: () => Promise<{ data: Watermark | null; error: null }>;
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
    };
    const builder: QueryBuilder = {
      select: () => builder,
      eq: (key, value) => { filters.set(key, value); return builder; },
      in: (key, values) => { inFilters.set(key, values); return builder; },
      update: (value) => { action = 'update'; patch = value; return builder; },
      upsert: (value) => {
        const existing = watermarks.get(value.domain);
        if (existing) Object.assign(existing, value);
        else watermarks.set(value.domain, { ...value });
        watermarkUpserts.push({ ...value });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: matchingRows()[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
  };

  (base.client as unknown as { from: (table: string) => unknown }).from = (table: string) => {
    if (table === 'external_sync_watermarks') return watermarkQuery();
    if (table === 'error_events') {
      return {
        insert: async (row: Record<string, unknown>) => {
          if (failErrorEventInsert) return { error: { code: 'XX000' } };
          errorEvents.push({ ...row });
          return { error: null };
        },
      };
    }
    return baseFrom(table);
  };
  (base.client as unknown as { rpc: (...args: unknown[]) => Promise<unknown> }).rpc = async () => ({ data: null, error: null });

  return {
    client: base.client as unknown as SupabaseClient,
    watermarks,
    watermarkUpserts,
    errorEvents,
    set failErrorEventInsert(value: boolean) { failErrorEventInsert = value; },
  };
}

function orgBinding() {
  return {
    orgId: ORG,
    siteUrl: 'https://erp.example.test',
    secretRef: SECRET_REF,
    company: 'Synthetic Company',
    config: {},
    ownedDomains: ['companies'],
    versionMajor: 15,
  };
}

function stubs() {
  const originalEnvGet = Deno.env.get;
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const values: Record<string, string> = {
    SYNTHETIC_SWEEP_BINDING_KEY: 'synthetic-key',
    SYNTHETIC_SWEEP_BINDING_SECRET: 'synthetic-secret',
  };
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => values[key];
  console.error = () => {};
  const requests: string[] = [];
  let failSupplier = true;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    const path = new URL(url).pathname;
    if (path === '/api/resource/Supplier' && failSupplier) {
      return new Response(JSON.stringify({ exception: ERROR_TEXT }), { status: 403 });
    }
    if (path === '/api/resource/Supplier' && !failSupplier) {
      return new Response(JSON.stringify({
        data: [{ name: 'SUP-RECOVERY', modified: '2026-10-08 09:00:00', docstatus: 0, supplier_name: 'Recovery Co', tax_id: 'TAX-1' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return {
    requests,
    set failSupplier(value: boolean) { failSupplier = value; },
    restore() {
      globalThis.fetch = originalFetch;
      (Deno.env as unknown as { get: unknown }).get = originalEnvGet;
      console.error = originalConsoleError;
    },
  };
}

Deno.test('AC-998-002 failed list stores a bounded safe error and preserves the cursor while siblings continue', async () => {
  const db = fakeDb([{
    org_id: ORG, external_tier: 'erpnext', domain: SUPPLIER_DOMAIN,
    watermark_cursor: '2026-10-01 09:00:00', last_error: null, last_error_at: null,
  }]);
  const stubsLive = stubs();
  try {
    const result = await sweepOrgDoctypesLive(db.client, orgBinding());
    const row = db.watermarks.get(SUPPLIER_DOMAIN);
    assert(row?.last_error, 'failed Supplier list must persist last_error on its watermark');
    assert(row.last_error.length <= 500, 'persisted error must be bounded to 500 characters');
    assert(!row.last_error.includes('upstream.example.test') && !row.last_error.includes('query-secret'), 'persisted error must not expose URL/query secrets');
    assert(row.last_error_at && Number.isFinite(Date.parse(row.last_error_at)), 'failed list must stamp last_error_at');
    assert(row.watermark_cursor === '2026-10-01 09:00:00', 'failure must not change the previous cursor');
    assert(stubsLive.requests.some((url) => new URL(url).pathname === '/api/resource/Contact'), 'Contact sibling must still be polled');
    assert(stubsLive.requests.some((url) => new URL(url).pathname === '/api/resource/Customer'), 'Customer sibling must still be polled');
    assert(result.error && !result.error.includes('upstream.example.test') && !result.error.includes('query-secret'), 'public sweep error must also be scrubbed');
  } finally {
    stubsLive.restore();
  }
});

Deno.test('AC-998-002 completed list clears prior error fields while advancing the cursor', async () => {
  const db = fakeDb([{
    org_id: ORG, external_tier: 'erpnext', domain: SUPPLIER_DOMAIN,
    watermark_cursor: '2026-10-01 09:00:00', last_error: 'prior safe failure', last_error_at: '2026-10-01T09:00:00.000Z',
  }]);
  const stubsLive = stubs();
  stubsLive.failSupplier = false;
  try {
    const result = await sweepOrgDoctypesLive(db.client, orgBinding(), undefined, { tickMaxDocs: 1 });
    assert(!result.error, `successful walk must not report an error: ${result.error}`);
    const advance = db.watermarkUpserts.find((row) => row.domain === SUPPLIER_DOMAIN && row.watermark_cursor === '2026-10-08 09:00:00');
    assert(advance, 'successful walk must advance the Supplier cursor');
    assert(advance.last_error === null && advance.last_error_at === null, 'cursor advancement must clear both prior error fields');
  } finally {
    stubsLive.restore();
  }
});

Deno.test('AC-998-003 records one stable event per hour and event-write failure does not stop sibling polling', async () => {
  const startMs = Date.parse('2026-10-10T12:00:00.000Z');
  const db = fakeDb();
  const stubsLive = stubs();
  try {
    const runAt = (time: number) => sweepOrgDoctypesLive(db.client, orgBinding(), undefined, { nowMs: () => time });
    await runAt(startMs);
    await runAt(startMs + 30 * 60_000);
    assert(Number(db.errorEvents.length) === 1, `repeat failure inside one hour must not create another event; got ${db.errorEvents.length}`);
    assert(JSON.stringify(db.errorEvents[0]) === JSON.stringify({
      fn: 'erpnext-sweep', error_code: 'sweep-doctype-failed', context_id: SUPPLIER_DOMAIN, org_id: ORG,
    }), `event must contain only stable routing values: ${JSON.stringify(db.errorEvents[0])}`);

    await runAt(startMs + 60 * 60_000);
    assert(Number(db.errorEvents.length) === 2, 'failure at exactly one hour must create a fresh event');

    db.failErrorEventInsert = true;
    const requestsBefore = stubsLive.requests.length;
    const result = await runAt(startMs + 120 * 60_000);
    assert(result.error, 'event sink failure must preserve the ordinary contained doctype error result');
    assert(stubsLive.requests.length > requestsBefore, 'event sink failure must not prevent sibling list requests');
    assert(stubsLive.requests.some((url) => new URL(url).pathname === '/api/resource/Contact'), 'Contact sibling must still be polled when event insert fails');
  } finally {
    stubsLive.restore();
  }
});
