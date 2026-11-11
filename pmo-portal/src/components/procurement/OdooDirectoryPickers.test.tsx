/** AC-OPP-081 (FR-OPP-093): taxes and journals come from the mirrored Odoo directories; disabled with a reason when empty or stale. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

const NOW = new Date('2026-11-03T12:00:00Z');
const h = vi.hoisted(() => ({
  records: { data: undefined as { rows: unknown[]; total: number } | undefined, isError: false },
  summary: { data: undefined as { asOf: string | null } | undefined },
  seen: [] as unknown[],
}));
vi.mock('@/src/hooks/useOdoo', () => ({
  useMasterRecords: (input: unknown) => { h.seen.push(input); return h.records; },
  useMasterSummary: () => h.summary,
}));
vi.mock('@/src/lib/format', async (orig) => ({ ...(await orig<typeof import('@/src/lib/format')>()), formatRelativeTime: () => '3 days ago' }));

import { OdooAccountSelect, OdooJournalSelect, OdooTaxPicker } from './OdooDirectoryPickers';

const tax = (id: string, name: string) => ({ external_id: id, name, code: null, attrs: {} });
const journal = (id: string, name: string, type: string) => ({ external_id: id, name, code: null, attrs: { type } });
const FRESH = '2026-11-03T11:00:00Z';

beforeEach(() => { h.seen.length = 0; h.records = { data: undefined, isError: false }; h.summary = { data: undefined }; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('AC-OPP-081 OdooTaxPicker', () => {
  it('asks the purchase taxes of the directory and lists them as checkboxes in one named group', () => {
    h.records = { data: { rows: [tax('7', 'PPN 11%'), tax('12', 'PPh 23')], total: 2 }, isError: false }; h.summary = { data: { asOf: FRESH } };
    render(<OdooTaxPicker value={[]} onChange={vi.fn()} />);
    expect(h.seen[0]).toMatchObject({ kind: 'tax', purpose: 'purchase' });
    const group = screen.getByRole('group', { name: 'Taxes' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'PPN 11%' })).not.toBeChecked();
  });

  it('says what leaving every tax unticked does', () => {
    h.records = { data: { rows: [tax('7', 'PPN 11%')], total: 1 }, isError: false }; h.summary = { data: { asOf: FRESH } };
    render(<OdooTaxPicker value={[]} onChange={vi.fn()} />);
    expect(screen.getByText("Leave all unticked to use your organisation's default taxes.")).toBeInTheDocument();
  });

  it('picking and unpicking reports the chosen ids in order', async () => {
    h.records = { data: { rows: [tax('7', 'PPN 11%'), tax('12', 'PPh 23')], total: 2 }, isError: false }; h.summary = { data: { asOf: FRESH } };
    const onChange = vi.fn();
    const { rerender } = render(<OdooTaxPicker value={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'PPh 23' }));
    expect(onChange).toHaveBeenLastCalledWith(['12']);
    rerender(<OdooTaxPicker value={['12']} onChange={onChange} />);
    expect(screen.getByRole('checkbox', { name: 'PPh 23' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'PPN 11%' }));
    expect(onChange).toHaveBeenLastCalledWith(['12', '7']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'PPh 23' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('an empty directory disables the group and says why', () => {
    h.records = { data: { rows: [], total: 0 }, isError: false }; h.summary = { data: { asOf: null } };
    render(<OdooTaxPicker value={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Taxes' })).toBeDisabled();
    expect(screen.getByText('No taxes have been read from Odoo yet.')).toBeInTheDocument();
  });

  it('a directory last read over a day ago is disabled with its age', () => {
    h.records = { data: { rows: [tax('7', 'PPN 11%')], total: 1 }, isError: false }; h.summary = { data: { asOf: '2026-10-31T11:00:00Z' } };
    render(<OdooTaxPicker value={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'PPN 11%' })).toBeDisabled();
    expect(screen.getByText('The tax list was last read 3 days ago; refresh the Odoo connection first.')).toBeInTheDocument();
  });

  it('has no axe violations, enabled or disabled', async () => {
    h.records = { data: { rows: [tax('7', 'PPN 11%')], total: 1 }, isError: false }; h.summary = { data: { asOf: FRESH } };
    const { container, rerender } = render(<OdooTaxPicker value={['7']} onChange={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
    h.records = { data: { rows: [], total: 0 }, isError: false };
    rerender(<OdooTaxPicker value={[]} onChange={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('AC-OPP-081 OdooJournalSelect', () => {
  it('AC-OCI-091 takes the caller\'s label, so a receipt reads "Received into" and a bill payment reads "Pay from"', () => {
    const { rerender } = render(<OdooJournalSelect value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Pay from' })).toBeInTheDocument();
    rerender(<OdooJournalSelect value="" onChange={vi.fn()} label="Received into" />);
    expect(screen.getByRole('combobox', { name: 'Received into' })).toBeInTheDocument();
  });

  it('offers only bank and cash journals, after the default, and reports the choice', async () => {
    h.records = { data: { rows: [journal('9', 'Bank BCA', 'bank'), journal('3', 'Purchases', 'purchase'), journal('4', 'Petty cash', 'cash')], total: 3 }, isError: false };
    h.summary = { data: { asOf: FRESH } };
    const onChange = vi.fn();
    render(<OdooJournalSelect value="" onChange={onChange} />);
    expect(h.seen[0]).toMatchObject({ kind: 'journal' });
    const select = screen.getByRole('combobox', { name: 'Pay from' });
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Default journal', 'Bank BCA', 'Petty cash']);
    await userEvent.selectOptions(select, '9');
    expect(onChange).toHaveBeenCalledWith('9');
  });

  it('with no journals read it is disabled and says why', () => {
    h.records = { data: { rows: [], total: 0 }, isError: false }; h.summary = { data: { asOf: null } };
    render(<OdooJournalSelect value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Pay from' })).toBeDisabled();
    expect(screen.getByText('No payment journals have been read from Odoo yet.')).toBeInTheDocument();
  });

  it('a stale journal list is disabled with its age', () => {
    h.records = { data: { rows: [journal('9', 'Bank BCA', 'bank')], total: 1 }, isError: false }; h.summary = { data: { asOf: '2026-10-30T00:00:00Z' } };
    render(<OdooJournalSelect value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Pay from' })).toBeDisabled();
    expect(screen.getByText('The journal list was last read 3 days ago; refresh the Odoo connection first.')).toBeInTheDocument();
  });
});

describe('AC-OCI-091 OdooAccountSelect', () => {
  it('offers active mirrored accounts from the directory', async () => {
    h.records = { data: { rows: [{ external_id: '88', name: 'Tax prepayments', code: '1350', attrs: {} }], total: 1 }, isError: false };
    h.summary = { data: { asOf: FRESH } };
    const onChange = vi.fn();
    render(<OdooAccountSelect id="tax-prepaid" label="Tax-prepaid account" value="" onChange={onChange} />);
    expect(h.seen[0]).toMatchObject({ kind: 'account' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tax-prepaid account' }), '88');
    expect(onChange).toHaveBeenCalledWith('88');
  });

  it('is disabled with a clear reason when the account directory is empty or stale', () => {
    h.records = { data: { rows: [], total: 0 }, isError: false }; h.summary = { data: { asOf: null } };
    const { rerender } = render(<OdooAccountSelect id="tax-prepaid" label="Tax-prepaid account" value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Tax-prepaid account' })).toBeDisabled();
    expect(screen.getByText('No accounts have been read from Odoo yet.')).toBeInTheDocument();
    h.records = { data: { rows: [{ external_id: '88', name: 'Tax prepayments', code: '1350', attrs: {} }], total: 1 }, isError: false };
    h.summary = { data: { asOf: '2026-10-30T00:00:00Z' } };
    rerender(<OdooAccountSelect id="tax-prepaid" label="Tax-prepaid account" value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Tax-prepaid account' })).toBeDisabled();
    expect(screen.getByText('The account list was last read 3 days ago; refresh the Odoo connection first.')).toBeInTheDocument();
  });

  it('review: asks for a page big enough for a chart of accounts, not 100 rows', () => {
    h.records = { data: { rows: [], total: 0 }, isError: false };
    render(<OdooAccountSelect id="a" label="Tax-prepaid account" value="" onChange={vi.fn()} />);
    expect(h.seen[0]).toMatchObject({ kind: 'account', pageSize: 500 });
  });

  it('review: a saved account stays visible even when the list does not hold it, instead of reading as not set', () => {
    h.records = { data: { rows: [{ external_id: '88', name: 'Tax prepayments', code: '1350', attrs: {} }], total: 1 }, isError: false };
    h.summary = { data: { asOf: FRESH } };
    render(<OdooAccountSelect id="a" label="Customer-advance account" value="210" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Customer-advance account' })).toHaveDisplayValue('Saved account 210');
  });

  it('review: can hide its visible label (the setup row already names it) and keeps the accessible name', () => {
    h.records = { data: { rows: [], total: 0 }, isError: false };
    render(<OdooAccountSelect id="a" label="Tax-prepaid account" hideLabel value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Tax-prepaid account' })).toBeInTheDocument();
  });
});
