/** cutover.activation (v1) — nothing reaches the ERP before the connection is activated. */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

export function cutoverSuite(h: ErpHarness): void {
  describe(`cutover.activation (${h.tier})`, () => {
    it('FR-ENA-012 a connection that is not activated refuses the push before any ERP call', async () => {
      expect(await h.pushPurchase('not-activated')).toMatchObject({ outcome: 'refused', code: 'config-rejected', erpCalls: 0 });
    });

    it('no connection at all refuses the push before any ERP call', async () => {
      const r = await h.pushPurchase('absent');
      expect(r).toMatchObject({ outcome: 'refused', erpCalls: 0 });
    });

    it('an activated connection resolves, so the refusals above are about activation', async () => {
      expect(await h.pushPurchase('activated')).toMatchObject({ outcome: 'pushed' });
    });
  });
}
