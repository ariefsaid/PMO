import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { crewErrorMessage } from './crewErrors';

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
});
