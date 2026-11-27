import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buttonClasses, Icon } from '@/src/components/ui';
import StockLedger from '@/pages/stock/StockLedger';
import ConsumptionReport from './ConsumptionReport';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useMyStockLocations } from '@/src/hooks/useStock';

/** Materials used by this project against its allowances (#1512 S5), then the trace of every movement (S3). */
const MaterialsTab: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const isKeeper = useMyStockLocations().keepsAny;
  const canIssue = may('create', 'stockDocument', { record: { isKeeper, viewOnly: realRole !== effectiveRole } });
  return (
    <section aria-label={t('materials.title')} className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-group font-semibold">{t('materials.title')}</h2>
        {canIssue && (
          <Link to={`/stock/new/issue?project=${projectId}`} className={buttonClasses('primary', 'sm')}>
            <Icon name="plus" />{t('materials.issue')}
          </Link>
        )}
      </div>
      <section aria-labelledby="materials-consumption" className="panel-card flex min-w-0 flex-col gap-4 p-[var(--panel-inset)]">
        <h3 id="materials-consumption" className="text-base font-semibold">{t('materials.consumption')}</h3>
        <ConsumptionReport projectId={projectId} />
      </section>
      <section aria-labelledby="materials-movements" className="panel-card flex min-w-0 flex-col gap-4 p-[var(--panel-inset)]">
        <h3 id="materials-movements" className="text-base font-semibold">{t('materials.movements')}</h3>
        <StockLedger projectId={projectId} embedded />
      </section>
    </section>
  );
};

export default MaterialsTab;
