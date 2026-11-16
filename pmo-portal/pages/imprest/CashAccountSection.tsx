import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, RecordSection, TextField, UnsavedChangesDialog, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useSetCashAccount } from '@/src/hooks/useImprest';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';

/** The float's ERP cash account (S6). Set once by Finance/Admin through the validating edge function; read-only after. Until it
 *  is set the float's cash movements are not posted to the ERP. The server refuses a change, a moved float and a shared account. */
export const CashAccountSection: React.FC<{ floatId: string; account: string | null }> = ({ floatId, account }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  const bind = useSetCashAccount();
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ leave: () => void; stay: () => void } | null>(null);
  const value = name.trim();
  const holdLeave = useCallback((leave: () => void, stay: () => void) => setPendingLeave({ leave, stay }), []);
  useUnsavedChangesGuard({ dirty: Boolean(name), guardHistory: true, onBlocked: holdLeave });
  const refusals = {
    'imprest-cash-account-locked': t('imprest:cash.locked', "This site cash's cash account can't be changed"),
    'imprest-cash-account-taken': t('imprest:cash.taken', 'That account belongs to another site cash'),
    'imprest-cash-account-unfit': t('imprest:cash.unfit', "That isn't a usable cash account"),
    'imprest-cash-account-unsupported': t('imprest:cash.unsupported', "The ERP connection can't take a cash account yet"),
  };
  const submit = async () => {
    try { await bind.mutateAsync({ floatId, account: value }); toast(t('imprest:cash.done', 'Cash account set'), value, 'success'); setName(''); }
    catch (err) { const { headline, detail } = classifyMutationError(err, refusals); toast(headline, detail, 'warning'); }
    setConfirming(false);
  };

  return (
    <RecordSection title={t('imprest:cash.title', 'ERP cash account')}>
      <div className="text-sm">
        {account ? (
          <p><span className="font-medium">{account}</span> <span className="text-muted-foreground">{t('imprest:cash.fixed', '· set once, cannot be changed')}</span></p>
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground">{t('imprest:cash.unset', 'Not linked to an accounting cash account yet, so these movements stay in PMO.')}</p>
            {may('edit', 'imprestFloat') && (
              <div className="flex flex-wrap items-end gap-2">
                <TextField label={t('imprest:cash.label', 'ERP cash account name')} value={name} onChange={setName} spellCheck={false} />
                <Button variant="primary" disabled={!value} onClick={() => setConfirming(true)}>{t('imprest:cash.set', 'Set account')}</Button>
              </div>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('imprest:cash.confirmTitle', 'Set the cash account to {{account}}?', { account: value })}
        description={<p>{t('imprest:cash.confirmBody', 'The ERP checks it. Once set it cannot be changed, so set it before this site cash first moves money.')}</p>}
        confirmLabel={t('imprest:cash.set', 'Set account')}
        loading={bind.isPending}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      />
      <UnsavedChangesDialog
        open={pendingLeave !== null}
        onDiscard={() => { const pending = pendingLeave; setPendingLeave(null); pending?.leave(); }}
        onKeepEditing={() => { const pending = pendingLeave; setPendingLeave(null); pending?.stay(); }}
      />
    </RecordSection>
  );
};
