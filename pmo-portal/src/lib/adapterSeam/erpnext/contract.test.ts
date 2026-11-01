/**
 * AC-ECA-042 — ERPNext's identity and declarations. The shared suites it declares supported are run for it by
 * `contractSuite/tiers.contract.test.ts` (one runner for every tier, so none can leave suites out).
 * ERPNext-only wire-format tests stay in their own files (FR-ECA-051).
 */
import { describe, expect, it } from 'vitest';
import { SUITES } from '../contractSuite/index.ts';
import { TIER_HARNESSES } from '../contractSuite/tiers.ts';
import { ERPNEXT_WORKFLOWS } from './workflowDeclarations.ts';

describe('erpnext contract', () => {
  it('declares itself as the erpnext tier', () => {
    expect(TIER_HARNESSES.erpnext.tier).toBe('erpnext');
  });

  it('has a shared suite for every workflow it declares supported', () => {
    const supported = Object.entries(ERPNEXT_WORKFLOWS).filter(([, d]) => d.status === 'supported');
    expect(supported.length).toBeGreaterThan(0);
    for (const [id] of supported) expect(SUITES, id).toHaveProperty([id]);
  });

  it('shares every shipped workflow except cutover.timesheet, whose proof is Deno-side only (#1601)', () => {
    const unshared = Object.entries(ERPNEXT_WORKFLOWS).filter(([, d]) => d.status === 'pending' && d.issue === 1601).map(([id]) => id);
    expect(unshared).toEqual(['cutover.purchase', 'cutover.timesheet', 'cutover.revenue']);
  });
});
