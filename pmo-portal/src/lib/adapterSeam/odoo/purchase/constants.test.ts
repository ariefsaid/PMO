import { expect, it } from 'vitest';
import { CLAIM_BUDGET_MS, REQUEST_DEADLINE_MS, ATTEMPTS, RECLAIM_WINDOW_MS, SETTLE_MARGIN_MS, CLEARANCE_TTL_MS, READ_CAP, PLATFORM_ROW_CAP } from './constants.ts';
import { ODOO_CALL_TIMEOUT_MS } from '../client.ts';
it('AC-OPP-063 keeps Odoo money requests inside reclaim and clearance bounds', () => {
  expect(REQUEST_DEADLINE_MS).toBe(ODOO_CALL_TIMEOUT_MS);
  expect(RECLAIM_WINDOW_MS).toBeGreaterThan(CLAIM_BUDGET_MS + REQUEST_DEADLINE_MS + SETTLE_MARGIN_MS);
  expect(REQUEST_DEADLINE_MS * ATTEMPTS).toBeLessThan(RECLAIM_WINDOW_MS);
  expect(CLEARANCE_TTL_MS).toBeGreaterThan(CLAIM_BUDGET_MS + REQUEST_DEADLINE_MS * ATTEMPTS);
  expect(READ_CAP).toBeLessThan(PLATFORM_ROW_CAP);
});
