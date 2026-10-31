import type { TierWorkflows } from '../connect/workflows.ts';
import { createErpnextHarness } from '../erpnext/contract.harness.ts';
import { ERPNEXT_WORKFLOWS } from '../erpnext/workflowDeclarations.ts';
import type { ErpHarness } from './harness.ts';

/** Every ERP tier that must stay in parity. A new tier adds its line here AND in `TIER_HARNESSES`: the shared
 *  runner (`tiers.contract.test.ts`) runs the suites for it, so no tier hand-picks which ones to run. */
export const TIER_WORKFLOWS: Readonly<Record<string, TierWorkflows>> = {
  erpnext: ERPNEXT_WORKFLOWS,
};

export const TIER_HARNESSES: Readonly<Record<string, ErpHarness>> = {
  erpnext: createErpnextHarness(),
};
