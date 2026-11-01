import { describe, expect, it } from 'vitest';
import { SI_FROM_DOC_FIELDS, siFromDoc } from './bodies/salesInvoice.ts';

// The link-resolution rules moved to the shared `project.match` suite (contractSuite/project.suite.ts).
describe('ERPNext sales-invoice project provenance', () => {
  it('AC-PFIN-001/003 maps carried ERP project provenance without inventing omitted keys', () => {
    expect(siFromDoc({ name: 'SI-A', project: 'ERP-A' }).erp_project).toBe('ERP-A');
    expect(siFromDoc({ name: 'SI-A', project: null })).toHaveProperty('erp_project', null);
    expect(siFromDoc({ name: 'SI-A' })).not.toHaveProperty('erp_project');
    expect(SI_FROM_DOC_FIELDS).toContain('project');
  });
});
