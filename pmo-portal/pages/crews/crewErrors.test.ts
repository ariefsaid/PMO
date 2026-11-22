import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { crewErrorMessage } from './crewErrors';
import { STALE_VERSION_CODE } from '@/src/lib/repositories/crews';

const t = ((_key: string, fallback: string, opts?: Record<string, unknown>) =>
  (fallback ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts?.[k] ?? ''))) as TFunction;
describe('crew errors', () => {
  it('explains when a selected user already has a workforce person', () => {
    expect(crewErrorMessage(t, { code: '23505', message: 'duplicate key value violates unique constraint "people_profile_live"' }))
      .toBe('That user is already linked to a person. Select that person instead.');
  });
  it('explains a duplicate crew role without calling it a crew code', () => {
    expect(crewErrorMessage(t, { code: '23505', message: 'duplicate key value violates unique constraint "crew_standard_roles_name"' }))
      .toBe('That standard role is already listed for this crew.');
  });

  it('AC-CRW-010 sends the reader back when someone changed the record first', () => {
    expect(crewErrorMessage(t, { code: STALE_VERSION_CODE, message: 'stale' }))
      .toBe('Someone changed this since you opened it. Reload and try again.');
  });

  it('a duplicate code that is neither a user link nor a role is a live crew code clash', () => {
    expect(crewErrorMessage(t, { code: '23505', message: 'duplicate key value violates unique constraint "crew_code_live"' }))
      .toBe('That code is already used by a live crew.');
  });

  it('overlapping loan dates say so specifically before the generic overlap', () => {
    expect(crewErrorMessage(t, { code: '23P01', message: 'crew_loans_no_overlap: conflict' }))
      .toBe('This person is already on loan on some of these days.');
  });

  it('generic exclusion overlap defers to the existing placement', () => {
    expect(crewErrorMessage(t, { code: '23P01', message: 'placement overlap' }))
      .toBe('These dates overlap another placement. End that one first.');
  });

  it('AC-ATT-010 refuses hours the same person recorded', () => {
    expect(crewErrorMessage(t, { message: 'separation of duties: you recorded these hours' }))
      .toBe('You recorded these hours, so someone else approves them.');
  });

  it('the archive guard tells the reader what to settle first', () => {
    expect(crewErrorMessage(t, { message: 'CRW_ARCHIVE_IN_USE: still in use' })).toContain("End this crew's current and future members");
  });

  it('loan writes name the crews and placement rules they violate', () => {
    expect(crewErrorMessage(t, { message: 'LOAN_CREW: same crew' })).toBe('Choose two different live crews of this organisation.');
    expect(crewErrorMessage(t, { message: 'LOAN_HOME: not placed' })).toBe('The person must be placed in the home crew for the whole loan.');
    expect(crewErrorMessage(t, { message: 'LOAN_HOURS_LOCKED: locked 2026-03-10 for approval' })).toContain('Hours on 10 Mar');
  });

  it('attendance guards each get their sentence', () => {
    expect(crewErrorMessage(t, { message: 'ATT_LOCKED: day locked' })).toContain('Re-open the timesheet');
    expect(crewErrorMessage(t, { message: 'ATT_SUBMITTED: week sent' })).toContain('Return it to change a day');
    expect(crewErrorMessage(t, { message: 'ATT_NOT_ROSTERED: nobody' })).toContain('not in a crew rostered');
    expect(crewErrorMessage(t, { message: 'ATT_OFF_ROTATION: off' })).toContain('Give a reason to mark them present');
    expect(crewErrorMessage(t, { message: 'ATT_DAY_CEILING: already has 26.5 hours on WO-12 that day' })).toContain('26.5 hours on WO-12');
    expect(crewErrorMessage(t, { message: 'ATT_DATE_WINDOW: opens 2026-03-01' })).toContain('open for attendance is 1 Mar');
    expect(crewErrorMessage(t, { message: 'ATT_TS_MANUAL_ENTRY: typed line 2026-03-10' })).toContain('typed line for');
    expect(crewErrorMessage(t, { message: 'ATT_DATE_FUTURE: tomorrow' })).toContain('future date');
    expect(crewErrorMessage(t, { message: 'ATT_NEEDS_REVIEW: disagreements' })).toContain('check-in and roster disagree');
    expect(crewErrorMessage(t, { message: 'ATT_TS_NOT_DRAFT: sent' })).toContain('timesheet correction path');
    expect(crewErrorMessage(t, { message: 'ATT_WEEK_EMPTY: nothing' })).toContain('no present days');
    expect(crewErrorMessage(t, { message: 'ATT_TS_SPLIT_DAY: split' })).toContain('split across two work orders');
  });
});
