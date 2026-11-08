import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), limit: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: h.rpc, from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: h.limit, order: () => ({ limit: h.limit }) }) }) }) }) }) },
}));

import { AppError } from '@/src/lib/appError';
import {
  getOdooCompanyCurrency, getOdooLedgerHealth, getOdooLedgerLines, getOdooProjectLinked, getOdooStatement, getOdooStatementCatalogue, switchOdooLedgerBasis,
} from './odooLedger';

const PROJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ok = (data: unknown) => h.rpc.mockResolvedValueOnce({ data, error: null });
const fail = (message: string, code: string) => h.rpc.mockResolvedValueOnce({ data: null, error: { message, code } });

beforeEach(() => h.rpc.mockReset());

describe('getOdooLedgerHealth (AC-ODA-009/010)', () => {
  it('sends only the project id (never an org) and returns the parsed health', async () => {
    ok({
      state: 'stale', asOf: '2026-11-07T10:00:00Z', caughtUp: true, lastCensus: null,
      check: { status: 'differs', checkedAt: '2026-11-07T09:00:00Z', accountsChecked: 4, stale: false,
        accounts: [{ account: '5100', pmo: { debit: '100.00', credit: '0.00' }, odoo: { debit: '120.00', credit: '0.00' } }] },
      lastGood: null,
      unmapped: { count: 2, debit: '10.00', credit: '0.00', accounts: ['6100'] },
      unattributed: { count: 1, debit: '5.00', credit: '0.00' }, unlinked: { count: 0, debit: '0.00', credit: '0.00' },
    });
    const health = await getOdooLedgerHealth(PROJECT);
    expect(h.rpc).toHaveBeenCalledWith('get_odoo_ledger_health', { p_project_id: PROJECT });
    expect(health.state).toBe('stale');
    expect(health.check?.status).toBe('differs');
    expect(health.check?.accounts[0]).toEqual({ account: '5100', pmo: { debit: '100.00', credit: '0.00' }, odoo: { debit: '120.00', credit: '0.00' } });
    expect(health.unmapped).toEqual({ count: 2, debit: '10.00', credit: '0.00', accounts: ['6100'] });
  });

  it('keeps people without the reconciliation view on totals: missing check and amounts come back null, not zero', async () => {
    ok({ state: 'fresh', asOf: '2026-11-07T10:00:00Z', caughtUp: true, lastCensus: null, check: null, lastGood: null, unmapped: null, unattributed: null, unlinked: null });
    const health = await getOdooLedgerHealth(PROJECT);
    expect(health.check).toBeNull();
    expect(health.unmapped).toBeNull();
  });

  it('refuses a malformed state instead of guessing', async () => {
    ok({ state: 'weird', asOf: null, caughtUp: false });
    await expect(getOdooLedgerHealth()).rejects.toMatchObject({ code: 'odoo-ledger-invalid-response' });
  });

  it('carries the database code on a refusal', async () => {
    fail('Not permitted', '42501');
    await expect(getOdooLedgerHealth()).rejects.toEqual(expect.objectContaining({ code: '42501' }));
  });
});

describe('getOdooLedgerLines (FR-ODA-051)', () => {
  it('passes the keyset and a bounded page size, and returns the next key', async () => {
    ok({ lines: [{ id: 'l1', date: '2026-10-01', moveName: 'BILL/2026/0001', account: '5100', partner: 'Vendor A', debit: '10.00', credit: '0.00' }], next: 'l1', limit: 50, linked: true });
    const page = await getOdooLedgerLines({ projectId: PROJECT, category: 'materials', after: 'l0', limit: 50 });
    expect(h.rpc).toHaveBeenCalledWith('get_odoo_ledger_lines', { p_project_id: PROJECT, p_category: 'materials', p_after: 'l0', p_limit: 50 });
    expect(page.linked).toBe(true);
    expect(page.next).toBe('l1');
    expect(page.lines[0]).toMatchObject({ moveName: 'BILL/2026/0001', partner: 'Vendor A', debit: '10.00' });
  });

  it('says unlinked, with no lines, when the project has no single linked account', async () => {
    ok({ lines: [], next: null, limit: 50, linked: false });
    const page = await getOdooLedgerLines({ projectId: PROJECT, category: 'materials' });
    expect(page).toMatchObject({ linked: false, lines: [], next: null });
  });
});

describe('statements', () => {
  it('reads the catalogue and the statement with the period as the RPC expects it', async () => {
    ok({ state: 'complete', companyLabel: 'Acme', generation: { asOf: '2026-11-07T10:00:00Z' },
      periods: [{ kind: 'month', currentStart: '2026-10-01', currentEnd: '2026-10-31', priorStart: '2026-09-01', priorEnd: '2026-09-30' }],
      scopes: [{ scopeKind: 'company', projectId: null, statements: ['trial_balance'], viewKinds: ['account_breakdown'] }] });
    const cat = await getOdooStatementCatalogue();
    expect(h.rpc).toHaveBeenCalledWith('get_odoo_statement_catalogue', { p_project_id: null });
    if (cat.state !== 'complete') throw new Error('expected complete');
    expect(cat.periods).toHaveLength(1);

    ok({ state: 'not_in_use' });
    const read = await getOdooStatement({ statement: 'trial_balance', periodKind: 'month', periodStart: '2026-10-01' });
    expect(h.rpc).toHaveBeenLastCalledWith('get_odoo_statement', { p_kind: 'trial_balance', p_period: { kind: 'month', start: '2026-10-01' }, p_project_id: null });
    expect(read.state).toBe('not_in_use');
  });

  it('parses a complete statement with its provenance and the balance flag', async () => {
    ok({ state: 'complete', companyLabel: 'Acme', generation: { asOf: '2026-11-07T10:00:00Z' },
      selection: { periodKind: 'month', periodStart: '2026-10-01', statement: 'balance_sheet', scopeKind: 'company', projectId: null, viewKind: 'account_breakdown' },
      result: { viewKind: 'account_breakdown', period: { kind: 'month', currentStart: '2026-10-01', currentEnd: '2026-10-31', priorStart: '2026-09-01', priorEnd: '2026-09-30' }, hasActivity: true,
        payload: {
          current: { columns: [{ fieldname: 'balance', label: 'Balance', type: 'currency' }], rows: [{ row_kind: 'account', account: '1100', account_name: 'Cash', section: 'asset', balance: '50.00' }], summary: [{ total_assets: '50.00', total_liabilities_equity: '40.00', difference: '10.00', balanced: false }] },
          prior: { columns: [], rows: [], summary: [{}] } },
        provenance: { ledgerAsOf: '2026-11-07T10:00:00Z', caughtUp: false, lastCheck: { status: 'matches', checkedAt: '2026-11-07T09:00:00Z' }, scope: 'company',
          unattributed: { count: 1, debit: 5, credit: 0 }, unlinked: { count: 0, debit: 0, credit: 0 }, unclassified: { count: 0, debit: 0, credit: 0, balance: 0 } } } });
    const read = await getOdooStatement({ statement: 'balance_sheet', periodKind: 'month', periodStart: '2026-10-01' });
    if (read.state !== 'complete') throw new Error('expected complete');
    expect(read.provenance.caughtUp).toBe(false);
    expect(read.current.summary[0]).toMatchObject({ balanced: false, difference: '10.00' });
    expect(read.provenance.unattributed).toEqual({ count: 1, debit: '5', credit: '0' });
  });

  it('rejects a malformed period before calling the database', async () => {
    await expect(getOdooStatement({ statement: 'trial_balance', periodKind: 'month', periodStart: '2026-10-15' })).rejects.toBeInstanceOf(AppError);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe('switchOdooLedgerBasis (AC-ODA-016)', () => {
  it('sends the confirmation and the written reason, nothing else', async () => {
    ok('2026-11-07T11:00:00Z');
    const at = await switchOdooLedgerBasis({ confirmDifference: true, reason: '  Rounding on one account, explained to the auditor.  ' });
    expect(h.rpc).toHaveBeenCalledWith('switch_odoo_ledger_basis', { p_confirm_difference: true, p_reason: 'Rounding on one account, explained to the auditor.' });
    expect(at).toBe('2026-11-07T11:00:00Z');
  });

  it('defaults to no confirmation', async () => {
    ok('2026-11-07T11:00:00Z');
    await switchOdooLedgerBasis();
    expect(h.rpc).toHaveBeenCalledWith('switch_odoo_ledger_basis', { p_confirm_difference: false, p_reason: null });
  });

  it('keeps the refusal reason slug so the screen can say why', async () => {
    fail('ledger_not_caught_up', 'P0001');
    await expect(switchOdooLedgerBasis()).rejects.toMatchObject({ code: 'P0001', message: 'ledger_not_caught_up' });
  });
});

describe('getOdooProjectLinked (FR-ODA-052)', () => {
  it('is true only when the project has a binding', async () => {
    h.limit.mockResolvedValueOnce({ data: [{ id: 'b1' }], error: null });
    await expect(getOdooProjectLinked(PROJECT)).resolves.toBe(true);
    h.limit.mockResolvedValueOnce({ data: [], error: null });
    await expect(getOdooProjectLinked(PROJECT)).resolves.toBe(false);
  });
});

describe('getOdooCompanyCurrency (OQ-ODA-5: ledger amounts are in the Odoo company currency)', () => {
  it('returns the company currency code, or null when none is recorded', async () => {
    h.limit.mockResolvedValueOnce({ data: [{ attrs: { currency: 'IDR' } }], error: null });
    await expect(getOdooCompanyCurrency()).resolves.toBe('IDR');
    h.limit.mockResolvedValueOnce({ data: [{ attrs: {} }], error: null });
    await expect(getOdooCompanyCurrency()).resolves.toBeNull();
    h.limit.mockResolvedValueOnce({ data: [{ attrs: { currency: 'not a code' } }], error: null });
    await expect(getOdooCompanyCurrency()).resolves.toBeNull();
    h.limit.mockResolvedValueOnce({ data: [], error: null });
    await expect(getOdooCompanyCurrency()).resolves.toBeNull();
  });
  it('surfaces a read error', async () => {
    h.limit.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(getOdooCompanyCurrency()).rejects.toBeInstanceOf(AppError);
  });
});
