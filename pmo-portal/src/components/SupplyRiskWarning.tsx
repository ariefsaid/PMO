/**
 * #2583 (FR-VSR-012/014) — the read-time warning on a work order that has an open order from a supplier marked at risk
 * or inactive. Informational only: it never blocks issuing, receiving or billing (OD-VSR-4). The warning is in words,
 * not colour alone (NFR-VSR-002). One project-scoped read serves every row of a project (shared query key).
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { supplyRiskLabel } from '@/src/lib/supplyRiskLabels';
import { useSupplyRiskWarnings } from '@/src/hooks/useSupplyRisk';

export const WorkOrderSupplyWarning: React.FC<{ workOrderId: string; projectId: string }> = ({ workOrderId, projectId }) => {
  const { t } = useTranslation('supplyRisk');
  const warnings = useSupplyRiskWarnings({ projectId });
  const mine = (warnings.data ?? []).filter((w) => w.workOrderId === workOrderId);
  if (mine.length === 0) return null;
  return (
    <ul className="m-0 list-none space-y-1 p-0" data-testid="supply-risk-warning">
      {mine.map((w) => (
        <li key={w.supplierId} role="note" className="text-control text-warning-foreground">
          <strong className="font-semibold">{t('warning.lead', 'Supplier warning')}</strong>
          {': '}
          <Link to={`/companies/${w.supplierId}`} className="underline underline-offset-2">{w.supplierName}</Link>
          {' '}
          {t('warning.body', 'is {{status}} and has an open order on this work order.', {
            status: supplyRiskLabel(t as never, w.status).toLowerCase(),
          })}
        </li>
      ))}
    </ul>
  );
};
