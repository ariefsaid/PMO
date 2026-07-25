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
    const sources: ErpPartySource[] = [{ doctype: 'Supplier', name: 'Acme Co', taxId: 'TAX-1' }];
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
    const sources: ErpPartySource[] = [{ doctype: 'Supplier', name: 'Acme Co', taxId: 'TAX-1' }];

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
      { doctype: 'Supplier', name: 'Acme Co' },
      { doctype: 'Customer', name: 'Acme Co' },
    ];
    const result = await onboardParties(sources, deps);
    assertEquals(result, { adopted: 2, reconciled: 0 });
    assertEquals(externalRefs.size, 2);
    assertEquals(companies.size, 2);
    const types = [...companies.values()].map((c) => c.type).sort();
    assertEquals(types, ['Client', 'Vendor']);
  },
});
