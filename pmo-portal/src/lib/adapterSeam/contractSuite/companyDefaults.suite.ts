/**
 * company-defaults.set (v1) — the ERP company's default accounts and cost centre, chosen in PMO (#1599 ECX-3, AC-ECX-020).
 * The ERP checks only that an account exists, is a leaf and is the company's; it accepts an account of the wrong kind. So the
 * tier must refuse a wrong kind, a group, another company's target or a disabled one BEFORE any write, write only the slots
 * that change (a retry writes nothing), and report only what the ERP reads back.
 */
import { describe, expect, it } from 'vitest';
import type { CompanyDefaultsHarness, ErpHarness, Suite } from './harness.ts';
import type { DefaultTargetFacts } from '../companyDefaults.ts';

function harnessOf(h: ErpHarness): CompanyDefaultsHarness {
  if (!h.companyDefaults) throw new Error(`${h.tier} declares company-defaults.set supported but its harness has no companyDefaults()`);
  return h.companyDefaults();
}

const leaf = (c: CompanyDefaultsHarness, name: string, more: Partial<DefaultTargetFacts> = {}): DefaultTargetFacts =>
  ({ name, company: c.company, isGroup: false, disabled: false, rootType: null, accountType: null, ...more });

function chart(c: CompanyDefaultsHarness): void {
  c.load('account', leaf(c, 'Creditors', { rootType: 'Liability', accountType: 'Payable' }));
  c.load('account', leaf(c, 'Debtors', { rootType: 'Asset', accountType: 'Receivable' }));
  c.load('account', leaf(c, 'Cash', { rootType: 'Asset', accountType: 'Cash' }));
  c.load('account', leaf(c, 'Bank A', { rootType: 'Asset', accountType: 'Bank' }));
  c.load('account', leaf(c, 'Site Costs', { rootType: 'Expense', accountType: null }));
  c.load('account', leaf(c, 'Service Income', { rootType: 'Income', accountType: null }));
  c.load('account', leaf(c, 'Accounts Payable', { rootType: 'Liability', isGroup: true }));
  c.load('account', leaf(c, 'Old Creditors', { rootType: 'Liability', accountType: 'Payable', disabled: true }));
  c.load('account', { ...leaf(c, 'Other Creditors', { rootType: 'Liability', accountType: 'Payable' }), company: 'Other Co' });
  c.load('cost_centre', leaf(c, 'Main'));
  c.load('cost_centre', leaf(c, 'All Centres', { isGroup: true }));
  c.load('cost_centre', { ...leaf(c, 'Other Main'), company: 'Other Co' });
}

async function refused(c: CompanyDefaultsHarness, choice: Parameters<CompanyDefaultsHarness['writer']['set']>[0]) {
  const err = await c.writer.set(choice).then(() => null, (e: unknown) => e as { code?: string; message?: string });
  expect(err, 'the choice must be refused').not.toBeNull();
  expect(err?.code).toBe('commit-rejected');
  expect(c.writes()).toEqual([]);
  return err?.message ?? '';
}

export const companyDefaultsSuite: Suite = (h) => describe(`company-defaults.set (${h.tier})`, () => {
  it('AC-ECX-020 given an empty payable default and a Payable account, setting it writes the company once and a retry writes nothing', async () => {
    const c = harnessOf(h); chart(c);
    const first = await c.writer.set({ payable: 'Creditors' });
    expect(first.written).toEqual(['payable']);
    expect(first.readBack.payable).toBe('Creditors');
    expect(c.held().payable).toBe('Creditors');
    const again = await c.writer.set({ payable: 'Creditors' });
    expect(again.written).toEqual([]);
    expect(again.readBack.payable).toBe('Creditors');
    expect(c.writes()).toEqual([['payable']]);
  });

  it('AC-ECX-020 an account of the wrong type is refused before any write, though the ERP itself would accept it', async () => {
    const c = harnessOf(h); chart(c);
    expect(await refused(c, { payable: 'Debtors' })).toMatch(/not a payable account/);
    await refused(c, { cash: 'Bank A' });
    await refused(c, { bank: 'Cash' });
    await refused(c, { expense: 'Service Income' });
    expect(c.held().payable).toBeNull();
  });

  it('AC-ECX-020 one wrong choice among several writes none of them', async () => {
    const c = harnessOf(h); chart(c);
    await refused(c, { cash: 'Cash', payable: 'Debtors' });
    expect(c.held().cash).toBeNull();
  });

  it('AC-ECX-020 a group, a disabled account, another company\'s account and an unknown account are refused before any write', async () => {
    const c = harnessOf(h); chart(c);
    expect(await refused(c, { payable: 'Accounts Payable' })).toMatch(/group/);
    expect(await refused(c, { payable: 'Old Creditors' })).toMatch(/disabled/);
    expect(await refused(c, { payable: 'Other Creditors' })).toMatch(/another company/);
    await refused(c, { payable: 'No Such Account' });
  });

  it('AC-ECX-020 the cost centre must be a leaf of the connected company: a group or another company\'s is refused', async () => {
    const c = harnessOf(h); chart(c);
    await refused(c, { cost_centre: 'All Centres' });
    await refused(c, { cost_centre: 'Other Main' });
    const ok = await c.writer.set({ cost_centre: 'Main' });
    expect(ok.readBack.cost_centre).toBe('Main');
  });

  it('AC-ECX-020 the expense default takes any Expense leaf; only the slots that change are written', async () => {
    const c = harnessOf(h); chart(c);
    await c.writer.set({ cash: 'Cash' });
    const r = await c.writer.set({ cash: 'Cash', expense: 'Site Costs', bank: 'Bank A' });
    expect([...r.written].sort()).toEqual(['bank', 'expense']);
    expect(c.writes()).toEqual([['cash'], expect.arrayContaining(['bank', 'expense'])]);
    expect(c.held()).toMatchObject({ cash: 'Cash', expense: 'Site Costs', bank: 'Bank A', payable: null });
  });

  it('AC-ECX-020 a write the ERP does not keep is refused, never reported as set', async () => {
    const c = harnessOf(h); chart(c);
    c.dropNextWrite();
    const err = await c.writer.set({ payable: 'Creditors' }).then(() => null, (e: unknown) => e as { code?: string });
    expect(err?.code).toBe('commit-rejected');
    expect(c.held().payable).toBeNull();
  });
});
