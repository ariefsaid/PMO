// task 3.9 (AC-ENA-041) — enumerating ERP Supplier/Customer -> adoptParty (via onboardParties) is
// idempotent: two runs against the SAME underlying state produce exactly ONE companies mirror row +
// ONE external_refs mapping per distinct ERP party. Deno-native test (no vitest import), proving the
// orchestration at the exact edge-fn-adjacent path the plan names; the logic under test is the pure,
// Deno-importable `erpnext/onboarding.ts` (mirrors clickup-onboard's pure/thin-wiring split).
// Verify: cd supabase/functions/adapter-dispatch && deno test --config deno.json ../erpnext-onboard/index.test.ts

import { onboardParties } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/onboarding.ts';
import type { ErpPartySource, PartyCandidate } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

/** An in-memory fake of the (companies, external_refs) state onboardParties mutates — simulates the
 *  real DB across two SEPARATE onboardParties() calls (a retried onboarding run). */
function makeFakeState() {
  const externalRefs = new Map<string, string>(); // externalRecordId -> pmoRecordId
  const companies = new Map<string, PmoRecord>(); // pmoRecordId -> canonical
  let insertCount = 0;
  let updateCount = 0;
  let recordRefCount = 0;

  const deps = {
    findPmoRecordId: async (externalRecordId: string) => externalRefs.get(externalRecordId) ?? null,
    findCandidates: async (_doctype: ErpPartySource['doctype'], _name: string): Promise<PartyCandidate[]> => [],
    insertCompaniesMirror: async (canonical: PmoRecord) => {
      companies.set(canonical.id, canonical);
      insertCount += 1;
    },
    updateCompaniesMirror: async (pmoRecordId: string, canonical: PmoRecord) => {
      companies.set(pmoRecordId, canonical);
      updateCount += 1;
    },
    recordExternalRef: async (mapping: { pmoRecordId: string; externalRecordId: string }) => {
      externalRefs.set(mapping.externalRecordId, mapping.pmoRecordId);
      recordRefCount += 1;
    },
  };
  return { deps, companies, externalRefs, counts: () => ({ insertCount, updateCount, recordRefCount }) };
}

Deno.test({
  name: 'AC-ENA-041 onboardParties: a fresh Supplier is adopted (insert + recordExternalRef) exactly once',
  fn: async () => {
    const { deps, companies, externalRefs, counts } = makeFakeState();
    const sources: ErpPartySource[] = [{ doctype: 'Supplier', id: 'Acme Co', name: 'Acme Co', taxId: 'TAX-1' }];
    const result = await onboardParties(sources, deps);
    assertEquals(result, { adopted: 1, reconciled: 0 });
    assertEquals(counts(), { insertCount: 1, updateCount: 0, recordRefCount: 1 });
    assertEquals(externalRefs.size, 1);
    assertEquals(companies.size, 1);
  },
});

Deno.test({
  name: 'AC-ENA-041 onboardParties run TWICE against the SAME state -> exactly one mirror + one external_refs (idempotent)',
  fn: async () => {
    const { deps, companies, externalRefs, counts } = makeFakeState();
    const sources: ErpPartySource[] = [{ doctype: 'Supplier', id: 'Acme Co', name: 'Acme Co', taxId: 'TAX-1' }];

    const first = await onboardParties(sources, deps);
    const second = await onboardParties(sources, deps);

    assertEquals(first, { adopted: 1, reconciled: 0 }, 'first run mints the mirror + ref');
    assertEquals(second, { adopted: 0, reconciled: 1 }, 'second run reconciles the SAME mapping, never re-mints');
    const c = counts();
    assertEquals(c.insertCount, 1, 'exactly one companies INSERT across both runs');
    assertEquals(c.recordRefCount, 1, 'exactly one external_refs record across both runs');
    assertEquals(c.updateCount, 1, 'the second run took the update branch');
    assertEquals(externalRefs.size, 1, 'exactly one external_refs mapping');
    assertEquals(companies.size, 1, 'exactly one companies mirror row');
  },
});

Deno.test({
  name: 'AC-ENA-042 onboarding a party that exists as BOTH Supplier and Customer under the same name mints two distinct rows',
  fn: async () => {
    const { deps, companies, externalRefs } = makeFakeState();
    const sources: ErpPartySource[] = [
      { doctype: 'Supplier', id: 'Acme Co', name: 'Acme Co' },
      { doctype: 'Customer', id: 'Acme Co', name: 'Acme Co' },
    ];
    const result = await onboardParties(sources, deps);
    assertEquals(result, { adopted: 2, reconciled: 0 });
    assertEquals(externalRefs.size, 2);
    assertEquals(companies.size, 2);
    const types = [...companies.values()].map((c) => c.type).sort();
    assertEquals(types, ['Client', 'Vendor']);
  },
});

Deno.test({
  name: 'AC-ONB-001 onboardParties with numbered party IDs: external ref keyed by the ERPNext ID, PMO company named by the display name',
  fn: async () => {
    const { deps, companies, externalRefs } = makeFakeState();
    const sources: ErpPartySource[] = [
      { doctype: 'Customer', id: 'C-000001', name: 'PT Example' },
      { doctype: 'Supplier', id: 'S-000001', name: 'PT Vendor' },
    ];
    const result = await onboardParties(sources, deps);
    assertEquals(result, { adopted: 2, reconciled: 0 });
    assertEquals([...externalRefs.keys()].sort(), ['Customer:C-000001', 'Supplier:S-000001']);
    const customer = companies.get(externalRefs.get('Customer:C-000001')!);
    const supplier = companies.get(externalRefs.get('Supplier:S-000001')!);
    assertEquals([customer?.name, customer?.erp_customer_name], ['PT Example', 'PT Example']);
    assertEquals([supplier?.name, supplier?.erp_supplier_name], ['PT Vendor', 'PT Vendor']);
  },
});

Deno.test({
  name: 'AC-ONB-003 onboarding re-run over a party the sweep already adopted (ref keyed by ID) adopts nothing twice',
  fn: async () => {
    const { deps, companies, externalRefs, counts } = makeFakeState();
    // The sweep adopted C-000001 first: it keys the ref by the ERPNext document name (feedKinds.externalIdForKind).
    externalRefs.set('Customer:C-000001', 'pmo-swept-1');
    companies.set('pmo-swept-1', { id: 'pmo-swept-1', name: 'PT Example', type: 'Client' });
    // A display-name match would also exist — it must NOT be consulted (that would mint a second row).
    deps.findCandidates = async () => [{ pmoRecordId: 'pmo-swept-1', taxId: null }];
    const sources: ErpPartySource[] = [{ doctype: 'Customer', id: 'C-000001', name: 'PT Example' }];

    const first = await onboardParties(sources, deps);
    const second = await onboardParties(sources, deps);

    assertEquals(first, { adopted: 0, reconciled: 1 }, 'first run finds the swept mapping by ID');
    assertEquals(second, { adopted: 0, reconciled: 1 }, 'second run still reconciles, never re-mints');
    assertEquals(counts(), { insertCount: 0, updateCount: 2, recordRefCount: 0 });
    assertEquals(externalRefs.size, 1);
    assertEquals(companies.size, 1);
    assertEquals(companies.get('pmo-swept-1')?.name, 'PT Example');
  },
});

Deno.test('same-name adoption narrows a tax match before recording the party mapping', async () => {
  const { deps, companies, externalRefs, counts } = makeFakeState();
  deps.findCandidates = async () => [
    { pmoRecordId: 'pmo-other', taxId: 'TAX-TEST-2' },
    { pmoRecordId: 'pmo-matching', taxId: 'TAX-TEST-1' },
  ];
  const result = await onboardParties([
    { doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party', taxId: 'TAX-TEST-1' },
  ], deps);
  assertEquals(result, { adopted: 1, reconciled: 0 });
  assertEquals([...companies.keys()], ['pmo-matching']);
  assertEquals(externalRefs.get('Supplier:ERP-TEST-001'), 'pmo-matching');
  assertEquals(counts(), { insertCount: 1, updateCount: 0, recordRefCount: 1 });
});

Deno.test('conflicting same-name tax ID requires action before any mirror or mapping write', async () => {
  const { deps, companies, externalRefs, counts } = makeFakeState();
  deps.findCandidates = async () => [{ pmoRecordId: 'pmo-other', taxId: 'TAX-TEST-2' }];
  let failure: unknown;
  try {
    await onboardParties([
      { doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party', taxId: 'TAX-TEST-1' },
    ], deps);
  } catch (error) {
    failure = error;
  }
  assertEquals((failure as { code?: string } | undefined)?.code, 'action-required');
  assertEquals(counts(), { insertCount: 0, updateCount: 0, recordRefCount: 0 });
  assertEquals(companies.size, 0);
  assertEquals(externalRefs.size, 0);
});
