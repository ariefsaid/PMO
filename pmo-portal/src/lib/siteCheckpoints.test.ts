import { describe, expect, it } from 'vitest';
import { checkpointState, startedOnTimeShare } from './siteCheckpoints';

const due = '2026-03-10T00:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(due) + minutes * 60_000).toISOString();
const row = (recordedAt: string | null) => ({ due_at: due, grace_minutes: 10, recorded_at: recordedAt });

describe('AC-STC-011 checkpoint state against due time plus grace', () => {
  it('is on time when recorded at the end of the grace', () => {
    expect(checkpointState(row(at(10)), new Date(at(60)))).toBe('on_time');
  });
  it('is late when recorded one minute after the grace', () => {
    expect(checkpointState(row(at(11)), new Date(at(60)))).toBe('late');
  });
  it('is late while unrecorded after the grace', () => {
    expect(checkpointState(row(null), new Date(at(11)))).toBe('late');
  });
  it('is pending while unrecorded inside the grace', () => {
    expect(checkpointState(row(null), new Date(at(10)))).toBe('pending');
  });
});

describe('started on time share', () => {
  it('counts days, never averages minutes', () => {
    expect(startedOnTimeShare([{ status: 'on_time' }, { status: 'late' }, { status: 'not_started' }])).toEqual({ days: 3, onTime: 1, share: 1 / 3 });
  });
  it('is zero days and zero share with no days', () => {
    expect(startedOnTimeShare([])).toEqual({ days: 0, onTime: 0, share: 0 });
  });
});
