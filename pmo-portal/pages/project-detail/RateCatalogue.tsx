import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SelectField, TextField } from '@/src/components/ui';
import { ImportWizard } from '@/src/components/import';
import { makeRateCatalogueImportDescriptor } from '@/src/lib/import';
import { formatCurrency, formatDayYear } from '@/src/lib/format';
import { repositories } from '@/src/lib/repositories';
import type { CatalogueItem, CatalogueRate, CatalogueVariant } from '@/src/lib/db/rateCatalogue';

export default function RateCatalogue({ projectId, currency, canWrite, onImportOpenChange }: { projectId: string; currency: string; canWrite: boolean; onImportOpenChange?: (open: boolean) => void }) {
  const { t } = useTranslation('project');
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [rates, setRates] = useState<CatalogueRate[]>([]);
  const [variants, setVariants] = useState<CatalogueVariant[]>([]);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [name, setName] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const ratesByItem = useMemo(() => {
    const grouped = new Map<string, CatalogueRate[]>();
    for (const rate of rates) grouped.set(rate.item_id, [...(grouped.get(rate.item_id) ?? []), rate]);
    return grouped;
  }, [rates]);
  const variantsById = useMemo(() => new Map(variants.map((variant) => [variant.id, variant.name])), [variants]);
  const load = useCallback(async () => {
    setState('loading');
    try {
      const [nextItems, nextRates, nextVariants] = await Promise.all([repositories.rateCatalogue.listItems(projectId), repositories.rateCatalogue.listRates(projectId), repositories.rateCatalogue.listVariants(projectId)]);
      setItems(nextItems); setRates(nextRates); setVariants(nextVariants); setState('ready');
    } catch { setState('error'); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  const write = async (action: () => Promise<unknown>) => {
    setSaving(true); setError(false);
    try { await action(); await load(); } catch { setError(true); } finally { setSaving(false); }
  };
  if (state === 'loading') return <p role="status">{t('rateCatalogue.loading', 'Loading rates…')}</p>;
  if (state === 'error') return <div role="alert"><p>{t('rateCatalogue.loadError', 'Could not load rates')}</p><Button variant="outline" onClick={() => void load()}>{t('rateCatalogue.retry', 'Retry')}</Button></div>;
  const title = t('rateCatalogue.title', 'Rate catalogue');
  const cell = 'px-4 py-3 align-baseline';
  const narrowCell = '@max-[30rem]:flex @max-[30rem]:justify-between @max-[30rem]:gap-4 @max-[30rem]:p-0 @max-[30rem]:before:text-left @max-[30rem]:before:text-muted-foreground @max-[30rem]:before:content-[attr(data-label)]';
  const locationLabel = t('rateCatalogue.location', 'Location');
  const rateLabel = t('rateCatalogue.rate', 'Rate');
  const dateLabel = t('rateCatalogue.effective', 'Effective from');
  return <section className="min-w-0 space-y-4" aria-label={title}>
    {items.length === 0 ? (
      <p className="text-control text-muted-foreground">
        {variants.length === 0 && canWrite ? t('rateCatalogue.noLocations', 'No locations yet. Add a location.') : t('rateCatalogue.empty', 'No catalogue items')}
      </p>
    ) : (
      <div role="group" tabIndex={0} aria-label={title} className="@container relative overflow-x-auto rounded-lg border border-border focus-visible:outline-offset-[-2px]">
        <table className="w-full text-control @max-[30rem]:block">
          <thead className="border-b border-border text-left text-muted-foreground @max-[30rem]:sr-only">
            <tr>
              <th scope="col" className={`${cell} font-normal`}>{t('rateCatalogue.item', 'Item')}</th>
              <th scope="col" className={`${cell} font-normal`}>{locationLabel}</th>
              <th scope="col" className={`${cell} text-right font-normal`}>{rateLabel}</th>
              <th scope="col" className={`${cell} font-normal`}>{dateLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border @max-[30rem]:block">
            {items.flatMap((item) => {
              const itemRates = ratesByItem.get(item.id) ?? [];
              return (itemRates.length ? itemRates : [null]).map((rate) => (
                <tr className="@max-[30rem]:grid @max-[30rem]:gap-2 @max-[30rem]:p-4" key={rate ? `${item.id}-${rate.variant_id}-${rate.effective_from}` : item.id}>
                  <th scope="row" className={`${cell} text-left font-normal @max-[30rem]:p-0`}>
                    <span className="block text-muted-foreground">{item.item_code}</span>
                    <span className="break-words">{item.description}</span>
                  </th>
                  <td data-label={locationLabel} className={`${cell} ${narrowCell} @max-[30rem]:text-right`}>
                    <span className="min-w-0 break-words">{rate ? variantsById.get(rate.variant_id) : '—'}</span>
                  </td>
                  <td data-label={rateLabel} className={`${cell} ${narrowCell} text-right tabular-nums`}>{rate ? formatCurrency(rate.rate, currency, { precision: 'minor' }) : '—'}</td>
                  <td data-label={dateLabel} className={`${cell} ${narrowCell} @max-[30rem]:text-right`}>{rate ? formatDayYear(rate.effective_from) : '—'}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    )}
    {canWrite && <div className="space-y-4 border-t border-border pt-4">
      <div className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <TextField id="catalogue-variant" label={t('rateCatalogue.newVariant', 'New location')} value={name} onChange={setName} />
        <Button variant="outline" disabled={saving || !name.trim()} onClick={() => void write(async () => { await repositories.rateCatalogue.addVariants(projectId, [name.trim()]); setName(''); })}>{t('rateCatalogue.addVariant', 'Add location')}</Button>
      </div>
      <div className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <SelectField id="catalogue-default" label={t('rateCatalogue.defaultVariant', 'Default location')} value={variants.find((v) => v.is_default)?.id ?? ''} placeholder={t('rateCatalogue.none', 'None')} options={variants.map((v) => ({ value: v.id, label: v.name }))} onChange={(v) => void write(() => repositories.rateCatalogue.setDefaultVariant(projectId, v || null))} disabled={saving} />
        <Button variant="primary" onClick={() => { setImportOpen(true); onImportOpenChange?.(true); }} disabled={variants.length === 0}>{t('rateCatalogue.import', 'Import')}</Button>
      </div>
    </div>}
    {error && <p role="alert">{t('rateCatalogue.saveError', 'Could not save. Try again.')}</p>}
    {importOpen && <ImportWizard descriptor={makeRateCatalogueImportDescriptor(projectId, variants.map((v) => v.name), t)} onClose={(didImport) => { setImportOpen(false); onImportOpenChange?.(false); if (didImport) void load(); }} />}
  </section>;
}
