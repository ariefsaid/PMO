import { describe, expect, it } from 'vitest';
import {
  clearanceDueByItem,
  clearanceOverdueByPerson,
  closeoutOverdueByWorkOrder,
  isChecklistItemOverdue,
  orgToday,
  parseTargetDays,
} from './checklistDue';

/**
 * AC-CTD-009 — the pure derivations behind the checklist target dates (#2800): the organisation day that decides
 * "passed", the overdue question itself, and the two counts the screens show. No clock, no database, no component.
 */
describe('AC-CTD-009 an item is overdue only after its due day has passed', () => {
  it('the due day itself is not overdue; the day after is', () => {
    expect(isChecklistItemOverdue({ dueOn: '2026-11-21', done: false }, '2026-11-22')).toBe(true);
    expect(isChecklistItemOverdue({ dueOn: '2026-11-22', done: false }, '2026-11-22')).toBe(false);
    expect(isChecklistItemOverdue({ dueOn: '2026-11-23', done: false }, '2026-11-22')).toBe(false);
  });

  it('a done item and an item with no target are never overdue', () => {
    expect(isChecklistItemOverdue({ dueOn: '2026-11-01', done: true }, '2026-11-22')).toBe(false);
    expect(isChecklistItemOverdue({ dueOn: null, done: false }, '2026-11-22')).toBe(false);
  });
});

describe('AC-CTD-009 the day is the organisation calendar day', () => {
  it('one instant is a different day in Jakarta and in UTC, and that decides the marker', () => {
    // 17:30 UTC is already 00:30 on the 23rd in Jakarta (UTC+7).
    const instant = new Date('2026-11-22T17:30:00.000Z');
    expect(orgToday(instant, 'Asia/Jakarta')).toBe('2026-11-23');
    expect(orgToday(instant, 'UTC')).toBe('2026-11-22');

    const item = { dueOn: '2026-11-22', done: false };
    expect(isChecklistItemOverdue(item, orgToday(instant, 'Asia/Jakarta'))).toBe(true);
    expect(isChecklistItemOverdue(item, orgToday(instant, 'UTC'))).toBe(false);
  });

  it('a timezone before UTC keeps the earlier day', () => {
    const instant = new Date('2026-11-23T02:00:00.000Z'); // 21:00 on the 22nd in New York
    expect(orgToday(instant, 'America/New_York')).toBe('2026-11-22');
    expect(orgToday(instant, 'UTC')).toBe('2026-11-23');
  });

  it('falls back to UTC rather than throwing when no zone is supplied', () => {
    expect(orgToday(new Date('2026-11-22T17:30:00.000Z'), '')).toBe('2026-11-22');
  });
});

describe('AC-CTD-009 the overdue count per work order', () => {
  const rows = [
    { workOrderId: 'w1', dueOn: '2026-11-20', doneOn: null },
    { workOrderId: 'w1', dueOn: '2026-11-01', doneOn: null },
    { workOrderId: 'w1', dueOn: '2026-11-21', doneOn: '2026-11-21' }, // done: not counted
    { workOrderId: 'w1', dueOn: '2026-11-22', doneOn: null }, // due today: not counted
    { workOrderId: 'w2', dueOn: null, doneOn: null }, // no target: not counted
    { workOrderId: 'w2', dueOn: '2026-11-19', doneOn: null },
  ];

  it('counts only open items past their day, grouped by work order', () => {
    const counts = closeoutOverdueByWorkOrder(rows, '2026-11-22');
    expect(counts.get('w1')).toBe(2);
    expect(counts.get('w2')).toBe(1);
    expect(counts.get('w3')).toBeUndefined();
  });

  it('an organisation with no targeted items gets no counts at all', () => {
    expect(closeoutOverdueByWorkOrder([], '2026-11-22').size).toBe(0);
    expect(closeoutOverdueByWorkOrder([{ workOrderId: 'w1', dueOn: null, doneOn: null }], '2026-11-22').size).toBe(0);
  });
});

describe('AC-CTD-009 the overdue count per person', () => {
  const rows = [
    { personId: 'p1', itemId: 'i1', dueOn: '2026-11-01', overdue: true },
    { personId: 'p1', itemId: 'i2', dueOn: '2026-11-30', overdue: false },
    { personId: 'p2', itemId: 'i1', dueOn: '2026-01-01', overdue: true },
  ];

  it('counts the database’s own overdue answer, never recomputing it from a date', () => {
    const counts = clearanceOverdueByPerson(rows);
    expect(counts.get('p1')).toBe(1);
    expect(counts.get('p2')).toBe(1);
    expect(counts.get('p3')).toBeUndefined();
  });

  it('an empty read gives every person a zero, not a phantom count', () => {
    expect(clearanceOverdueByPerson([]).size).toBe(0);
  });

  it('one person’s checklist picks only that person’s due rows', () => {
    const byItem = clearanceDueByItem(rows, 'p1');
    expect([...byItem.entries()]).toEqual([
      ['i1', { dueOn: '2026-11-01', overdue: true }],
      ['i2', { dueOn: '2026-11-30', overdue: false }],
    ]);
    expect(clearanceDueByItem(rows, 'p9').size).toBe(0);
  });
});

describe('the forms’ target-day draft', () => {
  it.each<[string, number | null | undefined]>([
    ['', null],
    ['   ', null],
    ['1', 1],
    ['5', 5],
    ['365', 365],
    ['0', undefined],
    ['366', undefined],
    ['1.5', undefined],
    ['1e3', undefined],
    ['1000', undefined],
    ['-3', undefined],
    ['days', undefined],
  ])('%j reads as %j', (raw, expected) => {
    expect(parseTargetDays(raw)).toBe(expected);
  });

  it('trims a surrounded draft', () => {
    expect(parseTargetDays('  14 ')).toBe(14);
  });
});
