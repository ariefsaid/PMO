import { WithheldPrice } from '@/src/components/ui/WithheldPrice';
import { useMaySeePrices } from '@/src/hooks/useHidePrices';
import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { CanWrite } from '@/src/auth/usePermission';
import { useImprestOpenRequests } from '@/src/hooks/useImprest';
import { OPEN_REQUEST_LIMIT } from '@/src/lib/db/imprest';
import { foldRequests, seedFromRequests, type OpenRequest, type PlanSeedLine } from '@/src/lib/imprest/planSeed';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrency } from '@/src/lib/format';

/**
 * Open purchase requests of this site's project, beside the monthly plan (cash-advance-estimate, FR-CAE-001..006): a read-only
 * suggestion of what is about to be bought, by purpose and work order. Nothing here writes; "Start the plan from these" only
 * fills the plan editor, which saves through the existing plan path.
 */
export const OpenRequestsSection: React.FC<{ floatId: string; currency: string; onStartPlan: (lines: PlanSeedLine[]) => void }> = ({ floatId, currency, onStartPlan }) => {
  const { t } = useTranslation();
  const maySeePrices = useMaySeePrices();
  const q = useImprestOpenRequests(floatId);
  const requests = useMemo(() => foldRequests(q.data?.rows ?? []), [q.data]);
  const seed = useMemo(() => seedFromRequests(requests, currency), [requests, currency]);
  const pricesHidden = !maySeePrices && requests.length > 0;
  // purpose -> work order (or none) -> requests, in the order the read gave them
  const groups = useMemo(() => {
    const byPurpose = new Map<string, Map<string, OpenRequest[]>>();
    for (const r of requests) {
      const purpose = r.category ?? '';
      const wo = r.workOrderLabel ?? '';
      const inner = byPurpose.get(purpose) ?? new Map<string, OpenRequest[]>();
      inner.set(wo, [...(inner.get(wo) ?? []), r]);
      byPurpose.set(purpose, inner);
    }
    return [...byPurpose.entries()];
  }, [requests]);
  const money = (v: number | null, cur: string) => (pricesHidden || v === null ? '—' : formatCurrency(Number(v), cur));
  const reason = pricesHidden
    ? t('imprest:open.noPrices', 'Add the lines yourself in the plan.')
    : seed.lines.length === 0
      ? t('imprest:open.nothingToStart', 'None of these requests has a purpose and a price in {{currency}}, so there is nothing to fill in. Add the lines yourself in the plan.', { currency })
      : null;

  return (
    <RecordSection
      title={t('imprest:open.title', 'Open purchase requests')}
      actions={requests.length > 0 && (
        <CanWrite entity="imprestPlan" action="create">
          <Button variant="outline" size="sm" disabled={reason !== null} onClick={() => onStartPlan(seed.lines)}>
            {t('imprest:open.startPlan', 'Start the plan from these')}
          </Button>
        </CanWrite>
      )}
    >
      <div data-testid="open-requests">
        {q.isPending && <ListState variant="loading" rows={2} />}
        {q.isError && <ListState variant="error" title={t('imprest:open.error', "Couldn't load the open purchase requests")} onRetry={() => void q.refetch()} />}
        {!q.isPending && !q.isError && requests.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="open-requests-empty">
            {t('imprest:open.empty', "No open purchase requests on this site's project. Project members raise one under Procurement, and it shows here until it is ordered.")}
          </p>
        )}
        {!q.isPending && !q.isError && requests.length > 0 && (
          <div className="space-y-3">
            <p className="text-control text-muted-foreground">
              {t('imprest:open.help', 'Requests not yet ordered or paid. This list only suggests; the plan is yours to edit and save.')}
            </p>
            {reason && <div className="text-control text-muted-foreground" data-testid="open-requests-reason">{pricesHidden && <WithheldPrice />}{reason}</div>}
            {!reason && seed.skipped > 0 && (
              <p className="text-control text-muted-foreground" data-testid="open-requests-skipped">
                {t('imprest:open.skipped', '{{count}} request(s) with no purpose, no visible price or another currency are not counted in the plan.', { count: seed.skipped })}
              </p>
            )}
            {groups.map(([purpose, byWo]) => (
              <div key={purpose || 'none'} className="space-y-3" data-testid={`open-purpose-${purpose || 'none'}`}>
                <h3 className="text-sm font-semibold text-foreground">{purpose ? budgetCategoryLabel(purpose as OpenRequest['category'] & string, t) : t('imprest:open.noPurpose', 'No purpose set')}</h3>
                {[...byWo.entries()].map(([wo, reqs]) => (
                  <div key={wo || 'none'} className="space-y-1">
                    <p className="text-control text-muted-foreground">{wo || t('imprest:open.noWorkOrder', 'No work order')}</p>
                    <ul className="divide-y divide-border text-sm">
                      {reqs.map((r) => (
                        <li key={r.id} className="py-2 first:pt-1 last:pb-0">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Link to={`/procurement/${r.id}`} className="font-semibold text-primary-text hover:underline">{r.prNumber ?? r.title}</Link>
                            <span className="min-w-0 basis-full truncate sm:basis-0 sm:flex-1">{r.title}</span>
                            <StatusPill record="procurement" state={r.status} />
                            <span className="tabular-nums">{money(r.total, r.currency)}</span>
                          </div>
                          {r.lines.length > 0 && (
                            <ul className="mt-1 pl-4 text-control text-muted-foreground">
                              {r.lines.map((l) => (
                                <li key={l.id} className="flex gap-3"><span className="flex-1">{l.name} × {l.quantity}</span><span className="tabular-nums">{money(l.amount, r.currency)}</span></li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
            {q.data?.truncated && <p role="status" className="text-control text-muted-foreground">
              {t('imprest:open.truncated', 'Showing the first {{count}} lines only.', { count: OPEN_REQUEST_LIMIT })}
            </p>}
          </div>
        )}
      </div>
    </RecordSection>
  );
};
