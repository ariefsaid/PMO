import type { Role } from '@/src/auth/AuthContext';

export const procurementsKey = (orgId: string | undefined, withRefs = false) =>
  withRefs ? ['procurements', orgId, 'with-refs'] as const : ['procurements', orgId] as const;

export const expenseClaimsAwaitingKey = (orgId: string | undefined) =>
  ['expense-claims-awaiting', orgId] as const;

export const awaitingApprovalKey = (
  orgId: string | undefined,
  userId: string | undefined,
  role: Role | null,
) => ['timesheets-awaiting', orgId, userId, role] as const;

export const nativeDraftInvoicesKey = (orgId: string | undefined) =>
  ['salesInvoices', orgId, 'native-drafts'] as const;

export const externalDomainOwnershipKey = (orgId: string | undefined) =>
  ['external-domain-ownership', orgId] as const;
