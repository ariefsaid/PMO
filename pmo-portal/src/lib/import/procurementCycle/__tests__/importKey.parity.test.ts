import { describe, it, expect } from 'vitest';
import { computeRecordImportKey as tsRecordKey } from '../importKey';
import type { CycleRow } from '../types';
// The Node-side mirror consumed by scripts/import-historical.mjs. Byte-identical OUTPUT is the
// contract (FR-IDEM-002 / A5): the in-app commit path (.ts) and the operator loader (.mjs) must
// write the SAME import_key for the same row, or a case imported by one path is invisible to the
// other's skip lookup.
import { computeRecordImportKey as mjsRecordKey } from '../../../../../../scripts/lib/historicalImportKey.mjs';

const baseRow: CycleRow = {
  caseRef: 'CASE-1', type: 'PO', project: undefined, title: undefined, caseStatus: undefined,
  vendor: undefined, externalRef: undefined, status: undefined, date: undefined, amount: undefined,
  rowNumber: 1,
};

describe('importKey parity — .ts computeRecordImportKey === scripts/lib .mjs mirror (A5)', () => {
  const cases: Array<{ name: string; row: CycleRow }> = [
    { name: 'externalRef present (reference_number wins)', row: { ...baseRow, externalRef: 'PO-4471' } },
    { name: 'externalRef whitespace-only → fingerprint fallback', row: { ...baseRow, externalRef: '   ', date: '2025-06-01', amount: '1500', vendor: 'Acme' } },
    { name: 'fingerprint: all fields present', row: { ...baseRow, date: '2025-06-01', amount: '1500', vendor: 'Acme' } },
    { name: 'fingerprint: date/amount/vendor all absent (?? "" coalesce)', row: { ...baseRow, type: 'VI' } },
    { name: 'fingerprint: only amount present', row: { ...baseRow, amount: '900' } },
    { name: 'fingerprint: only vendor present', row: { ...baseRow, vendor: 'SunGear' } },
  ];

  for (const { name, row } of cases) {
    it(`matches for: ${name}`, () => {
      const ts = tsRecordKey(row);
      const mjs = mjsRecordKey(row);
      expect(mjs).toBe(ts);
    });
  }
});
