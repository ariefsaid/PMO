import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ conn: { data: undefined as unknown }, owned: { data: [] as Array<{ externalTier: string; domain: string }> } }));
vi.mock('@/src/hooks/useOdoo', () => ({ useOdooConnection: () => h.conn }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => h.owned }));

import { OdooSetupChecklist } from './OdooSetupChecklist';

afterEach(cleanup);
const read = (config: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ status: 'active', activated: true, capabilities: { missing: [] }, config, connection: null, ...over });
const item = (name: string) => screen.getByRole('listitem', { name });
const doneOf = (name: string) => within(item(name)).queryByText('Done') !== null;

it('FR-ODC-110 an Odoo org lists the Odoo steps and none of ERPNext\'s activity-type or budget-category items', () => {
  h.conn.data = read({});
  render(<OdooSetupChecklist />);
  const names = screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
  expect(names).toEqual(['Odoo connected', 'Company chosen', 'Odoo apps available', 'Map once', 'Sends finished', 'Vendors and clients managed in Odoo']);
  expect(screen.queryByText(/activity type/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/budget categor/i)).not.toBeInTheDocument();
});

it('FR-ODC-110 each step is done only when its own fact holds', () => {
  h.conn.data = read({ account_defaults: { payable: 1 }, unit_map: { m: 2 }, default_warehouse_id: 3, sends_finished_at: '2026-11-01' }, { capabilities: { missing: ['stock.warehouse'] } });
  h.owned.data = [];
  render(<OdooSetupChecklist />);
  expect(['Odoo connected', 'Company chosen', 'Map once', 'Sends finished'].map(doneOf)).toEqual([true, true, true, true]);
  expect(doneOf('Odoo apps available')).toBe(false);
  expect(doneOf('Vendors and clients managed in Odoo')).toBe(false);
  cleanup();
  h.owned.data = [{ externalTier: 'odoo', domain: 'companies' }];
  render(<OdooSetupChecklist />);
  expect(doneOf('Vendors and clients managed in Odoo')).toBe(true);
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
  h.conn.data = read({}, { capabilities: { missing: ['stock.warehouse', 'account.tax'] } });
  render(<OdooSetupChecklist />);
  expect(within(item('Odoo apps available')).getByText(/stock\.warehouse, account\.tax/)).toBeInTheDocument();
});

it('FR-ODC-110 ERPNext owning companies does not complete the Odoo employ step, and a partial map is not "mapped"', () => {
  h.conn.data = read({ account_defaults: { payable: 1 } });
  h.owned.data = [{ externalTier: 'erpnext', domain: 'companies' }];
  render(<OdooSetupChecklist />);
  expect(doneOf('Vendors and clients managed in Odoo')).toBe(false);
  expect(doneOf('Map once')).toBe(false);
});
