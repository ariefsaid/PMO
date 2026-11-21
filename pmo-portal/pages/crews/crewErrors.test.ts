import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { crewErrorMessage } from './crewErrors';
import { STALE_VERSION_CODE } from '@/src/lib/repositories/crews';

const t = ((_key: string, fallback: string) => fallback) as TFunction;
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
});
