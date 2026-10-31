// #1600 — the change feed must run the SAME PMO-company match as onboarding before it creates a company
// for an unmapped ERP Supplier/Customer. Drives the shipped createErpFeedDeps + applyErpFeedEvent against
// an in-memory store with REAL insert semantics (primary key + the two external_refs uniques refuse a
// duplicate, as Postgres does) — the old fakes accepted any insert and hid the duplicate-company bug.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test -A ../_shared/erpnextFeedDeps.partyMatch.test.ts

import { createErpFeedDeps } from './erpnextFeedDeps.ts';
import { applyErpFeedEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import { findCompanyCandidates } from './companyCandidates.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
const UNIQUES: Record<string, string[][]> = {
  companies: [['id']],
  external_refs: [['org_id', 'domain', 'external_record_id'], ['org_id', 'domain', 'pmo_record_id']],
};

function memoryClient(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { companies: [], external_refs: [], notifications: [], profiles: [{ id: 'admin-1', org_id: 'org-1', status: 'active', role: 'Admin' }], ...structuredClone(seed) };
  const dupe = (table: string, row: Row) =>
    (UNIQUES[table] ?? []).some((cols) => (tables[table] ?? []).some((other) => cols.every((c) => other[c] === row[c])));
  function filtered(table: string, filters: Array<(row: Row) => boolean>) {
    return (tables[table] ??= []).filter((row) => filters.every((f) => f(row)));
  }
  function builder(table: string, run: (rows: Row[]) => { data: unknown; error: unknown }) {
    const filters: Array<(row: Row) => boolean> = [];
    const b = {
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return b; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return b; },
      contains(col: string, val: Row) { filters.push((r) => Object.entries(val).every(([k, v]) => (r[col] as Row | undefined)?.[k] === v)); return b; },
      is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return b; },
      ilike(col: string, pattern: string) { // %word% only (what findCompanyCandidates sends), `\\` escapes
        const needle = pattern.slice(1, -1).replace(/\\(.)/g, '$1').toLowerCase();
        filters.push((r) => String(r[col] ?? '').toLowerCase().includes(needle)); return b;
      },
      limit() { return b; },
      maybeSingle() { const out = run(filtered(table, filters)); return Promise.resolve({ ...out, data: Array.isArray(out.data) ? out.data[0] ?? null : out.data }); },
      then(resolve: (v: unknown) => void) { resolve(run(filtered(table, filters))); },
    };
    return b;
  }
  const client = {
    from(table: string) {
      return {
        select: () => builder(table, (rows) => ({ data: rows.map((r) => ({ ...r })), error: null })),
        update: (patch: Row) => builder(table, (rows) => { rows.forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }),
        insert: (input: Row | Row[]) => {
          for (const row of Array.isArray(input) ? input : [input]) {
            if (dupe(table, row)) return Promise.resolve({ data: null, error: { message: `duplicate key value violates unique constraint on ${table}`, code: '23505' } });
            (tables[table] ??= []).push({ ...row });
          }
          return Promise.resolve({ data: null, error: null });
        },
        // the feed's other upsert callers never run on this path; refuse loudly if one does
        upsert: () => { throw new Error('unexpected upsert'); },
      };
    },
  } as unknown as SupabaseClient;
  return { client, tables };
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const ORG = 'org-1';
const company = (id: string, name: string, type = 'Vendor', erp_tax_id: string | null = null): Row => ({ id, org_id: ORG, name, type, erp_tax_id });
const ref = (pmo: string, ext: string): Row => ({ org_id: ORG, domain: 'companies', pmo_record_id: pmo, external_record_id: ext, external_tier: 'erpnext' });

async function sweepSupplier(client: SupabaseClient, name: string, extId = 'Supplier:ERP-TEST-001', taxId: string | null = null) {
  const deps = createErpFeedDeps(client, ORG, 'supplier');
  return await applyErpFeedEvent(
    { tier: 'erpnext', domain: 'companies' }, extId,
    { id: 'ignored', erp_supplier_name: name, type: 'Vendor', erp_tax_id: taxId, erp_docstatus: 0 },
    Date.parse('2026-10-31T00:00:00.000Z'), deps,
  );
}

Deno.test('#1600 sweep: an unmapped ERP supplier matching an existing PMO vendor is LINKED, not created again', async () => {
  const { client, tables } = memoryClient({ companies: [company('company-1', 'Test party')] });
  const outcome = await sweepSupplier(client, 'Test party');
  assertEq(outcome, { kind: 'upserted', pmoRecordId: 'company-1', adopted: false }, 'outcome');
  assertEq(tables.companies.length, 1, 'still one company');
  assertEq(tables.external_refs.map((r) => [r.pmo_record_id, r.external_record_id]), [['company-1', 'Supplier:ERP-TEST-001']], 'ref');
});

Deno.test('#1600 sweep: no PMO match still brings the supplier in as a new company', async () => {
  const { client, tables } = memoryClient({ companies: [company('company-1', 'Other party')] });
  const outcome = await sweepSupplier(client, 'Test party');
  assertEq(outcome.kind === 'upserted' && outcome.adopted, true, 'adopted');
  assertEq(tables.companies.length, 2, 'new company minted');
  assertEq(tables.external_refs.length, 1, 'one ref');
});

Deno.test('#1600 sweep: applying the same event twice leaves one company and one ref', async () => {
  const { client, tables } = memoryClient({ companies: [company('company-1', 'Test party')] });
  await sweepSupplier(client, 'Test party');
  await sweepSupplier(client, 'Test party');
  assertEq([tables.companies.length, tables.external_refs.length], [1, 1], 'counts');
});

Deno.test('#1600 sweep: two PMO vendors with the name make an unclear match; nothing is written', async () => {
  const { client, tables } = memoryClient({ companies: [company('company-1', 'Test party'), company('company-2', 'Test party')] });
  let failure: { code?: string; details?: string } | undefined;
  try { await sweepSupplier(client, 'Test party'); } catch (err) { failure = err as typeof failure; }
  assertEq(failure?.code, 'party-match-unclear', 'terminal code: the feed skips this party instead of halting the poll');
  assertEq([tables.companies.length, tables.external_refs.length], [2, 0], 'no writes');
  assertEq(tables.notifications.length, 1, 'an admin is told');
});

Deno.test('#1600 sweep: a conflicting tax ID is an unclear match; nothing is written', async () => {
  const { client, tables } = memoryClient({ companies: [company('company-1', 'Test party', 'Vendor', 'TAX-TEST-2')] });
  let failure: { code?: string; details?: string } | undefined;
  try { await sweepSupplier(client, 'Test party', 'Supplier:ERP-TEST-001', 'TAX-TEST-1'); } catch (err) { failure = err as typeof failure; }
  assertEq(failure?.code, 'party-match-unclear', 'terminal code');
  assertEq([tables.companies.length, tables.external_refs.length], [1, 0], 'no writes');
});

Deno.test('#1600 sweep: a PMO vendor already linked to another ERP supplier is not a candidate', async () => {
  const { client, tables } = memoryClient({
    companies: [company('company-1', 'Test party')],
    external_refs: [ref('company-1', 'Supplier:ERP-TEST-009')],
  });
  const outcome = await sweepSupplier(client, 'Test party');
  assertEq(outcome.kind === 'upserted' && outcome.adopted, true, 'adopted as new');
  assertEq(tables.companies.length, 2, 'new company');
  assertEq(tables.external_refs.find((r) => r.pmo_record_id === 'company-1')?.external_record_id, 'Supplier:ERP-TEST-009', 'existing link untouched');
});

Deno.test('#1600 sweep: a same-name client does not match a supplier', async () => {
  const { client, tables } = memoryClient({ companies: [company('company-1', 'Test party', 'Client')] });
  await sweepSupplier(client, 'Test party');
  assertEq(tables.companies.length, 2, 'vendor minted beside the client');
});

Deno.test('#1600 an unclear party match is a terminal skip for the feed, not a halt of the whole poll', async () => {
  const { erpFeedApplyErrorPolicy } = await import('../../../pmo-portal/src/lib/adapterSeam/erpnext/feedErrorPolicy.ts');
  assertEq(erpFeedApplyErrorPolicy({ code: 'party-match-unclear' }), 'skip', 'policy');
});

Deno.test('#1600 sweep: legal-form punctuation and case do not make a second company ("PT Acme" = "PT. ACME")', async () => {
  const { client, tables } = memoryClient({ companies: [company('company-1', 'PT Acme Indonesia')] });
  const outcome = await sweepSupplier(client, 'PT. ACME  INDONESIA');
  assertEq(outcome, { kind: 'upserted', pmoRecordId: 'company-1', adopted: false }, 'linked');
  assertEq(tables.companies.length, 1, 'still one company');
});

Deno.test('#1600 sweep: a different company that only shares a word is not matched', async () => {
  const { client, tables } = memoryClient({ companies: [company('company-1', 'PT Acme Indonesia')] });
  await sweepSupplier(client, 'PT Acme Logistics');
  assertEq(tables.companies.length, 2, 'new company minted');
});

Deno.test('#1600 sweep: an archived PMO vendor is not a candidate', async () => {
  const { client, tables } = memoryClient({ companies: [{ ...company('company-1', 'Test party'), archived_at: '2026-01-01T00:00:00Z' }] });
  const outcome = await sweepSupplier(client, 'Test party');
  assertEq(outcome.kind === 'upserted' && outcome.adopted, true, 'adopted as new');
  assertEq(tables.companies.length, 2, 'archived row left alone');
});

// The shared lookup itself, so the setup step (which uses it directly) is bound too, not only the feed.
Deno.test('#1600 findCompanyCandidates: same org + type + normalised name; never a linked or archived company', async () => {
  const { client } = memoryClient({
    companies: [
      company('c-live', 'PT. Acme'),
      company('c-linked', 'PT Acme'),
      { ...company('c-archived', 'pt acme'), archived_at: '2026-01-01T00:00:00Z' },
      company('c-client', 'PT Acme', 'Client'),
      { ...company('c-other-org', 'PT Acme'), org_id: 'org-2' },
    ],
    external_refs: [ref('c-linked', 'Supplier:ERP-TEST-009')],
  });
  const found = await findCompanyCandidates(client, ORG, 'Supplier', 'PT ACME');
  assertEq(found.map((c) => c.pmoRecordId), ['c-live'], 'only the live, unlinked, same-org vendor');
});
