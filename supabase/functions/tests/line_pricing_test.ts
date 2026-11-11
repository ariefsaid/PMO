import { itemsNetTotal } from '../../../pmo-portal/src/lib/itemsNet.ts';

Deno.test('line totals match shared decimal vectors', async () => {
  const sql = await Deno.readTextFile(new URL('../../tests/line_pricing_parity.test.sql', import.meta.url));
  const vectors: Array<{ name: string; items: Array<{ qty: number; rate: number }>; total: number }> =
    JSON.parse(sql.split('$vectors$')[1]);
  for (const vector of vectors) {
    const actual = itemsNetTotal(vector.items);
    if (actual !== vector.total) throw new Error(`${vector.name}: expected ${vector.total}, got ${actual}`);
  }
});
