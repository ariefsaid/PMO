import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ListPage, ListState, Card } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { useProjects } from '@/src/hooks/useProjects';
import { localToday } from '@/src/lib/efaktur';
import { ErpPurchasesTable } from './procurement/ErpPurchasesTable';

/** FR-EPR-007 — the org's ERP-native purchases with their project. Read-only (DD-XING-2). */
const ErpPurchasesPage: React.FC = () => {
  const { t } = useTranslation('finance');
  const canView = usePermission()('view', 'procurement');
  const purchases = useErpPurchases(undefined, { enabled: canView });
  const projects = useProjects({ enabled: canView });
  const projectNames = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const rows = purchases.data ?? [];

  return (
    <ListPage
      title={t('erpPurchases.title', 'Purchases recorded in ERPNext')}
      description={t('erpPurchases.pageDescription', 'Purchase orders and supplier invoices entered in ERPNext. Their cost is already in each project\'s Actuals.')}
      count={canView && purchases.data ? rows.length : undefined}
      primaryAction={<Link to="/procurement" className="text-sm font-medium text-primary hover:underline">{t('erpPurchases.backToProcurement', 'Procurement requests')}</Link>}
    >
      {!canView ? (
        <ListState variant="empty" title={t('erpPurchases.noAccess', "You don't have access to the organization's purchases")} />
      ) : purchases.isError ? (
        <ListState variant="error" title={t('erpPurchases.error', "Couldn't load ERP purchases")} onRetry={() => purchases.refetch()} />
      ) : purchases.isPending ? (
        <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>
      ) : rows.length === 0 ? (
        <ListState variant="empty" icon="table" title={t('erpPurchases.empty', 'No purchases from ERPNext yet')}
          sub={t('erpPurchases.emptySub', 'They appear here after the next sync once ERPNext is connected.')} />
      ) : (
        <Card className="overflow-hidden">
          <ErpPurchasesTable rows={rows} today={localToday()} projectNames={projectNames} />
        </Card>
      )}
    </ListPage>
  );
};

export default ErpPurchasesPage;
