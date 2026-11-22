import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/src/components/ui';
import { useOrgSwitch, useSetOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { useStockErrorText } from './useStockErrorText';

/** The Admin switch for work-order transfers (#2691), off by default. Renders nothing until the setting has been read, so a screen without it shows no new control. */
export const WoTransferToggle: React.FC = () => {
  const { t } = useTranslation('stock');
  const errorText = useStockErrorText();
  const [error, setError] = useState('');
  const q = useOrgSwitch('stockWoTransfers');
  const change = useSetOrgSwitch('stockWoTransfers');
  if (q.data === undefined) return null;
  return (
    <div className="space-y-1">
      <Checkbox label={t('workOrderTransfer.setting')} checked={q.data} onChange={(c) => { setError(''); change.mutate(c === true, { onError: (err) => setError(errorText(err)) }); }}>{t('workOrderTransfer.setting')}</Checkbox>
      <p className="text-sm text-muted-foreground">{t('workOrderTransfer.settingHelp')}</p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
};
