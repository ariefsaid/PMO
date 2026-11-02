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

  const notified: string[] = [];
  const reviews: Array<{ pmoIds: string[]; externalId: string; reason: string }> = [];
  const deps = {
    findPmoRecordId: async (externalRecordId: string) => externalRefs.get(externalRecordId) ?? null,
    findCandidates: async (_doctype: ErpPartySource['doctype'], _name: string, _taxId?: string | null): Promise<PartyCandidate[]> => [],
    // REAL insert semantics (the old fake overwrote on a duplicate id, which hid #1600): the primary key
    // and both external_refs uniques refuse, like Postgres does.
    insertCompaniesMirror: async (canonical: PmoRecord) => {
      if (companies.has(canonical.id)) throw Object.assign(new Error('duplicate key (companies_pkey)'), { code: '23505' });
      companies.set(canonical.id, canonical);
      insertCount += 1;
    },
    updateCompaniesMirror: async (pmoRecordId: string, canonical: PmoRecord) => {
      if (!companies.has(pmoRecordId)) throw new Error('update of a missing company');
      companies.set(pmoRecordId, canonical);
      updateCount += 1;
    },
    recordExternalRef: async (mapping: { pmoRecordId: string; externalRecordId: string }) => {
      if (externalRefs.has(mapping.externalRecordId) || [...externalRefs.values()].includes(mapping.pmoRecordId)) {
        throw Object.assign(new Error('duplicate key (external_refs)'), { code: '23505' });
      }
      externalRefs.set(mapping.externalRecordId, mapping.pmoRecordId);
      recordRefCount += 1;
    },
    mirrorExists: async (pmoRecordId: string) => companies.has(pmoRecordId),
    notifyUnclearMatch: async (entry: { name: string }) => { notified.push(entry.name); },
    recordReview: async (entry: { pmoIds: string[]; externalId: string; reason: string }) => { reviews.push(entry); },
  };
  return { deps, companies, externalRefs, notified, reviews, counts: () => ({ insertCount, updateCount, recordRefCount }) };
}

Deno.test({
  name: 'AC-ENA-041 onboardParties: a fresh Supplier is adopted (insert + recordExternalRef) exactly once',
  fn: async () => {
    const { deps, companies, externalRefs, counts } = makeFakeState();
    const sources: ErpPartySource[] = [{ doctype: 'Supplier', id: 'Acme Co', name: 'Acme Co', taxId: 'TAX-1' }];
    const result = await onboardParties(sources, deps);
    assertEquals(result, { adopted: 1, reconciled: 0, needsDecision: [], skippedInternal: 0 });
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

    assertEquals(first, { adopted: 1, reconciled: 0, needsDecision: [], skippedInternal: 0 }, 'first run mints the mirror + ref');
    assertEquals(second, { adopted: 0, reconciled: 1, needsDecision: [], skippedInternal: 0 }, 'second run reconciles the SAME mapping, never re-mints');
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
    assertEquals(result, { adopted: 2, reconciled: 0, needsDecision: [], skippedInternal: 0 });
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
    assertEquals(result, { adopted: 2, reconciled: 0, needsDecision: [], skippedInternal: 0 });
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

    assertEquals(first, { adopted: 0, reconciled: 1, needsDecision: [], skippedInternal: 0 }, 'first run finds the swept mapping by ID');
    assertEquals(second, { adopted: 0, reconciled: 1, needsDecision: [], skippedInternal: 0 }, 'second run still reconciles, never re-mints');
    assertEquals(counts(), { insertCount: 0, updateCount: 2, recordRefCount: 0 });
    assertEquals(externalRefs.size, 1);
    assertEquals(companies.size, 1);
    assertEquals(companies.get('pmo-swept-1')?.name, 'PT Example');
  },
});

Deno.test('AC-ECA-006 a matched existing company is LINKED (update + ref), never re-inserted', async () => {
  const { deps, companies, externalRefs, counts } = makeFakeState();
  companies.set('pmo-existing', { id: 'pmo-existing', name: 'Test party', type: 'Vendor' });
  deps.findCandidates = async () => [{ pmoRecordId: 'pmo-existing', taxId: null }];
  const result = await onboardParties([{ doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party' }], deps);
  assertEquals([result.adopted, result.reconciled, result.needsDecision.length], [1, 0, 0]);
  assertEquals([...companies.keys()], ['pmo-existing'], 'no second company');
  assertEquals(externalRefs.get('Supplier:ERP-TEST-001'), 'pmo-existing');
  assertEquals(counts(), { insertCount: 0, updateCount: 1, recordRefCount: 1 });
});

Deno.test('same-name adoption narrows a tax match and links it, no second company', async () => {
  const { deps, companies, externalRefs, counts } = makeFakeState();
  companies.set('pmo-other', { id: 'pmo-other', name: 'Test party', type: 'Vendor' });
  companies.set('pmo-matching', { id: 'pmo-matching', name: 'Test party', type: 'Vendor' });
  deps.findCandidates = async () => [
    { pmoRecordId: 'pmo-other', taxId: 'TAX-TEST-2' },
    { pmoRecordId: 'pmo-matching', taxId: 'TAX-TEST-1' },
  ];
  const result = await onboardParties([
    { doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party', taxId: 'TAX-TEST-1' },
  ], deps);
  assertEquals([result.adopted, result.needsDecision.length], [1, 0]);
  assertEquals([...companies.keys()].sort(), ['pmo-matching', 'pmo-other']);
  assertEquals(externalRefs.get('Supplier:ERP-TEST-001'), 'pmo-matching');
  assertEquals(counts(), { insertCount: 0, updateCount: 1, recordRefCount: 1 });
});

Deno.test('#1600 a conflicting tax ID becomes a needs-a-decision row with no writes, and the rest still apply', async () => {
  const { deps, companies, externalRefs, counts, reviews } = makeFakeState();
  deps.findCandidates = async (_doctype, name) =>
    name === 'Test party' ? [{ pmoRecordId: 'pmo-other', taxId: 'TAX-TEST-2' }] : [];
  const result = await onboardParties([
    { doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party', taxId: 'TAX-TEST-1' },
    { doctype: 'Supplier', id: 'ERP-TEST-002', name: 'Other party' },
  ], deps);
  assertEquals([result.adopted, result.reconciled], [1, 0]);
  assertEquals(result.needsDecision.map((row) => [row.doctype, row.id, row.reason]), [['Supplier', 'ERP-TEST-001', 'conflicting-tax-id']]);
  assertEquals(counts(), { insertCount: 1, updateCount: 0, recordRefCount: 1 });
  assertEquals([...externalRefs.keys()], ['Supplier:ERP-TEST-002']);
  assertEquals(companies.size, 1);
  assertEquals(reviews.map((r) => [r.externalId, r.reason]), [['Supplier:ERP-TEST-001', 'tax-conflict']]);
});

Deno.test('AC-ECA-006 a party that links or brings in cleanly records no review row', async () => {
  const { deps, reviews } = makeFakeState();
  await onboardParties([{ doctype: 'Supplier', id: 'ERP-TEST-009', name: 'Fine party' }], deps);
  assertEquals(reviews, []);
});

Deno.test('AC-ECA-006 the tax id reaches the candidate lookup, so a tax-id match with a different name can be found', async () => {
  const { deps, companies, externalRefs } = makeFakeState();
  companies.set('pmo-tax', { id: 'pmo-tax', name: 'Legacy Name', type: 'Vendor' });
  let askedWith: string | null | undefined;
  deps.findCandidates = async (_doctype, _name, taxId) => { askedWith = taxId; return [{ pmoRecordId: 'pmo-tax', taxId: 'TAX-1' }]; };
  await onboardParties([{ doctype: 'Supplier', id: 'ERP-TEST-010', name: 'Another Name', taxId: 'TAX-1' }], deps);
  assertEquals(askedWith, 'TAX-1');
  assertEquals(externalRefs.get('Supplier:ERP-TEST-010'), 'pmo-tax');
});

Deno.test('AC-ECA-006 an ambiguous match becomes a needs-a-decision row and the rest apply', async () => {
  const { deps, externalRefs, reviews } = makeFakeState();
  deps.findCandidates = async (_doctype, name) =>
    name === 'Test party' ? [{ pmoRecordId: 'pmo-a', taxId: null }, { pmoRecordId: 'pmo-b', taxId: null }] : [];
  const result = await onboardParties([
    { doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party' },
    { doctype: 'Customer', id: 'ERP-TEST-003', name: 'Third party' },
  ], deps);
  assertEquals([result.adopted, result.needsDecision.map((row) => row.reason)], [1, ['ambiguous-match']]);
  assertEquals([...externalRefs.keys()], ['Customer:ERP-TEST-003']);
  // the persisted review row (AC-ECA-006): the ERP party by its document id, and the PMO companies it could be
  assertEquals(reviews, [{ pmoIds: ['pmo-a', 'pmo-b'], externalId: 'Supplier:ERP-TEST-001', reason: 'ambiguous' }]);
});

Deno.test('#1600 setup loses the race to the sweep: the claim is refused, NO second company is written, the run goes on', async () => {
  const { deps, companies, externalRefs, counts } = makeFakeState();
  // The sweep polls the same ERP party between setup's candidate lookup and its first write: it claims the
  // link and mints company A. Setup's claim then hits the real unique (23505) BEFORE any company insert.
  let raced = false;
  deps.findCandidates = async (_doctype, name) => {
    if (name === 'Test party' && !raced) {
      raced = true;
      externalRefs.set('Supplier:ERP-TEST-001', 'pmo-swept');
      companies.set('pmo-swept', { id: 'pmo-swept', name: 'Test party', type: 'Vendor' });
    }
    return [];
  };
  const result = await onboardParties([
    { doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party' },
    { doctype: 'Supplier', id: 'ERP-TEST-002', name: 'Other party' },
  ], deps);
  assertEquals([result.adopted, result.reconciled, result.needsDecision.length], [1, 1, 0], 'raced party reconciled, next one applied');
  assertEquals([...companies.keys()].filter((id) => id !== 'pmo-swept').length, 1, 'only the next party minted; no unlinked twin of the raced one');
  assertEquals(externalRefs.get('Supplier:ERP-TEST-001'), 'pmo-swept', 'the sweep link stands');
  assertEquals(counts().insertCount, 1, 'exactly one insert (the other party)');
});

Deno.test('#1600 a matched company the sweep linked first is never re-pointed: reconciled, not rewritten', async () => {
  const { deps, companies, externalRefs, counts } = makeFakeState();
  companies.set('pmo-existing', { id: 'pmo-existing', name: 'Test party', type: 'Vendor' });
  deps.findCandidates = async () => {
    externalRefs.set('Supplier:ERP-TEST-001', 'pmo-existing'); // the sweep linked it after setup matched it
    return [{ pmoRecordId: 'pmo-existing', taxId: null }];
  };
  const result = await onboardParties([{ doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party' }], deps);
  assertEquals([result.adopted, result.reconciled], [0, 1], 'reconciled');
  assertEquals(counts(), { insertCount: 0, updateCount: 0, recordRefCount: 0 }, 'nothing written');
});

Deno.test('#1600 a matched company already linked to ANOTHER ERP party is a decision, never a re-point', async () => {
  const { deps, companies, externalRefs, notified, counts } = makeFakeState();
  companies.set('pmo-existing', { id: 'pmo-existing', name: 'Test party', type: 'Vendor' });
  externalRefs.set('Supplier:ERP-TEST-009', 'pmo-existing');
  deps.findCandidates = async () => [{ pmoRecordId: 'pmo-existing', taxId: null }];
  const result = await onboardParties([{ doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party' }], deps);
  assertEquals(result.needsDecision.map((row) => [row.id, row.reason]), [['ERP-TEST-001', 'already-linked']], 'decision row');
  assertEquals(notified, ['Test party'], 'admins told');
  assertEquals(externalRefs.get('Supplier:ERP-TEST-009'), 'pmo-existing', 'old link untouched');
  assertEquals(externalRefs.has('Supplier:ERP-TEST-001'), false, 'no new link');
  assertEquals(counts().updateCount, 0, 'company not rewritten');
});

Deno.test('#1600 an unclear match tells the org admins and writes nothing', async () => {
  const { deps, externalRefs, notified, counts } = makeFakeState();
  deps.findCandidates = async (_doctype, name) =>
    name === 'Test party' ? [{ pmoRecordId: 'pmo-a', taxId: null }, { pmoRecordId: 'pmo-b', taxId: null }] : [];
  await onboardParties([{ doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party' }], deps);
  assertEquals(notified, ['Test party'], 'notified');
  assertEquals([externalRefs.size, counts().insertCount], [0, 0], 'no writes');
});

Deno.test('#1600 a claimed link whose company never landed is repaired with the same id on the next run', async () => {
  const { deps, companies, externalRefs, counts } = makeFakeState();
  externalRefs.set('Supplier:ERP-TEST-001', 'pmo-claimed'); // run died after the claim, before the insert
  const result = await onboardParties([{ doctype: 'Supplier', id: 'ERP-TEST-001', name: 'Test party' }], deps);
  assertEquals([result.adopted, result.reconciled], [1, 0], 'repaired');
  assertEquals(companies.get('pmo-claimed')?.name, 'Test party', 'same id');
  assertEquals(counts().insertCount, 1, 'one insert');
});

Deno.test('an Internal-type ERP party is skipped and counted; it never aborts the run', async () => {
  const { deps, externalRefs } = makeFakeState();
  const result = await onboardParties([
    { doctype: 'Customer', id: 'ERP-TEST-INT', name: 'Own company', isInternal: true },
    { doctype: 'Supplier', id: 'ERP-TEST-002', name: 'Other party' },
  ], deps);
  assertEquals([result.adopted, result.skippedInternal], [1, 1], 'counts');
  assertEquals([...externalRefs.keys()], ['Supplier:ERP-TEST-002'], 'only the external party linked');
});
