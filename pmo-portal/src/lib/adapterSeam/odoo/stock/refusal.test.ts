import { describe, expect, it } from 'vitest';
import { isSetupRefusal, parseRefusalEvidence, refusalEvidence } from './refusal.ts';

describe('AC-OSP-007 a refusal is stored on the document as its reason code and, when known, the subject it names', () => {
  it('writes and reads the reason alone', () => {
    expect(refusalEvidence('foreign-company')).toBe('foreign-company');
    expect(parseRefusalEvidence('foreign-company')).toEqual({ reason: 'foreign-company' });
  });

  it('writes and reads the reason with the id of the record it names', () => {
    const text = refusalEvidence('warehouse-unmapped', '15080000-0000-4000-8000-000000000003');
    expect(parseRefusalEvidence(text)).toEqual({ reason: 'warehouse-unmapped', subjectId: '15080000-0000-4000-8000-000000000003' });
  });

  it('reads stored text from before a subject was kept as the reason alone', () => {
    expect(parseRefusalEvidence('analytic-costs-disabled')).toEqual({ reason: 'analytic-costs-disabled' });
  });

  it('knows which reasons end in a step in Integration setup, and which point to Odoo or to the document', () => {
    for (const reason of ['foreign-company', 'item-unmapped', 'warehouse-unmapped', 'project-unlinked', 'company-not-set', 'operation-type-not-set', 'other']) expect(isSetupRefusal(reason)).toBe(true);
    for (const reason of ['missing-module-stock', 'analytic-costs-disabled', 'read-failed', 'lines-invalid', 'document-not-found']) expect(isSetupRefusal(reason)).toBe(false);
  });
});
