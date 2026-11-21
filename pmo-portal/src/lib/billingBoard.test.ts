import { describe, expect, it } from 'vitest';
import { groupBoard, type BoardRow } from './billingBoard';

const row = (over: Partial<BoardRow>): BoardRow => ({
  claimId: 'c', projectId: 'p', projectName: 'P', workOrderId: null, woNumber: null, claimCreatedAt: '2026-01-01T00:00:00Z',
  stepCount: 3, stepsDone: 1, currentPosition: 2, currentName: 'Approve', ownerRole: null, startedOn: '2026-01-01', lastCompletedOn: null,
  dueOn: null, allDone: false, today: '2026-01-11', ...over,
});

describe('groupBoard', () => {
  it('AC-BBD-008 columns are distinct step names ordered by median position, then all-done; no empty column', () => {
    const cols = groupBoard([
      row({ claimId: 'a', currentName: 'Send', currentPosition: 3 }),
      row({ claimId: 'b', currentName: 'Check', currentPosition: 1 }),
      row({ claimId: 'c', currentName: ' check ', currentPosition: 2 }),
      row({ claimId: 'd', currentName: 'Approve', currentPosition: 2 }),
      row({ claimId: 'e', allDone: true, currentName: null, currentPosition: null, startedOn: null, lastCompletedOn: '2026-01-06' }),
    ]);
    expect(cols.map((c) => c.name)).toEqual(['Check', 'Approve', 'Send', null]);
    expect(cols[0].cards.map((c) => c.claimId).sort()).toEqual(['b', 'c']);
    expect(cols[3].allDone).toBe(true);
    expect(groupBoard([row({ allDone: false })]).some((c) => c.allDone)).toBe(false);
    expect(groupBoard([])).toEqual([]);
  });

  it('AC-BBD-008 ties on median break by name', () => {
    const cols = groupBoard([row({ currentName: 'Zed', currentPosition: 1 }), row({ currentName: 'Alpha', currentPosition: 1 })]);
    expect(cols.map((c) => c.name)).toEqual(['Alpha', 'Zed']);
  });

  it('AC-BBD-009 oldest first inside a column; age is days on the step; all-done age is days since the last completion', () => {
    const cols = groupBoard([
      row({ claimId: 'young', startedOn: '2026-01-09', projectName: 'A' }),
      row({ claimId: 'old', startedOn: '2026-01-01', projectName: 'B' }),
      row({ claimId: 'unstarted', startedOn: null, projectName: 'C' }),
      row({ claimId: 'done', allDone: true, currentName: null, currentPosition: null, startedOn: null, lastCompletedOn: '2026-01-06' }),
    ]);
    expect(cols[0].cards.map((c) => [c.claimId, c.ageDays])).toEqual([['old', 10], ['young', 2], ['unstarted', null]]);
    expect(cols[1].cards[0].ageDays).toBe(5);
  });

  it('AC-BBD-010 overdue only when the current step is past its due date', () => {
    const [col] = groupBoard([
      row({ claimId: 'late', dueOn: '2026-01-08' }),
      row({ claimId: 'today', dueOn: '2026-01-11' }),
      row({ claimId: 'none', dueOn: null }),
    ]);
    const by = Object.fromEntries(col.cards.map((c) => [c.claimId, c.overdueDays]));
    expect(by).toEqual({ late: 3, today: null, none: null });
  });
});
