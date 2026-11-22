import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge, Button, ConfirmDialog, DataTable, Drawer, ListState, ReasonDialog, StatusPill, TextArea, useToast,
  type Column,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useApproveJournal, useJournal, useMayApproveJournal, usePostJournal, useRequestJournalReversal, useReturnJournal, useSubmitJournal } from '@/src/hooks/useJournals';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { formatDayYear, formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatExactCents, parseExactCents } from '@/src/lib/exactDecimal';
import { ApprovedSendFailure } from '@/src/lib/journals/approvedSendFailure';
import type { JournalDetail, JournalLineRow, JournalListRow } from '@/src/lib/db/journals';
import { journalErrorOverrides, journalKindLabel } from './journalWords';
import { DateField } from '@/src/components/ui/DateField';

/** numeric(18,2) from PostgREST (string or number) as exact two-decimal text; '' for zero. */
const exactText = (v: string | number): string => {
  const s = typeof v === 'number' ? v.toFixed(2) : v;
  return /^0+(\.0+)?$/.test(s) ? '' : s;
};

export interface JournalDrawerProps {
  row: JournalListRow;
  currency: string;
  currentUserId: string | null;
  viewOnly: boolean;
  today: string;
  onClose: () => void;
  onEdit: (detail: JournalDetail) => void;
  /** The row was opened by id before its record loaded: its status, kind and total are not known yet. */
  placeholder?: boolean;
  /** A reversal was drafted: show it. */
  onOpenJournal: (id: string) => void;
}

type Dialog = 'approve' | 'return' | 'reverse' | null;

/** One journal in the side drawer (#895): lines, ledger reference and the moves this person may make. */
export const JournalDrawer: React.FC<JournalDrawerProps> = ({ row, currency, currentUserId, viewOnly, today, placeholder = false, onClose, onEdit, onOpenJournal }) => {
  const { t } = useTranslation('journals');
  const { toast } = useToast();
  const may = usePermission();
  const isPmo = row.origin === 'pmo' && row.id !== null;
  const { data: detail, isPending, isError, refetch } = useJournal(isPmo ? row.id : null);
  const submit = useSubmitJournal();
  const approve = useApproveJournal();
  const returnJournal = useReturnJournal();
  const reverse = useRequestJournalReversal();
  const post = usePostJournal();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [reverseDate, setReverseDate] = useState(today);
  const [reverseReason, setReverseReason] = useState('');
  const [busy, setBusy] = useState(false);
  // The approval went through but the ledger send failed: the dialog offers only the send again.
  const [sendFailed, setSendFailed] = useState(false);

  const entry = detail?.entry;
  const status = entry?.status ?? row.status;
  const wroteIt = !!entry && !!currentUserId
    && (entry.maker_id === currentUserId || detail.authorIds.includes(currentUserId) || detail.originalAuthorIds.includes(currentUserId));
  // Asked only of a writer of a submitted journal: the server's rule says whether they are the only member the org has
  // ever had, the one case in which a writer may approve.
  const { data: serverMayApprove } = useMayApproveJournal(wroteIt && entry?.status === 'submitted' ? entry.id : null, currentUserId);
  const soleActiveMember = wroteIt && serverMayApprove === true;
  const record = entry ? {
    maker_id: entry.maker_id, author_ids: detail.authorIds, original_author_ids: detail.originalAuthorIds, status: entry.status, viewOnly,
    sole_active_member: soleActiveMember,
  } : undefined;
  const canEdit = isPmo && !!entry && entry.status === 'draft' && !entry.reverses_journal_id && !viewOnly && may('edit', 'journal');
  const canSubmit = isPmo && !!entry && entry.status === 'draft' && !viewOnly && may('edit', 'journal');
  const canDecide = isPmo && !!entry && entry.status === 'submitted' && may('approve', 'journal', { currentUserId, record });
  // An approved journal whose send did not finish (sending) or that the ledger did not confirm (Needs a check) is sent again;
  // the dispatch re-reads it, and the outbox adopts a move the ledger already holds rather than posting a second one.
  const canSend = isPmo && !!entry && ['approved', 'sending', 'held'].includes(entry.status) && !viewOnly && may('edit', 'journal');
  const canReverse = isPmo && !!entry && entry.status === 'posted' && !entry.reverses_journal_id && !viewOnly && may('create', 'journal');

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      toast(done, undefined, 'success');
      setDialog(null);
    } catch (err) {
      if (err instanceof ApprovedSendFailure) setSendFailed(true);
      const c = classifyMutationError(err instanceof ApprovedSendFailure ? err.cause : err, journalErrorOverrides(t));
      setError(joinSentences(c.headline, c.detail));
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setDialog(null); setError(null); setSendFailed(false); };

  // Read-only money carries its currency on each figure; a whole amount shows no cents, a fractional one keeps them.
  const lineMoney = (v: string | number): string => {
    const text = exactText(v);
    return text ? formatExactMoney(text, currency, getNumberLocale(), { trimZeroFraction: true }) ?? text : '';
  };
  const lineColumns: Column<JournalLineRow>[] = [
    { key: 'account', header: t('journals:form.account', 'Account'), cell: (l) => l.account },
    { key: 'label', header: t('journals:form.label', 'Label'), cell: (l) => l.label || '—' },
    { key: 'debit', header: t('journals:form.debit', 'Debit'), align: 'num', cell: (l) => (lineMoney(l.debit) ? <span className="tabular-nums">{lineMoney(l.debit)}</span> : null) },
    { key: 'credit', header: t('journals:form.credit', 'Credit'), align: 'num', cell: (l) => (lineMoney(l.credit) ? <span className="tabular-nums">{lineMoney(l.credit)}</span> : null) },
  ];
  // The record's own lines decide its total once read (a just-saved draft opens before the list refreshes).
  const totalText = detail ? formatExactCents(detail.lines.reduce((sum, l) => sum + (parseExactCents(exactText(l.debit) || '0') ?? 0n), 0n)) : row.total;
  const total = formatExactMoney(totalText, currency, getNumberLocale(), { trimZeroFraction: true });
  const ledgerRef = entry?.external_name ?? row.ledger_name;
  const ledgerDate = entry?.posted_date ?? row.posted_date ?? null;
  const heldReason = entry?.held_reason ?? row.held_reason;
  const returnReason = entry?.return_reason ?? row.return_reason;

  const actions = (
    <div className="flex flex-wrap gap-2">
      {canSubmit && <Button variant="primary" loading={busy && dialog === null} onClick={() => { void act(() => submit.mutateAsync(entry!.id), t('journals:form.submitted', 'Journal submitted')); }}>
        {t('journals:actions.submit', 'Submit')}
      </Button>}
      {canEdit && <Button variant="outline" onClick={() => onEdit(detail!)}>{t('journals:actions.edit', 'Edit')}</Button>}
      {canDecide && <Button variant="primary" onClick={() => { setError(null); setDialog('approve'); }}>{t('journals:actions.approve', 'Approve')}</Button>}
      {canDecide && <Button variant="outline" onClick={() => { setError(null); setDialog('return'); }}>{t('journals:actions.return', 'Return')}</Button>}
      {canSend && <Button variant="outline" loading={busy && dialog === null} onClick={() => { void act(() => post.mutateAsync(entry!.id), t('journals:actions.sent', 'Journal sent to the ledger')); }}>
        {t('journals:actions.send', 'Send to the ledger')}
      </Button>}
      {canReverse && <Button variant="outline" onClick={() => { setError(null); setReverseDate(today); setReverseReason(''); setDialog('reverse'); }}>{t('journals:actions.reverse', 'Reverse')}</Button>}
    </div>
  );

  return (
    <Drawer open width="lg" title={entry?.memo ?? row.memo ?? ledgerRef ?? '—'} onClose={onClose} loading={busy} nestedOpen={dialog !== null}
      status={placeholder && !detail ? undefined : <StatusPill record="journal" state={status} />}
      headerActions={actions}>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex gap-2"><dt className="text-muted-foreground">{t('journals:list.date', 'Date')}</dt><dd>{formatDayYear(entry?.entry_date ?? row.date)}</dd></div>
        {row.origin === 'pmo' && !(placeholder && !detail) && <>
          <div className="flex gap-2"><dt className="text-muted-foreground">{t('journals:form.kind', 'Kind')}</dt><dd>{journalKindLabel(t, entry?.kind ?? row.kind)}</dd></div>
        </>}
        {!(placeholder && !detail) && <>
          <div className="flex gap-2"><dt className="text-muted-foreground">{t('journals:list.total', 'Total')}</dt><dd className="tabular-nums">{total ?? totalText}</dd></div>
        </>}
        {ledgerRef && <>
          <div className="flex gap-2"><dt className="text-muted-foreground">{t('journals:detail.ledgerRef', 'Ledger reference')}</dt><dd className="tabular-nums">{ledgerRef}</dd></div>
        </>}
        {ledgerDate && <>
          <div className="flex gap-2"><dt className="text-muted-foreground">{t('journals:detail.ledgerDate', 'Ledger date')}</dt><dd>{formatDayYear(ledgerDate)}</dd></div>
        </>}
        {entry?.reversal_reason && <>
          <div className="flex gap-2"><dt className="text-muted-foreground">{t('journals:detail.reversalReason', 'Reversal reason')}</dt><dd>{entry.reversal_reason}</dd></div>
        </>}
      </dl>
      {row.origin === 'outside-pmo' && <p className="mt-3 text-sm text-muted-foreground"><Badge>{t('journals:list.outside', 'Outside PMO')}</Badge></p>}
      {status === 'held' && heldReason && <p role="status" className="mt-3 text-sm font-medium text-warning-foreground">{heldReason}</p>}
      {status === 'draft' && returnReason && <p role="status" className="mt-3 text-sm font-medium text-warning-foreground">
        {t('journals:detail.returned', 'Returned: {{reason}}', { reason: returnReason })}
      </p>}
      {canDecide && soleActiveMember && <p className="mt-3 text-sm text-muted-foreground">
        {t('journals:detail.soleMember', "You're the only member of this organisation, so you can approve your own journal. Once a colleague joins, a second person approves.")}
      </p>}
      {error && dialog === null && <p role="alert" className="mt-3 break-words text-sm text-destructive-text">{error}</p>}
      {isPmo && <div className="mt-4">
        {isPending && <ListState variant="loading" shape="table" rows={2} />}
        {!isPending && (isError || !detail) && <ListState variant="error" title={t('journals:detail.error', "Couldn't load this journal")}
          sub={t('journals:list.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void refetch()} />}
        {detail && <DataTable<JournalLineRow> rows={detail.lines} columns={lineColumns} rowKey={(l) => l.id} tableId="journal-lines-table"
          state={detail.lines.length === 0 ? 'empty' : undefined} emptyTitle={t('journals:detail.noLines', 'No lines yet')} />}
      </div>}

      <ConfirmDialog open={dialog === 'approve'}
        title={sendFailed ? t('journals:approve.sendFailedTitle', 'Approved, but not sent') : t('journals:approve.title', 'Approve this journal?')}
        description={sendFailed
          ? t('journals:approve.sendFailedBody', 'The journal is approved. Sending it to the ledger failed; send it again.')
          : t('journals:approve.body', 'It is sent to the ledger once approved.')}
        confirmLabel={sendFailed ? t('journals:actions.retrySend', 'Retry send') : t('journals:actions.approve', 'Approve')} loading={busy} error={error}
        onConfirm={() => {
          if (sendFailed) void act(() => post.mutateAsync(entry!.id), t('journals:actions.sent', 'Journal sent to the ledger'));
          else void act(() => approve.mutateAsync(entry!.id), t('journals:approve.toast', 'Journal approved'));
        }}
        onCancel={close} />
      <ReasonDialog open={dialog === 'return'} kind="return" subject={t('journals:return.subject', 'journal')} loading={busy} error={error}
        onConfirm={(reason) => { void act(() => returnJournal.mutateAsync({ id: entry!.id, reason }), t('journals:return.toast', 'Journal returned')); }} onCancel={close} />
      <ConfirmDialog open={dialog === 'reverse'} title={t('journals:reverse.title', 'Reverse this journal?')}
        description={<div className="space-y-3">
          <p>{t('journals:reverse.body', 'A new draft swaps every debit and credit. A second approver approves it.')}</p>
          <DateField label={t('journals:reverse.date', 'Reversal date')} required value={reverseDate} onChange={setReverseDate} />
          <TextArea label={t('journals:reverse.reason', 'Reason')} required maxLength={500} value={reverseReason} onChange={setReverseReason} />
        </div>}
        confirmLabel={t('journals:reverse.confirm', 'Draft the reversal')} loading={busy} error={error}
        confirmDisabled={!reverseDate || reverseReason.trim() === ''}
        onConfirm={() => {
          void act(async () => {
            const id = await reverse.mutateAsync({ id: entry!.id, date: reverseDate, reason: reverseReason.trim() });
            onOpenJournal(id);
          }, t('journals:reverse.toast', 'Reversal drafted'));
        }}
        onCancel={close} />
    </Drawer>
  );
};
