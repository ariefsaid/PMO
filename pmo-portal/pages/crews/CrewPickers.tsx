import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, type ComboboxOption } from '@/src/components/ui';
import { useCrewWorkOrders } from '@/src/hooks/useCrews';

/** The organisation's open work orders (#2528): the roster and tick screens start from one. */
export function WorkOrderPicker({ value, onChange, id }: { value: string | null; onChange: (id: string | null) => void; id: string }) {
  const { t } = useTranslation('crews');
  const workOrders = useCrewWorkOrders();
  const options: ComboboxOption[] = useMemo(
    () => (workOrders.data ?? []).map((wo) => ({
      value: wo.id, label: wo.wo_number ?? wo.title, sub: wo.wo_number ? wo.title : undefined, searchTerms: [wo.title],
    })),
    [workOrders.data],
  );
  const load = useCallback(async () => options, [options]);
  return (
    <Combobox
      id={id}
      label={t('crews:workOrder', 'Work order')}
      value={value}
      selectedOption={options.find((o) => o.value === value) ?? null}
      loadOptions={load}
      statusOverride={workOrders.isLoading ? 'loading' : workOrders.isError ? 'error' : undefined}
      onRetry={() => void workOrders.refetch()}
      onChange={(v) => onChange(v || null)}
      placeholder={t('crews:pickWorkOrder', 'Choose a work order')}
      searchPlaceholder={t('crews:searchWorkOrders', 'Search work orders…')}
      noun={t('crews:workOrderNoun', 'work order')}
      nounPlural={t('crews:workOrderNounPlural', 'work orders')}
      emptyMessage={t('crews:noWorkOrders', 'No open work orders.')}
    />
  );
}
