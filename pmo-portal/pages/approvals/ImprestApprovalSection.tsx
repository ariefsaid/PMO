import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, ListState } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useImprestAwaiting } from '@/src/hooks/useImprest';
import { availablePlanActions, availableReplenishmentActions } from '@/src/lib/imprest/imprestRules';
import { formatCurrencyAuto } from '@/src/lib/format';

/** "Site cash awaiting you" on /approvals (FR-IMP-073): Submitted plans the viewer may decide and replenishments they may
 *  approve or pay. Decisions happen on the float page. Out-of-plan claims already appear in the expense section.
 *  Hidden when none; a failed read shows an error, never a false empty inbox. */
export const ImprestApprovalSection: React.FC = () => {
  const { t } = useTranslation();
  const userId = useAuth().currentUser?.id;
  const { realRole } = useEffectiveRole();
  const { data, isPending, isError, refetch } = useImprestAwaiting();
  const rows = useMemo(() => {
    const plans = (data?.plans ?? [])
      .filter((p) => p.float && availablePlanActions({ userId, realRole, custodianId: p.float.custodian_id, plan: p }).includes('approvePlan'))
      .map((p) => ({ key: `plan:${p.id}`, floatId: p.float_id, label: t('imprest:approvals.plan', 'Plan {{month}}', { month: p.month.slice(0, 7) }),
        project: p.float?.project?.name ?? '—', amount: formatCurrencyAuto(Number(p.total), p.float?.currency ?? ''), kind: t('imprest:approvals.planKind', 'Site cash plan') }));
    const reps = (data?.replenishments ?? [])
      .filter((r) => r.float && availableReplenishmentActions({ userId, realRole, custodianId: r.float.custodian_id, rep: r })
        .some((a) => a === 'approveReplenishment' || a === 'payReplenishment'))
      .map((r) => ({ key: `rep:${r.id}`, floatId: r.float_id, label: r.number,
        project: r.float?.project?.name ?? '—', amount: formatCurrencyAuto(Number(r.amount), r.float?.currency ?? ''),
        kind: r.status === 'Approved' ? t('imprest:approvals.toPay', 'Replenishment to pay') : t('imprest:approvals.toApprove', 'Replenishment to approve') }));
    return [...plans, ...reps];
  }, [data, userId, realRole, t]);
  if (isPending) return null;
  if (isError) {
    return <div className="mb-4"><ListState variant="error" title={t('imprest:approvals.error', "Couldn't load site cash awaiting you")}
      sub={t('imprest:approvals.errorSub', 'Everything else below is unaffected.')} onRetry={() => void refetch()} /></div>;
  }
  if (rows.length === 0) return null;
  return (
    <section aria-label={t('imprest:approvals.label', 'Site cash awaiting you')} className="mb-4">
      <Card seam>
        <CardHead className="rounded-t-lg">{t('imprest:approvals.heading', 'Site cash awaiting you ({{count}})', { count: rows.length })}</CardHead>
        <ul className="divide-y divide-border rounded-b-lg border-t border-border">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <Link to={`/imprest/${r.floatId}`} className="font-medium text-primary-text hover:underline">{r.label}</Link>
              <span className="min-w-0 flex-1 truncate">{r.project}</span>
              <span className="text-muted-foreground">{r.kind}</span>
              <span className="tabular-nums">{r.amount}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
};
