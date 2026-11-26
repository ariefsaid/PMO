import { afterEach, describe, expect, it } from 'vitest';
import { orgStageName, setOrgStageNames } from './orgStageNames';

const rows = [
  { status: 'Tender Submitted', label_en: 'Bid sent', label_id: null },
  { status: 'Leads', label_en: null, label_id: 'Calon' },
];

describe('organisation stage names', () => {
  afterEach(() => setOrgStageNames([], 'en'));

  it('AC-STG-007: gives the English name to an English reader and nothing for an unnamed stage', () => {
    expect(setOrgStageNames(rows, 'en')).toBe(true);
    expect(orgStageName('Tender Submitted')).toBe('Bid sent');
    expect(orgStageName('Leads')).toBeUndefined();
  });

  it('AC-STG-007: never leaks the English name to a Bahasa reader', () => {
    setOrgStageNames(rows, 'id');
    expect(orgStageName('Tender Submitted')).toBeUndefined();
    expect(orgStageName('Leads')).toBe('Calon');
  });

  it('reports no change when the same names are set again', () => {
    setOrgStageNames(rows, 'en');
    expect(setOrgStageNames(rows, 'en')).toBe(false);
  });
});
