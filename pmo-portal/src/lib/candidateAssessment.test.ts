import { describe, expect, it } from 'vitest';
import { deriveAssessment, type AssessmentItem } from './candidateAssessment';

const item = (over: Partial<AssessmentItem>): AssessmentItem => ({
  id: 'i', label: 'Item', position: 1, required: true, status: 'open', target_date: null, ...over,
});

describe('AC-CWO-015 deriveAssessment', () => {
  it('counts passed of required, treating not applicable as ready', () => {
    const r = deriveAssessment([
      item({ id: 'a', status: 'passed' }), item({ id: 'b', status: 'not_applicable' }),
      item({ id: 'c', status: 'open' }), item({ id: 'd', required: false, status: 'passed' }),
    ], '2026-11-21');
    expect(r.requiredCount).toBe(3);
    expect(r.readyRequired).toBe(2);
    expect(r.readyToAccept).toBe(false);
    expect(r.blocking.map((i) => i.id)).toEqual(['c']);
  });

  it('is ready to accept when no item is required or all required are ready', () => {
    expect(deriveAssessment([], '2026-11-21').readyToAccept).toBe(true);
    expect(deriveAssessment([item({ status: 'failed', required: false })], '2026-11-21').readyToAccept).toBe(true);
    expect(deriveAssessment([item({ status: 'passed' })], '2026-11-21').readyToAccept).toBe(true);
  });

  it('a failed required item blocks acceptance', () => {
    expect(deriveAssessment([item({ status: 'failed' })], '2026-11-21').readyToAccept).toBe(false);
  });

  it('counts overdue items against the organisation date passed in, never the browser clock', () => {
    const items = [
      item({ id: 'a', target_date: '2026-11-20' }), // before today: overdue
      item({ id: 'b', target_date: '2026-11-21' }), // today: not overdue
      item({ id: 'c', target_date: '2026-11-22' }),
      item({ id: 'd', target_date: '2026-11-01', status: 'passed' }), // done: never overdue
      item({ id: 'e', target_date: '2026-11-01', status: 'not_applicable' }),
      item({ id: 'f', target_date: null }),
    ];
    expect(deriveAssessment(items, '2026-11-21').overdue.map((i) => i.id)).toEqual(['a']);
    expect(deriveAssessment(items, '2026-11-23').overdue.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
