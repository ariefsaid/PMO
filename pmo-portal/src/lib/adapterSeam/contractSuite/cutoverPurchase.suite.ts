/**
 * cutover.purchase (v1) — a purchase started before the cut-over pushes no later step (FR-ECA-030, OQ-ECA-1). The suite sees
 * only the verdict; the cut-over instant (the later of the connection and the procurement employ time) is decided in SQL
 * and proven by pgTAP (`process_domain_cutover.test.sql`).
 */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

export function cutoverPurchaseSuite(h: ErpHarness): void {
  const step = h.pushPurchaseStep ?? (() => { throw new Error(`${h.tier} declares cutover.purchase supported but has no pushPurchaseStep()`); });
  describe(`cutover.purchase (${h.tier})`, () => {
    it.each(['goods-receipt', 'purchase-invoice', 'payment'] as const)(
      'AC-ECA-020 %s of a purchase ordered before the connection creates no ERP document',
      async (s) => {
        expect(await step(s, true)).toMatchObject({ outcome: 'refused', code: 'pre-cutover', erpCalls: 0 });
      },
    );

    it('a purchase ordered after the cut-over is not held back: the gate passes and the tier resolves its adapter', async () => {
      // `pushed` here means the step got past the gate to a resolved adapter; the harness makes no document call to count.
      expect(await step('goods-receipt', false)).toMatchObject({ outcome: 'pushed' });
    });

    it('a check that cannot answer refuses the step before any ERP call (fail closed)', async () => {
      expect(await step('goods-receipt', 'unknown')).toMatchObject({ outcome: 'refused', erpCalls: 0 });
    });
  });
}
