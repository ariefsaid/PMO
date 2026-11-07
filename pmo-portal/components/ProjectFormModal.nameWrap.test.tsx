import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ProjectFormModal from './ProjectFormModal';

vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isError: false }) }));
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({ useProjectNumberProposal: () => ({ status: 'success', number: 'PMO-TEST-1339', error: null }) }));
vi.mock('@/src/hooks/useOrgTaxDefault', () => ({ useOrgTaxDefault: () => undefined, useTaxTreatmentPreselect: () => undefined }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [{ id: 'c1', name: 'Client Legal', type: 'Client' }], isError: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'c1', name: 'Client Legal', type: 'Client' }], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));

const LONG = 'Pengadaan dan Pemasangan Sistem Instrumentasi dan Kontrol Terpadu untuk Fasilitas Pengolahan Gas Tahap Dua';

describe('ProjectFormModal project name (#1339)', () => {
  it('is a wrapping text area that holds the whole long name while editing', () => {
    render(<ProjectFormModal mode="editHeader" onClose={vi.fn()} onError={vi.fn()} onSubmit={vi.fn()} onSave={vi.fn()}
      initial={{ id: 'p1', name: LONG, code: null, client_id: 'c1', project_manager_id: null }} />);
    const name = screen.getByLabelText(/^Project name/);
    expect(name.tagName).toBe('TEXTAREA');
    expect(name).toHaveValue(LONG);
  });

  it('flattens pasted line breaks so the stored name stays on one line', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProjectFormModal mode="editHeader" onClose={vi.fn()} onError={vi.fn()} onSubmit={vi.fn()} onSave={onSave}
      initial={{ id: 'p1', name: 'Old', code: null, client_id: 'c1', project_manager_id: null }} />);
    const name = screen.getByLabelText(/^Project name/);
    fireEvent.change(name, { target: { value: 'Civil works\r\n  Phase 2\nBlock A' } });
    expect(name).toHaveValue('Civil works Phase 2 Block A');
    await userEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Civil works Phase 2 Block A' })));
  });
});
