import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ListPage, ListState, Card } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useErpOrphans } from '@/src/hooks/useErpPurchases';
import { useProjects } from '@/src/hooks/useProjects';
import { ErpOrphansSection } from './procurement/ErpOrphansSection';

/** FR-PFE-041 — the org's ERPNext purchase documents not yet in a purchase, with their project; each can be linked. */
const ErpPurchasesPage: React.FC = () => {
  const { t } = useTranslation('finance');
  const may = usePermission();
  const canView = may('view', 'procurement');
  const canLink = may('create', 'erpPurchaseLink');
  const purchases = useErpOrphans(undefined, { enabled: canView });
  const projects = useProjects({ enabled: canView });
  const projectNames = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const orphans = useMemo(() => purchases.data ?? [], [purchases.data]);

  return (
    <ListPage
      title={t('erpLinks.orphansTitle', 'ERPNext documents not in a purchase')}
      description={t('erpLinks.pageDescription', 'Orders, receipts, invoices and payments entered in ERPNext that no purchase holds yet. Their cost is already in each project\'s Actuals.')}
      count={canView && purchases.data ? orphans.length : undefined}
      primaryAction={canView
        ? <Link to="/procurement" className="text-sm font-medium text-primary hover:underline">{t('erpPurchases.backToProcurement', 'Procurement')}</Link>
        : undefined}
    >
      {!canView ? (
        <ListState variant="empty" title={t('erpPurchases.noAccess', "You don't have access to the organization's purchases")} />
      ) : purchases.isError ? (
        <ListState variant="error" title={t('erpLinks.loadError', "Couldn't load the ERPNext documents not in a purchase")} onRetry={() => purchases.refetch()} />
      ) : purchases.isPending ? (
        <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>
      ) : orphans.length === 0 ? (
        <ListState variant="empty" icon="table" title={t('erpLinks.allLinked', 'Every ERPNext document is in a purchase')}
          sub={t('erpLinks.allLinkedSub', 'New documents appear here after the next sync.')} />
      ) : (
        <Card className="overflow-hidden">
          <ErpOrphansSection rows={orphans} canLink={canLink} projectNames={projectNames} />
        </Card>
      )}
    </ListPage>
  );
};

export default ErpPurchasesPage;
