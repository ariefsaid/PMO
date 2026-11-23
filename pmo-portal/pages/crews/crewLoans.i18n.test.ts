import { describe, expect, it } from 'vitest';
import enCrews from '../../public/locales/en/crews.json';
import idCrews from '../../public/locales/id/crews.json';
import enRefusals from '../../public/locales/en/refusals.json';
import idRefusals from '../../public/locales/id/refusals.json';

/** AC-LOAN-011 — every crew-loan string exists in English and Bahasa Indonesia, and none is left in English. */
describe('AC-LOAN-011 crew loan strings', () => {
  it('has the same keys in both languages', () => {
    expect(Object.keys(idCrews.loans).sort()).toEqual(Object.keys(enCrews.loans).sort());
    expect(idCrews.errors.loanOverlap).toBeTruthy();
    expect(idCrews.errors.loanOverlap).not.toBe(enCrews.errors.loanOverlap);
    for (const k of ['LOAN_CREW', 'LOAN_HOME', 'LOAN_HOURS_LOCKED'] as const) {
      expect(idRefusals[k]).toBeTruthy();
      expect(idRefusals[k]).not.toBe(enRefusals[k]);
    }
  });
});
