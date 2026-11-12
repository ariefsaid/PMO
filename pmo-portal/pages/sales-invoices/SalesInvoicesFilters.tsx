import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  cn,
  FilterBar,
  ViewToggle,
} from '@/src/components/ui';
import { salesInvoiceStatusLabel, type StatusFilter } from './salesInvoiceListModel';

type InvoiceGroupMode = 'none' | 'client' | 'project';

/** The receivables list toolbar: status filter, customer/project chips, overdue toggle, group-by. */
const SalesInvoicesFilters: React.FC<{
  embedded: boolean;
  isDesktop: boolean;
  statusFilters: readonly StatusFilter[];
  statusFilter: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onClearFilters: () => void;
  shownCount: number;
  totalCount: number;
  requestedCustomerId: string | null;
  selectedCustomerLabel: string | null;
  customerOptionsPending: boolean;
  onClearCustomer: () => void;
  contextualProjectId: string | null;
  selectedProjectLabel: string | null;
  onClearProject: () => void;
  overdueActive: boolean;
  organizationToday: string | null;
  onToggleOverdue: () => void;
  groupMode: InvoiceGroupMode;
  onGroupChange: (value: InvoiceGroupMode) => void;
}> = ({
  embedded,
  isDesktop,
  statusFilters,
  statusFilter,
  onStatusChange,
  search,
  onSearchChange,
  onClearFilters,
  shownCount,
  totalCount,
  requestedCustomerId,
  selectedCustomerLabel,
  customerOptionsPending,
  onClearCustomer,
  contextualProjectId,
  selectedProjectLabel,
  onClearProject,
  overdueActive,
  organizationToday,
  onToggleOverdue,
  groupMode,
  onGroupChange,
}) => {
  const { t } = useTranslation();
  return (
    <div
      role="region"
      aria-label={t('financeCopy.filterByStatus', "Filter by status")}
      tabIndex={0}
      className={embedded
        // P5: on a phone the filters wrap onto a second line instead of running past the screen edge.
        ? isDesktop
          ? 'flex min-w-0 shrink-0 flex-col gap-2 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
          : 'flex min-w-0 max-w-full flex-col gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
        : 'min-w-0 max-w-full flex flex-col gap-2 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'}
    >
      <FilterBar
        searchKey="q"
        searchLabel={t('financeCopy.searchSalesInvoices', "Search sales invoices")}
        searchPlaceholder={t('financeCopy.searchInvoices', "Search invoices…")}
        searchSurface="sales-invoices-list"
        module="salesInvoices"
        filters={[
          {
            key: 'status',
            label: t('financeCopy.filterByStatus', "Filter by status"),
            kind: 'segment',
            semantics: 'tabs',
            options: statusFilters.filter((f) => f !== 'All').map((f) => ({ value: f, label: salesInvoiceStatusLabel(f, t) })),
          },
        ]}
        values={{
          q: search,
          status: statusFilter === 'All' ? '' : statusFilter,
        }}
        onChange={(key, value) => {
          if (key === 'status') {
            onStatusChange((value || 'All') as StatusFilter);
          } else if (key === 'q') {
            onSearchChange(value);
          }
        }}
        onClear={onClearFilters}
        shown={shownCount}
        total={totalCount}
        labels={{
          all: t('financeCopy.statusAll', 'All'),
          clear: t('finance:financeCopy.clearAll', 'Clear all'),
          filters: t('finance:receivables.filters', 'Filters'),
        }}
      />
      <div data-testid="invoice-filter-group" className={embedded ? (isDesktop ? 'flex shrink-0 items-center gap-2' : 'flex min-w-0 max-w-full flex-wrap items-center gap-2') : 'mt-2 flex flex-wrap items-end gap-2'}>
        {requestedCustomerId && (
          <div data-testid="customer-filter" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
            <span role="status" className="min-w-0 break-words text-sm">
              {t('dashboard.uxs36CustomerFilterLabel', 'Customer')}: <span className="font-medium">
                {selectedCustomerLabel ?? (customerOptionsPending
                  // #1175: a still-loading option request has not decided anything yet — claim
                  // "loading", not "unavailable", until it resolves.
                  ? t('dashboard.uxs36CustomerFilterLoading', 'Loading customer…')
                  : t('dashboard.uxs36CustomerFilterUnavailable', 'Selected customer is unavailable'))}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearCustomer}
            >{t('dashboard.uxs36CustomerFilterClear', 'Clear customer filter')}</Button>
          </div>
        )}
        {contextualProjectId && (
          <div data-testid="project-filter" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
            <span role="status" className="min-w-0 break-words text-sm">
              {t('financeCopy.project', 'Project')}: <span className="font-medium">
                {selectedProjectLabel ?? t('financeCopy.projectUnavailable', 'Project details unavailable')}
              </span>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onClearProject}>
              {t('finance:invoices.clearProject', 'Clear project filter')}
            </Button>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={overdueActive}
          disabled={!organizationToday && !overdueActive}
          onClick={onToggleOverdue}
          className={cn(
            'h-8 max-sm:h-11',
            overdueActive
              ? 'border-primary/40 bg-primary/10 font-semibold text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >{t('uxs05.overdueOnly', 'Overdue only')}</Button>
        {embedded && <div className="flex flex-wrap items-center gap-2">
          <span className="text-control font-medium text-muted-foreground">{t('finance:receivables.groupBy', 'Group by')}</span>
          <ViewToggle<InvoiceGroupMode>
            options={[
              { value: 'none', label: t('finance:receivables.groupNone', 'None') },
              { value: 'client', label: t('finance:receivables.groupClient', 'Client') },
              { value: 'project', label: t('finance:receivables.groupProject', 'Project') },
            ]}
            value={groupMode}
            onChange={onGroupChange}
            ariaLabel={t('finance:receivables.groupBy', 'Group by')}
          />
        </div>}
      </div>
    </div>
  );
};

export default SalesInvoicesFilters;
