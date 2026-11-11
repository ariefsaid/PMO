import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';

export interface BulkBarProps {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}

/** Replaces the list's export control while one or more visible records are selected. */
export function BulkBar({ count, onClear, children }: BulkBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2" role="region" aria-label={t('finance:bulk.actions', 'Selected records')}>
      <span className="text-sm font-medium tabular">{t('finance:bulk.selected', '{{count}} selected', { count })}</span>
      {children}
      <Button type="button" variant="ghost" onClick={onClear}>{t('finance:bulk.clear', 'Clear')}</Button>
    </div>
  );
}
