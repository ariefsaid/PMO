/**
 * The two work-order write forms (#566).
 *
 * Both exist to enforce one owner ruling in the UI: OD-TAX-1 — a money figure states its tax basis
 * or it is not written at all, and NO treatment is ever pre-selected. A defaulted marker is a wrong
 * answer indistinguishable from a deliberate one, and #478 established that ambiguity cannot be
 * recovered afterwards. Everything else here follows from what the server will accept:
 *   • the body form drops the value + basis in EDIT mode, because 0197 §5(a) revoked those three
 *     columns from the client UPDATE grant;
 *   • the value form does NOT pre-fill the current figure, because restating it is an act of
 *     authorship the witness re-stamps — pre-filling makes "press Save" the path of least
 *     resistance for the very decision the SoD is asking a second person to make.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import WorkOrderFormModal from '../WorkOrderFormModal';
import WorkOrderValueModal from '../WorkOrderValueModal';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

const draft = (over: Partial<WorkOrderRow> = {}): WorkOrderRow =>
  ({
    id: 'wo-1',
    org_id: 'org-1',
    project_id: 'p1',
    wo_number: null,
    client_po_number: 'PO-77',
    title: 'Phase 1 fabrication',
    description: null,
    status: 'Draft',
    order_value: 250_000,
    currency: 'USD',
    tax_treatment: 'exclusive',
    tax_amount: 27_500,
    tax_rate: null,
    tax_template: null,
    order_date: null,
    start_date: null,
    end_date: null,
    order_value_set_by: null,
    order_value_set_at: null,
    issued_by: null,
    issued_at: null,
    over_commit_ack_by: null,
    over_commit_ack_at: null,
    closed_at: null,
    cancelled_at: null,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  }) as WorkOrderRow;

const onCreate = vi.fn();
const onUpdate = vi.fn();
const onSave = vi.fn();

beforeEach(() => {
  setActiveLocale(EN_LOCALE);
  onCreate.mockReset().mockResolvedValue(undefined);
  onUpdate.mockReset().mockResolvedValue(undefined);
  onSave.mockReset().mockResolvedValue(undefined);
});
afterEach(() => resetActiveLocale());

const renderCreate = () =>
  render(
    <WorkOrderFormModal
      workOrder={null}
      currencySymbolPrefix="$"
      onClose={vi.fn()}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onError={vi.fn()}
    />,
  );

describe('WorkOrderFormModal — create', () => {
  it('OD-TAX-1: the tax treatment starts UNCHOSEN — nothing is pre-selected', () => {
    renderCreate();
    expect(screen.getByTestId('wo-tax-treatment')).toHaveValue('');
  });

  it('blocks submit until the value AND its basis are both stated', async () => {
    renderCreate();
    const submit = screen.getByRole('button', { name: 'Create draft' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Title/), 'Phase 2');
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId('wo-order-value'), '500000');
    expect(submit).toBeDisabled(); // a value with no basis is exactly what OD-TAX-1 forbids

    await userEvent.selectOptions(screen.getByTestId('wo-tax-treatment'), 'exclusive');
    await userEvent.type(screen.getByTestId('wo-tax-amount'), '55000');
    expect(submit).toBeEnabled();
  });

  it('accepts a tax amount of 0 — "no tax" is an answer, not a blank', async () => {
    renderCreate();
    await userEvent.type(screen.getByLabelText(/Title/), 'Phase 2');
    await userEvent.type(screen.getByTestId('wo-order-value'), '500000');
    await userEvent.selectOptions(screen.getByTestId('wo-tax-treatment'), 'exclusive');
    await userEvent.type(screen.getByTestId('wo-tax-amount'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orderValue: 500_000, taxTreatment: 'exclusive', taxAmount: 0 }),
    );
  });

  it('refuses an inclusive value whose tax exceeds it — that inverts the ceiling (0197 §6)', async () => {
    renderCreate();
    await userEvent.type(screen.getByLabelText(/Title/), 'Phase 2');
    await userEvent.type(screen.getByTestId('wo-order-value'), '1000');
    await userEvent.selectOptions(screen.getByTestId('wo-tax-treatment'), 'inclusive');
    await userEvent.type(screen.getByTestId('wo-tax-amount'), '9000');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/tax cannot be larger than the value itself/).length,
    ).toBeGreaterThan(0);
  });

  it('sends the whole granted body, with blanks as null rather than empty strings', async () => {
    renderCreate();
    await userEvent.type(screen.getByLabelText(/Title/), 'Phase 2');
    await userEvent.type(screen.getByTestId('wo-order-value'), '500000');
    await userEvent.selectOptions(screen.getByTestId('wo-tax-treatment'), 'exclusive');
    await userEvent.type(screen.getByTestId('wo-tax-amount'), '55000');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(onCreate).toHaveBeenCalledWith({
      title: 'Phase 2',
      clientPoNumber: null,
      description: null,
      orderValue: 500_000,
      taxTreatment: 'exclusive',
      taxAmount: 55_000,
      taxRate: null,
      taxBaseNumerator: 1,
      taxBaseDenominator: 1,
      orderDate: null,
      startDate: null,
      endDate: null,
    });
  });

  it('AC-DPP-001: submits the nominal rate and authored fraction with calculated tax', async () => {
    renderCreate();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Reduced base');
    await user.type(screen.getByTestId('wo-order-value'), '1000');
    await user.selectOptions(screen.getByTestId('wo-tax-treatment'), 'exclusive');
    await user.type(screen.getByLabelText('Nominal tax rate (%)'), '12');
    await user.clear(screen.getByLabelText('Tax base (DPP)'));
    await user.type(screen.getByLabelText('Tax base (DPP)'), '11/12');
    expect(screen.getByTestId('wo-tax-amount')).toHaveValue('110');
    expect(screen.getByTestId('wo-tax-amount')).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      orderValue: 1000, taxTreatment: 'exclusive', taxAmount: 110,
      taxRate: 12, taxBaseNumerator: 11, taxBaseDenominator: 12,
    }));
  });

  it('AC-PLC-009: rejects an en-US order value with excess precision before creating the draft', async () => {
    setActiveLocale(EN_LOCALE);
    renderCreate();
    await userEvent.type(screen.getByLabelText(/Title/), 'Phase 2');
    await userEvent.type(screen.getByTestId('wo-order-value'), '1.234');
    await userEvent.selectOptions(screen.getByTestId('wo-tax-treatment'), 'exclusive');
    await userEvent.type(screen.getByTestId('wo-tax-amount'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText(/non-negative amount with no more than 2 decimal places/i, {
      selector: 'span[role="alert"]',
    })).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: parses id-ID order value grouping as 1234 before creating the draft', async () => {
    setActiveLocale(ID_LOCALE);
    renderCreate();
    await userEvent.type(screen.getByLabelText(/Title/), 'Phase 2');
    await userEvent.type(screen.getByTestId('wo-order-value'), '1.234');
    await userEvent.selectOptions(screen.getByTestId('wo-tax-treatment'), 'exclusive');
    await userEvent.type(screen.getByTestId('wo-tax-amount'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ orderValue: 1234 }));
  });
});

describe('WorkOrderFormModal — edit', () => {
  const renderEdit = () =>
    render(
      <WorkOrderFormModal
        workOrder={draft()}
        currencySymbolPrefix="$"
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onError={vi.fn()}
      />,
    );

  it('offers no value or tax fields at all — they are not in the client UPDATE grant', () => {
    renderEdit();
    expect(screen.queryByTestId('wo-order-value')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wo-tax-treatment')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wo-tax-amount')).not.toBeInTheDocument();
  });

  it('updates the body only, never the money', async () => {
    renderEdit();
    const title = screen.getByLabelText(/Title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Phase 1 fabrication (rev B)');
    await userEvent.click(screen.getByRole('button', { name: 'Save work order' }));

    expect(onUpdate).toHaveBeenCalledWith('wo-1', {
      title: 'Phase 1 fabrication (rev B)',
      clientPoNumber: 'PO-77',
      description: null,
      orderDate: null,
      startDate: null,
      endDate: null,
    });
    const patch = onUpdate.mock.calls[0][1];
    expect(patch).not.toHaveProperty('orderValue');
    expect(patch).not.toHaveProperty('taxTreatment');
    expect(patch).not.toHaveProperty('taxAmount');
  });
});

describe('WorkOrderValueModal', () => {
  const renderValue = () =>
    render(
      <WorkOrderValueModal
        workOrder={draft()}
        currentValueText="$250,000 excl. PPN"
        currencySymbolPrefix="$"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

  it('shows the current figure with its basis as read-only context', () => {
    renderValue();
    expect(screen.getByTestId('wo-value-current')).toHaveTextContent('$250,000 excl. PPN');
  });

  it('does NOT pre-fill the figure or the treatment — restating them is the ratifier’s act', () => {
    renderValue();
    expect(screen.getByTestId('wo-value-input')).toHaveValue('');
    expect(screen.getByTestId('wo-value-tax-treatment')).toHaveValue('');
    expect(screen.getByTestId('wo-value-tax-amount')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Set value' })).toBeDisabled();
  });

  it('writes the value and its basis in ONE call — the basis never travels alone', async () => {
    renderValue();
    await userEvent.type(screen.getByTestId('wo-value-input'), '300000');
    await userEvent.selectOptions(screen.getByTestId('wo-value-tax-treatment'), 'inclusive');
    await userEvent.type(screen.getByTestId('wo-value-tax-amount'), '30000');
    await userEvent.click(screen.getByRole('button', { name: 'Set value' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'wo-1',
      value: 300_000,
      taxTreatment: 'inclusive',
      taxAmount: 30_000,
      taxRate: null,
      taxBaseNumerator: 1,
      taxBaseDenominator: 1,
    });
  });

  it('#953 keeps a rejected Set value save keyboard-reachable in the modal while preserving entered values', async () => {
    onSave.mockRejectedValueOnce(new Error('Could not save'));
    render(
      <WorkOrderValueModal
        workOrder={draft()}
        currentValueText="$250,000 excl. PPN"
        currencySymbolPrefix="$"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await userEvent.type(screen.getByTestId('wo-value-input'), '300000');
    await userEvent.selectOptions(screen.getByTestId('wo-value-tax-treatment'), 'inclusive');
    await userEvent.type(screen.getByTestId('wo-value-tax-amount'), '30000');
    await userEvent.click(screen.getByRole('button', { name: 'Set value' }));

    const dialog = screen.getByRole('dialog');
    const saveError = await screen.findByTestId('entity-modal-save-error');
    expect(dialog).toContainElement(saveError);
    await waitFor(() => expect(saveError).toHaveFocus());
    // NumberField applies the active en-US grouping mask; the typed digits remain
    // intact semantically, while the controlled display is formatted for reading.
    expect(screen.getByTestId('wo-value-input')).toHaveValue('300,000');
    expect(screen.getByTestId('wo-value-tax-treatment')).toHaveValue('inclusive');
    expect(screen.getByTestId('wo-value-tax-amount')).toHaveValue('30,000');
    expect(onSave).toHaveBeenCalledWith({
      id: 'wo-1',
      value: 300_000,
      taxTreatment: 'inclusive',
      taxAmount: 30_000,
      taxRate: null,
      taxBaseNumerator: 1,
      taxBaseDenominator: 1,
    });
  });

  it('will not submit a value whose basis is unstated', async () => {
    renderValue();
    await userEvent.type(screen.getByTestId('wo-value-input'), '300000');
    await userEvent.type(screen.getByTestId('wo-value-tax-amount'), '30000');
    expect(screen.getByRole('button', { name: 'Set value' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: rejects an en-US witnessed value with excess precision before the SoD write', async () => {
    setActiveLocale(EN_LOCALE);
    renderValue();
    await userEvent.type(screen.getByTestId('wo-value-input'), '1.234');
    await userEvent.selectOptions(screen.getByTestId('wo-value-tax-treatment'), 'exclusive');
    await userEvent.type(screen.getByTestId('wo-value-tax-amount'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Set value' }));

    expect(await screen.findByText(/non-negative amount with no more than 2 decimal places/i, {
      selector: 'span[role="alert"]',
    })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: parses id-ID witnessed value grouping as 1234 before the SoD write', async () => {
    setActiveLocale(ID_LOCALE);
    renderValue();
    await userEvent.type(screen.getByTestId('wo-value-input'), '1.234');
    await userEvent.selectOptions(screen.getByTestId('wo-value-tax-treatment'), 'exclusive');
    await userEvent.type(screen.getByTestId('wo-value-tax-amount'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Set value' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: 1234, taxAmount: 0 }));
  });
});
