import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  conn: { data: undefined as unknown }, owned: { data: [] as Array<{ externalTier: string; domain: string }> },
  proposal: { data: undefined as unknown }, sends: { data: undefined as boolean | undefined }, save: vi.fn(), can: { setValue: true, manage: true },
  accounts: { data: { rows: [{ external_id: '210', name: 'Advance Liability', code: '210', attrs: {} }, { external_id: '88', name: 'Tax Prepayments', code: '1350', attrs: {} }], total: 2 }, isError: false },
  accountSummary: { data: { inactive: 0, tombstoned: 0, asOf: new Date().toISOString() } },
}));
vi.mock('@/src/hooks/useOdoo', () => ({
  useOdooConnection: () => h.conn,
  useOdooJournalProposal: () => h.proposal,
  useOdooSendsFinished: () => h.sends,
  useOdooSetup: () => ({ mutateAsync: h.save, isPending: false }),
  useMasterRecords: () => h.accounts,
  useMasterSummary: () => h.accountSummary,
}));
vi.mock('./useOdooCan', () => ({ useOdooCan: () => h.can }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => h.owned }));

import { KIND_SPECS } from '@/src/lib/adapterSeam/odoo/kinds';
import { OdooSetupChecklist } from './OdooSetupChecklist';

afterEach(cleanup);
const WH = KIND_SPECS.warehouse.model;
const TAX = KIND_SPECS.tax.model;
const read = (config: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ status: 'active', activated: true, capabilities: { missing: [] }, config, connection: null, ...over });
const item = (name: string) => screen.getByRole('listitem', { name });
const doneOf = (name: string) => within(item(name)).queryByText('Done') !== null;

it('FR-ODC-110 an Odoo org lists the Odoo steps and none of ERPNext\'s activity-type or budget-category items', () => {
  h.conn.data = read({});
  render(<OdooSetupChecklist />);
  const names = screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
  expect(names).toEqual(['Odoo connected', 'Company chosen', 'Odoo apps available', 'Map once', 'Payment journal', 'Customer-advance account', 'Tax-prepaid account', 'Sends finished', 'Vendors and clients managed in Odoo']);
  expect(screen.queryByText(/activity type/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/budget categor/i)).not.toBeInTheDocument();
});

it('FR-ODC-110 each step is done only when its own fact holds', () => {
  h.conn.data = read({ account_defaults: { payable: 1 }, unit_map: { m: 2 }, default_warehouse_id: 3 }, { capabilities: { missing: [WH] } });
  h.owned.data = [];
  h.sends.data = true;
  render(<OdooSetupChecklist />);
  expect(['Odoo connected', 'Company chosen', 'Map once', 'Sends finished'].map(doneOf)).toEqual([true, true, true, true]);
  expect(doneOf('Odoo apps available')).toBe(false);
  expect(doneOf('Vendors and clients managed in Odoo')).toBe(false);
  cleanup();
  h.owned.data = [{ externalTier: 'odoo', domain: 'companies' }];
  render(<OdooSetupChecklist />);
  expect(doneOf('Vendors and clients managed in Odoo')).toBe(true);
});

it('FR-ODC-110 the sends step follows the send state, so a stored marker alone does not make it Done', () => {
  h.owned.data = [];
  h.conn.data = read({ sends_finished_at: '2026-11-01' });
  h.sends.data = false;
  render(<OdooSetupChecklist />);
  expect(doneOf('Sends finished')).toBe(false);
  cleanup();
  h.conn.data = read({});
  h.sends.data = true;
  render(<OdooSetupChecklist />);
  expect(doneOf('Sends finished')).toBe(true);
});

it('FR-ODC-113 Finance (may set values, may not manage) is not shown the Admin-only sends step', () => {
  h.conn.data = read({});
  h.owned.data = [];
  h.can.manage = false;
  try {
    render(<OdooSetupChecklist />);
    expect(screen.queryByRole('listitem', { name: 'Sends finished' })).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Payment journal' })).toBeInTheDocument();
  } finally { h.can.manage = true; }
});

it('FR-ODC-110 an org that is connected but not activated has only the first step done', () => {
  h.conn.data = read({}, { activated: false, capabilities: null });
  h.owned.data = [];
  render(<OdooSetupChecklist />);
  expect(doneOf('Odoo connected')).toBe(true);
  expect(doneOf('Company chosen')).toBe(false);
  expect(doneOf('Odoo apps available')).toBe(false);
  expect(doneOf('Map once')).toBe(false);
});

it('FR-ODC-110 the missing apps are named on the capability step', () => {
  h.conn.data = read({}, { capabilities: { missing: [WH, TAX] } });
  render(<OdooSetupChecklist />);
  expect(within(item('Odoo apps available')).getByText(`Missing: ${WH}, ${TAX}`)).toBeInTheDocument();
});

it('FR-ODC-110 ERPNext owning companies does not complete the Odoo employ step, and a partial map is not "mapped"', () => {
  h.conn.data = read({ account_defaults: { payable: 1 } });
  h.owned.data = [{ externalTier: 'erpnext', domain: 'companies' }];
  render(<OdooSetupChecklist />);
  expect(doneOf('Vendors and clients managed in Odoo')).toBe(false);
  expect(doneOf('Map once')).toBe(false);
});

describe('AC-OPP-081 / P8-T5 the payment journal default', () => {
  const cands = [{ id: '9', code: 'BNK1', name: 'Bank BCA' }, { id: '4', code: 'CSH', name: 'Petty cash' }];
  beforeEach(() => { h.save.mockReset(); h.can.setValue = true; h.proposal.data = undefined; h.owned.data = []; });

  it('is done when the binding holds a default journal, and names it when the proposal read can', () => {
    h.conn.data = read({ default_payment_journal_id: 9 });
    h.proposal.data = { journal: { state: 'set', current: cands[0], candidates: cands } };
    render(<OdooSetupChecklist />);
    expect(doneOf('Payment journal')).toBe(true);
    expect(within(item('Payment journal')).getByText('Bank BCA')).toBeInTheDocument();
  });

  it('with one bank journal Odoo proposes it, and one click accepts it', async () => {
    h.conn.data = read({});
    h.proposal.data = { journal: { state: 'proposed', proposed: cands[0], candidates: cands, current: null } };
    h.save.mockResolvedValue({ saved: true });
    render(<OdooSetupChecklist />);
    expect(doneOf('Payment journal')).toBe(false);
    expect(within(item('Payment journal')).getByText('Proposed: Bank BCA')).toBeInTheDocument();
    await userEvent.click(within(item('Payment journal')).getByRole('button', { name: 'Accept Bank BCA' }));
    expect(h.save).toHaveBeenCalledWith({ default_payment_journal_id: '9' });
  });

  it('with several journals the user chooses one before saving', async () => {
    h.conn.data = read({});
    h.proposal.data = { journal: { state: 'choose', candidates: cands, current: null } };
    h.save.mockResolvedValue({ saved: true });
    render(<OdooSetupChecklist />);
    const row = item('Payment journal');
    expect(within(row).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.selectOptions(within(row).getByRole('combobox', { name: 'Payment journal' }), '4');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(h.save).toHaveBeenCalledWith({ default_payment_journal_id: '4' });
  });

  it('a save Odoo or the database refuses says so instead of doing nothing', async () => {
    h.conn.data = read({});
    h.proposal.data = { journal: { state: 'proposed', proposed: cands[0], candidates: cands, current: null } };
    h.save.mockRejectedValueOnce(new Error('nope'));
    render(<OdooSetupChecklist />);
    await userEvent.click(within(item('Payment journal')).getByRole('button', { name: 'Accept Bank BCA' }));
    expect(await within(item('Payment journal')).findByRole('alert')).toHaveTextContent('The journal could not be saved. Try again.');
  });

  it('with no bank or cash journal read it says so and offers nothing', () => {
    h.conn.data = read({});
    h.proposal.data = { journal: { state: 'none', candidates: [], current: null } };
    render(<OdooSetupChecklist />);
    expect(within(item('Payment journal')).getByText('No bank or cash journal has been read from Odoo yet.')).toBeInTheDocument();
    expect(within(item('Payment journal')).queryByRole('button')).toBeNull();
  });

  it('a role that may not set values sees the state but no control', () => {
    h.can.setValue = false;
    h.conn.data = read({});
    h.proposal.data = { journal: { state: 'proposed', proposed: cands[0], candidates: cands, current: null } };
    render(<OdooSetupChecklist />);
    expect(within(item('Payment journal')).queryByRole('button')).toBeNull();
  });
});

it('AC-OCI-091 saves the account defaults using the mirror ids', async () => {
  h.can.setValue = true;
  h.conn.data = read({});
  h.proposal.data = { journal: { state: 'none', candidates: [], current: null } };
  h.save.mockResolvedValue({ saved: true });
  render(<OdooSetupChecklist />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Customer-advance account' }), '210');
  await userEvent.click(within(item('Customer-advance account')).getByRole('button', { name: 'Save' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tax-prepaid account' }), '88');
  await userEvent.click(within(item('Tax-prepaid account')).getByRole('button', { name: 'Save' }));
  expect(h.save).toHaveBeenNthCalledWith(1, { customer_advance_account_ref: 'account.account:210' });
  expect(h.save).toHaveBeenNthCalledWith(2, { tax_prepaid_account_id: '88' });
});
