import { describe, expect, it } from 'vitest';
import { resolveAccountDefault, resolveProjectCostAccount, resolveUnit, type ResolverReads } from './resolvers';

const reads = (o: { config?: Record<string, unknown> | null; link?: { external_container_id: string; config: Record<string, unknown> } | null; master?: { active: boolean; tombstoned_at: string | null } | null }): ResolverReads => ({
  config: async () => o.config ?? null,
  projectLink: async () => o.link ?? null,
  master: async () => o.master ?? null,
});

describe('AC-ODC-071 resolvers never default or guess', () => {
  it('an unlinked project is unresolved: unlinked', async () => {
    expect(await resolveProjectCostAccount(reads({}), 'p1')).toEqual({ resolved: false, reason: 'unlinked' });
  });
  it('a link needing attention is unresolved with the reason', async () => {
    expect(await resolveProjectCostAccount(reads({ link: { external_container_id: '101', config: { attention: 'archived' } } }), 'p1')).toEqual({ resolved: false, reason: 'needs-attention', detail: 'archived' });
  });
  it('a healthy link resolves to the cost account', async () => {
    expect(await resolveProjectCostAccount(reads({ link: { external_container_id: '101', config: {} } }), 'p1')).toEqual({ resolved: true, accountId: '101' });
  });
  it('an unmapped unit is unresolved: unmapped', async () => {
    expect(await resolveUnit(reads({ config: { unit_map: { m: '5' } } }), 'm3')).toEqual({ resolved: false, reason: 'unmapped' });
  });
  it('a mapped unit whose Odoo unit is live resolves', async () => {
    expect(await resolveUnit(reads({ config: { unit_map: { m: '5' } }, master: { active: true, tombstoned_at: null } }), 'm')).toEqual({ resolved: true, id: '5' });
  });
  it('an unset default is unresolved: unset', async () => {
    expect(await resolveAccountDefault(reads({ config: { account_defaults: { payable: '1' } } }), 'bank')).toEqual({ resolved: false, reason: 'unset' });
  });
  it('a default whose mirror row is inactive, tombstoned or gone needs attention', async () => {
    const cfg = { account_defaults: { bank: '4' } };
    for (const master of [{ active: false, tombstoned_at: null }, { active: true, tombstoned_at: '2026-01-01T00:00:00Z' }, null]) {
      expect(await resolveAccountDefault(reads({ config: cfg, master }), 'bank')).toEqual({ resolved: false, reason: 'needs-attention', detail: 'inactive' });
    }
  });
});
