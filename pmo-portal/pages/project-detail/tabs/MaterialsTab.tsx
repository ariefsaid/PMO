import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/src/components/ui';
import StockLedger from '@/pages/stock/StockLedger';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useStockKeepers } from '@/src/hooks/useStock';

/** Materials issued to this project and the trace of every movement (#1512 S3). S5 adds the consumption report above. */
const MaterialsTab: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const keepers = useStockKeepers();
  const isKeeper = (keepers.data ?? []).some((k) => k.user_id === me);
  const canIssue = may('create', 'stockDocument', { record: { isKeeper, viewOnly: realRole !== effectiveRole } });
  return (
    <section aria-label={t('materials.title')} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-group font-semibold">{t('materials.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('materials.description')}</p>
        </div>
        {canIssue && (
          <Link to={`/stock/new/issue?project=${projectId}`}>
            <Button variant="primary" size="sm"><Icon name="plus" />{t('materials.issue')}</Button>
          </Link>
        )}
      </div>
      <StockLedger projectId={projectId} embedded />
    </section>
  );
};

export default MaterialsTab;
