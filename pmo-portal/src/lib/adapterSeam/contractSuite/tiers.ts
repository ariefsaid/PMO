import type { TierWorkflows } from '../connect/workflows.ts';
import { ERPNEXT_WORKFLOWS } from '../erpnext/workflowDeclarations.ts';

/** Every ERP tier that must stay in parity. A new tier adds its line here and its `contract.test.ts`. */
export const TIER_WORKFLOWS: Readonly<Record<string, TierWorkflows>> = {
  erpnext: ERPNEXT_WORKFLOWS,
};
