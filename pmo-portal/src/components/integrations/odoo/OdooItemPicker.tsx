/** AC-ODC-040: pick an Odoo item from PMO's mirror. The mirror can hold thousands, so search and paging run on the server through the shared Combobox's server-search mode (keyboard, focus and ARIA come from there). */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox } from '@/src/components/ui/Combobox';
import { useMasterRecordsInfinite } from '@/src/hooks/useOdoo';
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
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const q = useMasterRecordsInfinite({ kind: 'product', search: search || undefined, pageSize: STEP, purpose }, open);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  const options = useMemo(() => rows.map((r) => ({ value: r.external_id, label: r.name, sub: r.code ?? undefined })), [rows]);

  return (
    <Combobox
      label={label}
      value={value}
      selectedOption={value ? { value, label: selectedLabel ?? value } : null}
      onChange={(v) => { const r = rows.find((x) => x.external_id === v); if (r) onChange(r); }}
      placeholder={t('administration:odoo.picker.placeholder', 'Select an item')}
      searchPlaceholder={t('administration:odoo.picker.search', 'Search code or name')}
      noun={t('administration:odoo.picker.noun', 'item')}
      disabled={disabled}
      serverSearch={{
        options,
        status: q.isError ? 'error' : q.isPending ? 'loading' : 'ready',
        onQueryChange: setTyped,
        onOpenChange: setOpen,
        onRetry: () => void q.refetch(),
        hasMore: q.hasNextPage,
        moreLabel: t('administration:odoo.picker.more', 'Show more'),
        onLoadMore: () => { if (!q.isFetchingNextPage) void q.fetchNextPage(); },
      }}
    />
  );
}
