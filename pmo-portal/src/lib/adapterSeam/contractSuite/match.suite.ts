/**
 * item.match · account.match · employee.match (v1) — page every ERP master of a kind, then pair with the PMO side:
 * one exact-code link, one doubtful pair held for review, nothing written (FR-ECA-010/011, FR-ECA-001).
 */
import { describe, expect, it } from 'vitest';
import { proposeMatches } from '../connect/match.ts';
import type { MasterKind, NormalisedMaster, PmoMaster } from '../connect/types.ts';
import type { ConnectHarness, ErpHarness, Suite } from './harness.ts';

type Rows = Omit<NormalisedMaster, 'kind'>[];
interface Fixture { pmo: PmoMaster[]; erp: Rows; link: { pmoId: string; externalId: string }; review: { pmoId: string; externalIds: string[] } }

// ERP-only ids are opaque; the account rows are named after the category they pay for, because that is how a chart
// of accounts says it (the tier derives the code from the account itself).
const FIXTURES: Partial<Record<MasterKind, Fixture>> = {
  item: {
    pmo: [{ id: 'p1', name: 'Semen 50 kg', code: 'SMN-50' }, { id: 'p2', name: 'Cat Tembok' }, { id: 'p3', name: 'Only in PMO', code: 'ONLY-1' }],
    erp: [{ externalId: 'SMN-50', code: 'SMN-50', name: 'Semen', active: true }, { externalId: 'CAT-A', code: 'CAT-A', name: 'Cat Tembok', active: true },
      { externalId: 'CAT-B', code: 'CAT-B', name: 'Cat Tembok', active: true }],
    link: { pmoId: 'p1', externalId: 'SMN-50' }, review: { pmoId: 'p2', externalIds: ['CAT-A', 'CAT-B'] },
  },
  employee: {
    pmo: [{ id: 'u1', name: 'Siti Rahma', code: 'siti@example.com' }, { id: 'u2', name: 'Budi' }, { id: 'u3', name: 'Only in PMO', code: 'solo@example.com' }],
    erp: [{ externalId: 'EMP-1', code: 'siti@example.com', name: 'Siti R.', active: true }, { externalId: 'EMP-2', name: 'Budi', active: true },
      { externalId: 'EMP-3', name: 'Budi', active: true }],
    link: { pmoId: 'u1', externalId: 'EMP-1' }, review: { pmoId: 'u2', externalIds: ['EMP-2', 'EMP-3'] },
  },
  account: {
    pmo: [{ id: 'Materials', name: 'Materials', code: 'Materials' }, { id: 'Labor', name: 'Labor', code: 'Labor' }, { id: 'Equipment', name: 'Equipment', code: 'Equipment' }],
    erp: [{ externalId: 'ACC-1', code: 'Materials', name: 'Materials', active: true }, { externalId: 'ACC-2', code: 'Labor', name: 'Labor', active: true },
      { externalId: 'ACC-3', code: 'Labor', name: 'Labor', active: true }, { externalId: 'ACC-4', code: null, name: 'Misc', active: true }],
    link: { pmoId: 'Materials', externalId: 'ACC-1' }, review: { pmoId: 'Labor', externalIds: ['ACC-2', 'ACC-3'] },
  },
};

function connectOf(h: ErpHarness, name: string): Required<Pick<ConnectHarness, 'load' | 'calls' | 'pageSize'>> & ConnectHarness {
  const c = h.connect?.();
  if (!c?.load || !c.calls || !c.pageSize) throw new Error(`${h.tier} declares ${name} supported but its harness has no connect().load/calls/pageSize`);
  return c as Required<Pick<ConnectHarness, 'load' | 'calls' | 'pageSize'>> & ConnectHarness;
}

export function matchSuite(kind: 'item' | 'account' | 'employee'): Suite {
  const f = FIXTURES[kind]!;
  return (h) => describe(`${kind}.match (${h.tier})`, () => {
    it('FR-ECA-010 pages every ERP master, then links one exact key and holds one doubtful pair, writing nothing', async () => {
      const c = connectOf(h, `${kind}.match`);
      const filler: Rows = kind === 'item'
        ? Array.from({ length: c.pageSize }, (_, i) => ({ externalId: `FILL-${String(i).padStart(5, '0')}`, code: `FILL-${String(i).padStart(5, '0')}`, name: `Filler ${i}`, active: true }))
        : [];
      c.load(kind, [...f.erp, ...filler]);
      const all: NormalisedMaster[] = [];
      let cursor: string | null = null; let pages = 0;
      do {
        const page: { rows: NormalisedMaster[]; nextCursor: string | null } = await c.adapter.listMasters(kind, cursor);
        all.push(...page.rows); cursor = page.nextCursor; pages += 1;
      } while (cursor !== null && pages < 100);
      expect(all).toHaveLength(f.erp.length + filler.length);
      if (kind === 'item') expect(pages).toBeGreaterThanOrEqual(2);

      const out = proposeMatches(kind, f.pmo, all);
      expect(out.filter((o) => o.outcome === 'link')).toEqual([{ outcome: 'link', ...f.link, key: 'code' }]);
      expect(out.filter((o) => o.outcome === 'review')).toMatchObject([{ pmoIds: [f.review.pmoId], externalIds: f.review.externalIds }]);
      expect(c.calls().writes).toBe(0);
    });
  });
}
