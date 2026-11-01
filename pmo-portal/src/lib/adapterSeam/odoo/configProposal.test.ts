import { describe, expect, it } from 'vitest';
import { proposeOdooConfig, type ConfigMaster } from './configProposal';

const acct = (id: string, type: string, over: Partial<ConfigMaster> = {}): ConfigMaster => ({ external_id: id, name: `Account ${id}`, active: true, tombstoned_at: null, attrs: { account_type: type }, ...over });
const named = (id: string, name: string, over: Partial<ConfigMaster> = {}): ConfigMaster => ({ external_id: id, name, active: true, tombstoned_at: null, attrs: {}, ...over });
const find = (p: ReturnType<typeof proposeOdooConfig>, key: string) => p.find((x) => x.key === key)!;

const ACCOUNTS = [acct('1', 'liability_payable'), acct('2', 'asset_receivable'), acct('3', 'expense'), acct('4', 'asset_cash'), acct('5', 'asset_cash'), acct('6', 'asset_current'), acct('7', 'expense_direct_cost')];

describe('AC-ODC-096 proposeOdooConfig', () => {
  it('proposes the only active account of a type, and asks to choose when two fit', () => {
    const p = proposeOdooConfig({ accounts: ACCOUNTS, uoms: [], warehouses: [], pmoUnits: [] });
    expect(find(p, 'account_defaults.payable')).toEqual({ key: 'account_defaults.payable', value: '1', reason: 'unique' });
    expect(find(p, 'account_defaults.receivable')).toEqual({ key: 'account_defaults.receivable', value: '2', reason: 'unique' });
    expect(find(p, 'account_defaults.bank')).toEqual({ key: 'account_defaults.bank', candidates: ['4', '5'], reason: 'choose' });
    expect(find(p, 'account_defaults.cash')).toEqual({ key: 'account_defaults.cash', candidates: ['4', '5'], reason: 'choose' });
    expect(find(p, 'account_defaults.stock_valuation')).toMatchObject({ value: '6', reason: 'unique' });
  });

  it('expense accepts both expense types, so a plan with both asks to choose', () => {
    expect(find(proposeOdooConfig({ accounts: ACCOUNTS, uoms: [], warehouses: [], pmoUnits: [] }), 'account_defaults.expense')).toMatchObject({ reason: 'choose', candidates: ['3', '7'] });
  });

  it('ignores inactive and tombstoned accounts', () => {
    const p = proposeOdooConfig({ accounts: [acct('1', 'liability_payable'), acct('9', 'liability_payable', { active: false }), acct('8', 'liability_payable', { tombstoned_at: '2026-01-01T00:00:00Z' })], uoms: [], warehouses: [], pmoUnits: [] });
    expect(find(p, 'account_defaults.payable')).toMatchObject({ value: '1', reason: 'unique' });
  });

  it('no account of a type yields an empty choose row, not a guess', () => {
    expect(find(proposeOdooConfig({ accounts: [], uoms: [], warehouses: [], pmoUnits: [] }), 'account_defaults.payable')).toEqual({ key: 'account_defaults.payable', candidates: [], reason: 'choose' });
  });

  it('maps a PMO unit to the unit whose normalised name equals it; m2 and m² are not equal', () => {
    const p = proposeOdooConfig({ accounts: [], uoms: [named('5', 'M'), named('6', 'm²'), named('7', 'Unit')], warehouses: [], pmoUnits: ['m', 'm2', ' unit '] });
    expect(find(p, 'unit_map.m')).toEqual({ key: 'unit_map.m', value: '5', reason: 'unique' });
    expect(find(p, 'unit_map.m2')).toEqual({ key: 'unit_map.m2', candidates: [], reason: 'choose' });
    expect(find(p, 'unit_map. unit ')).toMatchObject({ value: '7', reason: 'unique' });
  });

  it('proposes the only active warehouse and asks to choose between two', () => {
    expect(find(proposeOdooConfig({ accounts: [], uoms: [], warehouses: [named('1', 'Main')], pmoUnits: [] }), 'default_warehouse_id')).toEqual({ key: 'default_warehouse_id', value: '1', reason: 'unique' });
    expect(find(proposeOdooConfig({ accounts: [], uoms: [], warehouses: [named('1', 'Main'), named('2', 'Site')], pmoUnits: [] }), 'default_warehouse_id')).toMatchObject({ reason: 'choose', candidates: ['1', '2'] });
  });

  it('is deterministic: same inputs, same output', () => {
    const input = { accounts: ACCOUNTS, uoms: [named('5', 'm')], warehouses: [named('1', 'Main')], pmoUnits: ['m'] };
    expect(proposeOdooConfig(input)).toEqual(proposeOdooConfig(input));
  });
});
