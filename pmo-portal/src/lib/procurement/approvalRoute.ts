import type { TFunction } from 'i18next';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';

/**
 * #803 approval routing — the FE mirror of `public.spend_approval_route` (migration 0242, ADR-0075).
 * UX ONLY (ADR-0016): `transition_procurement` is the authority. Pure — no I/O, no React.
 */
export type ApprovalRouteKind = 'project' | 'org' | 'flat';

export type ApprovalRouteReason =
  | 'within_budget'
  | 'no_project'
  | 'no_category'
  | 'no_active_budget'
  | 'currency_mismatch'
  | 'exceeds_line';

export interface ApprovalRouteApprover {
  id: string;
  fullName: string;
}

export interface ApprovalRoute {
  procurementId: string;
  route: ApprovalRouteKind;
  reason: ApprovalRouteReason;
  approvers: ApprovalRouteApprover[];
  requestAmount: number;
  lineBudget: number | null;
  lineUsed: number | null;
}

/**
 * May this viewer decide (approve/reject) as far as ROUTING is concerned? The OD-PROC-1 role matrix and
 * SoD-a are separate gates the caller still applies. No route (not Requested, or the read failed) adds
 * no restriction (FR-APR-035) — the server enforces either way.
 */
export function mayDecideRoutedApproval(
  route: ApprovalRoute | null | undefined,
  userId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (!route || route.route === 'flat') return true;
  if (isAdmin) return true;
  return Boolean(userId) && route.approvers.some((a) => a.id === userId);
}

/** One line telling a viewer who is not routed this request who decides it, and why (FR-APR-031). */
export function approvalRouteNote(route: ApprovalRoute, category: string | null, t: TFunction): string {
  const names = route.approvers
    .map((a) => a.fullName)
    .join(t('procurementDetail.route.nameJoiner', ' or '));
  const cat = category ? budgetCategoryLabel(category, t) : '';
  let why: string;
  if (route.route === 'org' && route.reason === 'within_budget') {
    why = t('procurementDetail.route.why.escalated', "the project's own approver cannot approve it.");
  } else if (route.reason === 'within_budget') {
    why = t('procurementDetail.route.why.withinBudget', {
      defaultValue: "it is within the project's {{category}} budget.",
      category: cat,
    });
  } else if (route.reason === 'exceeds_line') {
    why = t('procurementDetail.route.why.exceedsLine', {
      defaultValue: "it would take the project's {{category}} budget over its limit.",
      category: cat,
    });
  } else if (route.reason === 'no_project') {
    why = t('procurementDetail.route.why.noProject', 'it is overhead spend, not charged to a project.');
  } else if (route.reason === 'no_category') {
    why = t(
      'procurementDetail.route.why.noCategory',
      'it has no budget category, so it cannot be checked against the project budget.',
    );
  } else if (route.reason === 'no_active_budget') {
    why = t('procurementDetail.route.why.noActiveBudget', 'the project has no active budget.');
  } else {
    why = t(
      'procurementDetail.route.why.currencyMismatch',
      "its currency differs from the project budget's currency.",
    );
  }
  return t('procurementDetail.route.note', {
    defaultValue: 'Approval for this request is routed to {{names}}: {{why}}',
    names,
    why,
  });
}
