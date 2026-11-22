import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, type ComboboxOption } from '@/src/components/ui';
import { useCrewWorkOrders } from '@/src/hooks/useCrews';

/** The organisation's open work orders (#2528): the roster and tick screens start from one. */
export function WorkOrderPicker({ value, onChange, id, remember = false }: { value: string | null; onChange: (id: string | null) => void; id: string; remember?: boolean }) {
  const { t } = useTranslation('crews');
  const workOrders = useCrewWorkOrders();
  // The crew schedule screens open on the work order the person used last, per browser. It is applied only when the
  // address names none and that work order is in this organisation's open list (an id from another organisation never matches);
  // choosing another replaces it.
  const storageKey = 'pmo.crews.lastWorkOrder';
  useEffect(() => {
    if (!remember || value || !workOrders.data) return;
    try {
      const last = window.localStorage.getItem(storageKey);
      if (last && workOrders.data.some((wo) => wo.id === last)) onChange(last);
    } catch { /* storage unavailable: start empty */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applied once the open work orders have loaded
  }, [remember, storageKey, workOrders.data]);
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
      onChange={(v) => {
        if (remember && v) { try { window.localStorage.setItem(storageKey, v); } catch { /* ignore */ } }
        onChange(v || null);
      }}
      placeholder={t('crews:pickWorkOrder', 'Choose a work order')}
      searchPlaceholder={t('crews:searchWorkOrders', 'Search work orders…')}
      noun={t('crews:workOrderNoun', 'work order')}
      nounPlural={t('crews:workOrderNounPlural', 'work orders')}
      emptyMessage={t('crews:noWorkOrders', 'No open work orders.')}
    />
  );
}
