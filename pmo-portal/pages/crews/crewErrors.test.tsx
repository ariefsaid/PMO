import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCrewErrorText, useCrewToolErrorText, useLeaveErrorText } from './crewErrors';
import { STALE_VERSION_CODE } from '@/src/lib/repositories/crews';

const crew = (err: unknown) => renderHook(() => useCrewErrorText()).result.current(err);
const tool = (err: unknown) => renderHook(() => useCrewToolErrorText()).result.current(err);
const leave = (err: unknown) => renderHook(() => useLeaveErrorText()).result.current(err);

describe('crew errors', () => {
  it('explains when a selected user already has a workforce person', () => {
    expect(crew({ code: '23505', message: 'duplicate key value violates unique constraint "people_profile_live"' }))
      .toBe('That user is already linked to a person. Select that person instead.');
  });
  it('explains a duplicate crew role without calling it a crew code', () => {
    expect(crew({ code: '23505', message: 'duplicate key value violates unique constraint "crew_standard_roles_name"' }))
      .toBe('That standard role is already listed for this crew.');
  });
  it('AC-CRW-010 sends the reader back when someone changed the record first', () => {
    expect(crew({ code: STALE_VERSION_CODE, message: 'stale' })).toBe('Someone changed this since you opened it. Reload and try again.');
  });
  it('a duplicate code that is neither a user link nor a role is a live crew code clash', () => {
    expect(crew({ code: '23505', message: 'duplicate key value violates unique constraint "crew_code_live"' }))
      .toBe('That code is already used by a live crew.');
  });
  it('overlapping loan dates say so specifically before the generic overlap', () => {
    expect(crew({ code: '23P01', message: 'crew_loans_no_overlap: conflict' })).toBe('This person is already on loan on some of these days.');
    expect(crew({ code: '23P01', message: 'placement overlap' })).toBe('These dates overlap another placement. End that one first.');
  });
  it('AC-ATT-010 refuses hours the same person recorded', () => {
    expect(crew({ message: 'separation of duties: you recorded these hours' })).toBe('You recorded these hours, so someone else approves them.');
  });
  it('the archive guard tells the reader what to settle first', () => {
    expect(crew({ message: 'CRW_ARCHIVE_IN_USE: still in use' })).toContain("End this crew's current and future members");
  });
  it('loan and attendance rules read as their own sentence, with the figures the database names', () => {
    expect(crew({ message: 'LOAN_HOURS_LOCKED: locked 2026-03-10 for approval' })).toContain('Hours on 10 Mar');
    expect(crew({ message: 'ATT_DAY_CEILING: Ana already has 26.5 hours on WO-12 that day' })).toContain('26.5 hours on WO-12');
    expect(crew({ message: 'ATT_DATE_WINDOW: opens 2026-03-01' })).toContain('open for attendance is 1 Mar');
    expect(crew({ message: 'ATT_LOCKED: day locked' })).toContain('Re-open the timesheet');
  });
  it('a phone clock-in for a crew the person is not in says so, not "refresh"', () => {
    const text = crew({ code: '23514', message: 'PCI_CREW: you are not in that crew today' });
    expect(text).toMatch(/not in that crew today/);
    expect(text).not.toMatch(/refresh|PCI_/i);
  });
});

describe('crew tool errors', () => {
  it('AC-CTR-001 names the usable quantity when a report is larger', () => {
    expect(tool({ code: '23514', message: 'CTR_QTY_EXCEEDS_USABLE: only 3 usable' })).toBe('Only 3 usable. Report that many or fewer.');
  });
  it('AC-CTR-002 explains a duplicate serial and a repeated report', () => {
    expect(tool({ code: '23505', message: 'duplicate key value violates unique constraint "crew_tool_lines_serial_live"' }))
      .toBe('That serial number is already on a live tool line.');
    expect(tool({ code: '23505', message: 'duplicate key: report id' })).toBe('This report was already sent.');
  });
  it('AC-CTR-014 tells the person to choose a resolution when the task was set Done directly', () => {
    expect(tool({ code: '23514', message: 'CTR_RESOLVE_REQUIRED: choose a resolution' })).toMatch(/Choose a resolution/);
  });
  it('AC-CTR-006/008/009 each rule has its sentence, and a crew rule still reads', () => {
    expect(tool({ code: '23514', message: 'CTR_PHOTO_REQUIRED: add a photo of the damaged tool' })).toBe('Add a photo of the damaged tool.');
    expect(tool({ code: '23514', message: 'CTR_PHOTO: upload lost' })).toBe('A photo did not upload. Add it again.');
    expect(tool({ code: '23514', message: 'CTR_NOT_ALLOWED: nope' })).toBe('Your role cannot do this.');
    expect(tool({ code: '23514', message: 'CRW_ARCHIVE_IN_USE: x' })).toMatch(/End this crew/);
  });
});

describe('leave errors', () => {
  it('maps every LV_ rule to its sentence', () => {
    expect(leave({ code: 'P0001', message: 'LV_OVERLAP: x' })).toContain('already has a pending or approved request');
    expect(leave({ code: 'P0001', message: 'LV_RANGE: x' })).toContain('last day is before the first');
    expect(leave({ code: 'P0001', message: 'LV_FORBIDDEN: x' })).toContain('cannot do this');
    expect(leave({ code: 'P0001', message: 'LV_DECIDED: x' })).toContain('already been decided');
    expect(leave({ code: 'P0001', message: 'LV_NOTE: x' })).toContain('reason when rejecting');
    expect(leave({ code: 'P0001', message: 'LV_DISABLED: x' })).toContain('not switched on');
  });
  it('a duplicate leave type has its own sentence', () => {
    expect(leave({ code: '23505', message: 'duplicate key' })).toBe('That leave type already exists.');
  });
});
