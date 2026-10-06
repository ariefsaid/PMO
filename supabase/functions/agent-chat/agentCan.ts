/**
 * agentCan.ts — the agent's deputy-reauth preflight (FR-AW-010), extracted from index.ts so it is unit-tested.
 * UX-only (ADR-0016): RLS and adapter-dispatch are the authorities. Role sets come from agentRoles.ts, which is
 * drift-guarded against policy.ts and authGuard.ts.
 */
import {
  AGENT_MASTER_DATA_ROLES,
  AGENT_DELIVERY_WITH_ENGINEER_ROLES,
  AGENT_REVENUE_WRITE_ROLES,
} from '../../../pmo-portal/src/auth/agentRoles.ts';

export function agentCan(action: string, entity: string, ctx: { realRole: string | null }): boolean {
  const role = ctx.realRole;
  if (!role) return false;
  if (entity === 'contactActivity' && action === 'create') return AGENT_MASTER_DATA_ROLES.includes(role);
  if (entity === 'taskStatus' && action === 'edit') return AGENT_DELIVERY_WITH_ENGINEER_ROLES.includes(role);
  if (entity === 'salesInvoice' && action === 'create') return AGENT_REVENUE_WRITE_ROLES.includes(role);
  return false;
}
