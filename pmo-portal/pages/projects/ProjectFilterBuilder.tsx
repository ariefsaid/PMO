import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { Filters } from '@/src/components/reui/filters/filters';
import type { FilterField, FilterLabels, FilterOption } from '@/src/components/reui/filters/filters-types';
import { trackFilterApplied } from '@/src/lib/analytics';
import { ACTIVE_PROJECT_STATUSES } from '@/src/lib/db/projects';
import {
  AWARD_TYPES, BIDDING_ENTITIES, classificationValueOptions,
} from '@/src/lib/projectClassification';
import {
  queryToPatch, workingSetToQuery, type ProjectFilterValue,
} from '@/src/lib/projects/projectFilterQuery';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import type { useProjectListModel } from './useProjectListModel';

type Option = { value: string; label: string };
const withoutAll = (options: Option[]): FilterOption[] => options.filter((o) => o.value !== 'All');

/** The builder chrome in the viewer's language; the operator words ride in `operatorLabels` below. */
function builderLabels(t: TFunction): Partial<FilterLabels> {
  return {
    addFilter: t('projects.filterBuilder.addFilter', 'Add filter'),
    clearAll: t('projects.filterBuilder.clearAll', 'Clear all'),
    searchFields: t('projects.filterBuilder.searchFields', 'Search filters…'),
    searchOperators: t('projects.filterBuilder.searchOperators', 'Search conditions…'),
    searchOptions: t('projects.filterBuilder.searchOptions', 'Search…'),
    back: t('projects.filterBuilder.back', 'Back'),
    clear: t('projects.filterBuilder.clear', 'Clear'),
    apply: t('projects.filterBuilder.apply', 'Apply'),
    discard: t('projects.filterBuilder.discard', 'Discard'),
    empty: t('projects.filterBuilder.empty', 'No results'),
    loading: t('projects.filterBuilder.loading', 'Loading…'),
    error: t('projects.filterBuilder.error', "Couldn't load"),
    retry: t('projects.filterBuilder.retry', 'Retry'),
    remove: t('projects.filterBuilder.remove', 'Remove filter'),
    filtersLabel: t('projects.filterBuilder.filtersLabel', 'Active filters'),
    selectCondition: t('projects.filterBuilder.selectCondition', 'Condition'),
    selectPlaceholder: t('projects.filterBuilder.selectPlaceholder', 'Select…'),
    valuePlaceholder: t('projects.filterBuilder.valuePlaceholder', 'Value'),
    noValue: t('projects.filterBuilder.noValue', 'Any'),
    incomplete: t('projects.filterBuilder.incomplete', 'Incomplete'),
    rangeSeparator: t('projects.filterBuilder.rangeSeparator', 'to'),
    rangeFrom: (field) => t('projects.filterBuilder.rangeFrom', '{{field}} from', { field }),
    rangeTo: (field) => t('projects.filterBuilder.rangeTo', '{{field}} to', { field }),
    valueRange: (from, to) => `${from} – ${to}`,
    valueCount: (count) => t('projects.filterBuilder.valueCount', '{{count}} selected', { count }),
    itemCount: (count) => t('projects.filterBuilder.itemCount', '{{count}} items', { count }),
  };
}

/**
 * The Projects filter builder (#1983): removable chips over the URL working set. Replaces the
 * customer / end-customer / project-manager selects and the classification panel; the status
 * segments and search stay beside it. Filtering itself is client-side (`useProjectListModel`).
 */
export function ProjectFilterBuilder({ model, t, canViewMoney }: {
  model: ReturnType<typeof useProjectListModel>; t: TFunction; canViewMoney: boolean;
}) {
  const { workingSet, setWorkingSet, all, customerFilterOptions, endCustomerFilterOptions, pmFilterOptions,
    clientCompaniesResult, companiesResult, projectManagersResult, isEngineer } = model;
  const statusLabel = useProjectStatusLabel();
  const query = useMemo(() => workingSetToQuery(workingSet, canViewMoney), [workingSet, canViewMoney]);

  const fields = useMemo<FilterField<ProjectFilterValue>[]>(() => {
    const distinct = (field: 'service_line' | 'sector', selected?: string): FilterOption[] =>
      [...new Set([...all.map((p) => p[field]), selected])]
        .filter((v): v is string => Boolean(v)).sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
    const day = (id: string, label: string): FilterField<ProjectFilterValue> => ({
      id, label, type: 'text', data: { input: 'date' },
      operators: [
        { value: 'is_on_or_after', label: t('projects.filterBuilder.onOrAfter', 'is on or after'), arity: 'one' },
        { value: 'is_on_or_before', label: t('projects.filterBuilder.onOrBefore', 'is on or before'), arity: 'one' },
        { value: 'between', label: t('projects.filterBuilder.between', 'is between'), arity: 'range' },
      ],
    });
    // A restored link may name a row that is not in the list: keep it selectable (and removable) as "Unavailable".
    const single = (id: string, label: string, options: FilterOption[], selected?: string): FilterField<ProjectFilterValue> =>
      ({ id, label, type: 'select',
        options: selected && selected !== 'All' && !options.some((o) => o.value === selected)
          ? [...options, { value: selected, label: t('projects.mobile.unavailable', 'Unavailable selection') }] : options,
        operators: [{ value: 'is', label: t('projects.filterBuilder.is', 'is'), arity: 'one' }] });
    const list: FilterField<ProjectFilterValue>[] = [
      { id: 'status', label: t('projects.filterBuilder.status', 'Status'), type: 'select',
        options: ACTIVE_PROJECT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
        operators: [{ value: 'is_any_of', label: t('projects.filterBuilder.isAnyOf', 'is any of'), arity: 'many' }] },
    ];
    // N19: customer / manager browsing is not offered to an Engineer (their scope is "My Projects").
    if (!isEngineer) {
      list.push(
        single('client', t('projects.filterBuilder.customer', 'Customer'), withoutAll(customerFilterOptions), workingSet.client),
        single('endClient', t('projects.filterBuilder.endCustomer', 'End customer'), withoutAll(endCustomerFilterOptions), workingSet.endClient),
        single('pm', t('projects.filterBuilder.manager', 'Project manager'), withoutAll(pmFilterOptions), workingSet.pm),
      );
    }
    list.push(
      day('startDate', t('projects.filterBuilder.startDate', 'Start date')),
      day('endDate', t('projects.filterBuilder.endDate', 'End date')),
    );
    if (canViewMoney) {
      list.push({ id: 'contractValue', label: t('projects.filterBuilder.contractValue', 'Contract value'), type: 'number',
        operators: [
          { value: 'gte', label: t('projects.filterBuilder.atLeast', 'is at least'), arity: 'one' },
          { value: 'lte', label: t('projects.filterBuilder.atMost', 'is at most'), arity: 'one' },
          { value: 'between', label: t('projects.filterBuilder.between', 'is between'), arity: 'range' },
        ] });
    }
    list.push(
      single('serviceLine', t('projectClassification.serviceLine', 'Service line'), distinct('service_line', workingSet.serviceLine)),
      single('sector', t('projectClassification.sector', 'Sector'), distinct('sector', workingSet.sector)),
      single('awardType', t('projectClassification.awardType', 'Award type'), classificationValueOptions(t, AWARD_TYPES), workingSet.awardType),
      single('biddingEntity', t('projectClassification.biddingEntity', 'Bidding entity'), classificationValueOptions(t, BIDDING_ENTITIES), workingSet.biddingEntity),
      { id: 'location', label: t('projectClassification.location', 'Location'), type: 'text',
        operators: [{ value: 'contains', label: t('projects.filterBuilder.contains', 'contains'), arity: 'one' }] },
    );
    return list;
  }, [all, workingSet, t, statusLabel, isEngineer, canViewMoney, customerFilterOptions, endCustomerFilterOptions, pmFilterOptions]);

  const failed = [clientCompaniesResult, companiesResult, projectManagersResult].filter((r) => !r.isPending && r.isError);
  return (
    <div data-testid="project-filter-builder" className="min-w-0 max-w-full">
      <Filters<ProjectFilterValue>
        fields={fields}
        query={query}
        size="sm"
        showClear
        labels={builderLabels(t)}
        onBeforeQueryChange={(next) => {
          // One rule per field: the working set holds one value per key.
          const ids = next.rules.map((r) => (r.type === 'rule' ? r.path[0] : ''));
          return new Set(ids).size === ids.length;
        }}
        onQueryChange={(next, details) => {
          setWorkingSet((ws) => ({ ...ws, ...queryToPatch(next) }));
          if (details.reason === 'add' || details.reason === 'update') {
            trackFilterApplied(details.rule?.path[0] ?? 'builder', fields.length, 'projects');
          }
        }}
      />
      {failed.length > 0 && (
        <div className="mt-1 flex items-center gap-2">
          <p role="alert" className="text-[12px] text-destructive">{t('projects.mobile.error', "Couldn't load options")}</p>
          <button type="button" onClick={() => failed.forEach((r) => void r.refetch())}
            className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline">
            {t('projects.mobile.retry', 'Retry')}
          </button>
        </div>
      )}
    </div>
  );
}
