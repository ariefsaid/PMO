import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, SelectField, TextField } from '@/src/components/ui';
import type { PurchaseLineCategory } from '@/src/lib/db/procurementLinePlanning';
import { EMPTY_PLANNING, type LinePlanningValue } from './linePlanningValue';

export interface LinePlanningSectionProps {
  lines: { id: string; name: string }[];
  values: Record<string, LinePlanningValue>;
  onChange: (lineId: string, next: LinePlanningValue) => void;
  categories: PurchaseLineCategory[];
  /** Read-only (a request past Draft, or a caller who may not edit the lines): shows the values as text. */
  readOnly?: boolean;
  busy?: boolean;
}

/**
 * #2696 — one row per request line: a category (the organisation's list) and the date it is needed. Optional both ways.
 * Rendered only when the organisation setting is on. A retired category stays visible on a line that carries it.
 */
export const LinePlanningSection: React.FC<LinePlanningSectionProps> = ({ lines, values, onChange, categories, readOnly, busy }) => {
  const { t } = useTranslation('procurement');
  if (lines.length === 0) return null;
  const options = [{ value: '', label: t('linePlanning.none', 'None') }, ...categories.filter((c) => !c.archived_at).map((c) => ({ value: c.id, label: c.name }))];
  return (
    <Card data-testid="line-planning-section">
      <CardHead>{t('linePlanning.section', 'Category and needed by')}</CardHead>
      <CardPad>
        <ul className="space-y-4">
          {lines.map((line) => {
            const value = values[line.id] ?? EMPTY_PLANNING;
            const current = categories.find((c) => c.id === value.categoryId);
            const rowOptions = current?.archived_at ? [...options, { value: current.id, label: `${current.name} (${t('linePlanning.retired', 'Retired')})` }] : options;
            return (
              <li key={line.id} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,10rem)] sm:items-end">
                <p className="min-w-0 break-words text-control font-medium">{line.name}</p>
                {readOnly ? (
                  <>
                    <p className="text-control" data-testid="line-planning-category">{current?.name ?? t('linePlanning.columnEmpty', '—')}</p>
                    <p className="text-control" data-testid="line-planning-needed-by">{value.neededBy || t('linePlanning.columnEmpty', '—')}</p>
                  </>
                ) : (
                  <>
                    <SelectField
                      label={t('linePlanning.category', 'Line category')}
                      value={value.categoryId}
                      onChange={(categoryId) => onChange(line.id, { ...value, categoryId })}
                      options={rowOptions}
                      disabled={busy}
                      fullWidth
                    />
                    <TextField
                      label={t('linePlanning.neededBy', 'Needed by')}
                      type="date"
                      value={value.neededBy}
                      onChange={(neededBy) => onChange(line.id, { ...value, neededBy })}
                      disabled={busy}
                      fullWidth
                    />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </CardPad>
    </Card>
  );
};
