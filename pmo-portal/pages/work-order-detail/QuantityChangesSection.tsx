import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useOverContract, useQuantityChangeRequests, useWorkOrderRequestBudget } from '@/src/hooks/useQuantityChanges';
import { formatDay } from '@/src/lib/format';
import { limitReached } from '@/src/lib/quantityChangeRules';
import { RaiseQuantityChangeDialog } from '../quantityChanges/RaiseQuantityChangeDialog';

/**
 * #2578: the quantity change requests of one work order, its request count beside the organisation limit, and the doorway to raise
 * one. Rendered only for the roles that may read them; the page stays otherwise read-only.
 */
export const QuantityChangesSection: React.FC<{ workOrderId: string; projectId: string; status: string }> = ({ workOrderId, projectId, status }) => {
  const { t } = useTranslation('quantityChanges');
  const navigate = useNavigate();
  const may = usePermission();
  const [open, setOpen] = useState(false);
  const list = useQuantityChangeRequests({ workOrderId }, 0);
  const budget = useWorkOrderRequestBudget(workOrderId);
  const over = useOverContract(projectId, true);
  const mayRaise = may('create', 'quantityChange') && status !== 'Closed' && status !== 'Cancelled';
  const reached = budget.data ? limitReached(budget.data.request_count, budget.data.request_limit) : false;
  const overCount = (over.data ?? []).length;
  return (
    <RecordSection title={t('workOrder.title', 'Quantity changes')} data-testid="wo-quantity-changes"
      actions={mayRaise ? <Button variant="outline" onClick={() => setOpen(true)} disabled={reached}>{t('workOrder.raise', 'Request a quantity change')}</Button> : undefined}>
      {budget.data && (
        <p className="text-foreground" data-testid="wo-qcr-count">
          {t('workOrder.count', 'Requests')} <span className="tabular-nums">{budget.data.request_count}{budget.data.request_limit !== null ? ` / ${budget.data.request_limit}` : ''}</span>
          {reached ? ` · ${t('raise.limitReached', 'This work order has reached its request limit')}` : ''}
        </p>
      )}
      <p><Link to={`/quantity-changes?project=${projectId}`} className="text-primary-text hover:underline" data-testid="wo-qcr-all">{t('workOrder.all', 'All quantity change requests and over-contract lines')}</Link></p>
      {overCount > 0 && <p className="text-foreground">{t('workOrder.overLines', { defaultValue: '{{count}} contract lines over their quantity', count: overCount })}</p>}
      {list.isPending ? <ListState variant="loading" rows={1} /> : list.isError ? (
        <ListState variant="error" title={t('list.error', "Couldn't load requests")} onRetry={() => void list.refetch()} />
      ) : list.data.rows.length === 0 ? (
        <p className="text-muted-foreground">{t('workOrder.empty', 'No quantity change requests on this work order')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.data.rows.map((r) => (
            <li key={r.id} className="flex min-h-11 flex-wrap items-center gap-x-4 py-2">
              <Link to={`/quantity-changes/${r.id}`} className="text-primary-text hover:underline">{formatDay(r.created_at)}</Link>
              <span className="text-muted-foreground">{r.author_name ?? '—'}</span>
              <StatusPill record="quantityChange" state={r.status} />
            </li>
          ))}
        </ul>
      )}
      {open && <RaiseQuantityChangeDialog presetProjectId={projectId} presetWorkOrderId={workOrderId} onClose={() => setOpen(false)} onCreated={(id) => navigate(`/quantity-changes/${id}`)} />}
    </RecordSection>
  );
};
