import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, ListState, StatusPill, TextArea, TextField, useToast, type Column } from '@/src/components/ui';
import { CanWrite } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useDecideFloatChange, useImprestFloatChanges, useProposeFloatAmount } from '@/src/hooks/useImprest';
import { availableFloatChangeActions } from '@/src/lib/imprest/imprestRules';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ImprestFloatChangeListRow } from '@/src/lib/db/imprest';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatCurrencyAuto, parseMoneyInputAtScale } from '@/src/lib/format';
import { imprestStatusLabel } from './imprestLabels';

/** The float's amount and its change proposals (FR-IMP-002): a new float starts at zero until a second person approves the
 *  proposed amount. The proposer and the custodian never decide; the RPC refuses anyone the senior route excludes. */
export const FloatAmountSection: React.FC<{ floatId: string; custodianId: string; currency: string; floatAmount: number | string }> = ({ floatId, custodianId, currency, floatAmount }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const changes = useImprestFloatChanges(floatId);
  const decide = useDecideFloatChange();
  const propose = useProposeFloatAmount();
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'propose' | null>(null);
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const money = (v: number | string) => formatCurrencyAuto(Number(v), currency);
  const rows = changes.data?.rows ?? [];
  const open = rows.find((c) => c.status === 'Proposed');
  const actions = open ? availableFloatChangeActions({ userId, realRole, custodianId, change: open }) : [];
  const history = rows.filter((c) => c.status !== 'Proposed');
  const columns: Column<ImprestFloatChangeListRow>[] = [
    { key: 'date', header: t('imprest:amount.history.date', 'Date'), rowHeader: true, cell: (r) => <span className="whitespace-nowrap">{r.proposed_at.slice(0, 10)}</span> },
    { key: 'amount', header: t('imprest:amount.history.amount', 'Amount'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.proposed_amount)}</span> },
    { key: 'status', header: t('imprest:amount.history.status', 'Status'), cell: (r) => <StatusPill variant={workflowVariant(r.status)}>{imprestStatusLabel(r.status, t)}</StatusPill> },
    { key: 'who', header: t('imprest:amount.history.who', 'Proposed by'), cell: (r) => <span>{r.proposer?.full_name ?? '—'}{r.decider ? <span className="text-muted-foreground">{t('imprest:amount.history.decidedBy', ' · decided by {{name}}', { name: r.decider.full_name })}</span> : null}</span> },
    { key: 'note', header: t('imprest:amount.history.note', 'Note'), cell: (r) => r.notes ? <span className="block max-w-xs truncate text-muted-foreground" title={r.notes}>{r.notes}</span> : null },
  ];
  const parsed = parseMoneyInputAtScale(amount, 2);
  const close = () => { setDialog(null); setNotes(''); setAmount(''); };
  const run = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast(success, undefined, 'success'); close(); }
    catch (err) { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); }
  };

  return (
    <Card className="mb-4">
      <CardHead>{t('imprest:amount.title', 'Float amount')}</CardHead>
      <CardPad className="pt-0">
        {changes.isPending && <ListState variant="loading" rows={2} />}
        {!changes.isPending && (changes.isError || !changes.data) && (
          <ListState variant="error" title={t('imprest:amount.error', "Couldn't load the float amount changes")} onRetry={() => void changes.refetch()} />
        )}
        {!changes.isPending && !changes.isError && changes.data && (
          <div className="space-y-2 text-sm">
            <p>{t('imprest:amount.current', 'Current float: {{amount}}', { amount: money(floatAmount) })}</p>
            {open && (
              <div role="note" className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>{t('imprest:amount.open', 'Proposed {{amount}} on {{date}}: awaiting a senior approver.', { amount: money(open.proposed_amount), date: open.proposed_at.slice(0, 10) })}</span>
                {actions.includes('approveFloatChange') && <Button variant="primary" size="sm" onClick={() => setDialog('approve')}>{t('imprest:actions.approve', 'Approve')}</Button>}
                {actions.includes('rejectFloatChange') && <Button variant="outline" size="sm" onClick={() => setDialog('reject')}>{t('imprest:actions.reject', 'Reject')}</Button>}
              </div>
            )}
            {!open && (
              <CanWrite entity="imprestFloat" action="edit">
                <Button variant="outline" size="sm" onClick={() => setDialog('propose')}>{t('imprest:amount.propose', 'Propose new amount')}</Button>
              </CanWrite>
            )}
            {history.length > 0 && (
              <DataTable<ImprestFloatChangeListRow> rows={history} columns={columns} rowKey={(r) => r.id} tableId="imprest-float-changes" />
            )}
          </div>
        )}
      </CardPad>
      <ConfirmDialog
        open={dialog === 'approve' || dialog === 'reject'}
        tone={dialog === 'reject' ? 'destructive' : 'default'}
        title={dialog === 'reject' ? t('imprest:amount.rejectTitle', 'Reject the proposed float amount?') : t('imprest:amount.approveTitle', 'Approve the proposed float amount?')}
        description={<div className="space-y-3">
          <p>{open ? money(open.proposed_amount) : ''}</p>
          {dialog === 'reject' && <TextArea label={t('imprest:confirm.notes', 'Note (optional)')} value={notes} onChange={setNotes} />}
        </div>}
        confirmLabel={dialog === 'reject' ? t('imprest:actions.reject', 'Reject') : t('imprest:actions.approve', 'Approve')}
        loading={decide.isPending}
        onConfirm={() => { if (open) void run(() => decide.mutateAsync({ changeId: open.id, approve: dialog === 'approve', ...(notes.trim() ? { notes: notes.trim() } : {}) }), t('imprest:toast.updated', 'Updated')); }}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog === 'propose'}
        title={t('imprest:amount.proposeTitle', 'Propose a new float amount')}
        description={<TextField label={t('imprest:amount.newAmount', 'New float amount')} inputMode="decimal" value={amount} onChange={setAmount} />}
        confirmLabel={t('imprest:amount.proposeConfirm', 'Propose amount')}
        confirmDisabled={parsed === null || !(parsed > 0)}
        loading={propose.isPending}
        onConfirm={() => void run(() => propose.mutateAsync({ floatId, amount: parsed as number }), t('imprest:amount.proposed', 'Amount proposed'))}
        onCancel={close}
      />
    </Card>
  );
};
