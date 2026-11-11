import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useSetCashAccount } from '@/src/hooks/useImprest';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/** The float's ERP cash account (S6). Set once by Finance/Admin through the validating edge function; read-only after. Until it
 *  is set the float's cash movements are not posted to the ERP. The server refuses a change, a moved float and a shared account. */
export const CashAccountSection: React.FC<{ floatId: string; account: string | null }> = ({ floatId, account }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  const bind = useSetCashAccount();
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const value = name.trim();
  const refusals = {
    'imprest-cash-account-locked': t('imprest:cash.locked', "This float's cash account can't be changed"),
    'imprest-cash-account-taken': t('imprest:cash.taken', 'That account belongs to another float'),
    'imprest-cash-account-unfit': t('imprest:cash.unfit', "That isn't a usable cash account"),
    'imprest-cash-account-unsupported': t('imprest:cash.unsupported', "The ERP connection can't take a cash account yet"),
  };
  const submit = async () => {
    try { await bind.mutateAsync({ floatId, account: value }); toast(t('imprest:cash.done', 'Cash account set'), value, 'success'); setName(''); }
    catch (err) { const { headline, detail } = classifyMutationError(err, refusals); toast(headline, detail, 'warning'); }
    setConfirming(false);
  };

  return (
    <Card className="mb-4">
      <CardHead>{t('imprest:cash.title', 'ERP cash account')}</CardHead>
      <CardPad className="pt-0 text-sm">
        {account ? (
          <p><span className="font-medium">{account}</span> <span className="text-muted-foreground">{t('imprest:cash.fixed', '· set once, cannot be changed')}</span></p>
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground">{t('imprest:cash.unset', 'No cash account set. This float\'s cash movements are not posted to the ERP.')}</p>
            {may('edit', 'imprestFloat') && (
              <div className="flex flex-wrap items-end gap-2">
                <TextField label={t('imprest:cash.label', 'ERP cash account name')} value={name} onChange={setName} />
                <Button variant="primary" disabled={!value} onClick={() => setConfirming(true)}>{t('imprest:cash.set', 'Set account')}</Button>
              </div>
            )}
          </div>
        )}
      </CardPad>
      <ConfirmDialog
        open={confirming}
        title={t('imprest:cash.confirmTitle', 'Set the cash account to {{account}}?', { account: value })}
        description={<p>{t('imprest:cash.confirmBody', 'The ERP checks it. Once set it cannot be changed, so set it before the float first moves cash.')}</p>}
        confirmLabel={t('imprest:cash.set', 'Set account')}
        loading={bind.isPending}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
};
