import { describe, expect, it } from 'vitest';
import { mayActOnStep, stepDaysOver, stepDueOn, stepStatus, summariseWaitingWorkOrderSteps } from './workOrderBillingSteps';

const base = { startedOn: '2026-11-01', doneOn: null, skippedOn: null, targetDays: 3 };

describe('AC-WBS-012 work-order step derivations', () => {
  it('status follows the dates', () => {
    expect(stepStatus({ startedOn: null, doneOn: null, skippedOn: null })).toBe('open');
    expect(stepStatus(base)).toBe('current');
    expect(stepStatus({ ...base, doneOn: '2026-11-02' })).toBe('done');
    expect(stepStatus({ ...base, skippedOn: '2026-11-02' })).toBe('skipped');
  });
  it('due is the start plus the target days, null without either', () => {
    expect(stepDueOn(base)).toBe('2026-11-04');
    expect(stepDueOn({ startedOn: '2026-11-29', targetDays: 3 })).toBe('2026-12-02');
    expect(stepDueOn({ startedOn: null, targetDays: 3 })).toBeNull();
    expect(stepDueOn({ startedOn: '2026-11-01', targetDays: null })).toBeNull();
  });
  it('days over only for a current step past its target, by the claim steps\' own rule', () => {
    expect(stepDaysOver(base, '2026-11-04')).toBeNull();
    expect(stepDaysOver(base, '2026-11-06')).toBe(2);
    expect(stepDaysOver({ ...base, doneOn: '2026-11-02' }, '2026-11-30')).toBeNull();
  });
});

describe('AC-WBS-005 which controls show', () => {
  const step = { assigneeId: 'p1', ownerRoleKey: 'quantity_surveyor' };
  it('the named person, the owner role and a runner act; others do not', () => {
    expect(mayActOnStep({ userId: 'p1', builtInRoleKey: 'engineer', role: 'Engineer' }, step)).toBe(true);
    expect(mayActOnStep({ userId: 'p2', builtInRoleKey: 'quantity_surveyor', role: 'Engineer' }, step)).toBe(true);
    expect(mayActOnStep({ userId: 'p2', builtInRoleKey: 'billing_officer', role: 'Finance' }, step)).toBe(true);
    expect(mayActOnStep({ userId: 'p2', builtInRoleKey: 'quality_manager', role: 'Project Manager' }, step)).toBe(false);
    expect(mayActOnStep({ userId: 'p2', builtInRoleKey: 'foreman', role: 'Engineer' }, step)).toBe(false);
  });
  it('a person with no role key keeps the claim-step writers', () => {
    expect(mayActOnStep({ userId: 'p2', builtInRoleKey: null, role: 'Finance' }, step)).toBe(true);
    expect(mayActOnStep({ userId: 'p2', builtInRoleKey: null, role: 'Engineer' }, step)).toBe(false);
  });
});

describe('AC-WBS-009 waiting pointer', () => {
  const row = (workOrderId: string, startedOn: string) => ({ stepId: workOrderId + startedOn, workOrderId, projectId: 'pr', projectName: 'P', workOrderLabel: 'W', stepName: 'S', startedOn, targetDays: 3 });
  it('is null with nothing waiting', () => expect(summariseWaitingWorkOrderSteps([], '2026-11-10')).toBeNull());
  it('counts, flags overdue, and links the one work order or the board', () => {
    expect(summariseWaitingWorkOrderSteps([row('w1', '2026-11-01')], '2026-11-10')).toEqual({ count: 1, overdue: 1, href: '/work-orders/w1' });
    expect(summariseWaitingWorkOrderSteps([row('w1', '2026-11-09'), row('w2', '2026-11-09')], '2026-11-10')).toEqual({ count: 2, overdue: 0, href: '/work-orders' });
  });
});
