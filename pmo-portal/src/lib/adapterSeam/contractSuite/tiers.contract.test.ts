/**
 * AC-ECA-042 — the ONE runner of the shared suites: every registered tier, every workflow it declares supported,
 * through that tier's harness. A tier cannot leave suites out (it has no loop of its own), and the last test fails
 * when a supported workflow's suite did not run or registered nothing. ERPNext-only wire-format tests stay in
 * their own files (FR-ECA-051).
 */
import { describe, expect, it } from 'vitest';
import { getCurrentSuite } from 'vitest/suite';
import { suiteRunProblems } from './parity.ts';
import { SUITES } from './index.ts';
import { TIER_HARNESSES, TIER_WORKFLOWS } from './tiers.ts';
import type { WorkflowId } from '../connect/workflows.ts';

const registered: Array<{ tier: string; id: string; tests: number }> = [];

for (const [tier, declared] of Object.entries(TIER_WORKFLOWS)) {
  for (const [id, declaration] of Object.entries(declared)) {
    const suite = SUITES[id as WorkflowId];
    const harness = TIER_HARNESSES[tier];
    if (declaration.status !== 'supported' || !suite || !harness) continue;
    describe(`${tier} ${id}`, () => {
      suite(harness);
      registered.push({ tier, id, tests: getCurrentSuite().tasks.length });
    });
  }
}

describe('the shared runner', () => {
  it('ran a non-empty suite for every supported workflow of every registered tier', () => {
    expect(suiteRunProblems(TIER_WORKFLOWS, registered)).toEqual([]);
  });
});
