/**
 * project.match · item.match · account.match · employee.match (v1) — page ERP masters through the tier adapter, then
 * pair with the PMO side: exact-code links, doubtful pairs held for review, unrelated records stay unmatched, and no
 * writes (FR-ECA-010/011, FR-ECA-001).
 */
import { describe, expect, it } from 'vitest';
import { proposeMatches } from '../connect/match.ts';
import type { MasterKind, MatchOutcome, NormalisedMaster, PmoMaster } from '../connect/types.ts';
import type { ConnectHarness, ErpHarness, Suite } from './harness.ts';

type Rows = Omit<NormalisedMaster, 'kind'>[];
type RowSelector = Pick<NormalisedMaster, 'code' | 'name'>;
type ReviewSelector = RowSelector & { expectedCount: number };
export interface MatchFixture {
  pmo: PmoMaster[];
  erp: Rows;
  link: { pmoId: string; code: string };
  review: Array<{ pmoId: string; rows: ReviewSelector[] }>;
  unmatchedPmoId: string;
  unmatchedErp?: RowSelector;
}
export interface MatchOracleInput {
  all: NormalisedMaster[];
  out: MatchOutcome[];
  pages: number;
  extraRows: number;
  writes: number;
}

// ERP-only ids are opaque to the suite. Accounts use codes derived from the account itself; Odoo project codes come
// from analytic-account codes and match PMO's project-number column.
export const MATCH_FIXTURES: Partial<Record<MasterKind, MatchFixture>> = {
  project: {
    pmo: [
      { id: 'p1', name: 'North bridge', code: 'PRJ-001' },
      { id: 'p2', name: 'Canal works', code: 'PRJ-002' },
      { id: 'p3', name: 'Only in PMO', code: 'PRJ-003' },
    ],
    erp: [
      { externalId: 'PRJ-001', code: 'PRJ-001', name: 'Bridge account', active: true },
      { externalId: 'ALT-2A', code: 'ALT-2A', name: 'Canal works', active: true },
      { externalId: 'ALT-2B', code: 'ALT-2B', name: 'Canal works', active: true },
      { externalId: 'ERP-ONLY', code: 'ERP-ONLY', name: 'ERP only project', active: true },
    ],
    link: { pmoId: 'p1', code: 'PRJ-001' },
    review: [{ pmoId: 'p2', rows: [
      { code: 'ALT-2A', name: 'Canal works', expectedCount: 1 },
      { code: 'ALT-2B', name: 'Canal works', expectedCount: 1 },
    ] }],
    unmatchedPmoId: 'p3', unmatchedErp: { code: 'ERP-ONLY', name: 'ERP only project' },
  },
  item: {
    pmo: [{ id: 'p1', name: 'Semen 50 kg', code: 'SMN-50' }, { id: 'p2', name: 'Cat Tembok' }, { id: 'p3', name: 'Only in PMO', code: 'ONLY-1' }],
    erp: [
      { externalId: 'SMN-50', code: 'SMN-50', name: 'Semen', active: true },
      { externalId: 'CAT-A', code: 'CAT-A', name: 'Cat Tembok', active: true },
      { externalId: 'CAT-B', code: 'CAT-B', name: 'Cat Tembok', active: true },
      { externalId: 'OTHER-1', code: 'OTHER-1', name: 'Unrelated ERP item', active: true },
    ],
    link: { pmoId: 'p1', code: 'SMN-50' },
    review: [{ pmoId: 'p2', rows: [
      { code: 'CAT-A', name: 'Cat Tembok', expectedCount: 1 },
      { code: 'CAT-B', name: 'Cat Tembok', expectedCount: 1 },
    ] }],
    unmatchedPmoId: 'p3', unmatchedErp: { code: 'OTHER-1', name: 'Unrelated ERP item' },
  },
  employee: {
    pmo: [{ id: 'u1', name: 'Siti Rahma', code: 'siti@example.com' }, { id: 'u2', name: 'Budi' }, { id: 'u3', name: 'Only in PMO', code: 'solo@example.com' }],
    erp: [
      { externalId: 'EMP-1', code: 'siti@example.com', name: 'Siti R.', active: true },
      { externalId: 'EMP-2', code: 'Budi', name: 'Budi', active: true },
      { externalId: 'EMP-3', code: 'Budi', name: 'Budi', active: true },
    ],
    link: { pmoId: 'u1', code: 'siti@example.com' },
    review: [{ pmoId: 'u2', rows: [{ code: 'budi', name: 'Budi', expectedCount: 2 }] }],
    unmatchedPmoId: 'u3',
  },
  account: {
    pmo: [
      { id: 'Materials', name: 'Materials', code: 'Materials' },
      { id: 'Labor', name: 'Labor', code: 'Labor' },
      { id: 'Equipment', name: 'Equipment', code: 'Equipment' },
    ],
    erp: [
      { externalId: 'ACC-1', code: 'Materials', name: 'Materials', active: true },
      { externalId: 'ACC-2', code: 'Labor', name: 'Labor', active: true },
      { externalId: 'ACC-3', code: 'Labor', name: 'Labor', active: true },
      { externalId: 'ACC-4', code: null, name: 'Misc', active: true },
    ],
    link: { pmoId: 'Materials', code: 'Materials' },
    review: [
      { pmoId: 'Labor', rows: [{ code: 'Labor', name: 'Labor', expectedCount: 2 }] },
    ],
    unmatchedPmoId: 'Equipment', unmatchedErp: { code: null, name: 'Misc' },
  },
};

/** The shared executable contract oracle. The suite and its mutation proof both call this same assertion path. */
export function assertMatchContractOracle(kind: MasterKind, f: MatchFixture, { all, out, pages, extraRows, writes }: MatchOracleInput): void {
  expect(all).toHaveLength(f.erp.length + extraRows);
  if (kind === 'item') expect(pages).toBeGreaterThanOrEqual(2);

  const codeMatch = all.find((row) => row.code === f.link.code);
  expect(codeMatch).toBeDefined();
  expect(out.filter((o) => o.outcome === 'link')).toEqual([
    { outcome: 'link', pmoId: f.link.pmoId, externalId: codeMatch!.externalId, key: 'code' },
  ]);
  const selectedReviewRows = f.review.map(({ rows }) => rows.map((selector, selectorIndex) => {
    const candidates = all.filter((row) => selector.code === row.code && selector.name === row.name);
    expect(candidates, `${kind} review selector ${selectorIndex} candidate multiplicity`).toHaveLength(selector.expectedCount);
    const ids = candidates.map((row) => row.externalId);
    expect(new Set(ids).size, `${kind} review selector ${selectorIndex} distinct IDs`).toBe(selector.expectedCount);
    return candidates;
  }));
  const expectedReviews = f.review.map(({ pmoId }, reviewIndex) => ({
    outcome: 'review' as const,
    pmoIds: [pmoId],
    externalIds: selectedReviewRows[reviewIndex].flatMap((candidates) => candidates.map((row) => row.externalId)).sort(),
    reason: 'ambiguous' as const,
  }));
  expect(out.filter((o) => o.outcome === 'review')).toEqual(expectedReviews);
  if (f.unmatchedErp) {
    const unmatchedErp = all.find((row) => row.code === f.unmatchedErp!.code && row.name === f.unmatchedErp!.name);
    expect(unmatchedErp).toBeDefined();
    expect(out.some((o) => o.outcome === 'link' && o.externalId === unmatchedErp!.externalId)).toBe(false);
  }
  if (kind === 'account') expect(out.some((o) => o.outcome === 'link' && o.pmoId === f.unmatchedPmoId)).toBe(false);
  else expect(out).toContainEqual({ outcome: 'send', pmoId: f.unmatchedPmoId });
  expect(writes).toBe(0);
}

function connectOf(h: ErpHarness, name: string): Required<Pick<ConnectHarness, 'load' | 'calls' | 'pageSize'>> & ConnectHarness {
  const c = h.connect?.();
  if (!c?.load || !c.calls || !c.pageSize) throw new Error(`${h.tier} declares ${name} supported but its harness has no connect().load/calls/pageSize`);
  return c as Required<Pick<ConnectHarness, 'load' | 'calls' | 'pageSize'>> & ConnectHarness;
}

export function matchSuite(kind: 'project' | 'item' | 'account' | 'employee'): Suite {
  const f = MATCH_FIXTURES[kind]!;
  return (h) => describe(`${kind}.match (${h.tier})`, () => {
    it('FR-ECA-010 lists real ERP masters, links the exact code, reviews doubtful pairs, and leaves mismatches unmatched', async () => {
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
      const out = proposeMatches(kind, f.pmo, all);
      assertMatchContractOracle(kind, f, { all, out, pages, extraRows: filler.length, writes: c.calls().writes });
    });
  });
}
