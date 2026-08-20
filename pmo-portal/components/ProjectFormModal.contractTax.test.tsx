/**
 * #513 (migration 0197) — ProjectFormModal: a stated contract value must state its tax basis.
 *
 * The rule is CONDITIONAL, exactly as the DB CHECK is written
 * (`contract_value = 0 or (tax_treatment is not null and tax_amount is not null)`):
 *   - value blank or 0  → the tax controls are not even asked for, and Create fires;
 *   - value non-zero    → the treatment + amount are required, Create stays disabled until they
 *                         are stated, and the reason is visible on screen.
 *
 * ⛔ The treatment must never open pre-selected. A defaulted marker is a WRONG value
 * indistinguishable from a deliberate one — that is the defect this issue exists to remove.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectFormModal from './ProjectFormModal';

vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({
    data: [{ id: 'c1', name: 'Innovate Corp', type: 'Client' }],
    isError: false,
  }),
  useProjectManagers: () => ({ data: [{ id: 'u1', full_name: 'Alice Manager' }], isError: false }),
}));

function renderModal(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ToastProvider>
      <ProjectFormModal mode="create" onClose={vi.fn()} onSubmit={onSubmit} onError={vi.fn()} />
    </ToastProvider>,
  );
  return { onSubmit };
}

async function fillRequired() {
  await userEvent.type(screen.getByLabelText(/project name/i), 'Harborside Terminal');
  await userEvent.click(screen.getByRole('combobox', { name: /client company/i }));
  await userEvent.click(await screen.findByRole('option', { name: /innovate corp/i }));
}

const createButton = () => screen.getByRole('button', { name: /^Create project$/i });

beforeEach(() => vi.clearAllMocks());

describe('#513 ProjectFormModal — contract-value tax basis', () => {
  it('#513: a non-zero estimated value blocks Create until a treatment is chosen, with the reason on screen', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '530200');

    // A number and a tax amount, but nobody has said what the number MEANS.
    expect(createButton()).toBeDisabled();
    expect(screen.getByTestId('project-tax-required-hint')).toBeInTheDocument();
    await userEvent.click(createButton());
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
    expect(createButton()).toBeEnabled();
    expect(screen.queryByTestId('project-tax-required-hint')).not.toBeInTheDocument();
  });

  it('#513: the treatment select opens with NOTHING chosen', async () => {
    renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    expect((screen.getByLabelText(/tax treatment/i) as HTMLSelectElement).value).toBe('');
  });

  it('#513: a stated basis reaches the create input alongside the value', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'inclusive');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '477000');
    await userEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      contract_value: 4820000,
      tax_treatment: 'inclusive',
      tax_amount: 477000,
    });
  });

  it('#513: a project originated with NO value is never asked for a tax treatment', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    expect(screen.queryByLabelText(/tax treatment/i)).not.toBeInTheDocument();
    expect(createButton()).toBeEnabled();
    await userEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(input.contract_value).toBe(0);
    expect(input).not.toHaveProperty('tax_treatment');
  });

  it('#513: an explicit 0 is not asked either — 0 states nothing, so there is nothing to state', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '0');
    expect(screen.queryByLabelText(/tax treatment/i)).not.toBeInTheDocument();
    await userEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((onSubmit.mock.calls[0][0] as Record<string, unknown>).contract_value).toBe(0);
  });

  it('#513: the tax amount goes through parseMoneyInput — "1e5" persists as 100000, not 15', async () => {
    // The same validate==persist regression AC-W3-NUM-001 pins for the value field: a local
    // strip-regex parse would read "1e5" as 15 while the validator read 100000.
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '1e5');
    await userEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ tax_amount: 100000 });
  });
});
