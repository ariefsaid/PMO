import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { LineItemsSection } from './LineItemsSection';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';
import enProcurement from '@/public/locales/en/procurement.json';
import idProcurement from '@/public/locales/id/procurement.json';

const items: ProcurementItemRow[] = [
  {
    id: 'it1',
    org_id: 'org-1',
    procurement_id: 'pr1',
    name: 'MIG welding wire',
    description: null,
    quantity: 24,
    rate: 86,
    amount: 2064,
    erp_docstatus: null,
    erp_line_amount: null,
    erp_modified: null,
  },
];

function renderSection(props: Partial<React.ComponentProps<typeof LineItemsSection>> = {}) {
  const onAdd = props.onAdd ?? vi.fn().mockResolvedValue(undefined);
  const onUpdate = props.onUpdate ?? vi.fn().mockResolvedValue(undefined);
  const onDelete = props.onDelete ?? vi.fn().mockResolvedValue(undefined);
  const onError = props.onError ?? vi.fn();
  render(
    <ToastProvider>
      <LineItemsSection
        items={props.items ?? items}
        editable={props.editable ?? true}
        valuesEditable={props.valuesEditable}
        createFormLayout={props.createFormLayout}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onError={onError}
        currency={props.currency ?? 'USD'}
        currencyKnown={props.currencyKnown}
        erpItems={catalog.connected ? { loadOptions: async () => [{ value: 'ITEM-TEST', label: 'ITEM-TEST', sub: 'Test service' }] } : undefined}
      />
    </ToastProvider>,
  );
  return { onAdd, onUpdate, onDelete, onError };
}

const catalog = vi.hoisted(() => ({ connected: false }));
beforeEach(() => { vi.clearAllMocks(); catalog.connected = false; });
afterEach(() => vi.unstubAllGlobals());

function renderAddFlow(createFormLayout: boolean) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const AddedItemFlow: React.FC = () => {
    const [currentItems, setCurrentItems] = React.useState<ProcurementItemRow[]>([]);
    return (
      <ToastProvider>
        <LineItemsSection
          items={currentItems}
          editable
          createFormLayout={createFormLayout}
          onAdd={async (input) => {
            await onAdd(input);
            setCurrentItems([{
              id: 'added-item', org_id: 'org-1', procurement_id: 'pr1',
              name: input.name, description: input.description ?? null,
              quantity: input.quantity, rate: input.rate, amount: input.quantity * input.rate,
              erp_docstatus: null, erp_line_amount: null, erp_modified: null,
            }]);
          }}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onError={vi.fn()}
          currency="USD"
        />
      </ToastProvider>
    );
  };
  render(<AddedItemFlow />);
  return onAdd;
}

describe('AC-PROC-003 LineItemsSection (editable line-items table)', () => {
  it('AC-ITM-001/002 purchase authoring picks ERP code and persists separate description', async () => {
    catalog.connected = true;
    const user = userEvent.setup();
    const { onAdd } = renderSection({ items: [] });
    await user.click(screen.getByRole('combobox', { name: 'ERP item' }));
    await user.type(await screen.findByRole('combobox', { name: /^(search|cari) /i }), 'Test service');
    await user.click(await screen.findByRole('option', { name: /ITEM-TEST/ }));
    await user.type(screen.getByLabelText('New item description'), 'Inspection of test unit');
    await user.type(screen.getByLabelText('New item quantity'), '2');
    await user.type(screen.getByLabelText('New item unit price'), '10');
    await user.click(screen.getByRole('button', { name: /add line item/i }));
    expect(onAdd).toHaveBeenCalledWith({ name: 'ITEM-TEST', description: 'Inspection of test unit', quantity: 2, rate: 10 });
  });
  it('saves a label without resending protected values', async () => {
    const { onUpdate } = renderSection({ valuesEditable: false });
    await userEvent.click(screen.getByRole('button', { name: /edit MIG welding wire/i }));
    expect(screen.getByLabelText(/edit quantity for MIG welding wire/i)).toBeDisabled();
    expect(screen.getByLabelText(/edit unit price for MIG welding wire/i)).toBeDisabled();
    const label = screen.getByLabelText(/edit description for MIG welding wire/i);
    await userEvent.clear(label);
    await userEvent.type(label, 'Wire');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onUpdate).toHaveBeenCalledWith('it1', { name: 'Wire' });
  });

  it('renders the item search placeholder in Indonesian when the UI language is Indonesian', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'id',
      fallbackLng: 'en',
      defaultNS: 'procurement',
      resources: { en: { procurement: enProcurement }, id: { procurement: idProcurement } },
      interpolation: { escapeValue: false },
      initImmediate: false,
      react: { useSuspense: false },
    });
    catalog.connected = true;
    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <LineItemsSection items={[]} editable onAdd={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onError={vi.fn()} currency="IDR" erpItems={{ loadOptions: async () => [] }} />
        </ToastProvider>
      </I18nextProvider>,
    );
    expect(screen.getByText('Belum ada item permintaan. Tambahkan di bawah.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Item ERP' }));
    expect(await screen.findByPlaceholderText('Cari kode atau nama item…')).toBeInTheDocument();
  });

  it('AC-PROC-003: renders rows with a derived line total + footer total (tabular)', () => {
    renderSection();
    expect(screen.getByText('MIG welding wire')).toBeInTheDocument();
    // Line total + footer total both render the formatted amount (USD, no fraction digits).
    expect(screen.getAllByText(/\$2,064/).length).toBeGreaterThanOrEqual(1);
    const table = screen.getByRole('table', { name: 'Line items' });
    expect(table).toHaveTextContent('Estimated total');
  });

  it('AC-MONEY-DISPLAY: keeps read-only unit price, line total and estimate exact to cents', () => {
    renderSection({ items: [{ ...items[0], quantity: 2, rate: 1032.25, amount: 2064.5 }] });
    expect(screen.getByText('$1,032.25')).toBeInTheDocument();
    expect(screen.getAllByText('$2,064.50').length).toBeGreaterThanOrEqual(2);
  });

  it('P1 keeps cents in the create add-row total for a fractional unit price', async () => {
    renderSection({ items: [], createFormLayout: true });
    await userEvent.type(screen.getByLabelText('New item description'), 'Clip');
    await userEvent.type(screen.getByLabelText('New item quantity'), '2');
    await userEvent.type(screen.getByLabelText('New item unit price'), '15.25');

    expect(screen.getByLabelText('New line total')).toHaveTextContent('$30.50');
  });

  it.each([true, false])('F2 keeps cents in the saved line and estimate after Add (create form: %s)', async (createFormLayout) => {
    vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
      matches: false, media, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    const onAdd = renderAddFlow(createFormLayout);
    await userEvent.type(screen.getByLabelText('New item description'), 'Clip');
    await userEvent.type(screen.getByLabelText('New item quantity'), '2');
    await userEvent.type(screen.getByLabelText('New item unit price'), '15.25');
    await userEvent.click(screen.getByRole('button', { name: /add line item/i }));

    expect(onAdd).toHaveBeenCalledWith({ name: 'Clip', quantity: 2, rate: 15.25 });
    expect(await screen.findByText('$15.25')).toBeInTheDocument();
    expect(screen.getAllByText('$30.50').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('group', { name: 'Estimated total' })).toHaveTextContent('$30.50');
  });

  it('FR-L10N-020: rows and the footer total render in the PROCUREMENT currency, not USD', () => {
    renderSection({ currency: 'EUR' });
    expect(screen.getAllByText(/€2,064/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/\$2,064/)).not.toBeInTheDocument();
  });

  it('C5: known amounts stay unknown until the organisation currency is resolved', () => {
    renderSection({ currencyKnown: false });
    expect(screen.getAllByText('Unknown')).toHaveLength(3);
    expect(screen.queryByText(/\$2,064/)).not.toBeInTheDocument();
  });

  it('AC-PROC-003: empty line totals remain unknown instead of displaying zero', () => {
    renderSection({ items: [] });
    expect(screen.getByText(/No line items yet/i)).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('AC-PROC-003: a read-only empty section does not invite unavailable editing', () => {
    renderSection({ items: [], editable: false });
    expect(screen.getByText('No line items yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Add one below/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-item-add-row')).not.toBeInTheDocument();
  });

  it('AC-PROC-003: derives exact line and section totals while displaying cents', () => {
    renderSection({ items: [{ ...items[0], quantity: 3, rate: 0.1, amount: 0.3 }] });
    expect(screen.getAllByText('$0.30').length).toBeGreaterThanOrEqual(2);
  });

  it('AC-PROC-003: the inline add-row preserves draft cents while creating an item from parsed qty × rate', async () => {
    const { onAdd } = renderSection({ items: [] });
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Shielding gas');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '6');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '142.51');
    expect(within(row).getByLabelText('New line total')).toHaveTextContent('$855.06');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(onAdd).toHaveBeenCalledWith({ name: 'Shielding gas', quantity: 6, rate: 142.51 });
  });

  it('AC-PROC-003: Add is disabled until a description is entered', () => {
    renderSection({ items: [] });
    const row = screen.getByTestId('line-item-add-row');
    expect(within(row).getByRole('button', { name: /add line item/i })).toBeDisabled();
  });

  it('adds the first line from the in-table row with keyboard navigation', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderSection({ items: [], createFormLayout: true });
    const table = screen.getByRole('table', { name: 'Line items' });
    const description = screen.getByLabelText('New item description');

    for (let tabCount = 0; tabCount < 24 && document.activeElement !== description; tabCount += 1) {
      await user.tab();
    }
    expect(description).toHaveFocus();
    await user.keyboard('Shielding gas');
    await user.tab();
    await user.keyboard('6');
    await user.tab();
    await user.keyboard('142.51');
    await user.tab();
    const addButton = within(table).getByRole('button', { name: /add line item/i });
    expect(addButton).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onAdd).toHaveBeenCalledWith({ name: 'Shielding gas', quantity: 6, rate: 142.51 });
    expect(screen.queryByText(/No line items yet/i)).not.toBeInTheDocument();
  });

  it('C1(d) adds the in-table line when Enter is pressed from an input', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderSection({ items: [], createFormLayout: true });
    await user.type(screen.getByLabelText('New item description'), 'Cable ties');
    await user.type(screen.getByLabelText('New item quantity'), '3');
    const unitPrice = screen.getByLabelText('New item unit price');
    await user.type(unitPrice, '1.25');
    await user.keyboard('{Enter}');

    expect(onAdd).toHaveBeenCalledWith({ name: 'Cable ties', quantity: 3, rate: 1.25 });
  });

  it('keeps unknown quantity and price blank and shows the resolved currency prefix', () => {
    renderSection({ items: [], createFormLayout: true, currency: 'IDR' });
    const quantity = screen.getByLabelText('New item quantity');
    const rate = screen.getByLabelText('New item unit price');
    expect(quantity).toHaveValue('');
    expect(quantity).toHaveAttribute('placeholder', 'Qty');
    expect(rate).toHaveValue('');
    expect(rate).toHaveAttribute('placeholder', 'Unit price');
    expect(rate.parentElement).toHaveTextContent('IDR');
  });

  it('does not show a currency prefix before the organisation currency resolves', () => {
    renderSection({ items: [], createFormLayout: true, currency: 'USD', currencyKnown: false });
    const rate = screen.getByLabelText('New item unit price');
    expect(rate.parentElement).not.toHaveTextContent('USD');
    expect(rate.parentElement).not.toHaveTextContent('$');
  });

  it('keeps an accessible name for row actions and omits the formula caption in the create layout', () => {
    renderSection({ items: [], createFormLayout: true });
    expect(screen.getByRole('columnheader', { name: 'Row actions' })).toBeInTheDocument();
    expect(screen.queryByText('qty × unit price → line total')).not.toBeInTheDocument();
  });

  it('AC-PROC-003: Edit flips the row to inputs and Save delegates the patch', async () => {
    const { onUpdate } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: /edit mig welding wire/i }));
    const qty = screen.getByLabelText(/edit quantity for mig welding wire/i);
    await userEvent.clear(qty);
    await userEvent.type(qty, '30');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onUpdate).toHaveBeenCalledWith('it1', { name: 'MIG welding wire', quantity: 30, rate: 86 });
  });

  it('AC-PROC-003: Remove opens a destructive confirm, then delegates the delete', async () => {
    const { onDelete } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: /remove mig welding wire/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('This removes the line item from procurement. You can add it again while the procurement is a draft.');
    await userEvent.click(within(dialog).getByRole('button', { name: /remove item/i }));
    expect(onDelete).toHaveBeenCalledWith('it1');
  });

  it('F2-17 keeps a persisted row update refusal beside the edited row for retry', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: '42501' }))
      .mockResolvedValueOnce(undefined);
    const { onError } = renderSection({ onUpdate });
    await user.click(screen.getByRole('button', { name: /edit MIG welding wire/i }));
    const quantity = screen.getByLabelText(/edit quantity for MIG welding wire/i);
    await user.clear(quantity);
    await user.type(quantity, '30');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const rowError = await within(screen.getByTestId('line-items-section')).findByText(/You don't have permission to do that/);
    expect(rowError.closest('[role="alert"]')).not.toBeNull();
    expect(quantity).toHaveValue('30');
    expect(onError).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText(/edit quantity for MIG welding wire/i)).not.toBeInTheDocument();
  });

  it('F2-17 keeps a refused new line draft and its classified error in the add row', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: '42501' }))
      .mockResolvedValueOnce(undefined);
    const { onError } = renderSection({ items: [], onAdd });
    const row = screen.getByTestId('line-item-add-row');
    await user.type(within(row).getByLabelText(/new item description/i), 'Shielding gas');
    await user.type(within(row).getByLabelText(/new item quantity/i), '6');
    await user.type(within(row).getByLabelText(/new item unit price/i), '10');
    await user.click(within(row).getByRole('button', { name: /add line item/i }));

    const addError = await within(screen.getByTestId('line-items-section')).findByText(/You don't have permission to do that/);
    expect(addError.closest('[role="alert"]')).not.toBeNull();
    expect(within(row).getByLabelText(/new item description/i)).toHaveValue('Shielding gas');
    expect(within(row).getByLabelText(/new item quantity/i)).toHaveValue('6');
    expect(onError).toHaveBeenCalledTimes(1);

    await user.click(within(row).getByRole('button', { name: /add line item/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
  });

  it('F2-17 keeps a refused line delete confirmation open with an error inside', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: '42501' }))
      .mockResolvedValueOnce(undefined);
    renderSection({ onDelete });
    await user.click(screen.getByRole('button', { name: /remove MIG welding wire/i }));
    let dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /remove item/i }));

    dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent("You don't have permission to do that.");
    await user.click(within(dialog).getByRole('button', { name: /remove item/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('AC-PROC-003: read-only mode shows static rows with NO add/edit/delete chrome', () => {
    renderSection({ editable: false });
    expect(screen.getByText('MIG welding wire')).toBeInTheDocument();
    expect(screen.queryByTestId('line-item-add-row')).toBeNull();
    expect(screen.queryByRole('button', { name: /edit mig welding wire/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove mig welding wire/i })).toBeNull();
  });
});
