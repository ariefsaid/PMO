import { describe, expect, it } from 'vitest';
import { currentStageIndex, nextInvoiceDeadline, stageAgeDays, stageOverdue } from './billingStages';

describe('stageAgeDays (FR-BST-030)', () => {
  it('AC-BST-010 an open stage started on 1 March is 10 days old on 11 March', () => {
    expect(stageAgeDays({ startedOn: '2026-03-01', completedOn: null }, '2026-03-11')).toBe(10);
  });
  it('AC-BST-010 a stage completed on 5 March is 4 days old, whatever today is', () => {
    expect(stageAgeDays({ startedOn: '2026-03-01', completedOn: '2026-03-05' }, '2026-04-30')).toBe(4);
  });
  it('AC-BST-010 a stage not yet started has no age', () => {
    expect(stageAgeDays({ startedOn: null, completedOn: null }, '2026-03-11')).toBeNull();
  });
  it('AC-BST-010 counts across a month and year end in calendar days', () => {
    expect(stageAgeDays({ startedOn: '2026-12-30', completedOn: null }, '2027-01-02')).toBe(3);
  });
});

describe('currentStageIndex (FR-BST-012)', () => {
  it('is the first stage not completed', () => {
    expect(currentStageIndex([{ completedOn: '2026-03-01' }, { completedOn: null }, { completedOn: null }])).toBe(1);
  });
  it('is null when every stage is complete', () => {
    expect(currentStageIndex([{ completedOn: '2026-03-01' }])).toBeNull();
  });
});

describe('nextInvoiceDeadline (FR-BST-032)', () => {
  it('AC-BST-011 on the 20th with day 25 and a 5-day window: the 25th, 5 days left, warning', () => {
    expect(nextInvoiceDeadline('2026-03-20', 25, 5)).toEqual({ date: '2026-03-25', daysLeft: 5, warn: true });
  });
  it('AC-BST-011 on the 19th: 6 days left, no warning', () => {
    expect(nextInvoiceDeadline('2026-03-19', 25, 5)).toEqual({ date: '2026-03-25', daysLeft: 6, warn: false });
  });
  it('AC-BST-011 on the deadline day itself: 0 days left, warning', () => {
    expect(nextInvoiceDeadline('2026-03-25', 25, 5)).toEqual({ date: '2026-03-25', daysLeft: 0, warn: true });
  });
  it('AC-BST-011 on the 26th the next deadline is next month\'s 25th', () => {
    expect(nextInvoiceDeadline('2026-03-26', 25, 5)).toEqual({ date: '2026-04-25', daysLeft: 30, warn: false });
  });
  it('AC-BST-011 day 31 in February is the 28th', () => {
    expect(nextInvoiceDeadline('2026-02-10', 31, 5)?.date).toBe('2026-02-28');
  });
  it('AC-BST-011 day 31 in a leap February is the 29th', () => {
    expect(nextInvoiceDeadline('2028-02-10', 31, 5)?.date).toBe('2028-02-29');
  });
  it('AC-BST-011 after 31 December the deadline rolls into January', () => {
    expect(nextInvoiceDeadline('2026-12-28', 25, 5)?.date).toBe('2027-01-25');
  });
  it('AC-BST-011 a project with no deadline day has no deadline', () => {
    expect(nextInvoiceDeadline('2026-03-20', null, 5)).toBeNull();
  });
});

describe('stageOverdue (FR-BSX-010)', () => {
  const open = { startedOn: '2026-03-01', completedOn: null, skippedOn: null, targetDays: 10 };
  it('AC-BSX-003 started 1 March with target 10: not overdue on 11 March', () => {
    expect(stageOverdue(open, '2026-03-11')).toBeNull();
  });
  it('AC-BSX-003 overdue on 12 March, with age 11 and target 10', () => {
    expect(stageOverdue(open, '2026-03-12')).toEqual({ age: 11, target: 10 });
  });
  it('AC-BSX-003 a stage with no target is never overdue', () => {
    expect(stageOverdue({ ...open, targetDays: null }, '2027-03-12')).toBeNull();
  });
  it('AC-BSX-003 a completed or skipped stage is not overdue', () => {
    expect(stageOverdue({ ...open, completedOn: '2026-03-20' }, '2026-04-30')).toBeNull();
    expect(stageOverdue({ ...open, skippedOn: '2026-03-20' }, '2026-04-30')).toBeNull();
  });
  it('AC-BSX-003 a stage not yet started is not overdue', () => {
    expect(stageOverdue({ ...open, startedOn: null }, '2026-04-30')).toBeNull();
  });
  it('FR-BSX-023 a skipped stage counts as done when finding the current stage', () => {
    expect(currentStageIndex([{ completedOn: '2026-03-02' }, { completedOn: null, skippedOn: '2026-03-03' }, { completedOn: null }])).toBe(2);
    expect(currentStageIndex([{ completedOn: null, skippedOn: '2026-03-03' }])).toBeNull();
  });
});
