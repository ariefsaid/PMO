import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../contract.ts';
import { scenarioOf, takeCensus } from './census.ts';
import type { ConnectAdapter } from './types.ts';

const ZERO = { party: 0, contact: 0, item: 0, project: 0, employee: 0, account: 0, budget: 0, purchase: 0, invoice: 0, receipt: 0, payment: 0, timesheet: 0 };

function fake(count: (d: string) => number | Error): { adapter: ConnectAdapter; sendMaster: ReturnType<typeof vi.fn> } {
  const sendMaster = vi.fn();
  return {
    sendMaster,
    adapter: {
      tier: 'fake',
      listMasters: async () => ({ rows: [], nextCursor: null }),
      countDomain: async (d) => { const c = count(d); if (c instanceof Error) throw c; return c; },
      sendMaster,
    },
  };
}

describe('AC-ECA-001 census', () => {
  it('AC-ECA-001 scenarioOf names the four cells', () => {
    expect(scenarioOf(0, 0)).toBe('none');
    expect(scenarioOf(0, 3)).toBe('S-A');
    expect(scenarioOf(2, 0)).toBe('S-C');
    expect(scenarioOf(2, 2)).toBe('S-D');
  });

  it('AC-ECA-001 takes 11 rows (5 kinds + 6 domains), read-only', async () => {
    const f = fake((d) => (d === 'party' ? 3 : 0));
    const rows = await takeCensus(f.adapter, { ...ZERO, item: 2 });
    expect(rows).toHaveLength(11);
    expect(rows.find((r) => r.kind === 'party')).toEqual({ kind: 'party', pmoCount: 0, erpCount: 3, scenario: 'S-A' });
    expect(rows.find((r) => r.kind === 'item')).toMatchObject({ pmoCount: 2, erpCount: 0, scenario: 'S-C' });
    expect(f.sendMaster).not.toHaveBeenCalled();
  });

  it('a domain this ERP cannot count yet is null, never 0', async () => {
    const f = fake((d) => (d === 'timesheet' ? new AdapterError('commit-rejected', 'x') : 0));
    const rows = await takeCensus(f.adapter, ZERO);
    expect(rows.find((r) => r.kind === 'timesheet')).toEqual({ kind: 'timesheet', pmoCount: 0, erpCount: null, scenario: null });
  });

  it('a master kind that cannot be counted propagates', async () => {
    const f = fake((d) => (d === 'party' ? new AdapterError('commit-rejected', 'x') : 0));
    await expect(takeCensus(f.adapter, ZERO)).rejects.toThrow(AdapterError);
  });
});
