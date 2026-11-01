/** party.bring-in (v1) — an ERP party with no PMO match becomes one PMO company, exactly once (FR-ECA-013/014). */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

const ACME = { role: 'vendor' as const, externalId: 'EXT-1', name: 'Acme Co', taxId: 'TAX-1' };

export function bringInSuite(h: ErpHarness): void {
  const run = h.bringIn ?? (() => { throw new Error(`${h.tier} declares party.bring-in supported but has no bringIn()`); });
  describe(`party.bring-in (${h.tier})`, () => {
    it('FR-ECA-014 no PMO match: one new company and one reference', async () => {
      expect(await run([ACME], [])).toMatchObject({ companies: 1, refs: 1, linked: [], review: 0 });
    });
    it('FR-ECA-013 applying the same party three times leaves one company and one reference', async () => {
      expect(await run([ACME], [], 3)).toMatchObject({ companies: 1, refs: 1 });
    });
    it('FR-ECA-014 a unique PMO match is linked, never duplicated', async () => {
      expect(await run([ACME], [{ pmoId: 'pmo-1', taxId: 'TAX-1' }])).toMatchObject({ companies: 1, refs: 1, linked: ['pmo-1'] });
    });
    it('FR-ECA-014 two PMO candidates: nothing written, one review', async () => {
      const r = await run([ACME], [{ pmoId: 'pmo-1', taxId: null }, { pmoId: 'pmo-2', taxId: null }]);
      expect(r).toMatchObject({ companies: 2, refs: 0, linked: [], review: 1 });
    });
  });
}
