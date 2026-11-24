import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, TextField, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useWorkOrderListEntries } from '@/src/hooks/useWorkOrderLists';
import { workOrderListRepository } from '@/src/lib/repositories/workOrderLists';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Rates by area for one contract line (docs/specs/areas-and-area-rates.spec.md). A line priced by hand may carry a rate per area of
 * the organisation's own list; a daily report on a work order in that area is priced at it, any other at the line's rate. Shown only
 * where the organisation has areas, the line is priced by hand, and the role may see and set the money; each rate saves on its own
 * button, an empty field removes the area's rate. The database decides who may (RLS reads, `set_boq_item_area_rate` writes).
 */
interface Props { boqItemId: string; catalogueItemId: string | null; currency?: string }

const RATE = /^\d{1,7}(\.\d{1,6})?$/;

const BoqAreaRates: React.FC<Props> = ({ boqItemId, catalogueItemId }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const { toast } = useToast();
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const allowed = may('edit', 'boqItem') && catalogueItemId === null;
  const areas = useWorkOrderListEntries('area', allowed);
  const live = (areas.data ?? []).filter((a) => !a.archived_at);
  const key = ['boq-area-rates', orgId, boqItemId] as const;
  const rates = useQuery({ queryKey: key, queryFn: () => workOrderListRepository.areaRates(boqItemId), enabled: allowed && live.length > 0 });
  const save = useMutation({
    mutationFn: (v: { areaId: string; rate: string | null }) => workOrderListRepository.setAreaRate(boqItemId, v.areaId, v.rate),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setDraft(Object.fromEntries((rates.data ?? []).map((r) => [r.areaId, r.rate.replace(/\.?0+$/, '')]))); }, [rates.data]);
  if (!allowed || live.length === 0) return null;

  const run = async (areaId: string, name: string) => {
    const raw = (draft[areaId] ?? '').trim();
    if (raw !== '' && (!RATE.test(raw) || Number(raw) <= 0)) { setErrors((e) => ({ ...e, [areaId]: t('projectDetail.billing.areaRates.invalid', 'Enter a rate above 0, or leave it empty to remove it.') })); return; }
    setErrors((e) => { const next = { ...e }; delete next[areaId]; return next; });
    try {
      await save.mutateAsync({ areaId, rate: raw === '' ? null : raw });
      toast(raw === '' ? t('projectDetail.billing.areaRates.removed', 'Area rate removed') : t('projectDetail.billing.areaRates.saved', 'Area rate saved'), name, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setErrors((e) => ({ ...e, [areaId]: detail || headline }));
    }
  };

  return (
    <fieldset className="mt-3 space-y-2" data-testid="boq-area-rates">
      <legend className="text-control font-medium text-foreground">{t('projectDetail.billing.areaRates.title', 'Rates by area')}</legend>
      <p className="text-control text-muted-foreground">{t('projectDetail.billing.areaRates.hint', "A daily report on a work order in an area is priced at that area's rate. An area with no rate uses the line's rate.")}</p>
      {rates.isError && <p role="alert" className="text-sm text-destructive-text">{t('projectDetail.billing.areaRates.loadError', "Couldn't load the area rates.")}</p>}
      <ul className="space-y-2">
        {live.map((a) => (
          <li key={a.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <span className="text-foreground">{a.name}{a.description ? <span className="block text-muted-foreground">{a.description}</span> : null}</span>
            <TextField label={t('projectDetail.billing.areaRates.rate', 'Rate for {{name}}', { name: a.name })} inputMode="decimal" value={draft[a.id] ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, [a.id]: v }))} error={errors[a.id]} disabled={save.isPending} />
            <Button variant="outline" size="sm" onClick={() => void run(a.id, a.name)} disabled={save.isPending}>{t('projectDetail.billing.areaRates.save', 'Save')}</Button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
};

export default BoqAreaRates;
