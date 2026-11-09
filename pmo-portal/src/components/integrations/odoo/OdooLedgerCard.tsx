/** FR-ODA-060/062: the Odoo ledger's health and the Admin's switch to it. Shown to Admin and Finance beside the Odoo setup; only an Admin can switch. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, ConfirmDialog, Button, ListState, StatusPill, TextArea } from '@/src/components/ui';
import { LedgerProvenance } from '@/src/components/odoo-ledger/LedgerProvenance';
import { useOdooLedgerHealth, useOdooLedgerMode, useSwitchOdooLedgerBasis } from '@/src/hooks/useOdooLedger';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { switchBlocker } from '@/src/components/odoo-ledger/ledgerState';

export function OdooLedgerCard() {
  const { t } = useTranslation('finance');
  const { t: tc } = useTranslation();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const mode = useOdooLedgerMode();
  const health = useOdooLedgerHealth(undefined, true);
  const switchBasis = useSwitchOdooLedgerBasis();
  const [dialog, setDialog] = useState<'plain' | 'difference' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const viewOnly = realRole !== effectiveRole;
  const canSwitch = may('act', 'odooLedgerBasis', { record: { viewOnly } });
  const canExplain = may('confirm', 'odooLedgerBasis', { record: { viewOnly } });
  const h = health.data;
  const blocker = h ? switchBlocker(h) : null;
  const differs = h?.check?.status === 'differs' && !h.check.stale;
  const reasonText: Record<NonNullable<ReturnType<typeof switchBlocker>>, string> = {
    'catching-up': t('odooLedger.card.blockedCatchingUp', 'PMO is still reading the Odoo history. You can move to the Odoo ledger once it has caught up.'),
    'not-checked': t('odooLedger.card.blockedNotChecked', 'PMO has not compared its figures with Odoo yet. The first check runs after the history is read.'),
    'check-stale': t('odooLedger.card.blockedStale', 'The last comparison with Odoo is out of date. A new one runs after the next update.'),
  };

  const close = () => { setDialog(null); setReason(''); };
  const run = async () => {
    setError(null);
    try {
      await switchBasis.mutateAsync(dialog === 'difference' ? { confirmDifference: true, reason } : {});
      close();
    } catch (e) {
      close();
      // The database names its refusal by slug; the screen says it in words.
      const refused: Record<string, string> = {
        ledger_not_caught_up: t('odooLedger.card.refusedNotCaughtUp', 'PMO is still reading the Odoo history.'),
        ledger_not_checked: t('odooLedger.card.refusedNotChecked', 'The Odoo ledger has not been compared with Odoo yet.'),
        ledger_check_stale: t('odooLedger.card.refusedStale', 'The last comparison is out of date. Wait for the next one.'),
        ledger_difference_unconfirmed: t('odooLedger.card.refusedUnconfirmed', 'A difference needs a written reason before you can move on.'),
      };
      setError(refused[(e as { message?: string }).message ?? ''] ?? classifyMutationError(e).headline);
    }
  };

  return (
    <Card className="p-4" data-testid="odoo-ledger-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-foreground">{t('odooLedger.card.title', 'Odoo ledger')}</h3>
        {mode.onLedger && <StatusPill variant="won">{t('odooLedger.card.inUse', 'In use')}</StatusPill>}
        {!mode.pending && !mode.onLedger && <StatusPill variant="neutral">{t('odooLedger.card.notInUse', 'Not in use yet')}</StatusPill>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode.onLedger
          ? t('odooLedger.card.inUseBody', 'Actual cost and statements come from the Odoo ledger.')
          : t('odooLedger.card.notInUseBody', 'Budgets and statements still follow PMO’s own documents until an Admin moves to the Odoo ledger.')}
      </p>
      {health.isPending && <ListState variant="loading" rows={2} />}
      {health.isError && <ListState variant="error" title={t('odooLedger.card.loadFailed', 'The Odoo ledger status could not be read')} onRetry={() => void health.refetch()} retryLabel={tc('financialStatements.retry', 'Retry')} />}
      {h && (
        <div className="mt-3 space-y-3">
          <LedgerProvenance state={h.state} asOf={h.asOf} check={h.check} unmapped={h.unmapped} unattributed={h.unattributed} unlinked={h.unlinked} />
          {!mode.onLedger && (
            <div className="space-y-2">
              {blocker && <p role="status" className="text-sm text-muted-foreground">{reasonText[blocker]}</p>}
              {!blocker && differs && (
                <p role="status" className="text-sm text-muted-foreground">
                  {canExplain
                    ? t('odooLedger.card.differsAdmin', 'PMO and Odoo differ on the accounts above. You can still move to the Odoo ledger by writing down why the difference is acceptable.')
                    : t('odooLedger.card.differsOther', 'PMO and Odoo differ on the accounts above. An Admin can move to the Odoo ledger after explaining the difference.')}
                </p>
              )}
              {!blocker && !differs && !canSwitch && (
                <p role="status" className="text-sm text-muted-foreground">{t('odooLedger.card.askAdmin', 'The figures match. An Admin can move to the Odoo ledger.')}</p>
              )}
              {canSwitch && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={blocker !== null}
                    loading={switchBasis.isPending}
                    onClick={() => setDialog(differs ? 'difference' : 'plain')}
                  >
                    {differs ? t('odooLedger.card.switchExplained', 'Move to the Odoo ledger with a reason') : t('odooLedger.card.switch', 'Move to the Odoo ledger')}
                  </Button>
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
        </div>
      )}
      <ConfirmDialog
        open={dialog !== null}
        title={t('odooLedger.card.confirmTitle', 'Move to the Odoo ledger')}
        description={(
          <div className="space-y-3">
            <p>{t('odooLedger.card.confirmBody', 'Every budget and statement of this organisation will show actual cost from the Odoo ledger, and PMO’s own documents stop counting as actual cost. PMO cannot move back; ask support if you need that.')}</p>
            {dialog === 'difference' && (
              <TextArea
                label={t('odooLedger.card.reasonLabel', 'Why is the difference acceptable?')}
                helper={t('odooLedger.card.reasonHelp', 'Kept in the audit trail with your name.')}
                value={reason}
                onChange={setReason}
                maxLength={500}
                required
                fullWidth
              />
            )}
          </div>
        )}
        confirmLabel={t('odooLedger.card.confirmAction', 'Move to the Odoo ledger')}
        loading={switchBasis.isPending}
        confirmDisabled={dialog === 'difference' && reason.trim() === ''}
        onConfirm={() => void run()}
        onCancel={close}
      />
    </Card>
  );
}
