// THEME-BACK-40 (#1643): what a budget outbox identity names, imported from its own module.
import { budgetAccountIdentity, budgetRangeIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { accountOfIdentity, bareBudgetVersionId, budgetDedupKey, fiscalYearOfIdentity, toFiscalYearOfIdentity } from './budgetOutboxFacts.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const VERSION = '11111111-1111-4111-8111-111111111111';

Deno.test('FR-BFY-038 an identity names its version, fiscal years and account; a pre-fan-out bare id names only itself', () => {
  const unit = budgetAccountIdentity(VERSION, 'FY 2026', 'Travel - C');
  assert(bareBudgetVersionId(unit) === VERSION && fiscalYearOfIdentity(unit) === 'FY 2026' && accountOfIdentity(unit) === 'Travel - C', unit);
  const range = budgetRangeIdentity(VERSION, 'FY 2026', 'FY 2027', 'Travel - C');
  assert(fiscalYearOfIdentity(range) === 'FY 2026' && toFiscalYearOfIdentity(range) === 'FY 2027', range);
  assert(bareBudgetVersionId(VERSION) === VERSION && fiscalYearOfIdentity(VERSION) === null, 'bare id');
});

Deno.test('BLOCKER 3 an orphan duplicates a mirror row only when version, years AND account all match', () => {
  const key = budgetDedupKey(VERSION, 'FY 2026', 'Travel - C', 'FY 2027');
  assert(key === budgetDedupKey(VERSION, 'FY 2026', 'Travel - C', 'FY 2027'), 'same unit, same key');
  assert(key !== budgetDedupKey(VERSION, 'FY 2026', 'Rent - C', 'FY 2027'), 'another account is another unit');
  assert(key !== budgetDedupKey(VERSION, 'FY 2027', 'Travel - C', 'FY 2027'), 'another year is another unit');
});
