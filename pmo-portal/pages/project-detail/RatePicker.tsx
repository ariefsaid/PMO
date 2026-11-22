import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Combobox, DateField, SelectField } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { formatCurrency, formatDay } from '@/src/lib/format';
import type { CatalogueItem, CatalogueRate, CatalogueVariant } from '@/src/lib/db/rateCatalogue';

export interface PricingChoice {
  itemId: string; variantId: string; asOf: string; rate: number | null;
  /** The picked catalogue item's own code, description and unit, so the line arrives filled. */
  item?: { itemCode: string; description: string; unit: string };
}
export default function RatePicker({ projectId, today, currency, onChange, initial, retryKey = 0 }: { retryKey?: number; projectId: string; today: string; currency: string; initial?: { itemId: string; variantId: string; asOf: string }; onChange: (choice: PricingChoice | null) => void }) {
  const { t } = useTranslation('project');
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [variants, setVariants] = useState<CatalogueVariant[]>([]);
  const [rates, setRates] = useState<CatalogueRate[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [itemId, setItemId] = useState(initial?.itemId ?? '');
  const [variantId, setVariantId] = useState(initial?.variantId ?? '');
  const [asOf, setAsOf] = useState(initial?.asOf ?? today);
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [nextItems, nextVariants, nextRates] = await Promise.all([repositories.rateCatalogue.listItems(projectId), repositories.rateCatalogue.listVariants(projectId), repositories.rateCatalogue.listRates(projectId)]);
      setItems(nextItems); setVariants(nextVariants); setRates(nextRates);
      setVariantId((v) => v || nextVariants.find((x) => x.is_default)?.id || ''); setStatus('ready');
    } catch { setStatus('error'); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load, retryKey]);
  const current = useMemo(() => rates.filter((r) => r.item_id === itemId && r.variant_id === variantId && r.effective_from <= asOf).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0], [rates, itemId, variantId, asOf]);
  const picked = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  useEffect(() => {
    onChange(itemId ? { itemId, variantId, asOf, rate: current?.rate ?? null, ...(picked ? { item: { itemCode: picked.item_code ?? '', description: picked.description ?? '', unit: picked.unit ?? '' } } : {}) } : null);
  }, [itemId, variantId, asOf, current, picked, onChange]);
  if (status === 'loading') return <p role="status">{t('rateCatalogue.loading', 'Loading rates…')}</p>;
  if (status === 'error') return <div role="alert">{t('rateCatalogue.loadError', 'Could not load rates')} <Button variant="outline" onClick={() => void load()}>{t('rateCatalogue.retry', 'Retry')}</Button></div>;
  return <div className="space-y-3">
    <Combobox label={t('rateCatalogue.pickItem', 'Catalogue item')} value={itemId || null} selectedOption={items.find((i) => i.id === itemId) ? { value: itemId, label: items.find((i) => i.id === itemId)?.description ?? '' } : null} loadOptions={async () => items.map((i) => ({ value: i.id, label: `${i.item_code} · ${i.description}` }))} onChange={setItemId} clearable onClear={() => setItemId('')} />
    {itemId && <>
      <SelectField id="catalogue-line-variant" label={t('rateCatalogue.location', 'Location')} value={variantId} placeholder={t('rateCatalogue.chooseLocation', 'Choose location')} options={variants.map((v) => ({ value: v.id, label: v.name }))} onChange={setVariantId} />
      <DateField id="catalogue-line-date" label={t('rateCatalogue.pricingDate', 'Pricing date')} value={asOf} onChange={setAsOf} />
      {current ? <p>{t('rateCatalogue.rate', 'Rate')}: {formatCurrency(current.rate, currency, { precision: 'minor' })} · {t('rateCatalogue.effective', 'Effective from')} {formatDay(current.effective_from)}</p> : null}
    </>}
  </div>;
}
