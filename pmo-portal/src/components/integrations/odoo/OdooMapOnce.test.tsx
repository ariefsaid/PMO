import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  conn: { data: undefined as unknown },
  proposal: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  save: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useOdoo', () => ({
  useOdooConnection: () => h.conn,
  useOdooConfigProposal: () => h.proposal,
  useOdooSetup: () => h.save,
}));
import { OdooMapOnce } from './OdooMapOnce';

const acct = (id: string, name: string, type: string) => ({ id, code: `C${id}`, name, type });
const BASE = () => ({
  proposals: [
    { key: 'account_defaults.payable', value: '1', reason: 'unique' },
    { key: 'account_defaults.receivable', value: '2', reason: 'unique' },
    { key: 'account_defaults.bank', candidates: ['3', '4'], reason: 'choose' },
    { key: 'account_defaults.cash', candidates: ['3', '4'], reason: 'choose' },
    { key: 'account_defaults.expense', value: '7', reason: 'unique' },
    { key: 'account_defaults.stock_valuation', candidates: [], reason: 'choose' },
    { key: 'account_defaults.stock_consumption', candidates: [], reason: 'choose' },
    { key: 'unit_map.m', value: '5', reason: 'unique' },
    { key: 'unit_map.m3', candidates: [], reason: 'choose' },
    { key: 'default_warehouse_id', value: '1', reason: 'unique' },
  ],
  accounts: [acct('1', 'Payable', 'liability_payable'), acct('2', 'Receivable', 'asset_receivable'), acct('3', 'Cash A', 'asset_cash'), acct('4', 'Cash B', 'asset_cash'), acct('7', 'Costs', 'expense'), acct('8', 'Group', 'view')],
  uoms: [{ id: '5', name: 'm' }, { id: '6', name: 'Unit' }],
  warehouses: [{ id: '1', code: 'WH', name: 'Main' }],
  units: [{ unit: 'm', mapped: false }, { unit: 'm3', mapped: false }],
  attention: [] as string[],
  current: { account_defaults: {} as Record<string, string>, unit_map: {} as Record<string, string>, default_warehouse_id: null as string | null },
});
beforeEach(() => {
  vi.clearAllMocks();
  h.conn.data = { status: 'active', activated: true, config: {} };
  h.proposal.data = BASE();
  h.proposal.isPending = false;
  h.proposal.isError = false;
  h.save.mutateAsync.mockResolvedValue({ saved: [] });
});
afterEach(cleanup);

const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLSelectElement;

it('AC-ODC-096 shows the three groups: accounts, units and the warehouse', () => {
  render(<OdooMapOnce />);
  expect(screen.getByRole('group', { name: 'Accounts' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Units' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Warehouse' })).toBeInTheDocument();
});

it('AC-ODC-096 every unique proposal is pre-filled; an undecided row is empty and says "Choose one"', () => {
  render(<OdooMapOnce />);
  expect(field('Payable account').value).toBe('1');
  expect(field('Receivable account').value).toBe('2');
  expect(field('Unit "m"').value).toBe('5');
  expect(field('Default receiving warehouse').value).toBe('1');
  expect(field('Bank account').value).toBe('');
  expect(within(screen.getByRole('group', { name: 'Accounts' })).getAllByText('Choose one').length).toBeGreaterThanOrEqual(2);
});

it('AC-ODC-096 "Accept all" sends once, with every value filled in; undecided rows are left out and block nothing', async () => {
  render(<OdooMapOnce />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
  await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledTimes(1));
  expect(h.save.mutateAsync).toHaveBeenCalledWith({
    account_defaults: { payable: '1', receivable: '2', expense: '7' }, unit_map: { m: '5' }, default_warehouse_id: '1',
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Saved');
});

it('AC-ODC-096 a row picked from the candidates joins the same request', async () => {
  render(<OdooMapOnce />);
  fireEvent.change(field('Bank account'), { target: { value: '4' } });
  fireEvent.change(field('Unit "m3"'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
  await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledTimes(1));
  expect(h.save.mutateAsync).toHaveBeenCalledWith({
    account_defaults: { payable: '1', receivable: '2', bank: '4', expense: '7' }, unit_map: { m: '5', m3: '6' }, default_warehouse_id: '1',
  });
});

it('a bank or cash row offers only its candidates, and never a group or off-balance account', () => {
  const p = BASE();
  p.accounts.push(acct('9', 'Off', 'off_balance'));
  h.proposal.data = p;
  render(<OdooMapOnce />);
  const options = (name: string) => within(field(name)).getAllByRole('option').map((o) => o.textContent);
  expect(options('Bank account')).toEqual(['Choose…', 'C3 Cash A', 'C4 Cash B']);
  for (const label of ['Payable account', 'Expense account', 'Stock valuation account']) {
    expect(options(label).join('|')).not.toMatch(/Group|Off/);
  }
});

it('AC-ODC-041 a unit nobody matched is listed as not matched, and is not a reason to hold back the rest', () => {
  render(<OdooMapOnce />);
  expect(within(screen.getByRole('group', { name: 'Units' })).getByText(/"m3".*not matched/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Accept all' })).toBeEnabled();
});

it('AC-ODC-070 a saved default that is no longer active in Odoo shows "Needs attention" and is not silently kept', async () => {
  const p = BASE();
  p.current = { account_defaults: { payable: '99' }, unit_map: {}, default_warehouse_id: '55' };
  p.attention = ['account_defaults.payable', 'default_warehouse_id'];
  h.proposal.data = p;
  render(<OdooMapOnce />);
  expect(within(screen.getByRole('group', { name: 'Accounts' })).getAllByText(/Needs attention/)).toHaveLength(1);
  expect(within(screen.getByRole('group', { name: 'Warehouse' })).getByText(/Needs attention/)).toBeInTheDocument();
  expect(field('Payable account').value).toBe('1');   // the replacement PMO proposes, to be accepted by a person
});

it('a saved, still-active choice wins over a new proposal and nothing is sent when nothing changed', () => {
  const p = BASE();
  p.current = { account_defaults: { payable: '1', receivable: '2', expense: '7' }, unit_map: { m: '5' }, default_warehouse_id: '1' };
  h.proposal.data = p;
  render(<OdooMapOnce />);
  expect(screen.getByRole('button', { name: 'Accept all' })).toBeDisabled();
});

it('a refusal is explained in plain words and keeps the picks', async () => {
  h.save.mutateAsync.mockRejectedValue(new AppError('x', 'REFUSED'));
  render(<OdooMapOnce />);
  fireEvent.change(field('Bank account'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/no longer available in Odoo/i);
  expect(field('Bank account').value).toBe('3');
});

it('renders nothing before the company is chosen, and a load error offers a retry', () => {
  h.conn.data = { status: 'active', activated: false, config: {} };
  const { container } = render(<OdooMapOnce />);
  expect(container).toBeEmptyDOMElement();
  cleanup();
  h.conn.data = { status: 'active', activated: true, config: {} };
  h.proposal.data = undefined;
  h.proposal.isError = true;
  render(<OdooMapOnce />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(h.proposal.refetch).toHaveBeenCalled();
});

it('AC-ODC-084 the screen has no axe violations', async () => {
  const { container } = render(<OdooMapOnce />);
  expect((await axe(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
});
