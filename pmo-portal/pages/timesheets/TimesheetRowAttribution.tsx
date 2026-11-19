import React from 'react';
import { useTranslation } from 'react-i18next';
import { CostAttributionFields } from '@/src/components/workOrders/CostAttributionFields';
import type { CostAttribution } from '@/src/lib/repositories/workOrderCosts';

/**
 * #2517: each project row's work order and discipline, under the editable week grid. They are saved with the row's
 * hours on Save (save_timesheet_week 0952), so the week's one Save stays the only write.
 */
export function TimesheetRowAttribution({ rows, onChange }: {
  rows: Array<{ projectId: string; project: string; attribution: CostAttribution }>;
  onChange: (projectId: string, attribution: CostAttribution) => void;
}) {
  const { t } = useTranslation('workOrderCost');
  if (rows.length === 0) return null;
  return (
    <section data-testid="timesheets-row-attribution" aria-label={t('workOrderCost:timesheetSection', 'Work order and discipline per project')}
      className="border-t border-border px-3.5 py-3">
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('workOrderCost:timesheetSection', 'Work order and discipline per project')}</h3>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.projectId} className="flex flex-wrap items-end gap-3">
            <span className="w-full text-sm font-medium text-foreground sm:w-48 sm:pb-2">{r.project}</span>
            <CostAttributionFields idPrefix={`ts-${r.projectId}`} itemClassName="min-w-48 flex-1 sm:max-w-64" compact
              projectId={r.projectId} value={r.attribution} onChange={(next) => onChange(r.projectId, next)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
