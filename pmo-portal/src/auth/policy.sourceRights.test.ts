import { describe, expect, it } from 'vitest';
import { can, type PolicyContext } from './policy';
const ctx = (key: string, viewOnly = false): PolicyContext => ({ realRole: 'Engineer', builtInRoleKey: key, record: { viewOnly } });
describe('source role rights', () => {
  it('AC-SR-001/003 target writers are PCM and Planner, without contract rights', () => {
    for (const key of ['project_control_manager', 'planner']) {
      expect(can('manage', 'workOrderRevenuePlan', ctx(key))).toBe(true);
      expect(can('manage', 'workOrderRevenuePlan', ctx(key, true))).toBe(false);
    }
    expect(can('manage', 'workOrderRevenuePlan', ctx('engineer'))).toBe(false);
  });
  it('AC-SR-002 Planner changes work-order placements without crew membership', () => {
    expect(can('manage', 'workOrderRoster', ctx('planner'))).toBe(true);
    expect(can('manage', 'crew', ctx('planner'))).toBe(false);
    expect(can('manage', 'workOrderRoster', ctx('quantity_surveyor'))).toBe(false);
  });
  it('AC-SR-004 officer reads operational figures without costs', () => {
    expect(can('view', 'equipmentMetrics', ctx('equipment_officer'))).toBe(true);
    expect(can('view', 'equipmentCosting', ctx('equipment_officer'))).toBe(false);
    expect(can('view', 'equipmentMetrics', ctx('engineer'))).toBe(false);
  });
});
