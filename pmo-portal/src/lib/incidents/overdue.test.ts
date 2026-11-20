import { describe, it, expect } from 'vitest';
import { isIncidentOverdue, needsCloseProof } from './overdue';

const now = new Date('2026-11-20T10:00:00Z');

describe('isIncidentOverdue', () => {
  it('AC-SIL-011: an open issue past its due time is overdue, with no escalation stamp involved', () => {
    expect(isIncidentOverdue({ status: 'Open', due_at: '2026-11-20T09:59:00Z' }, now)).toBe(true);
    expect(isIncidentOverdue({ status: 'Investigating', due_at: '2026-11-19T00:00:00Z' }, now)).toBe(true);
  });
  it('AC-SIL-011: not overdue before the due time, when closed, or when no due time is set', () => {
    expect(isIncidentOverdue({ status: 'Open', due_at: '2026-11-20T10:01:00Z' }, now)).toBe(false);
    expect(isIncidentOverdue({ status: 'Closed', due_at: '2026-11-01T00:00:00Z' }, now)).toBe(false);
    expect(isIncidentOverdue({ status: 'Open', due_at: null }, now)).toBe(false); // AC-SIL-013: legacy rows
  });
});

describe('needsCloseProof', () => {
  it('requires proof for High and Critical only (FR-SIL-012)', () => {
    expect(needsCloseProof('High')).toBe(true);
    expect(needsCloseProof('Critical')).toBe(true);
    expect(needsCloseProof('Medium')).toBe(false);
    expect(needsCloseProof('Low')).toBe(false);
  });
});
