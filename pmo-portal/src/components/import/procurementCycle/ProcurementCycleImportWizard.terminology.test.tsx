import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { setOrgTerms } from '@/src/lib/i18n/orgTerms';
import { ProcurementCycleImportWizard } from './ProcurementCycleImportWizard';

vi.mock('./useProcurementCycleImport', async (original) => ({
  ...(await original<typeof import('./useProcurementCycleImport')>()),
  useProcurementCycleImport: () => ({ step: 'mapping', parsed: { headers: ['project'], rows: [] }, mapping: { project: 0 }, setFieldMapping: vi.fn(), counts: { validRecords: 0 }, allRequiredMapped: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

describe('procurement cycle import wording', () => {
  afterEach(() => setOrgTerms({}));
  it('renames the app field label but preserves the uploaded header', () => {
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    render(<MemoryRouter><ProcurementCycleImportWizard requestedById="u" projectLookup={() => ({ id: null, error: null })} vendorLookup={() => ({ id: null, error: null })} onClose={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('job')).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'project' }).length).toBeGreaterThan(0);
  });
});
