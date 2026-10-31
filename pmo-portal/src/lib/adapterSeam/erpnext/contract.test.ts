/**
 * AC-ECA-042 — runs every shared suite ERPNext declares supported, through ERPNext's own harness.
 * ERPNext-only wire-format tests stay in their own files (FR-ECA-051).
 */
import { describe, expect, it } from 'vitest';
import { SUITES } from '../contractSuite/index.ts';
import { createErpnextHarness } from './contract.harness.ts';
import { ERPNEXT_WORKFLOWS } from './workflowDeclarations.ts';

const harness = createErpnextHarness();

describe('erpnext contract', () => {
  it('declares itself as the erpnext tier', () => {
    expect(harness.tier).toBe('erpnext');
  });

  it('has a shared suite for every workflow it declares supported', () => {
    const supported = Object.entries(ERPNEXT_WORKFLOWS).filter(([, d]) => d.status === 'supported');
    expect(supported.length).toBeGreaterThan(0);
    for (const [id] of supported) expect(SUITES, id).toHaveProperty([id]);
  });
});

for (const [id, declaration] of Object.entries(ERPNEXT_WORKFLOWS)) {
  const suite = SUITES[id as keyof typeof SUITES];
  if (declaration.status === 'supported' && suite) suite(harness);
}
