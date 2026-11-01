/**
 * census (v1) — read-only counts of every master kind and money domain on both sides, with the scenario per kind
 * (FR-ECA-001/003, DD-ECA-1). A tier that cannot count a money domain says so (null), never 0.
 */
import { describe, expect, it } from 'vitest';
import { takeCensus } from '../connect/census.ts';
import type { ConnectHarness, ErpHarness, Suite } from './harness.ts';

function connectOf(h: ErpHarness): Required<Pick<ConnectHarness, 'load' | 'calls'>> & ConnectHarness {
  const c = h.connect?.();
  if (!c?.load || !c.calls) throw new Error(`${h.tier} declares a census workflow supported but its harness has no connect().load/calls`);
  return c as Required<Pick<ConnectHarness, 'load' | 'calls'>> & ConnectHarness;
}

export const censusSuite: Suite = (h) => describe(`census (${h.tier})`, () => {
  it('AC-ECA-001 counts both sides per kind, names the scenario, and writes nothing', async () => {
    const c = connectOf(h);
    c.load('party', [1, 2, 3].map((n) => ({ externalId: `P${n}`, role: 'vendor' as const, name: `Vendor ${n}`, active: true })));
    c.load('project', [1, 2].map((n) => ({ externalId: `PRJ-${n}`, code: `PRJ-${n}`, name: `Project ${n}`, active: true })));
    const rows = await takeCensus(c.adapter, { party: 0, item: 2, project: 2, employee: 0, account: 0 });
    const kinds = rows.filter((r) => ['party', 'item', 'project', 'employee', 'account'].includes(r.kind));
    expect(kinds.map((r) => [r.kind, r.scenario])).toEqual([['party', 'S-A'], ['item', 'S-C'], ['project', 'S-D'], ['employee', 'none'], ['account', 'none']]);
    expect(rows.find((r) => r.kind === 'party')?.erpCount).toBe(3);
    const domains = rows.filter((r) => !kinds.includes(r));
    expect(domains.map((r) => r.kind)).toEqual(['budget', 'purchase', 'invoice', 'receipt', 'payment', 'timesheet']);
    for (const d of domains) expect(d.erpCount === null || Number.isInteger(d.erpCount)).toBe(true);
    expect(c.calls().writes).toBe(0);
  });
});
