import type { Role } from '@/src/auth/AuthContext';

export const procurementsKey = (orgId: string | undefined, withRefs = false, withSharedDetails = false, lean = false, withoutRoutes = false) =>
  lean
    ? withoutRoutes ? ['procurements', orgId, 'lean-list-no-routes'] as const : ['procurements', orgId, 'lean-list'] as const
    : withSharedDetails
    ? ['procurements', orgId, 'shared-list'] as const
    : withRefs ? ['procurements', orgId, 'with-refs'] as const : ['procurements', orgId] as const;

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
