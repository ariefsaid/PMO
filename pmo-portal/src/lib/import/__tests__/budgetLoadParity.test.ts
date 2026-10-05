import { describe, it, expect, vi } from 'vitest';

vi.mock('@/src/lib/repositories', () => ({ repositories: {} }));

import { BUDGET_CATEGORIES, computeBudgetLineImportKey as appKey } from '../budgetDescriptor';
// The Node-side mirror used by `pmo load` (#796). Byte-identical output is the contract: a line loaded by
// the CLI and the same line imported in the app must carry the same import_key (0195's skip + index).
import {
  BUDGET_CATEGORIES as LOAD_CATEGORIES,
  computeBudgetLineImportKey as loadKey,
} from '../../../../../scripts/lib/pmo-load.mjs';

describe('pmo load budget rules === the app budget import', () => {
  const base = { project: 'ORG-001', category: 'Labor', description: 'Crew', fiscalYear: '2025', amount: '400000', reference: '' };
  const cases = [
    { name: 'a reference wins (trimmed)', cells: { ...base, reference: ' R-2 ' } },
    { name: 'fingerprint with every cell', cells: base },
    { name: 'fingerprint with blank optional cells', cells: { ...base, description: '', fiscalYear: '' } },
    { name: 'a whitespace-only reference falls back to the fingerprint', cells: { ...base, reference: '   ' } },
  ];
  for (const { name, cells } of cases) {
    it(`AC-CSD-011 the line key matches for: ${name}`, () => {
      expect(loadKey(cells)).toBe(appKey(cells));
    });
  }
  it('AC-CSD-011 the categories equal the generated budget_category enum', () => {
    expect([...LOAD_CATEGORIES]).toEqual([...BUDGET_CATEGORIES]);
  });
});
