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
  return <section className="space-y-4" aria-label={t('rateCatalogue.title', 'Rate catalogue')}>
    {canWrite && <div className="flex flex-wrap items-end gap-2">
      <TextField id="catalogue-variant" label={t('rateCatalogue.newVariant', 'New location')} value={name} onChange={setName} />
      <Button variant="outline" disabled={saving || !name.trim()} onClick={() => void write(async () => { await repositories.rateCatalogue.addVariants(projectId, [name.trim()]); setName(''); })}>{t('rateCatalogue.addVariant', 'Add location')}</Button>
      <SelectField id="catalogue-default" label={t('rateCatalogue.defaultVariant', 'Default location')} value={variants.find((v) => v.is_default)?.id ?? ''} placeholder={t('rateCatalogue.none', 'None')} options={variants.map((v) => ({ value: v.id, label: v.name }))} onChange={(v) => void write(() => repositories.rateCatalogue.setDefaultVariant(projectId, v || null))} disabled={saving} />
      <Button variant="primary" onClick={() => { setImportOpen(true); onImportOpenChange?.(true); }} disabled={variants.length === 0}>{t('rateCatalogue.import', 'Import')}</Button>
    </div>}
    {error && <p role="alert">{t('rateCatalogue.saveError', 'Could not save. Try again.')}</p>}
    {items.length === 0 ? <p>{variants.length === 0 && canWrite ? t('rateCatalogue.noLocations', 'No locations yet. Add a location.') : t('rateCatalogue.empty', 'No catalogue items')}</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left"><th scope="col">{t('rateCatalogue.item', 'Item')}</th><th scope="col">{t('rateCatalogue.location', 'Location')}</th><th scope="col" className="text-right pr-4">{t('rateCatalogue.rate', 'Rate')}</th><th scope="col">{t('rateCatalogue.effective', 'Effective from')}</th></tr></thead><tbody>
      {items.flatMap((item) => { const itemRates = ratesByItem.get(item.id) ?? []; return itemRates.length ? itemRates.map((rate) => <tr className="border-b border-border" key={`${item.id}-${rate.variant_id}-${rate.effective_from}`}><td>{item.item_code} · {item.description}</td><td>{variantsById.get(rate.variant_id)}</td><td className="text-right tabular pr-4">{formatCurrency(rate.rate, currency, { precision: 'minor' })}</td><td className="whitespace-nowrap">{formatDayYear(rate.effective_from)}</td></tr>) : [<tr key={item.id}><td>{item.item_code} · {item.description}</td><td>—</td><td>—</td><td>—</td></tr>]; })}
    </tbody></table></div>}
    {importOpen && <ImportWizard descriptor={makeRateCatalogueImportDescriptor(projectId, variants.map((v) => v.name), t)} onClose={(didImport) => { setImportOpen(false); onImportOpenChange?.(false); if (didImport) void load(); }} />}
  </section>;
}
