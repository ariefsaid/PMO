import { describe, expect, it } from 'vitest';
import { can } from './policy';

describe('job role step rights', () => {
  const engineer = { realRole: 'Engineer' as const, builtInRoleKey: 'engineer' };
  const other = { realRole: 'Engineer' as const, builtInRoleKey: 'storekeeper' };

  it('AC-RR-001 lets engineers capture and edit Draft orders without issuing', () => {
    expect(can('create', 'workOrder', engineer)).toBe(true);
    expect(can('edit', 'workOrder', { ...engineer, record: { status: 'Draft' } })).toBe(true);
    expect(can('edit', 'workOrder', { ...engineer, record: { status: 'Issued' } })).toBe(false);
    expect(can('transition', 'workOrder', engineer)).toBe(false);
    expect(can('create', 'workOrder', other)).toBe(false);
  });

  it('AC-RR-002 lets engineers read the rate catalogue without writing it', () => {
    expect(can('view', 'rateCatalogue', engineer)).toBe(true);
    expect(can('create', 'rateCatalogue', engineer)).toBe(false);
    expect(can('view', 'rateCatalogue', other)).toBe(false);
  });

  it('AC-RR-004 lets engineers read and write work order plans', () => {
    expect(can('view', 'workOrderPlan', engineer)).toBe(true);
    expect(can('manage', 'workOrderPlan', engineer)).toBe(true);
    expect(can('manage', 'workOrderPlan', other)).toBe(false);
  });

  it('AC-RR-005 lets engineers read claims and billing stages without changing them', () => {
    expect(can('view', 'progressClaim', engineer)).toBe(true);
    expect(can('view', 'billingStage', engineer)).toBe(true);
    expect(can('create', 'progressClaim', engineer)).toBe(false);
    expect(can('transition', 'billingStage', engineer)).toBe(false);
    expect(can('view', 'progressClaim', other)).toBe(false);
  });

  it('AC-RR-008 lets a project administrator read equipment usage without approving it', () => {
    const admin = { realRole: 'Engineer' as const, builtInRoleKey: 'project_administrator', currentUserId: 'reader' };
    expect(can('view', 'equipmentUsage', { ...admin, record: { author_id: 'another' } })).toBe(true);
    expect(can('transition', 'equipmentUsage', { ...admin, record: { author_id: 'another' } })).toBe(false);
    expect(can('view', 'equipmentUsage', { ...other, currentUserId: 'reader', record: { author_id: 'another' } })).toBe(false);
  });

  it('AC-RR-006 lets a planner link work orders without granting structure management', () => {
    const planner = { realRole: 'Engineer' as const, builtInRoleKey: 'planner' };
    expect(can('linkWorkOrder', 'task', planner)).toBe(true);
    expect(can('linkWorkOrder', 'task', other)).toBe(false);
  });
});
