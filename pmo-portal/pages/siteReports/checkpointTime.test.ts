import { describe, expect, it } from 'vitest';
import { checkpointToday, checkpointTimeZone, formatCheckpointTime } from './checkpointTime';

/** NFR-STC-004: every checkpoint clock on screen is HH:mm in the viewer's resolved timezone, and the
 * range defaults come from the same clock. */
describe('checkpointTime', () => {
  it('formats an instant as a 24-hour clock time in the viewer timezone', () => {
    expect(formatCheckpointTime('2026-03-10T01:30:00Z')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('an absent instant is a dash, not a fabricated clock time', () => {
    expect(formatCheckpointTime(null)).toBe('—');
  });

  it('the day anchor is an ISO calendar day in the viewer timezone', () => {
    expect(checkpointToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(checkpointTimeZone()).toBeTruthy();
  });
});
