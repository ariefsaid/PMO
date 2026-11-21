import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useLineCategories, useLinePlanningEnabled } from '@/src/hooks/usePurchaseLinePlanning';
import { setProcurementLinePlanning } from '@/src/lib/db/procurementLinePlanning';
import { LinePlanningSection } from './LinePlanningSection';
import { EMPTY_PLANNING, type LinePlanningValue } from './linePlanningValue';

/** A line row as read from the case; the two planning columns are NULL for every line of an organisation that never turned planning on. */
type PlannedLine = { id: string; name: string; category_id?: string | null; needed_by?: string | null };

const initial = (items: PlannedLine[]): Record<string, LinePlanningValue> =>
  Object.fromEntries(items.map((i) => [i.id, { categoryId: i.category_id ?? '', neededBy: i.needed_by ?? '' }]));

/**
 * #2696 — the case's line planning (category and needed-by per line). Renders nothing while the organisation setting is off.
 * Editable only on a Draft the caller may edit; the server (set_procurement_line_planning) decides.
 */
export const LinePlanningPanel: React.FC<{ items: PlannedLine[]; editable: boolean }> = ({ items, editable }) => {
  const { t } = useTranslation('procurement');
  const enabled = useLinePlanningEnabled();
  const categories = useLineCategories(enabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [values, setValues] = useState<Record<string, LinePlanningValue>>(() => initial(items));
  const signature = items.map((i) => `${i.id}:${i.category_id ?? ''}:${i.needed_by ?? ''}`).join('|');
  useEffect(() => { setValues(initial(items)); }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setSaving(true); setSaved(false); setFailure(null);
    try {
      const changed = items.filter((i) => {
        const v = values[i.id] ?? EMPTY_PLANNING;
        return v.categoryId !== (i.category_id ?? '') || v.neededBy !== (i.needed_by ?? '');
      });
      for (const i of changed) {
        const v = values[i.id] ?? EMPTY_PLANNING;
        await setProcurementLinePlanning(i.id, v.categoryId || null, v.neededBy || null);
      }
      setSaved(true);
    } catch (e) {
      setFailure(e);
    } finally {
      setSaving(false);
    }
  };
  if (!enabled || items.length === 0) return null;
  const error = failure ? classifyMutationError(failure) : null;
  return (
    <div className="space-y-2" data-testid="line-planning-panel">
      <LinePlanningSection
        lines={items}
        values={values}
        onChange={(id, next) => { setSaved(false); setFailure(null); setValues((current) => ({ ...current, [id]: next })); }}
        categories={categories.data ?? []}
        readOnly={!editable}
        busy={saving}
      />
      {editable && (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" loading={saving} onClick={() => void save()}>{t('linePlanning.save', 'Save')}</Button>
          <p role="status" className="text-control text-muted-foreground">{saved ? t('linePlanning.saved', 'Saved') : ''}</p>
        </div>
      )}
      {error && <FieldError>{error.detail || error.headline}</FieldError>}
    </div>
  );
};
