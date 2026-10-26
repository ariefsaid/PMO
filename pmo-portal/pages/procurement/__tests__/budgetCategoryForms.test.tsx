import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { MemoryRouter } from 'react-router';
import ProcurementCreate from '../../ProcurementCreate';

const createRequest = vi.fn();
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: createRequest, isPending: false }),
  useCreateProcurementItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out', sub: 'PRJ-1' }] }),
  useVendorOptions: () => ({ data: [] }),
}));

vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'proj-1', name: 'HQ Fit-Out', archived_at: null }] }) }));

import { ProcurementHeaderEdit } from '../ProcurementHeaderEdit';

function renderNew() {
  createRequest.mockResolvedValue({ id: 'pc-new' });
  render(<ToastProvider><MemoryRouter><ProcurementCreate /></MemoryRouter></ToastProvider>);
  return createRequest;
}

describe('AC-APR-037 budget category on the request forms', () => {
  it('AC-APR-037: a chosen category is passed to onCreate', async () => {
    const onCreate = renderNew();
    await userEvent.type(screen.getByLabelText(/title/i), 'Cable');
    await userEvent.selectOptions(screen.getByLabelText('Budget category'), 'Materials');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ budgetCategory: 'Materials' });
  });

  it('AC-APR-037: "No category" omits the field', async () => {
    const onCreate = renderNew();
    await userEvent.type(screen.getByLabelText(/title/i), 'Cable');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('budgetCategory');
  });

  it('AC-APR-037: the Draft header edit sends a cleared category as null', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <ProcurementHeaderEdit
          title="Cable"
          projectId="proj-1"
          projectName="HQ Fit-Out"
          vendorId={null}
          vendorName={null}
          budgetCategory="Materials"
          onSave={onSave}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </ToastProvider>,
    );
    await userEvent.selectOptions(screen.getByLabelText('Budget category'), '');
    await userEvent.click(screen.getByRole('button', { name: /save request/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ budgetCategory: null })));
  });
});
