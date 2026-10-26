import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { Button, ListState, SearchMini, SelectField } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useErpOrphans } from '@/src/hooks/useErpPurchases';
import { useProjects } from '@/src/hooks/useProjects';
import { ErpOrphansSection } from './procurement/ErpOrphansSection';
import { MoneyOutListPage } from './procurement/MoneyOutHeader';
import { useUrlSearchInput } from '@/src/hooks/useListWorkingSet';
import { useListReturn } from '@/src/hooks/useListReturn';

/** FR-PFE-041 — the org's ERPNext purchase documents not yet in a purchase, with their project; each can be linked. */
const ErpPurchasesPage: React.FC = () => {
  const { t } = useTranslation('finance');
  const location = useLocation();
  const navigate = useNavigate();
  const { returnToList } = useListReturn({ list: 'procurement' });
  const may = usePermission();
  const canView = may('view', 'procurement');
  const canLink = may('create', 'erpPurchaseLink');
  const purchases = useErpOrphans(undefined, { enabled: canView });
  const projects = useProjects({ enabled: canView });
  const projectNames = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const orphans = useMemo(() => purchases.data ?? [], [purchases.data]);
  const params = new URLSearchParams(location.search);
  const project = params.get('project') ?? 'All';
  const type = params.get('type') ?? 'All';
  const sort = params.get('sort') === 'reverse' ? 'reverse' : 'default';
  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(location.search);
    if (!value || value === 'All' || (key === 'sort' && value === 'default')) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true, state: location.state });
  }, [location.pathname, location.search, location.state, navigate]);
  const [search, setSearch] = useUrlSearchInput(params.get('q') ?? '', (value) => setParam('q', value));
  const types = useMemo(() => [...new Set(orphans.map((row) => row.doctype))].sort(), [orphans]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return orphans
      .filter((row) => type === 'All' || row.doctype === type)
      .filter((row) => project === 'All' || row.projectIds.includes(project))
      .filter((row) => !query || [row.name, row.supplier ?? '', row.doctype].some((value) => value.toLocaleLowerCase().includes(query)))
      .sort((left, right) => {
        const leftDate = left.docDate ? Date.parse(left.docDate) : Number.NaN;
        const rightDate = right.docDate ? Date.parse(right.docDate) : Number.NaN;
        if (Number.isNaN(leftDate) !== Number.isNaN(rightDate)) return Number.isNaN(leftDate) ? 1 : -1;
        if (!Number.isNaN(leftDate) && leftDate !== rightDate) {
          return sort === 'reverse' ? leftDate - rightDate : rightDate - leftDate;
        }
        return left.name.localeCompare(right.name);
      });
  }, [orphans, project, search, sort, type]);
  const clearFilters = () => {
    setSearch('');
    const next = new URLSearchParams(location.search);
    for (const key of ['q', 'project', 'type']) next.delete(key);
    const query = next.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true, state: location.state });
  };
  const selectionKey = [search, project, type, sort].join('|');

  return (
    <MoneyOutListPage
      title={t('erpLinks.orphansTitle', 'ERPNext documents not in a purchase')}
      scope={t('erpLinks.pageDescription', 'Orders, receipts, invoices and payments entered in ERPNext that no purchase holds yet. Their cost is already in each project\'s Actuals.')}
      returnAction={{
        label: t('erpPurchases.backToProcurement', 'Procurement requests'),
        onReturn: () => returnToList('procurement'),
        phoneOnly: true,
      }}
      count={canView && purchases.data ? filtered.length : undefined}
      filters={canView && !purchases.isPending && (
        <div data-testid="money-out-toolbar" className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <SearchMini
            placeholder={t('erpPurchases.searchPlaceholder', 'Search documents or suppliers…')}
            aria-label={t('erpPurchases.searchLabel', 'Search ERP documents')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            containerClassName="min-w-0 flex-[1_1_14rem]"
          />
          <SelectField
            label={t('erpPurchases.projectFilter', 'Project')}
            hideLabel
            value={project}
            onChange={(value) => setParam('project', value)}
            options={[
              { value: 'All', label: t('erpPurchases.allProjects', 'All projects') },
              ...(projects.data ?? []).map((item) => ({ value: item.id, label: item.name })),
            ]}
            className="min-h-11 min-w-40 max-w-full"
          />
          <SelectField
            label={t('erpPurchases.typeFilter', 'Document type')}
            hideLabel
            value={type}
            onChange={(value) => setParam('type', value)}
            options={[
              { value: 'All', label: t('erpPurchases.allTypes', 'All types') },
              ...types.map((value) => ({ value, label: value })),
            ]}
            className="min-h-11 min-w-40 max-w-full"
          />
          <Button
            variant="outline"
            className="min-h-11"
            aria-label={t('erpPurchases.sortToggle', 'Sort by document date: {{order}}', {
              order: sort === 'reverse'
                ? t('erpPurchases.oldestDocumentDate', 'Oldest document date')
                : t('erpPurchases.latestDocumentDate', 'Latest document date'),
            })}
            onClick={() => setParam('sort', sort === 'default' ? 'reverse' : 'default')}
          >
            {sort === 'reverse'
              ? t('erpPurchases.oldestDocumentDate', 'Oldest document date')
              : t('erpPurchases.latestDocumentDate', 'Latest document date')}
          </Button>
        </div>
      )}
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
      ) : filtered.length === 0 ? (
        <ListState
          variant="empty"
          title={t('erpPurchases.noMatch', 'No documents match these filters')}
          action={{ label: t('erpPurchases.clearFilters', 'Clear filters'), onClick: clearFilters }}
        />
      ) : (
        <ErpOrphansSection key={selectionKey} rows={filtered} canLink={canLink} projectNames={projectNames} />
      )}
    </MoneyOutListPage>
  );
};

export default ErpPurchasesPage;
