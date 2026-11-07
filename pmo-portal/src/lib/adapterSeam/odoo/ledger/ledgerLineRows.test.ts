import { describe, expect, it } from 'vitest';
import { fanOutLine, parseDistributionKey, type LedgerLine, type ProjectAccounts } from './ledgerLineRows.ts';

const accounts: ProjectAccounts = new Map([['101', ['p1']], ['102', ['p2']], ['300', ['p3', 'p4']]]);
const line = (over: Partial<LedgerLine> = {}): LedgerLine => ({
  id: 7, moveName: 'BILL/2026/0001', journal: 'Vendor Bills', date: '2026-02-10', account: '5100', partner: 'Acme',
  debit: '1000.01', credit: '0', parentState: 'posted', distribution: { '101': 60, '102': 40 }, foreignCurrency: false,
  writeDate: '2026-02-10 08:00:00', ...over,
});
const sum = (rows: Array<{ debit: string; credit: string }>, k: 'debit' | 'credit') =>
  rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0);

describe('AC-ODA-001 fanOutLine', () => {
  it('splits 1,000.01 by 60/40: 600.01 + 400.00, rows sum to the line', () => {
    const rows = fanOutLine(line(), accounts);
    expect(rows.map((r) => [r.project, r.debit])).toEqual([['101', '600.01'], ['102', '400.00']]);
    expect(rows.map((r) => r.erp_name)).toEqual(['odoo:7:101', 'odoo:7:102']);
    expect(sum(rows, 'debit')).toBe(100001);
  });

  it('a distribution summing to 80 leaves a 20% unattributed row', () => {
    const rows = fanOutLine(line({ distribution: { '101': 50, '102': 30 } }), accounts);
    expect(rows.map((r) => [r.project, r.debit])).toEqual([['101', '500.01'], ['102', '300.00'], [null, '200.00']]);
    expect(rows[2].erp_name).toBe('odoo:7:-');
  });

  it('no distribution gives one unattributed row with the whole line', () => {
    for (const distribution of [null, false as const, {}]) {
      const rows = fanOutLine(line({ distribution }), accounts);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ project: null, debit: '1000.01', credit: '0.00', erp_name: 'odoo:7:-' });
    }
  });

  it('a credit line splits the credit column and stays exact', () => {
    const rows = fanOutLine(line({ debit: '0', credit: '1000.01' }), accounts);
    expect(rows.map((r) => [r.debit, r.credit])).toEqual([['0.00', '600.01'], ['0.00', '400.00']]);
  });

  it('a negative amount rounds away from zero and still sums to the line', () => {
    const rows = fanOutLine(line({ debit: '-1000.01' }), accounts);
    expect(rows.map((r) => r.debit)).toEqual(['-600.01', '-400.00']);
  });

  it('thirds sum to the line (the last share absorbs the remainder)', () => {
    const three: ProjectAccounts = new Map([['1', ['a']], ['2', ['b']], ['3', ['c']]]);
    const rows = fanOutLine(line({ debit: '100.00', distribution: { '1': 33.333, '2': 33.333, '3': 33.334 } }), three);
    expect(sum(rows, 'debit')).toBe(10000);
  });

  it('a share on an account no project links lands in the unattributed row', () => {
    const rows = fanOutLine(line({ distribution: { '101': 60, '999': 40 } }), accounts);
    expect(rows.map((r) => [r.project, r.debit])).toEqual([['101', '600.01'], [null, '400.00']]);
  });

  it('a distribution over 100 is not trusted: whole line unattributed', () => {
    const rows = fanOutLine(line({ distribution: { '101': 70, '102': 70 } }), accounts);
    expect(rows.map((r) => [r.project, r.debit])).toEqual([[null, '1000.01']]);
  });

  it('keeps the trace fields on every row', () => {
    const [row] = fanOutLine(line({ distribution: null }), accounts);
    expect(row).toMatchObject({
      voucher_type: 'account.move', voucher_no: 'BILL/2026/0001', account: '5100', posting_date: '2026-02-10',
      journal: 'Vendor Bills', partner: 'Acme', source_write_date: '2026-02-10 08:00:00', is_cancelled: false,
    });
  });
});

describe('AC-ODA-002 parseDistributionKey', () => {
  it('single id attributes to its project account', () => expect(parseDistributionKey('101', accounts)).toBe('101'));
  it('a combination across plans attributes to the project-plan account', () => {
    expect(parseDistributionKey('101,205', accounts)).toBe('101');
    expect(parseDistributionKey('205,101', accounts)).toBe('101');
  });
  it('an account two PMO projects claim is unattributed', () => expect(parseDistributionKey('300', accounts)).toBeNull());
  it('two project accounts in one key is unattributed', () => expect(parseDistributionKey('101,102', accounts)).toBeNull());
  it('an unknown or malformed key is unattributed', () => {
    for (const k of ['999', '', 'abc', '101,,']) expect(parseDistributionKey(k, accounts)).toBeNull();
  });
});

describe('AC-ODA-002 posting state and currency', () => {
  it.each(['draft', 'cancel'])('parent_state %s marks every row cancelled so no sum counts it', (parentState) => {
    const rows = fanOutLine(line({ parentState }), accounts);
    expect(rows.every((r) => r.is_cancelled)).toBe(true);
    expect(sum(rows, 'debit')).toBe(100001);
  });

  it('a foreign-currency line is flagged, not converted (OQ-ODA-5)', () => {
    expect(fanOutLine(line({ foreignCurrency: true }), accounts).every((r) => r.foreign_currency)).toBe(true);
    expect(fanOutLine(line(), accounts).every((r) => !r.foreign_currency)).toBe(true);
  });
});
