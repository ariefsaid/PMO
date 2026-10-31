/**
 * AC-ODC-095 — Odoo's identity and declarations. The shared suites it declares supported are run for it by
 * `contractSuite/tiers.contract.test.ts` (one runner for every tier, so none can leave suites out).
 * Odoo-only wire-format tests stay in their own files (FR-ECA-051).
 */
import { describe, expect, it } from 'vitest';
import { SUITES } from '../contractSuite/index.ts';
import { TIER_HARNESSES } from '../contractSuite/tiers.ts';
import { ODOO_WORKFLOWS } from './workflowDeclarations.ts';

const harness = TIER_HARNESSES.odoo;

describe('odoo contract', () => {
  it('declares itself as the odoo tier', () => {
    expect(harness.tier).toBe('odoo');
  });

  it('AC-ODC-095 has a shared suite for every workflow it declares supported, and supports the master sends and party match', () => {
    const supported = Object.entries(ODOO_WORKFLOWS).filter(([, d]) => d.status === 'supported').map(([id]) => id);
    expect(supported).toEqual(expect.arrayContaining(['party.match', 'party.send', 'project.send', 'item.send']));
    for (const id of supported) expect(SUITES, id).toHaveProperty([id]);
  });

  it('refuses workflows it has not built yet instead of pretending', async () => {
    expect(() => harness.resolveProjectLink({}, 'x')).toThrow(/pending/);
    await expect(harness.pushBudget({ account: 'a', fiscalYear: '2026', occupant: 'none' })).rejects.toThrow(/pending/);
    await expect(harness.pushPurchase('activated')).rejects.toThrow(/pending/);
  });
});
