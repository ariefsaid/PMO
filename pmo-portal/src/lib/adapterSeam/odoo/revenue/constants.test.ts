import { expect, it } from 'vitest';
import { ODOO_CALL_TIMEOUT_MS } from '../client.ts';
import { ATTEMPTS, CLAIM_BUDGET_MS, CLEARANCE_TTL_MS, PLATFORM_ROW_CAP, READ_CAP, RECLAIM_WINDOW_MS, REQUEST_DEADLINE_MS, SETTLE_MARGIN_MS } from './constants.ts';

it('AC-OCI-063 the per-attempt deadline is the Odoo client\'s own', () => {
  expect(REQUEST_DEADLINE_MS).toBe(ODOO_CALL_TIMEOUT_MS);
});
it('AC-OCI-063 the reclaim window outlasts a claim budget, a request deadline and the settle margin', () => {
  expect(RECLAIM_WINDOW_MS).toBeGreaterThan(CLAIM_BUDGET_MS + REQUEST_DEADLINE_MS + SETTLE_MARGIN_MS);
});
it('AC-OCI-063 per-attempt deadline times attempts stays below the reclaim window', () => {
  expect(REQUEST_DEADLINE_MS * ATTEMPTS).toBeLessThan(RECLAIM_WINDOW_MS);
});
it('AC-OCI-063 the SoD clearance outlasts the longest an Odoo post can still be in flight', () => {
  expect(CLEARANCE_TTL_MS).toBeGreaterThan(CLAIM_BUDGET_MS + REQUEST_DEADLINE_MS * ATTEMPTS);
});
it('AC-OCI-063 a read page stays below the platform row cap', () => {
  expect(READ_CAP).toBeLessThan(PLATFORM_ROW_CAP);
});
