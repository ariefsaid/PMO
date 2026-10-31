import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, type ComboboxOption } from '@/src/components/ui/Combobox';
import { useStockItems } from '@/src/hooks/useStock';

export interface ItemPickerProps {
  label: React.ReactNode;
  value: string | null;
  onChange: (itemId: string) => void;
  error?: React.ReactNode;
  id?: string;
  required?: boolean;
}

/** Active items only; the search matches the code or the name (Combobox filters label and sub). */
export const ItemPicker: React.FC<ItemPickerProps> = ({ label, value, onChange, error, id, required }) => {
  const { t } = useTranslation('stock');
  const items = useStockItems(false);
  const load = useCallback(async (): Promise<ComboboxOption[]> => {
    if (items.error) throw items.error;
    return (items.data ?? []).filter((i) => !i.archived_at).map((i) => ({ value: i.id, label: `${i.code} - ${i.name}` }));
  }, [items.data, items.error]);
  return (
    <Combobox
      id={id}
      label={label}
      required={required}
      value={value}
      onChange={(v) => onChange(v)}
      loadOptions={load}
      placeholder={t('form.itemPlaceholder')}
      searchPlaceholder={t('form.itemSearch')}
      noun={t('form.itemNoun')}
      error={error}
    />
  );
};
