import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #1632 (ADR-0017): these hooks reach data only through the typed repository seam, never a `lib/db` module.
// The one allowed exception is the pure `ON_HAND_STATUSES` domain constant (no data access).
const HOOKS = [
  'useDashboard', 'useDemoEligibility', 'useOrgCurrency', 'useResolvedLocale', 'useAssistantPanel',
  'useProcurementDetail', 'useProcurementCrud', 'useProcurementRecords', 'useProcurements',
  'useMeetings', 'useDocuments', 'useExpenseClaims', 'useWorkOrders', 'useProjectsMoneyCollection',
];

function dbImports(source: string): string[] {
  const found: string[] = [];
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+'([^']*)'/g;
  for (const m of source.matchAll(re)) {
    if (/(^|\/)lib\/db\//.test(m[2])) found.push(`${m[1].trim()} from ${m[2]}`);
  }
  return found;
}

describe('hooks consume repositories, not data modules (#1632)', () => {
  it.each(HOOKS)('%s has no lib/db import', (name) => {
    const source = readFileSync(resolve(__dirname, '..', `${name}.ts`), 'utf8');
    const offenders = dbImports(source).filter((i) => !/^\{\s*ON_HAND_STATUSES\s*\}\s+from\s+@\/src\/lib\/db\/projectTransitions$/.test(i));
    expect(offenders).toEqual([]);
  });
});
