import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

expect.extend(toHaveNoViolations);
const h = vi.hoisted(() => ({ proposeNumber: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { proposeNumber: h.proposeNumber } } }));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'client-1', name: 'Acme Client', type: 'Client' }], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useOrgTaxDefault', () => ({ useOrgTaxDefault: () => 'exclusive', useTaxTreatmentPreselect: () => undefined }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useTaxTreatmentOptions', () => ({ useTaxTreatmentOptions: () => ({ placeholder: 'Choose', options: [] }) }));

import ProjectFormModal from './ProjectFormModal';

function renderModal(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const view = render(
    <ToastProvider>
      <ProjectFormModal onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} />
    </ToastProvider>,
  );
  return { ...view, onSubmit };
}

async function selectClient() {
  await userEvent.click(screen.getByRole('combobox', { name: /client company/i }));
  await userEvent.click(await screen.findByRole('option', { name: /acme client/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.proposeNumber.mockResolvedValue('RIS-26-0001');
});
afterEach(() => cleanup());

describe('AC-CODE-002 ProjectFormModal', () => {
  it('proposes an editable PMO number and sends the separate optional Client Project Code', async () => {
    const { onSubmit } = renderModal();
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    const number = await screen.findByLabelText(/pmo project number/i);
    await waitFor(() => expect(number).toHaveValue('RIS-26-0001'));
    await userEvent.clear(number);
    await userEvent.type(number, 'RIS-26-EDITED');
    await userEvent.type(screen.getByLabelText(/client project code/i), 'CLIENT-77');
    expect(h.proposeNumber).toHaveBeenCalledWith('client-1');
    expect(await axe(document.body)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      pmo_project_number: 'RIS-26-EDITED', code: 'CLIENT-77', name: 'Site Upgrade', client_id: 'client-1',
    })));
  });

  it('turns a duplicate PMO number into an actionable field error and retains the entered value', async () => {
    const { onSubmit } = renderModal(vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key on pmo_project_number' }));
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    const number = await screen.findByLabelText(/pmo project number/i);
    await userEvent.clear(number);
    await userEvent.type(number, 'RIS-26-TAKEN');
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(screen.getAllByText(/already in use/i).length).toBeGreaterThan(0));
    expect(number).toHaveAttribute('aria-invalid', 'true');
    expect(number).toHaveValue('RIS-26-TAKEN');
    expect(onSubmit).toHaveBeenCalled();
  });

  it('announces proposal loading and explains a missing client segment without inventing a number', async () => {
    let reject!: (error: Error) => void;
    h.proposeNumber.mockReturnValue(new Promise<string>((_resolve, fail) => { reject = fail; }));
    const { onSubmit } = renderModal();
    await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await selectClient();
    expect(screen.getByRole('status')).toHaveTextContent(/proposing/i);
    await waitFor(() => expect(reject).toBeTypeOf('function'));
    reject(new Error('project_number_client_segment_required'));
    expect(await screen.findByText(/selected company needs a client number segment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pmo project number/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /create project/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
