(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepFieldsForKind, sweepOrgDoctypesLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('AC-BV16-007 v16 Budget list never requests fiscal_year', () => {
  const v16 = sweepFieldsForKind('budget', 16);
  assert(v16.includes('from_fiscal_year'), `v16 fields need from_fiscal_year: ${v16.join(',')}`);
  assert(v16.includes('to_fiscal_year'), `v16 fields need to_fiscal_year: ${v16.join(',')}`);
  assert(v16.includes('account'), `v16 fields need account: ${v16.join(',')}`);
  assert(!v16.includes('fiscal_year'), `v16 fields must not request removed fiscal_year: ${v16.join(',')}`);

  const v15 = sweepFieldsForKind('budget', 15);
  const legacy = sweepFieldsForKind('budget');
  assert(v15.includes('fiscal_year') && !v15.includes('from_fiscal_year'), 'v15 must retain its original list fields');
  assert(JSON.stringify(legacy) === JSON.stringify(v15), 'omitted major must retain the v15 list fields');
});

Deno.test('the live v16 Budget poll sends only the version-specific fiscal fields', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGet = Deno.env.get;
  const urls: string[] = [];
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => ({
    EXTERNAL_CONNECT_ENABLED: 'true', BV16_FIELDS_KEY: 'synthetic-key', BV16_FIELDS_SECRET: 'synthetic-secret',
  } as Record<string, string>)[key];
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  }) as typeof fetch;

  const empty = { data: [] as unknown[], error: null };
  const client = {
    from() {
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select: () => q, eq: () => q, in: () => q, is: () => q, not: () => q,
        insert: () => q, update: () => q, upsert: () => q, order: () => q, limit: () => q,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve(empty),
      };
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as SupabaseClient;
  try {
    await sweepOrgDoctypesLive(client, {
      orgId: '00000000-0000-4000-8000-000000000016', siteUrl: 'https://erp.example.test',
      secretRef: 'bv16-fields', company: 'Test Co', config: {}, ownedDomains: ['budget'], versionMajor: 16,
    });
    const request = urls.find((url) => url.includes('/api/resource/Budget?'));
    if (!request) throw new Error('the live sweep must issue its Budget list request');
    const fields = JSON.parse(new URL(request).searchParams.get('fields') ?? '[]') as string[];
    assert(fields.includes('from_fiscal_year') && fields.includes('to_fiscal_year') && fields.includes('account'),
      `the outbound v16 request needs version-16 fields: ${fields.join(',')}`);
    assert(!fields.includes('fiscal_year'), `the outbound v16 request must omit fiscal_year: ${fields.join(',')}`);
  } finally {
    globalThis.fetch = originalFetch;
    (Deno.env as unknown as { get: unknown }).get = originalEnvGet;
  }
});
