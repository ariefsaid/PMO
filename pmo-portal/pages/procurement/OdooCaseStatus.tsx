/**
 * #1505 P8 (FR-OPP-090/091/094/095): what Odoo has not settled on this case, in plain words with its age and next step, the note
 * shown while Odoo cannot be reached, and the two decisions for a held payment. Renders nothing for an org PMO owns or when nothing
 * is outstanding, so those screens stay exactly as they were. Settled records show their state in the ledger's status column.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, TextField } from '@/src/components/ui';
import { OdooOutcome } from '@/src/components/procurement/OdooOutcome';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { formatRelativeTime } from '@/src/lib/format';
import { odooOutcome } from '@/src/lib/procurement/odooOutcome';
import { useOdooPurchaseCommands, useOdooUnreachable, useResolveHeldPayment } from '@/src/hooks/useOdooPurchase';
import { odooOwnsProcurement } from '@/src/lib/adapterSeam/odoo/ownership';
import type { PurchaseCommand } from '@/src/lib/repositories/contracts/odoo';

const KIND_LABEL: Record<string, string> = { 'purchase-order': 'Order', 'goods-receipt': 'Goods receipt', 'purchase-invoice': 'Supplier invoice', payment: 'Payment' };

type Decision = { command: PurchaseCommand; resolution: 'adopt' | 'absent' };

/** The ownership cache is the gate, so an org PMO owns reads and subscribes to nothing here. */
export const OdooCaseStatus: React.FC<{ procurementId: string }> = ({ procurementId }) =>
  odooOwnsProcurement() ? <OdooCaseStatusBody procurementId={procurementId} /> : null;

const OdooCaseStatusBody: React.FC<{ procurementId: string }> = ({ procurementId }) => {
  const { t } = useTranslation('procurement');
  const commands = useOdooPurchaseCommands(procurementId);
  const { unreachable, lastOkAt } = useOdooUnreachable();
  const resolve = useResolveHeldPayment(procurementId);
  const { realRole, effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const me = useAuth().currentUser?.id ?? null;
  const [done, setDone] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  const list = commands.data ?? [];
  const readFailed = commands.isError && commands.data === undefined;
  if (!unreachable && !readFailed && list.length === 0 && !done) return null;

  // Real JWT role decides; a view-as session is read-only (ADR-0016).
  const mayResolve = may('resolve', 'odooHeldCommand', { record: { viewOnly: realRole !== effectiveRole } });
  const close = () => { setDecision(null); setNumber(''); setError(null); };
  const confirm = async () => {
    if (!decision) return;
    setError(null); setDone(false);
    try {
      await resolve.mutateAsync(decision.resolution === 'adopt'
        ? { outboxId: decision.command.id, resolution: 'adopt', paymentNumber: number.trim() }
        : { outboxId: decision.command.id, resolution: 'absent' });
      close();
      setDone(true);
    } catch {
      setError(t('odoo.held.failed', 'The decision could not be recorded.'));
    }
  };

  return (
    <section data-testid="odoo-case-status" aria-label={t('odoo.waiting.title', 'Waiting on Odoo')} className="mb-3 space-y-2 rounded-lg border border-border bg-card px-4 py-3">
      {unreachable && (
        <p data-testid="odoo-unreachable" role="status" className="text-[13px] text-foreground">
          {t('odoo.unreachable', 'Odoo cannot be reached. Showing what PMO last read, {{age}}. Try again once Odoo is back.', { age: formatRelativeTime(lastOkAt) })}
        </p>
      )}
      {done && <p role="status" className="text-[13px] text-muted-foreground">{t('odoo.held.done', 'Decision recorded.')}</p>}
      {readFailed && <p role="status" className="text-[13px] text-muted-foreground">{t('odoo.readFailed', 'What Odoo has not settled could not be read. Try again in a moment.')}</p>}
      {list.length > 0 && (
        <>
          <h3 className="text-[13px] font-semibold">{t('odoo.waiting.title', 'Waiting on Odoo')}</h3>
          <ul className="space-y-2">
            {list.map((c) => {
              const outcome = odooOutcome({ outboxState: c.state, outboxUpdatedAt: c.updatedAt, lastError: c.lastError });
              const heldPayment = c.kind === 'payment' && c.state === 'held';
              const mine = me !== null && c.actorUserId === me;
              return (
                <li key={c.id} className="grid items-start gap-x-4 gap-y-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
                  <span className="text-[13px] font-medium">{t(`odoo.kind.${c.kind}`, KIND_LABEL[c.kind])}</span>
                  <span className="min-w-0">{outcome && <OdooOutcome outcome={outcome} />}</span>
                  {heldPayment && mayResolve && !mine && (
                    <span className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDecision({ command: c, resolution: 'adopt' })}>{t('odoo.held.adopt', 'It exists in Odoo')}</Button>
                      <Button variant="outline" size="sm" onClick={() => setDecision({ command: c, resolution: 'absent' })}>{t('odoo.held.absent', 'It does not exist in Odoo')}</Button>
                    </span>
                  )}
                  {heldPayment && mayResolve && mine && <span className="text-[12px] text-muted-foreground">{t('odoo.held.ownCommand', 'You sent this payment, so someone else must decide.')}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={decision !== null}
        title={decision?.resolution === 'adopt' ? t('odoo.held.adoptTitle', 'Link this payment to Odoo?') : t('odoo.held.absentTitle', 'Confirm no payment exists in Odoo?')}
        description={(
          <span className="block space-y-3">
            <span className="block">{decision?.resolution === 'adopt'
              ? t('odoo.held.adoptBody', 'Enter the number of the Odoo payment to link. PMO checks that it belongs to this bill before treating it as the payment.')
              : t('odoo.held.absentBody', 'PMO will look for it once more and, if it finds nothing, may send the payment again. Only confirm after checking Odoo.')}</span>
            {decision?.resolution === 'adopt' && (
              <TextField label={t('odoo.held.adoptField', 'Odoo payment number')} value={number} onChange={setNumber} helper={t('odoo.held.adoptHint', 'The number Odoo shows for that payment, for example 123.')} inputMode="numeric" />
            )}
            {error && <span role="alert" className="block text-destructive-text">{error}</span>}
          </span>
        )}
        confirmLabel={t('odoo.held.confirm', 'Confirm')}
        cancelLabel={t('odoo.held.cancel', 'Cancel')}
        tone={decision?.resolution === 'absent' ? 'destructive' : 'default'}
        loading={resolve.isPending}
        confirmDisabled={decision?.resolution === 'adopt' && !/^[1-9][0-9]*$/.test(number.trim())}
        onConfirm={() => { void confirm(); }}
        onCancel={close}
      />
    </section>
  );
};
