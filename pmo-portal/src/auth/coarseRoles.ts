/** Shared coarse UI and agent preflight roles; server checks remain authoritative. */
export const ALL_ROLES = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'] as const;
export const MASTER_DATA_ROLES = ['Admin', 'Executive', 'Project Manager', 'Finance'] as const;
export const REVENUE_WRITE_ROLES = ['Admin', 'Finance'] as const;
