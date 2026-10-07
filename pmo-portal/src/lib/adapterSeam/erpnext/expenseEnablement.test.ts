/**
 * AC-EXP-128 (release guard, DD-EXP-22 / spec §10.7) — `expenses` may be switched on only once the GL mirror re-reads
 * cancelled GL entries (#901). Before that, cancelling a posted approval Journal Entry would leave its GL rows live in
 * `erp_gl_entry_mirror` and overstate project actuals.
 *
 * The guard is ONE constant read by the Admin action and the setup screen. This test binds it to what the SHIPPED
 * incremental GL fetch actually does, so the two cannot disagree in either direction:
 *   • flipping the flag while the fetch still drops cancelled rows → red;
 *   • landing #901 (the fetch stops dropping them) without flipping the flag → red, i.e. the switch is not forgotten.
 */
import { describe, expect, it } from 'vitest';
import { EXPENSES_EMPLOYABLE } from './expenseEnablement';
import { fetchGlEntries } from './ledgerFetch';
import type { ErpClientDeps } from './client';

/** The filters the shipped incremental GL fetch (`since` set, as the sweep calls it) sends to ERPNext. */
async function incrementalGlFilters(): Promise<unknown[]> {
  const urls: string[] = [];
  const client: ErpClientDeps = {
    fetchImpl: (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
    apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test',
  };
  await fetchGlEntries(client, { company: 'Example Co', since: '2026-10-01 00:00:00' });
  expect(urls.length).toBeGreaterThan(0);
  return JSON.parse(new URL(urls[0]).searchParams.get('filters') ?? '[]') as unknown[];
}

describe('expenses employ switch guard (AC-EXP-128, DD-EXP-22)', () => {
  it('AC-EXP-128 the expenses switch is open exactly when the incremental GL fetch re-reads cancelled entries (#901)', async () => {
    const filters = await incrementalGlFilters();
    const dropsCancelled = filters.some((f) => JSON.stringify(f) === JSON.stringify(['is_cancelled', '=', 0]));
    expect(
      EXPENSES_EMPLOYABLE,
      dropsCancelled
        ? 'the GL fetch still drops cancelled entries (#901 not landed) — EXPENSES_EMPLOYABLE must stay false'
        : 'the GL fetch re-reads cancelled entries (#901 landed) — set EXPENSES_EMPLOYABLE = true to ship the switch',
    ).toBe(!dropsCancelled);
  });
});
