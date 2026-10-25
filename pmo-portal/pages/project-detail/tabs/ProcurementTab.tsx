import React, { useMemo, useState } from 'react';
import {
  Button,
  DataTable,
  Icon,
  SearchMini,
  StatusPill,
  Toolbar,
  type Column,
} from '@/src/components/ui';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency, formatInstantDate } from '@/src/lib/format';
import { useProcurementStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { LEGAL_TRANSITIONS, type ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { pillVariantForStatus, openPR } from '../../../components/procurement';
import { ErpPurchasesSection } from '../ErpPurchasesSection';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';

export interface ProcurementTabProps {
  projectId: string;
}

const PROCUREMENT_STATUSES = Object.keys(LEGAL_TRANSITIONS) as ProcurementStatus[];

const ProcurementTab: React.FC<ProcurementTabProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const statusLabel = useProcurementStatusLabel();
  const { data, isPending, isError, refetch } = useProjectProcurements(projectId);
  const canCreate = may('create', 'procurement');
  const erp = useErpPurchases(projectId, { enabled: may('view', 'procurement') });
  const erpListedBelow = (erp.data ?? []).some((row) => row.procurementId === null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProcurementStatus | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  const rows = useMemo(() => {
    const ordered = [...(data ?? [])].sort((left, right) => {
      const byDate = Date.parse(right.created_at) - Date.parse(left.created_at);
      return (sortOrder === 'newest' ? byDate : -byDate) || left.id.localeCompare(right.id);
    });
    const query = search.trim().toLocaleLowerCase();
    return ordered.filter((row) => {
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
      const matchesSearch = !query || [row.title, row.code, row.id, row.vendor?.name]
        .some((value) => value?.toLocaleLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [data, search, sortOrder, statusFilter]);

  const columns: Column<ProcurementWithRefs>[] = [
    {
      key: 'request',
      header: t('projectDetail.procurement.column.request', 'Request'),
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold" title={row.title}>{row.title}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {row.code ?? row.id.slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      key: 'vendor',
      header: t('projectDetail.procurement.column.vendor', 'Vendor'),
      kind: 'meta',
      cell: (row) => <span className="text-muted-foreground">{row.vendor?.name ?? '—'}</span>,
    },
    {
      key: 'statusDate',
      header: t('projectDetail.procurement.column.statusDate', 'Status / date'),
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusPill variant={pillVariantForStatus(row.status as ProcurementStatus)}>
            {statusLabel(row.status as ProcurementStatus)}
          </StatusPill>
          <time dateTime={row.created_at} className="text-[12px] text-muted-foreground">
            {formatInstantDate(row.created_at)}
          </time>
        </div>
      ),
    },
    {
      key: 'value',
      header: t('projectDetail.procurement.column.value', 'Value'),
      align: 'num',
      cell: (row) => formatCurrency(row.total_value, row.currency),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('table.actions', 'Actions')}</span>,
      kind: 'actions',
      align: 'num',
      size: 100,
      minSize: 100,
      maxSize: 140,
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          aria-label={`${t('projectDetail.procurement.openRow', 'Open')} ${row.code ?? row.id.slice(0, 8)}`}
          onClick={(event) => {
            event.stopPropagation();
            openPR(navigate, row);
          }}
        >
          {t('projectDetail.procurement.openRow', 'Open')}
        </Button>
      ),
    },
  ];

  const hasActiveFilters = search.trim().length > 0 || statusFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
  };
  const listState = isPending ? 'loading' : (isError || !data) ? 'error' : rows.length === 0 ? 'empty' : undefined;

  return (
    <div>
      <Toolbar standalone role="group" aria-label={t('projectDetail.procurement.toolbar.label', 'Purchase request tools')}>
        <SearchMini
          placeholder={t('projectDetail.procurement.toolbar.searchPlaceholder', 'Search requests by name, code, or vendor…')}
          aria-label={t('projectDetail.procurement.toolbar.searchLabel', 'Search purchase requests')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          containerClassName="max-sm:h-11 max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:flex-1"
        />
        <select
          aria-label={t('projectDetail.procurement.toolbar.statusFilter', 'Status filter')}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ProcurementStatus | 'all')}
          className="h-8 max-sm:h-11 w-full sm:w-auto rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <option value="all">{t('projectDetail.procurement.toolbar.allStatuses', 'All statuses')}</option>
          {PROCUREMENT_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
        <select
          aria-label={t('projectDetail.procurement.toolbar.sortRequests', 'Sort requests')}
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as 'newest' | 'oldest')}
          className="h-8 max-sm:h-11 w-full sm:w-auto rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <option value="newest">{t('projectDetail.procurement.toolbar.newest', 'Newest request date')}</option>
          <option value="oldest">{t('projectDetail.procurement.toolbar.oldest', 'Oldest request date')}</option>
        </select>
        {canCreate && (
          <Button
            variant="primary"
            size="sm"
            className="max-sm:min-h-11 max-sm:w-full"
            onClick={() => navigate(`/procurement/new?project=${encodeURIComponent(projectId)}`)}
          >
            <Icon name="plus" />
            {t('projectDetail.procurement.newRequest', 'New request')}
          </Button>
        )}
      </Toolbar>

      <section aria-labelledby="project-procurement-heading">
        <h2 id="project-procurement-heading" className="mb-3.5 text-[16px] font-bold tracking-[-0.01em]">
          {t('projectDetail.procurement.title', 'Purchase Requests')}
        </h2>
        <DataTable<ProcurementWithRefs>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          onActivate={(row) => openPR(navigate, row)}
          rowLabel={(row) => `${t('projectDetail.procurement.openRow', 'Open')} ${row.title}`}
          state={listState}
          errorTitle={t('projectDetail.procurement.error.title', "Couldn't load procurement")}
          errorSub={t('projectDetail.procurement.error.sub', "Something went wrong fetching this project's purchase requests.")}
          onRetry={() => void refetch()}
          emptyTitle={hasActiveFilters
            ? t('projectDetail.procurement.empty.noMatches', 'No requests match these search and filters')
            : t('projectDetail.procurement.empty.title', 'No purchase requests for this project yet')}
          emptySub={!hasActiveFilters && erpListedBelow ? t(
            'uxs19.projectEmptyScope',
            'This list covers PMO requests. Purchases recorded in ERPNext appear below.',
          ) : undefined}
          emptyAction={hasActiveFilters ? {
            label: t('projectDetail.procurement.toolbar.clearSearchAndFilters', 'Clear search and filters'),
            onClick: clearFilters,
          } : undefined}
          cardBelow={700}
          tableId="project-detail-tabs-procurementtab-table"
        />
      </section>

      <ErpPurchasesSection projectId={projectId} />
    </div>
  );
};

export default ProcurementTab;
