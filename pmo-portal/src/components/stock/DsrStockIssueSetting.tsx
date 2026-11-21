import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, SelectField } from '@/src/components/ui';
import { useConsumableFlags, useDsrStockMutations, useDsrStockSettings } from '@/src/hooks/useDsrStockIssue';
import { useStockErrorText } from './useStockErrorText';

/** The Admin switch for "a validated daily report issues its material" (#2676), off by default, with which items count and the consumable flag per item. Renders nothing until the setting has been read. */
export const DsrStockIssueSetting: React.FC = () => {
  const { t } = useTranslation('stock');
  const errorText = useStockErrorText();
  const [error, setError] = useState('');
  const q = useDsrStockSettings();
  const flags = useConsumableFlags(q.data?.enabled === true && q.data.items === 'consumables');
  const { setSettings, setConsumable } = useDsrStockMutations();
  if (q.data === undefined) return null;
  const apply = (enabled: boolean, items: 'all' | 'consumables') => setSettings.mutate({ enabled, items }, { onSuccess: () => setError(''), onError: (e) => setError(errorText(e)) });
  return (
    <div className="space-y-2">
      <Checkbox label={t('dsrIssue.setting')} checked={q.data.enabled} onChange={(c) => apply(c === true, q.data.items)}>{t('dsrIssue.setting')}</Checkbox>
      <p className="text-sm text-muted-foreground">{t('dsrIssue.settingHelp')}</p>
      {q.data.enabled && (
        <SelectField label={t('dsrIssue.items')} value={q.data.items} onChange={(v) => apply(true, v as 'all' | 'consumables')}
          options={[{ value: 'all', label: t('dsrIssue.itemsAll') }, { value: 'consumables', label: t('dsrIssue.itemsConsumables') }]} />
      )}
      {q.data.enabled && q.data.items === 'consumables' && (
        <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={t('dsrIssue.flagList')}>
          {(flags.data ?? []).map((i) => (
            <li key={i.id}>
              <Checkbox label={`${i.code} - ${i.name}`} checked={i.consumable} onChange={(c) => setConsumable.mutate({ itemId: i.id, consumable: c === true })}>{`${i.code} - ${i.name}`}</Checkbox>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
};
