/**
 * account.send (v1) — a direct-cost account created from PMO (#1599 ECX-4, AC-ECX-030, OQ-ECX-1): one LEAF account under the
 * expense group the Finance user chose, in the bound company. A retry after a lost answer finds the first account; an account the
 * ERP already holds under that name is linked only when it is a leaf of the same company under the expense root. Nothing else in the
 * chart is ever written: no group, tax or fiscal year.
 */
import { describe, expect, it } from 'vitest';
import type { PmoMaster } from '../connect/types.ts';
import type { AccountChart, ConnectHarness, ErpHarness, Suite } from './harness.ts';

function setUp(h: ErpHarness): { c: ConnectHarness; chart: AccountChart } {
  if (!h.connect) throw new Error(`${h.tier} declares account.send supported but its harness has no connect()`);
  const c = h.connect();
  if (!c.chart) throw new Error(`${h.tier} declares account.send supported but its connect harness has no chart()`);
  return { c, chart: c.chart() };
}

const KEY = 'seed:account:Materials';
const record = (parentAccount: string, name = 'Site materials'): PmoMaster => ({ id: 'Materials', name, parentAccount });

export const accountSendSuite: Suite = (h) => describe(`account.send (${h.tier})`, () => {
  it('AC-ECX-030 creates one leaf account under the chosen expense group of the bound company and answers its ERP id', async () => {
    const { c, chart } = setUp(h);
    const { externalId } = await c.adapter.sendMaster('account', record(chart.expenseGroup), KEY);
    const created = c.accounts!().filter((a) => a.created);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ externalId, accountName: 'Site materials', parent: chart.expenseGroup, company: chart.company, isGroup: false, rootType: 'Expense' });
  });

  it('AC-ECX-030 sending again finds the first account: no second create, the same ERP id', async () => {
    const { c, chart } = setUp(h);
    const first = await c.adapter.sendMaster('account', record(chart.expenseGroup), KEY);
    expect(await c.adapter.sendMaster('account', record(chart.expenseGroup), KEY)).toEqual(first);
    expect(c.accounts!().filter((a) => a.created)).toHaveLength(1);
  });

  it('AC-ECX-030 a create whose answer is lost, then retried, links the same account', async () => {
    const { c, chart } = setUp(h);
    c.failNextWrite('lost-response');
    await expect(c.adapter.sendMaster('account', record(chart.expenseGroup), KEY)).rejects.toMatchObject({ code: 'external-unreachable' });
    const retry = await c.adapter.sendMaster('account', record(chart.expenseGroup), KEY);
    const created = c.accounts!().filter((a) => a.created);
    expect(created).toHaveLength(1);
    expect(created[0].externalId).toBe(retry.externalId);
  });

  it('AC-ECX-030 an account the ERP already holds under that name, a leaf of the company under the expense root, is linked, not created again', async () => {
    const { c, chart } = setUp(h);
    const existing = chart.place({ accountName: 'site MATERIALS', parent: chart.otherExpenseGroup, isGroup: false, rootType: 'Expense' });
    expect(await c.adapter.sendMaster('account', record(chart.expenseGroup), KEY)).toEqual({ externalId: existing });
    expect(c.accounts!().filter((a) => a.created)).toEqual([]);
  });

  it('AC-ECX-030 an account the ERP already holds under that name as a group, or outside the expense root, is refused in plain words and nothing is linked', async () => {
    for (const clash of [{ isGroup: true, rootType: 'Expense' as const }, { isGroup: false, rootType: 'Asset' as const }]) {
      const { c, chart } = setUp(h);
      chart.place({ accountName: 'SITE materials', parent: chart.otherExpenseGroup, ...clash });
      const failure = await c.adapter.sendMaster('account', record(chart.expenseGroup), KEY).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(Error);
      const err = failure as Error & { code?: string };
      expect(['commit-rejected', 'command-held']).toContain(err.code);
      if (err.code === 'command-held') {
        expect(err.message).toBe('Account requires reconciliation');
      } else {
        expect(err).toMatchObject({
          code: 'commit-rejected',
          message: expect.stringMatching(/already has an account named .+ that cannot hold direct costs/),
        });
      }
      expect(c.accounts!().filter((a) => a.created)).toEqual([]);
    }
  });

  it('AC-ECX-030 a parent that is not a group of the bound company is refused by the ERP and nothing is created', async () => {
    const { c, chart } = setUp(h);
    for (const parent of [chart.expenseLeaf, chart.otherCompanyGroup]) {
      await expect(c.adapter.sendMaster('account', record(parent), KEY)).rejects.toMatchObject({ code: 'commit-rejected' });
    }
    expect(c.accounts!().filter((a) => a.created)).toEqual([]);
  });

  it('AC-ECX-030 a parent group that is turned off is refused in plain words and nothing is created, although the ERP itself would accept it', async () => {
    const { c, chart } = setUp(h);
    await expect(c.adapter.sendMaster('account', record(chart.disabledExpenseGroup), KEY)).rejects.toMatchObject({
      code: 'commit-rejected', message: `${chart.disabledExpenseGroup} is turned off. Pick another expense group.`,
    });
    expect(c.accounts!().filter((a) => a.created)).toEqual([]);
    expect(c.calls!().writes).toBe(0);
  });

  it('AC-ECX-030 a parent that is a posting account is refused in our own words, never the ERP\'s', async () => {
    const { c, chart } = setUp(h);
    await expect(c.adapter.sendMaster('account', record(chart.expenseLeaf), KEY)).rejects.toMatchObject({
      code: 'commit-rejected', message: 'Pick a group account, not a posting account.',
    });
  });

  it('AC-ECX-030 an empty or blank name is refused in PMO before any ERP call', async () => {
    const { c, chart } = setUp(h);
    const before = c.calls!();
    for (const name of ['', '   ']) {
      await expect(c.adapter.sendMaster('account', record(chart.expenseGroup, name), KEY)).rejects.toMatchObject({ code: 'commit-rejected' });
    }
    expect(c.calls!()).toEqual(before);
  });

  it('AC-ECX-030 the send writes only the one leaf account: no group, tax or fiscal year', async () => {
    const { c, chart } = setUp(h);
    await c.adapter.sendMaster('account', record(chart.expenseGroup), KEY);
    expect(c.accounts!().filter((a) => a.created && a.isGroup)).toEqual([]);
    expect(c.writesOutsideAccounts!()).toEqual([]);
    expect(c.calls!().writes).toBe(1);
  });
});
