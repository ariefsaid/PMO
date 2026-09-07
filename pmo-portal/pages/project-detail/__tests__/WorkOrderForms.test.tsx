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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import WorkOrderFormModal from '../WorkOrderFormModal';
import WorkOrderValueModal from '../WorkOrderValueModal';

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
  onCreate.mockReset().mockResolvedValue(undefined);
  onUpdate.mockReset().mockResolvedValue(undefined);
  onSave.mockReset().mockResolvedValue(undefined);
});

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
      orderDate: null,
      startDate: null,
      endDate: null,
    });
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
        onError={vi.fn()}
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
    });
  });

  it('will not submit a value whose basis is unstated', async () => {
    renderValue();
    await userEvent.type(screen.getByTestId('wo-value-input'), '300000');
    await userEvent.type(screen.getByTestId('wo-value-tax-amount'), '30000');
    expect(screen.getByRole('button', { name: 'Set value' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
