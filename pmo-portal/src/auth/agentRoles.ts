/**
 * agentRoles.ts — shared role-set constants for the agent write-action preflight.
 *
 * This file has NO browser or Vite deps so it can be imported by:
 *   - pmo-portal/src/auth/policy.ts (FE RBAC layer)
 *   - supabase/functions/agent-chat/index.ts (Deno edge fn, via relative path)
 *
 * The sets mirror the RBAC matrix in policy.ts for the two v1 agent write actions:
 *   create_activity → MASTER_DATA roles (Admin·Exec·PM·Finance)
 *   update_task_status → DELIVERY roles + Engineer (RLS enforces own-task for Engineer)
 *
 * ADR-0016: this is a UX-preflight (can() check); RLS/SoD is the enforcement authority.
 *
 * Drift guard: agentRoles.test.ts asserts these match the policy.ts RBAC expectations
 * so a role rename in policy.ts will fail CI before this copy drifts.
 */

/** Roles allowed to create CRM activities (contactActivity.create in policy.ts). */
export const AGENT_MASTER_DATA_ROLES: string[] = [
  'Admin',
  'Executive',
  'Project Manager',
  'Finance',
];

/**
 * Roles allowed to call update_task_status.
 * DELIVERY (Admin·Exec·PM) may update any task; Engineer may update their OWN task
 * (RLS tasks_update_own_status enforces the ownership; can() check is the UX preflight).
 */
export const AGENT_DELIVERY_WITH_ENGINEER_ROLES: string[] = [
  'Admin',
  'Executive',
  'Project Manager',
  'Engineer',
];
