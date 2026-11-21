import React, { useContext, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/src/components/ui';
import { AuthContext } from '@/src/auth/AuthContext';
import { stockWorkOrderTransferRepository as repo } from '@/src/lib/repositories/stockWorkOrderTransfer';
import { useStockErrorText } from './useStockErrorText';

/** The Admin switch for work-order transfers (#2691), off by default. Renders nothing until the setting has been read, so a screen without it shows no new control. */
export const WoTransferToggle: React.FC = () => {
  const { t } = useTranslation('stock');
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  const qc = useQueryClient();
  const errorText = useStockErrorText();
  const [error, setError] = useState('');
  const q = useQuery({ queryKey: ['stock-wo-transfers-enabled', orgId], queryFn: () => repo.enabled(), enabled: Boolean(orgId), staleTime: 60_000, retry: false });
  const change = useMutation({
    mutationFn: (on: boolean) => repo.setEnabled(on),
    onSuccess: async () => { setError(''); await qc.invalidateQueries({ queryKey: ['stock-wo-transfers-enabled'] }); },
    onError: (err) => setError(errorText(err)),
  });
  if (q.data === undefined) return null;
  return (
    <div className="space-y-1">
      <Checkbox label={t('workOrderTransfer.setting')} checked={q.data} onChange={(c) => change.mutate(c === true)}>{t('workOrderTransfer.setting')}</Checkbox>
      <p className="text-sm text-muted-foreground">{t('workOrderTransfer.settingHelp')}</p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
};
