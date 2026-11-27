import { describe, expect, it } from 'vitest';
import { can, type PolicyContext, type Role } from './policy';

const as = (realRole: Role, builtInRoleKey: string | null, record: Record<string, unknown> = {}): PolicyContext =>
  ({ realRole, builtInRoleKey, currentUserId: 'me', record });

describe('owner material rights (#3010)', () => {
  it('the Material Coordinator at ordinary access records a reconciliation step', () => {
    expect(can('recordReconciliation', 'ownerMaterial', as('Engineer', 'material_coordinator'))).toBe(true);
  });
  it('approval rank records it; another job role or an ordinary reader does not', () => {
    expect(can('recordReconciliation', 'ownerMaterial', as('Admin', null))).toBe(true);
    expect(can('recordReconciliation', 'ownerMaterial', as('Engineer', 'storekeeper'))).toBe(false);
    expect(can('recordReconciliation', 'ownerMaterial', as('Engineer', null))).toBe(false);
  });
  it('view-as is read-only even for the coordinator, and every member reads', () => {
    expect(can('recordReconciliation', 'ownerMaterial', as('Engineer', 'material_coordinator', { viewOnly: true }))).toBe(false);
    expect(can('view', 'ownerMaterial', as('Engineer', null))).toBe(true);
  });
});
