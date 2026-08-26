/**
 * ProjectFormModal — a stated contract value must state its tax basis (#513 / migration 0197), and
 * the org's default now PRE-SELECTS that basis (#548 / `OD-TAX-1`, migration 0207).
 *
 * The #513 rule is unchanged and CONDITIONAL, exactly as the DB CHECK is written
 * (`contract_value = 0 or (tax_treatment is not null and tax_amount is not null)`):
 *   - value blank or 0  → the tax controls are not even asked for, and Create fires;
 *   - value non-zero    → the treatment + amount are required, Create stays disabled until they
 *                         are stated, and the reason is visible on screen.
 *
 * ⚑ WHAT #548 CHANGED, and why the old "the select opens with NOTHING chosen" assertion is gone.
 * `OD-TAX-1` is an owner ruling: the system caters to BOTH bases, and the org says which one it
 * meets most days so the uncommon one is a visible choice rather than a daily re-answer. The
 * marker is still never invented — it comes from a per-org row an Admin set, it is on screen, and
 * it is changeable before submit. What remains forbidden, and is asserted below, is a marker
 * appearing when the org states none, and the default overriding an answer the user gave.
 *
 * ⚑ BOTH VALUES APPEAR IN THE FIXTURES. A suite where every org is `exclusive` cannot tell a
 * derived pre-selection from a hardcoded string — the DD-CUR-6 / #529 blind spot this issue's own
 * test note names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// The org READ is stubbed; `useTaxTreatmentPreselect` stays real, so what runs below is the shipped
// seeding logic driven by a controllable org row.
const orgDefault = vi.hoisted(() => ({ value: 'exclusive' as string | undefined }));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => orgDefault.value };
});

vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({
    data: [{ id: 'c1', name: 'Innovate Corp', type: 'Client' }],
    isError: false,
  }),
  useProjectManagers: () => ({ data: [{ id: 'u1', full_name: 'Alice Manager' }], isError: false }),
}));

import ProjectFormModal from './ProjectFormModal';

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
const treatmentSelect = () => screen.getByLabelText(/tax treatment/i) as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  orgDefault.value = 'exclusive';
});

describe('#513 ProjectFormModal — contract-value tax basis', () => {
  it('#513: a non-zero estimated value blocks Create until the tax AMOUNT is stated, with the reason on screen', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');

    // A number and a basis, but no tax amount — 0197 requires BOTH alongside a stated value.
    expect(createButton()).toBeDisabled();
    expect(screen.getByTestId('project-tax-required-hint')).toBeInTheDocument();
    await userEvent.click(createButton());
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/tax amount/i), '530200');
    expect(createButton()).toBeEnabled();
    expect(screen.queryByTestId('project-tax-required-hint')).not.toBeInTheDocument();
  });

  it('#548: with NO org default readable, the select opens empty and Create stays blocked — a marker is never invented', async () => {
    orgDefault.value = undefined;
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '530200');

    expect(treatmentSelect().value).toBe('');
    expect(createButton()).toBeDisabled();
    expect(screen.getByTestId('project-tax-required-hint')).toBeInTheDocument();
    await userEvent.click(createButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('#548 (OD-TAX-1): the select opens pre-selected to the org default', async () => {
    renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await waitFor(() => expect(treatmentSelect().value).toBe('exclusive'));
  });

  it('#548: an INCLUSIVE org gets inclusive — the pre-selection is read, not hardcoded', async () => {
    orgDefault.value = 'inclusive';
    renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await waitFor(() => expect(treatmentSelect().value).toBe('inclusive'));
  });

  it('#548: the pre-selection is a starting point — the user overrides it and THEIR answer is written', async () => {
    // The government/SOE contract on an org that quotes commercially: the whole reason the owner
    // refused to pick one basis.
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await waitFor(() => expect(treatmentSelect().value).toBe('exclusive'));
    await userEvent.selectOptions(treatmentSelect(), 'inclusive');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '477000');
    await userEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      contract_value: 4820000,
      tax_treatment: 'inclusive',
      tax_amount: 477000,
    });
  });

  it('#513: a stated basis reaches the create input alongside the value', async () => {
    orgDefault.value = 'inclusive';
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await waitFor(() => expect(treatmentSelect().value).toBe('inclusive'));
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

  it('#548: EDITING an existing project is never pre-selected — the org default describes a NEW figure only', async () => {
    orgDefault.value = 'inclusive';
    render(
      <ToastProvider>
        <ProjectFormModal
          mode="editHeader"
          initial={{ id: 'p1', name: 'Harborside Terminal', client_id: 'c1' } as never}
          onClose={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          onError={vi.fn()}
        />
      </ToastProvider>,
    );
    // The edit form does not write `contract_value` at all (SoD → the detail-header RPC), so it
    // asks for no basis — and must not carry the CURRENT org posture toward an OLD row either.
    expect(screen.queryByLabelText(/tax treatment/i)).not.toBeInTheDocument();
  });

  it('#513: the tax amount goes through parseMoneyInput — "1e5" persists as 100000, not 15', async () => {
    // The same validate==persist regression AC-W3-NUM-001 pins for the value field: a local
    // strip-regex parse would read "1e5" as 15 while the validator read 100000.
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4820000');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '1e5');
    await userEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ tax_amount: 100000 });
  });
});
