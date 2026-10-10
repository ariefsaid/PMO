import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, DecisionContextSummary, TextArea, TextField, useToast } from '@/src/components/ui';
import { useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyCents, parseMoneyInputAtScale } from '@/src/lib/format';
import { settlementPreview, type ExpenseAction } from '@/src/lib/expenses/expenseRules';
import type { ExpenseClaimStatus, ExpenseClaimWithRefs } from '@/src/lib/db/expenseClaims';

type Dialog = 'approve' | 'reject' | 'pay' | 'cancel' | 'recordReturn' | null;

/** The actions the server would allow this viewer (FR-EXP-063). `actions` comes from availableExpenseActions; the
 *  RPCs decide. `advanceOutstanding`: for a claim, its linked advance's; for an advance, its own; null = unknown. */
export interface ExpenseDecisionBarProps {
  claim: ExpenseClaimWithRefs;
  actions: ExpenseAction[];
  advanceOutstanding: number | null;
}

export const ExpenseDecisionBar: React.FC<ExpenseDecisionBarProps> = ({ claim, actions, advanceOutstanding }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { transition, recordReturn } = useExpenseClaimMutations();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [returnAmount, setReturnAmount] = useState('');
  if (actions.length === 0) return null;

  const close = () => { setDialog(null); setNotes(''); setReference(''); setReturnAmount(''); };
  const run = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      toast(success, claim.title, 'success');
      close();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };
  const move = (to: ExpenseClaimStatus, success: string, opts: { notes?: string | null; paymentReference?: string | null } = {}) =>
    run(() => transition.mutateAsync({ id: claim.id, to, ...opts }), success);

  // A wrong number on screen is worse than none: with a linked advance whose outstanding is not yet known, show "—".
  const previewKnown = !claim.advance_id || advanceOutstanding !== null;
  const preview = settlementPreview(Number(claim.amount), claim.advance_id ? advanceOutstanding : null);
  const parsedReturn = parseMoneyInputAtScale(returnAmount, 2);
  const returnValid = parsedReturn !== null && parsedReturn > 0 && advanceOutstanding !== null && parsedReturn <= advanceOutstanding;
  const deciding = dialog === 'approve' || dialog === 'reject';
  const identity = [claim.claim_number, claim.title].filter(Boolean).join(' · ');
  const formattedAmount = formatCurrencyCents(Number(claim.amount), claim.currency);
  const decisionContext = <DecisionContextSummary identity={identity} amount={formattedAmount} />;

  return (
    <div className="mb-4 flex flex-wrap gap-2" data-testid="expense-decision-bar">
      {actions.includes('submit') && (
        <Button variant="primary" disabled={transition.isPending}
          onClick={() => void move('Submitted', t('expenses.toast.submitted', 'Submitted for approval'))}>
          {t('expenses.actions.submit', 'Submit for approval')}
        </Button>
      )}
      {actions.includes('reopen') && (
        <Button variant="outline" disabled={transition.isPending}
          onClick={() => void move('Draft', t('expenses.toast.reopened', 'Back to Draft'))}>
          {t('expenses.actions.reopen', 'Edit and resubmit')}
        </Button>
      )}
      {actions.includes('approve') && <Button variant="primary" onClick={() => setDialog('approve')}>{t('expenses.actions.approve', 'Approve')}</Button>}
      {actions.includes('reject') && <Button variant="outline" onClick={() => setDialog('reject')}>{t('expenses.actions.reject', 'Reject')}</Button>}
      {actions.includes('pay') && <Button variant="primary" onClick={() => setDialog('pay')}>{t('expenses.actions.pay', 'Mark paid')}</Button>}
      {actions.includes('recordReturn') && (
        <Button variant="outline" onClick={() => setDialog('recordReturn')}>{t('expenses.actions.recordReturn', 'Record cash returned')}</Button>
      )}
      {actions.includes('cancel') && <Button variant="ghost" onClick={() => setDialog('cancel')}>{t('expenses.actions.cancel', 'Cancel')}</Button>}

      <ConfirmDialog
        open={deciding}
        tone={dialog === 'reject' ? 'destructive' : 'default'}
        title={dialog === 'reject' ? t('expenses.confirm.rejectTitle', 'Reject {{number}}?', { number: claim.claim_number ?? claim.title }) : t('expenses.confirm.approveTitle', 'Approve {{number}} for {{amount}}?', { number: claim.claim_number ?? claim.title, amount: formattedAmount })}
        description={<div className="space-y-3"><DecisionContextSummary identity={identity} amount={formattedAmount} /><TextArea label={t('expenses.confirm.notesLabel', 'Note to the claimant (optional)')} value={notes} onChange={setNotes} /></div>}
        confirmLabel={dialog === 'reject' ? t('expenses.actions.reject', 'Reject') : t('expenses.actions.approve', 'Approve')}
        loading={transition.isPending}
        onConfirm={() =>
          void (dialog === 'reject'
            ? move('Rejected', t('expenses.toast.rejected', 'Rejected'), { notes: notes.trim() || null })
            : move('Approved', t('expenses.toast.approved', 'Approved'), { notes: notes.trim() || null }))
        }
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog === 'pay'}
        title={t('expenses.confirm.payTitle', 'Mark {{number}} paid: {{amount}}?', { number: claim.claim_number ?? claim.title, amount: formattedAmount })}
        description={
          <div className="space-y-3">
            {decisionContext}
            {claim.advance_id && (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt>{t('expenses.confirm.previewApplied', 'Advance applied')}</dt>
                <dd className="text-right tabular-nums" data-testid="pay-preview-applied">
                  {previewKnown ? formatCurrencyCents(preview.applied, claim.currency) : '—'}
                </dd>
                <dt>{t('expenses.confirm.previewCash', 'Cash to pay')}</dt>
                <dd className="text-right tabular-nums" data-testid="pay-preview-cash">
                  {previewKnown ? formatCurrencyCents(preview.cash, claim.currency) : '—'}
                </dd>
              </dl>
            )}
            <TextField label={t('expenses.confirm.referenceLabel', 'Payment reference (optional)')} value={reference} onChange={setReference} />
          </div>
        }
        confirmLabel={t('expenses.actions.pay', 'Mark paid')}
        loading={transition.isPending}
        onConfirm={() => void move('Paid', t('expenses.toast.paid', 'Marked paid'), { paymentReference: reference.trim() || null })}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog === 'recordReturn'}
        title={t('expenses.confirm.returnTitle', 'Record cash returned')}
        description={
          <div className="space-y-3">
            {decisionContext}
            <TextField label={t('expenses.confirm.returnAmountLabel', 'Amount returned')} inputMode="decimal" value={returnAmount} onChange={setReturnAmount}
              helper={advanceOutstanding !== null
                ? t('expenses.confirm.returnAmountHelper', 'Up to {{amount}} is outstanding.', { amount: formatCurrencyCents(advanceOutstanding, claim.currency) })
                : undefined} />
            <TextField label={t('expenses.confirm.returnReferenceLabel', 'Reference (optional)')} value={reference} onChange={setReference} />
          </div>
        }
        confirmLabel={t('expenses.confirm.returnConfirm', 'Record return')}
        confirmDisabled={!returnValid}
        loading={recordReturn.isPending}
        onConfirm={() =>
          void run(
            () => recordReturn.mutateAsync({ id: claim.id, amount: parsedReturn as number, reference: reference.trim() || null }),
            t('expenses.toast.returned', 'Return recorded'),
          )
        }
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog === 'cancel'}
        tone="destructive"
        title={t('expenses.confirm.cancelTitle', 'Cancel {{number}}?', { number: claim.claim_number ?? claim.title })}
        description={<div className="space-y-3"><p>{t('expenses.confirm.cancelDescription', 'It stays on record as Cancelled and can no longer be approved or paid.')}</p><DecisionContextSummary identity={identity} amount={formattedAmount} /></div>}
        confirmLabel={t('expenses.confirm.cancelConfirm', 'Cancel it')}
        cancelLabel={t('expenses.confirm.keep', 'Keep it')}
        loading={transition.isPending}
        onConfirm={() => void move('Cancelled', t('expenses.toast.cancelled', 'Cancelled'))}
        onCancel={close}
      />
    </div>
  );
};
