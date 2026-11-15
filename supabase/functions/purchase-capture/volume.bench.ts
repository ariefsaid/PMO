/**
 * #2286 — the served handler's in-process time for a whole-org preview at ten times today's volume (NFR-CAPV-003).
 * Evidence for docs/plans/2026-11-15-purchase-capture-volume.md §8, never a CI gate. Run from this directory:
 *   deno bench --allow-env --allow-net --allow-read volume.bench.ts
 */
import { handlePurchaseCaptureRequest } from './index.ts';
import { createJwtAuthority, installEdgeEnv } from '../_shared/testing/edgeTestKit.ts';
import { buildFixture } from './__fixtures__/capture10x.ts';
import { runAction } from './__fixtures__/capture10xServe.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
const golden = buildFixture();
const wide = buildFixture({ unrelated: 11000 });

Deno.bench(`preview, golden fixture (${golden.sources.length} sources, ${golden.ledger.length} ledger lines)`, async () => {
  await runAction(handlePurchaseCaptureRequest, golden, auth, 'preview');
});
Deno.bench(`preview, wide fixture (${wide.sources.length} sources, ${wide.ledger.length} ledger lines)`, async () => {
  const { body } = await runAction(handlePurchaseCaptureRequest, wide, auth, 'preview');
  if (!Array.isArray(body.missing)) throw new Error('no preview');
});
