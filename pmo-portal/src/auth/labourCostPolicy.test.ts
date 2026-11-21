import { expect, it } from 'vitest';
import { can } from './policy';

// #2670: mirrors 1250 — Admin and Finance write; Executive also reads; a Project Manager reads no rate. UX only (RLS decides).
it('AC-LCM-013 labour cost: Admin and Finance manage, Executive views, a Project Manager does neither', () => {
  for (const realRole of ['Admin', 'Finance'] as const) expect(can('manage', 'labourCost', { realRole })).toBe(true);
  for (const realRole of ['Executive', 'Project Manager', 'Engineer'] as const) expect(can('manage', 'labourCost', { realRole })).toBe(false);
  expect(can('view', 'labourCost', { realRole: 'Executive' })).toBe(true);
  for (const realRole of ['Project Manager', 'Engineer'] as const) expect(can('view', 'labourCost', { realRole })).toBe(false);
});
