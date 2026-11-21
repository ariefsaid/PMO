import { describe, it, expect } from 'vitest';
import { parseSafetySummary, buildSafetyPhotoPath } from './safetyDays';

/** #2596 NFR: every summary figure is validated; a malformed or missing number is an error, never a plausible 0. */
const raw = { month: '2026-03-01', timezone: 'UTC', project_id: null, worked_minutes: 1200, safe_minutes: 600, lost_time_incidents: 1, recordable_incidents: 0,
  near_misses: 2, toolbox_talks: 4, complete_days: 3, days_without_record: 1, hidden: {} };

describe('parseSafetySummary', () => {
  it('maps the database figures', () => {
    expect(parseSafetySummary(raw)).toMatchObject({ workedMinutes: 1200, safeMinutes: 600, lostTimeIncidents: 1, daysWithoutRecord: 1, projectId: null });
  });
  it('keeps a hidden figure null with its reason', () => {
    const s = parseSafetySummary({ ...raw, worked_minutes: null, hidden: { worked_minutes: 'no attendance' } });
    expect(s.workedMinutes).toBeNull();
    expect(s.hidden.workedMinutes).toBe('no attendance');
  });
  it('refuses a missing or malformed count instead of defaulting to 0', () => {
    expect(() => parseSafetySummary({ ...raw, near_misses: undefined })).toThrow();
    expect(() => parseSafetySummary({ ...raw, toolbox_talks: 'many' })).toThrow();
    expect(() => parseSafetySummary({ ...raw, complete_days: -1 })).toThrow();
    expect(() => parseSafetySummary(null)).toThrow();
  });
});

describe('buildSafetyPhotoPath', () => {
  it('keys the object at org, day, photo and a sanitised file name', () => {
    expect(buildSafetyPhotoPath('o1', 'd1', 'p1', 'a b.png').split('/').slice(0, 3)).toEqual(['o1', 'd1', 'p1']);
  });
});
