/** Coarse preflight roles; record-scoped rules remain in policy and server checks. */
import { ALL_ROLES, MASTER_DATA_ROLES, REVENUE_WRITE_ROLES } from './coarseRoles.ts';

export const AGENT_MASTER_DATA_ROLES: string[] = [...MASTER_DATA_ROLES];
export const AGENT_TASK_STATUS_ROLES: string[] = [...ALL_ROLES];
export const AGENT_REVENUE_VIEW_ROLES: string[] = [...MASTER_DATA_ROLES];
export const AGENT_REVENUE_WRITE_ROLES: string[] = [...REVENUE_WRITE_ROLES];
export const AGENT_MONEY_READ_ROLES: string[] = [...MASTER_DATA_ROLES];
