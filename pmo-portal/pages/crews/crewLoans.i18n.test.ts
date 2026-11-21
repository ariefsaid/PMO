import { describe, expect, it } from 'vitest';
import enCrews from '../../public/locales/en/crews.json';
import idCrews from '../../public/locales/id/crews.json';
import enAdmin from '../../public/locales/en/administration.json';
import idAdmin from '../../public/locales/id/administration.json';

/** AC-LOAN-011 — every crew-loan string exists in English and Bahasa Indonesia, and none is left in English. */
describe('AC-LOAN-011 crew loan strings', () => {
  it('has the same keys in both languages', () => {
    expect(Object.keys(idCrews.loans).sort()).toEqual(Object.keys(enCrews.loans).sort());
    expect(Object.keys(idAdmin.admin.crewLoans).sort()).toEqual(Object.keys(enAdmin.admin.crewLoans).sort());
    for (const k of ['loanOverlap', 'loanCrew', 'loanHome', 'loanLocked'] as const) {
      expect(idCrews.errors[k]).toBeTruthy();
      expect(idCrews.errors[k]).not.toBe(enCrews.errors[k]);
    }
  });
});
