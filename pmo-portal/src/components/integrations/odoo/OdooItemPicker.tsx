/** AC-ODC-040: pick an Odoo item from PMO's mirror. The mirror can hold thousands, so search runs server-side and the list grows on demand (Combobox loads one fixed list, so it cannot serve this). */
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/src/components/ui';
import { useMasterRecords } from '@/src/hooks/useOdoo';
import type { MasterRecord } from '@/src/lib/repositories/odoo';

const STEP = 25;

export interface OdooItemPickerProps {
  label: string;
  purpose: 'purchase' | 'sale';
  value: string | null;
  /** Shown on the closed control for the current value. */
  selectedLabel?: string;
  onChange: (item: MasterRecord) => void;
  disabled?: boolean;
}

export function OdooItemPicker({ label, purpose, value, selectedLabel, onChange, disabled }: OdooItemPickerProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [size, setSize] = useState(STEP);
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(typed.trim()); setSize(STEP); }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const q = useMasterRecords({ kind: 'product', search: search || undefined, page: 1, pageSize: size, purpose }, open);
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pick = (item: MasterRecord) => { onChange(item); setOpen(false); setTyped(''); };

  return (
    <div className="relative">
      <label id={`${id}-label`} className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      <button type="button" role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-list`} aria-labelledby={`${id}-label`} disabled={disabled}
        onClick={() => setOpen((o) => !o)} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm">
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>{value ? (selectedLabel ?? value) : t('administration:odoo.picker.placeholder', 'Select an item')}</span>
        <Icon name="down" className="size-3.55 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card p-2 shadow-sm">
          <input type="search" role="searchbox" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t('administration:odoo.picker.search', 'Search code or name')}
            placeholder={t('administration:odoo.picker.search', 'Search code or name')} className="mb-2 min-h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
          {q.isPending && <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">{t('administration:odoo.picker.loading', 'Loading items…')}</p>}
          {q.isError && (
            <div role="alert" className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm text-destructive">
              <span>{t('administration:odoo.picker.error', 'Items could not be loaded')}</span>
              <Button variant="outline" size="sm" onClick={() => void q.refetch()}>{t('administration:odoo.picker.retry', 'Retry')}</Button>
            </div>
          )}
          {!q.isPending && !q.isError && rows.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('administration:odoo.picker.empty', 'No items match')}</p>}
          {rows.length > 0 && (
            <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="max-h-64 overflow-auto">
              {rows.map((r) => (
                <li key={r.id} role="option" aria-selected={r.external_id === value} tabIndex={0} onClick={() => pick(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r); } }}
                  className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded px-2 text-sm hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="min-w-0 break-words">{r.name}</span>
                  {r.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.code}</span>}
                </li>
              ))}
            </ul>
          )}
          {rows.length < total && (
            <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setSize((n) => n + STEP)}>{t('administration:odoo.picker.more', 'Show more')}</Button>
          )}
        </div>
      )}
    </div>
  );
}
