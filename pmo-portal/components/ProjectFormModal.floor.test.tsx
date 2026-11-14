import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// Same harness as ProjectFormModal.projectNumber.test.tsx + contractTax.test.tsx: the real form;
// the number proposal read and the org tax default are stubbed at their seams.
const h = vi.hoisted(() => ({ proposeNumber: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { proposeNumber: h.proposeNumber } } }));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({
    data: [
      { id: 'client-1', name: 'Acme Client', type: 'Client' },
      { id: 'client-2', name: 'Borealis Client', type: 'Client' },
    ],
    isError: false,
  }),
  useProjectManagers: () => ({ data: [{ id: 'mgr-1', full_name: 'Alice Manager' }], isError: false }),
}));
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
const orgDefault = vi.hoisted(() => ({ value: 'exclusive' as string | undefined }));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => orgDefault.value };
});
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

import ProjectFormModal from './ProjectFormModal';

function renderModal(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ToastProvider>
      <ProjectFormModal mode="create" onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} />
    </ToastProvider>,
  );
  return { onSubmit };
}

async function pickOption(comboboxName: RegExp | string, optionName: RegExp | string) {
  await userEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

async function fillName() {
  await userEvent.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
}

beforeEach(() => {
  vi.clearAllMocks();
  orgDefault.value = 'exclusive';
  h.proposeNumber.mockImplementation(async (clientId: string) => clientId === 'client-1' ? 'RIS-26-0001' : 'RIS-26-0002');
});
afterEach(() => cleanup());

describe('ProjectFormModal floor', () => {
  it('floor: selecting a project manager sends the manager id in the create payload', async () => {
    const { onSubmit } = renderModal();
    await fillName();
    await pickOption(/client company/i, /acme client/i);
    await pickOption(/project manager/i, /alice manager/i);
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ project_manager_id: 'mgr-1' })));
  });

  it('floor: a Nominal tax rate is saved and recalculates the tax amount live', async () => {
    const { onSubmit } = renderModal();
    await fillName();
    await pickOption(/client company/i, /acme client/i);
    await userEvent.type(screen.getByLabelText(/estimated value/i), '100000');
    await userEvent.click(await screen.findByRole('button', { name: /create project/i }));
    // Value non-zero: tax treatment + amount required before Create enables.
    await userEvent.click(screen.getByLabelText(/tax treatment/i));
    await userEvent.click(await screen.findByRole('option', { name: /exclusive/i }));
    await userEvent.type(screen.getByLabelText(/nominal tax rate/i), '11');
    const amount = await screen.findByLabelText(/tax amount/i);
    await waitFor(() => { if (!((amount as HTMLInputElement).value.replace(/[^0-9]/g, '')).includes('11000')) throw new Error('amount not calculated: ' + JSON.stringify((amount as HTMLInputElement).value)); });
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tax_rate: 11, tax_amount: 11000 })));
  });

  it('floor: a reduced Tax base (DPP) fraction is saved with the rate', async () => {
    const { onSubmit } = renderModal();
    await fillName();
    await pickOption(/client company/i, /acme client/i);
    await userEvent.type(screen.getByLabelText(/estimated value/i), '100000');
    await userEvent.click(await screen.findByRole('button', { name: /create project/i }));
    await userEvent.click(screen.getByLabelText(/tax treatment/i));
    await userEvent.click(await screen.findByRole('option', { name: /exclusive/i }));
    await userEvent.type(screen.getByLabelText(/nominal tax rate/i), '11');
    await userEvent.clear(screen.getByLabelText(/tax base/i));
    await userEvent.type(screen.getByLabelText(/tax base/i), '1/2');
    const amount = await screen.findByLabelText(/tax amount/i);
    await waitFor(() => { if (!((amount as HTMLInputElement).value.replace(/[^0-9]/g, '')).includes('5500')) throw new Error('amount not calculated: ' + JSON.stringify((amount as HTMLInputElement).value)); });
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      tax_rate: 11, tax_base_numerator: 1, tax_base_denominator: 2, tax_amount: 5500,
    })));
  });

  it('floor: changing the client clears the old proposal and duplicate error, then proposes for the new client', async () => {
    const onSubmit = vi.fn().mockRejectedValue({ code: '23505', message: 'pmo_project_number duplicate' });
    const { onError } = { onError: vi.fn() };
    render(
      <ToastProvider>
        <ProjectFormModal mode="create" onClose={vi.fn()} onSubmit={onSubmit} onError={onError} />
      </ToastProvider>,
    );
    await fillName();
    await pickOption(/client company/i, /acme client/i);
    const number = await screen.findByLabelText(/pmo project number/i);
    await waitFor(() => expect(number).toHaveValue('RIS-26-0001'));
    await userEvent.clear(number);
    await userEvent.type(number, 'RIS-26-EDITED');
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await screen.findAllByText(/already in use/i);

    // Choosing a DIFFERENT client clears the stale proposal and its duplicate error.
    await pickOption(/client company/i, /borealis client/i);
    const fresh = await screen.findByLabelText(/pmo project number/i);
    await waitFor(() => expect(fresh).toHaveValue('RIS-26-0002'));
    expect(screen.queryAllByText(/already in use/i)).toHaveLength(0);
    expect(h.proposeNumber).toHaveBeenCalledWith('client-2');
  });
});
