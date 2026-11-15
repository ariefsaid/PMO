import { describe, expect, it } from 'vitest';
import { COMPANY_DEFAULT_SLOTS, defaultTargetProblem, SLOT_LABEL, type DefaultTargetFacts } from '@/src/lib/adapterSeam/companyDefaults';
import { matchCompanyDefaultsRefusal } from './companyDefaultsRefusal';

const fit = (over: Partial<DefaultTargetFacts>): DefaultTargetFacts => ({
  name: 'Acct - EC', company: 'Example Co', isGroup: false, disabled: false, rootType: 'Expense', accountType: '', ...over,
});

describe('matchCompanyDefaultsRefusal (#1599 ECX-3)', () => {
  it('ECX3-T6 binds to the adapter seam: every sentence defaultTargetProblem can return has a key, its record and its slot', () => {
    for (const slot of COMPANY_DEFAULT_SLOTS) {
      const cases: Array<[Partial<DefaultTargetFacts>, string]> = [
        [{ company: 'Other Co' }, 'otherCompany'],
        [{ isGroup: true }, 'group'],
        [{ disabled: true }, 'disabled'],
      ];
      if (slot !== 'cost_centre') cases.push([{ rootType: 'Asset', accountType: 'Receivable' }, { payable: 'notPayable', cash: 'notCash', bank: 'notBank', expense: 'notExpense' }[slot]]);
      for (const [facts, key] of cases) {
        const sentence = defaultTargetProblem(slot, 'Example Co', fit(facts));
        expect(sentence, `${slot}/${key}`).toContain(SLOT_LABEL[slot]);
        expect(matchCompanyDefaultsRefusal(sentence)).toEqual({ key, name: 'Acct - EC', slot });
      }
    }
  });

  it('ECX3-T6 the ERP\'s own words and an empty reason match nothing', () => {
    expect(matchCompanyDefaultsRefusal('Account is frozen.')).toBeNull();
    expect(matchCompanyDefaultsRefusal('')).toBeNull();
    expect(matchCompanyDefaultsRefusal(null)).toBeNull();
  });
});
