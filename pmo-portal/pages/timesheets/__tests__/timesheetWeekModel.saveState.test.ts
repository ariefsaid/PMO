import { describe, expect, it } from 'vitest';
import { weekSaveState } from '../timesheetWeekModel';

const base = { reconciling: false, saving: false, invalid: false, failed: false, saved: false, dirty: false, hasEntries: false };

describe('AC-TSF-001..004: weekSaveState picks the one status the user needs', () => {
  it('is quiet on an empty untouched week', () => {
    expect(weekSaveState(base)).toBe('idle');
  });
  it('reads saved on a clean week with entries', () => {
    expect(weekSaveState({ ...base, hasEntries: true })).toBe('saved');
  });
  it('reads unsaved when the buffer differs from the server', () => {
    expect(weekSaveState({ ...base, dirty: true, hasEntries: true })).toBe('unsaved');
  });
  it('reads saved when this very buffer just saved, even if the refetch is pending', () => {
    expect(weekSaveState({ ...base, dirty: true, saved: true })).toBe('saved');
  });
  it('reads failed when this very buffer failed to save', () => {
    expect(weekSaveState({ ...base, dirty: true, failed: true })).toBe('failed');
  });
  it('invalid input outranks failed, saved and unsaved', () => {
    expect(weekSaveState({ ...base, dirty: true, failed: true, saved: true, invalid: true })).toBe('invalid');
  });
  it('saving outranks invalid; reconciling outranks everything', () => {
    expect(weekSaveState({ ...base, saving: true, invalid: true })).toBe('saving');
    expect(weekSaveState({ ...base, saving: true, reconciling: true })).toBe('reconciling');
  });
});
