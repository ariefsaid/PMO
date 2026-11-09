import { describe, it, expect } from 'vitest';
import { isOverdue } from '../tabs/taskViewModel';

describe('AC-DND-016: board card late mark rule', () => {
  const today = '2026-11-08';
  it('is late only when open and due before today', () => {
    expect(isOverdue({ status: 'To Do', end_date: '2026-11-07' }, today)).toBe(true);
    expect(isOverdue({ status: 'Blocked', end_date: '2026-01-01' }, today)).toBe(true);
  });
  it('is not late when due today or later, undated, or Done', () => {
    expect(isOverdue({ status: 'To Do', end_date: today }, today)).toBe(false);
    expect(isOverdue({ status: 'In Progress', end_date: '2026-12-01' }, today)).toBe(false);
    expect(isOverdue({ status: 'To Do', end_date: null }, today)).toBe(false);
    expect(isOverdue({ status: 'Done', end_date: '2026-01-01' }, today)).toBe(false);
  });
});
