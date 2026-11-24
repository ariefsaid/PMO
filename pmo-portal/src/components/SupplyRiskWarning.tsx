/**
 * #2583 (FR-VSR-012/014) — the read-time warning on a work order that has an open order from a supplier marked at risk
 * or inactive. Informational only: it never blocks issuing, receiving or billing (OD-VSR-4). The warning is in words,
 * not colour alone (NFR-VSR-002). One project-scoped read serves every row of a project (shared query key).
 */
import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { supplyRiskLabel } from '@/src/lib/supplyRiskLabels';
import { useSupplyRiskWarnings } from '@/src/hooks/useSupplyRisk';
import { useCompany } from '@/src/hooks/useCompanies';

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

/** Walk PU18: the same warning on a purchase from a supplier marked at risk or inactive (the record the buyer opens). */
const SupplierRiskNoteBody: React.FC<{ supplierId: string }> = ({ supplierId }) => {
  const { t } = useTranslation('supplyRisk');
  const supplier = useCompany(supplierId).data;
  const status = supplier?.supply_risk_status;
  if (!supplier || (status !== 'at_risk' && status !== 'inactive')) return null;
  return (
    <p role="note" className="text-control text-warning-foreground" data-testid="supply-risk-purchase-warning">
      <strong className="font-semibold">{t('warning.lead', 'Supplier warning')}</strong>
      {': '}
      <Link to={`/companies/${supplier.id}`} className="underline underline-offset-2">{supplier.name}</Link>
      {' '}
      {t('warning.purchaseBody', 'is {{status}}.', { status: supplyRiskLabel(t as never, status).toLowerCase() })}
    </p>
  );
};

/** Renders nothing outside the auth and query providers (bare renders of the page in unit tests). */
export const SupplierRiskNote: React.FC<{ supplierId: string }> = (props) => {
  const auth = useContext(AuthContext);
  const queryClient = useContext(QueryClientContext);
  if (!auth || !queryClient) return null;
  return <SupplierRiskNoteBody {...props} />;
};
