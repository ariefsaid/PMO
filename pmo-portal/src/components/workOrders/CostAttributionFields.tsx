import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, type ComboboxOption } from '@/src/components/ui';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import type { CostAttribution } from '@/src/lib/repositories/workOrderCosts';

/**
 * The work-order and discipline pickers every cost form shares (#2517, ADR-0103).
 *
 * A cost sits at project level (no work order) or on one of its project's work orders; cancelled work orders are
 * not offered. With no project there is nothing to pick from, so the work-order picker says so. The database
 * re-checks both values on save — this component only offers the valid ones.
 *
 * When the project changes, a work order picked for the old project is cleared (it cannot belong to the new one).
 */
export interface CostAttributionFieldsProps {
  projectId: string | null | undefined;
  value: CostAttribution;
  onChange: (next: CostAttribution) => void;
  disabled?: boolean;
  compact?: boolean;
  idPrefix?: string;
  /** Wraps each picker (e.g. a width in a flex row of fields). */
  itemClassName?: string;
}

export function CostAttributionFields({ projectId, value, onChange, disabled, compact, idPrefix = 'cost', itemClassName }: CostAttributionFieldsProps) {
  const { t } = useTranslation();
  const workOrders = useProjectWorkOrders(projectId ?? '');
  const disciplines = useCostDisciplines();

  const workOrderOptions: ComboboxOption[] = useMemo(
    () => (workOrders.data ?? [])
      .filter((wo) => wo.status !== 'Cancelled')
      .map((wo) => ({ value: wo.id, label: wo.wo_number ?? wo.title, sub: wo.wo_number ? wo.title : undefined, searchTerms: [wo.title, wo.client_po_number ?? ''] })),
    [workOrders.data],
  );
  const disciplineOptions: ComboboxOption[] = useMemo(
    () => (disciplines.data ?? []).map((d) => ({ value: d.id, label: d.name, sub: d.code, searchTerms: [d.code] })),
    [disciplines.data],
  );
  const loadWorkOrders = useCallback(async () => workOrderOptions, [workOrderOptions]);
  const loadDisciplines = useCallback(async () => disciplineOptions, [disciplineOptions]);

  // A work order belongs to one project: drop it when the project changes.
  const lastProject = useRef(projectId);
  useEffect(() => {
    if (lastProject.current !== projectId) {
      lastProject.current = projectId;
      if (value.workOrderId) onChange({ ...value, workOrderId: null });
    }
  }, [projectId, value, onChange]);

  const noProject = !projectId;
  const item = (node: React.ReactNode) => (itemClassName ? <div className={itemClassName}>{node}</div> : node);
  return (
    <>
      {item(<Combobox
        id={`${idPrefix}-work-order`}
        label={t('costAttribution.workOrder', 'Work order')}
        value={value.workOrderId}
        selectedOption={workOrderOptions.find((o) => o.value === value.workOrderId) ?? null}
        loadOptions={loadWorkOrders}
        statusOverride={workOrders.isLoading && !noProject ? 'loading' : workOrders.isError ? 'error' : undefined}
        onRetry={() => void workOrders.refetch()}
        onChange={(v) => onChange({ ...value, workOrderId: v || null })}
        clearable
        onClear={() => onChange({ ...value, workOrderId: null })}
        placeholder={t('costAttribution.projectLevel', 'Project level')}
        searchPlaceholder={t('costAttribution.searchWorkOrders', 'Search work orders…')}
        noun={t('costAttribution.workOrderNoun', 'work order')}
        nounPlural={t('costAttribution.workOrderNounPlural', 'work orders')}
        emptyMessage={t('costAttribution.noWorkOrders', 'This project has no open work orders.')}
        helper={noProject ? t('costAttribution.needsProject', 'Choose a project to pick one of its work orders.') : undefined}
        disabled={disabled || noProject}
        compact={compact}
      />)}
      {item(<Combobox
        id={`${idPrefix}-discipline`}
        label={t('costAttribution.discipline', 'Discipline')}
        value={value.disciplineId}
        selectedOption={disciplineOptions.find((o) => o.value === value.disciplineId) ?? null}
        loadOptions={loadDisciplines}
        statusOverride={disciplines.isLoading ? 'loading' : disciplines.isError ? 'error' : undefined}
        onRetry={() => void disciplines.refetch()}
        onChange={(v) => onChange({ ...value, disciplineId: v || null })}
        clearable
        onClear={() => onChange({ ...value, disciplineId: null })}
        placeholder={t('costAttribution.noDiscipline', 'No discipline')}
        searchPlaceholder={t('costAttribution.searchDisciplines', 'Search disciplines…')}
        noun={t('costAttribution.disciplineNoun', 'discipline')}
        nounPlural={t('costAttribution.disciplineNounPlural', 'disciplines')}
        emptyMessage={t('costAttribution.noDisciplines', 'Your organisation has no disciplines yet. An Admin adds them.')}
        disabled={disabled}
        compact={compact}
      />)}
    </>
  );
}
