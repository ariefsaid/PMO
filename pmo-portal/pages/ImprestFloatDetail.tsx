import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, ListState, RecordHeader, StatusPill, TextArea, TextField, useToast, type Column,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import {
  useImprestCounts, useImprestFloatClaims, useImprestFloats, useImprestPosition, useImprestReplenishments, useRecordCount,
  useRequestReplenishment, useTransitionReplenishment,
} from '@/src/hooks/useImprest';
import { availableFloatActions, availableReplenishmentActions, toCents, type ImprestAction } from '@/src/lib/imprest/imprestRules';
import type { ImprestReplenishmentRow } from '@/src/lib/db/imprest';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyAuto, parseMoneyInputAtScale } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { PlansSection } from './imprest/PlansSection';
import { FloatAmountSection } from './imprest/FloatAmountSection';
import { imprestStatusLabel } from './imprest/imprestLabels';
import { expenseStatusLabel } from './expenses/expenseLabels';

type PlanLineUsage = { budget_category: string; planned: number; drawn: number; remaining: number;
  exceptions: Array<{ id: string; number: string | null; kind: string; amount: string; status: string }> };
type Dialog =
  | { kind: 'request'; as: 'replenishment' | 'funding' }
  | { kind: 'rep'; rep: ImprestReplenishmentRow; action: 'approveReplenishment' | 'rejectReplenishment' | 'payReplenishment' | 'cancelReplenishment' }
  | { kind: 'count' }
  | null;
const REP_TO = { approveReplenishment: 'Approved', rejectReplenishment: 'Rejected', payReplenishment: 'Paid', cancelReplenishment: 'Cancelled' } as const;

const Figure: React.FC<{ label: string; value: React.ReactNode; id: string }> = ({ label, value, id }) => (
  <div data-testid={`figure-${id}`}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>
);

/** `/imprest/:floatId` (FR-IMP-071): position, month plan, plans, receipts, replenishments and counts. The RPCs decide; this hides. */
const ImprestFloatDetail: React.FC = () => {
  const { t } = useTranslation();
  const { floatId } = useParams<{ floatId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const floats = useImprestFloats();
  const position = useImprestPosition(floatId);
  const reps = useImprestReplenishments(floatId);
  const counts = useImprestCounts(floatId);
  const claims = useImprestFloatClaims(floatId);
  const requestRep = useRequestReplenishment();
  const transitionRep = useTransitionReplenishment();
  const recordCount = useRecordCount();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [counted, setCounted] = useState('');
  const close = () => { setDialog(null); setNotes(''); setReference(''); setCounted(''); };
  const backLabel = t('imprest:detail.back', 'Site cash');
  const goBack = () => navigate('/imprest');

  if (floats.isPending) return <><BackBar label={backLabel} phoneOnly onBack={goBack} /><ListState variant="loading" rows={5} /></>;
  if (floats.isError || !floats.data) {
    return <><BackBar label={backLabel} phoneOnly onBack={goBack} />
      <ListState variant="error" title={t('imprest:detail.errorTitle', "Couldn't load this float")} onRetry={() => void floats.refetch()} /></>;
  }
  const flt = floats.data.rows.find((f) => f.id === floatId);
  if (!flt) {
    return <><BackBar label={backLabel} phoneOnly onBack={goBack} />
      <ListState variant="empty" icon="doc" title={t('imprest:detail.notFound', 'Float not found')}
        sub={t('imprest:detail.notFoundSub', "It doesn't exist, or you don't have access to it.")} /></>;
  }
  const cur = flt.currency;
  const money = (v: number | string) => formatCurrencyAuto(Number(v), cur);
  const pos = position.data ?? null;
  const repRows = reps.data?.rows ?? [];
  // A receipt is replenished only once the replenishment it was swept into is Paid (the position's receipts-waiting rule).
  const settlement = (repId: string | null): 'paid' | 'requested' | 'waiting' => {
    const rep = repId ? repRows.find((r) => r.id === repId) : undefined;
    return !rep ? 'waiting' : rep.status === 'Paid' ? 'paid' : 'requested';
  };
  const openFunding = repRows.some((r) => r.kind === 'funding' && (r.status === 'Requested' || r.status === 'Approved'));
  // Receipts already swept into an open replenishment request are still "waiting" in the position until it is Paid, but cannot
  // be requested again; unknown (reps not loaded) hides the button, the RPC refuses a duplicate either way.
  const inOpenRequest = repRows.filter((r) => r.kind === 'replenishment' && (r.status === 'Requested' || r.status === 'Approved'))
    .reduce((sum, r) => sum + toCents(r.amount), 0);
  const requestable = pos && reps.data ? Math.max(0, toCents(pos.receipts_waiting) - inOpenRequest) : 0;
  const floatActions = pos
    ? availableFloatActions({ userId, realRole, custodianId: flt.custodian_id, receiptsWaiting: (requestable / 100).toFixed(2), gap: pos.gap, openFunding })
    : [];
  const planLines = (pos?.plan_lines ?? []) as unknown as PlanLineUsage[];

  const run = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast(success, flt.project?.name, 'success'); close(); }
    catch (err) { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); }
  };
  const countedParsed = parseMoneyInputAtScale(counted, 2);
  const countDiffers = pos !== null && countedParsed !== null && Math.round(countedParsed * 100) !== toCents(pos.cash_book);
  const countValid = countedParsed !== null && countedParsed >= 0 && (!countDiffers || notes.trim().length > 0);

  const planColumns: Column<PlanLineUsage>[] = [
    { key: 'category', header: t('imprest:plan.category', 'Budget category'), rowHeader: true,
      cell: (r) => <span className="font-medium">{budgetCategoryLabel(r.budget_category, t)}</span> },
    { key: 'planned', header: t('imprest:plan.planned', 'Planned'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.planned)}</span> },
    { key: 'drawn', header: t('imprest:plan.drawn', 'Drawn'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.drawn)}</span> },
    { key: 'remaining', header: t('imprest:plan.remaining', 'Remaining'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.remaining)}</span> },
    { key: 'exception', header: t('imprest:plan.exceptions', 'Exceptions'), cell: (r) => r.exceptions.length === 0 ? null : (
      <span className="flex flex-wrap items-center gap-x-2">
        <StatusPill variant="warn">{t('imprest:plan.exception', 'Out of plan')}</StatusPill>
        {r.exceptions.map((x) => <Link key={x.id} to={`/expenses/${x.id}`} className="text-primary-text hover:underline">{x.number ?? x.id.slice(0, 8)}</Link>)}
      </span>) },
  ];
  const repColumns: Column<ImprestReplenishmentRow>[] = [
    { key: 'number', header: t('imprest:rep.number', 'Number'), rowHeader: true, cell: (r) => <span className="whitespace-nowrap font-medium">{r.number}</span> },
    { key: 'kind', header: t('imprest:rep.kind', 'Type'), cell: (r) => r.kind === 'funding' ? t('imprest:rep.funding', 'Funding') : t('imprest:rep.replenishment', 'Replenishment') },
    { key: 'amount', header: t('imprest:rep.amount', 'Amount'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.amount)}</span> },
    { key: 'status', header: t('imprest:rep.status', 'Status'), cell: (r) => <StatusPill variant={workflowVariant(r.status)}>{imprestStatusLabel(r.status, t)}</StatusPill> },
    { key: 'actions', header: <span className="sr-only">{t('imprest:rep.actions', 'Actions')}</span>, cell: (r) => {
      const acts = availableReplenishmentActions({ userId, realRole, custodianId: flt.custodian_id, rep: r });
      const btn = (a: ImprestAction, label: string, variant: 'primary' | 'outline' | 'ghost') => acts.includes(a) &&
        <Button variant={variant} size="sm" onClick={() => setDialog({ kind: 'rep', rep: r, action: a as never })}>{label}</Button>;
      return <span className="flex flex-wrap gap-1">
        {btn('approveReplenishment', t('imprest:actions.approve', 'Approve'), 'primary')}
        {btn('rejectReplenishment', t('imprest:actions.reject', 'Reject'), 'outline')}
        {btn('payReplenishment', t('imprest:actions.pay', 'Pay'), 'primary')}
        {btn('cancelReplenishment', t('imprest:actions.cancel', 'Cancel'), 'ghost')}
      </span>;
    } },
  ];

  const repDialog = dialog?.kind === 'rep' ? dialog : null;
  const repLabel = repDialog && {
    approveReplenishment: t('imprest:actions.approve', 'Approve'), rejectReplenishment: t('imprest:actions.reject', 'Reject'),
    payReplenishment: t('imprest:actions.pay', 'Pay'), cancelReplenishment: t('imprest:actions.cancel', 'Cancel'),
  }[repDialog.action];

  return (
    <div>
      <div className="hidden max-[920px]:block"><BackBar label={backLabel} onBack={goBack} /></div>
      <RecordHeader name={flt.project?.name ?? '—'} icon="$"
        status={<StatusPill variant="progress">{t('imprest:detail.active', 'Active')}</StatusPill>}
        meta={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t('imprest:detail.custodian', 'Custodian: {{name}}', { name: flt.custodian?.full_name ?? '—' })}</span>
          <span>{t('imprest:position.float', 'Float')}: {money(flt.float_amount)}</span>
        </span>} />

      {position.isPending && <ListState variant="loading" rows={3} />}
      {!position.isPending && (position.isError || !pos) && (
        <div className="mb-4"><ListState variant="error" title={t('imprest:detail.positionError', "Couldn't load this float's position")}
          sub={t('imprest:detail.positionErrorSub', 'No figure is shown rather than a wrong one. Try again.')} onRetry={() => void position.refetch()} /></div>
      )}
      {pos && (
        <>
          <Card variant="bare" className="mb-4">
            <CardHead>{t('imprest:detail.position', 'Position')}</CardHead>
            <CardPad>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Figure id="float" label={t('imprest:position.float', 'Float')} value={money(pos.float_amount)} />
                <Figure id="cash" label={t('imprest:position.cash', 'Cash in hand')} value={money(pos.cash_book)} />
                <Figure id="advances" label={t('imprest:position.advancesOut', 'Advances out')} value={money(pos.advances_out)} />
                <Figure id="receipts" label={t('imprest:position.receiptsWaiting', 'Receipts waiting')} value={money(pos.receipts_waiting)} />
                <Figure id="in-flight" label={t('imprest:position.inFlight', 'Replenishment in flight')} value={money(pos.replenishment_in_flight)} />
                <Figure id="gap" label={t('imprest:position.gap', 'Gap')} value={toCents(pos.gap) === 0 ? money(pos.gap) : (
                  <span role="status" className="text-destructive-text"><span>{t('imprest:position.gapFlag', 'Books do not balance')}</span> ({money(pos.gap)})</span>)} />
              </dl>
              {pos.last_count_at && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('imprest:position.lastCount', 'Last count {{date}}: variance {{variance}}', { date: pos.last_count_at.slice(0, 10), variance: money(pos.last_count_variance ?? 0) })}
                  {pos.last_count_variance != null && toCents(pos.last_count_variance) !== 0 && <> · <span className="text-destructive-text">{t('imprest:position.varianceFlag', 'Count variance')}</span></>}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {floatActions.includes('requestReplenishment') && <Button variant="primary" onClick={() => setDialog({ kind: 'request', as: 'replenishment' })}>{t('imprest:actions.requestReplenishment', 'Request replenishment')}</Button>}
                {floatActions.includes('requestFunding') && <Button variant="outline" onClick={() => setDialog({ kind: 'request', as: 'funding' })}>{t('imprest:actions.requestFunding', 'Request funding')}</Button>}
                {floatActions.includes('recordCount') && <Button variant="outline" onClick={() => setDialog({ kind: 'count' })}>{t('imprest:actions.recordCount', 'Record count')}</Button>}
              </div>
            </CardPad>
          </Card>

          <Card variant="bare" className="mb-4">
            <CardHead>{t('imprest:plan.title', 'This month\'s plan ({{month}})', { month: pos.month.slice(0, 7) })}</CardHead>
            <CardPad>
              <DataTable<PlanLineUsage> rows={planLines} columns={planColumns} rowKey={(r) => r.budget_category}
                state={planLines.length === 0 ? 'empty' : undefined}
                emptyTitle={t('imprest:plan.none', 'No approved plan this month')}
                emptySub={t('imprest:plan.noneSub', 'Spend this month is out of plan until a plan is approved.')}
                tableId="imprest-plan-usage" />
            </CardPad>
          </Card>
        </>
      )}

      <FloatAmountSection floatId={flt.id} custodianId={flt.custodian_id} currency={cur} floatAmount={flt.float_amount} />

      <PlansSection floatId={flt.id} custodianId={flt.custodian_id} currency={cur} currentMonth={pos?.month ?? new Date().toISOString().slice(0, 7) + '-01'} />

      <Card variant="bare" className="mb-4">
        <CardHead>{t('imprest:receipts.title', 'Receipts')}</CardHead>
        <CardPad>
          {claims.isError ? <p role="alert" className="text-sm text-destructive-text">{t('imprest:receipts.error', "Couldn't load the float's records")}</p>
            : claims.isPending ? <ListState variant="loading" rows={2} />
            : (claims.data?.rows ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t('imprest:receipts.none', 'Nothing has been charged to this float yet.')}</p>
            : <ul className="divide-y divide-border text-sm">
              {(claims.data?.rows ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <Link to={`/expenses/${c.id}`} className="font-medium text-primary-text hover:underline">{c.claim_number ?? c.title}</Link>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  {c.is_plan_exception && <StatusPill variant="warn">{t('imprest:plan.exception', 'Out of plan')}</StatusPill>}
                  <span className="tabular-nums">{money(c.amount)}</span>
                  <StatusPill variant={workflowVariant(c.status)}>{expenseStatusLabel(c.status, t)}</StatusPill>
                  {c.kind === 'claim' && c.status === 'Paid' && (settlement(c.imprest_replenishment_id) === 'paid'
                    ? <span className="text-muted-foreground">{t('imprest:receipts.replenished', 'Replenished')}</span>
                    : settlement(c.imprest_replenishment_id) === 'requested'
                      ? <span>{t('imprest:receipts.inRequest', 'In a replenishment request')}</span>
                      : <span>{t('imprest:receipts.waiting', 'Waiting')}</span>)}
                </li>
              ))}
            </ul>}
        </CardPad>
      </Card>

      <Card variant="bare" className="mb-4">
        <CardHead>{t('imprest:rep.title', 'Replenishments')}</CardHead>
        <CardPad>
          {reps.isError ? <ListState variant="error" title={t('imprest:rep.error', "Couldn't load replenishments")} onRetry={() => void reps.refetch()} />
            : <DataTable<ImprestReplenishmentRow> rows={repRows} columns={repColumns} rowKey={(r) => r.id}
              state={reps.isPending ? 'loading' : repRows.length === 0 ? 'empty' : undefined}
              emptyTitle={t('imprest:rep.none', 'No replenishments yet')} emptySub={t('imprest:rep.noneSub', 'The custodian requests one when receipts are waiting.')}
              tableId="imprest-replenishments" />}
        </CardPad>
      </Card>

      <Card variant="bare" className="mb-4">
        <CardHead>{t('imprest:counts.title', 'Cash counts')}</CardHead>
        <CardPad>
          {counts.isError ? <p role="alert" className="text-sm text-destructive-text">{t('imprest:counts.error', "Couldn't load counts")}</p>
            : (counts.data?.rows ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t('imprest:counts.none', 'No cash count recorded yet.')}</p>
            : <ul className="divide-y divide-border text-sm">
              {(counts.data?.rows ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                  <span>{c.counted_at.slice(0, 10)}</span>
                  <span className="tabular-nums">{t('imprest:counts.counted', 'Counted {{amount}}', { amount: money(c.counted_amount) })}</span>
                  <span className="tabular-nums text-muted-foreground">{t('imprest:counts.book', 'Book {{amount}}', { amount: money(c.book_amount) })}</span>
                  <span className={toCents(c.variance) !== 0 ? 'tabular-nums text-destructive-text' : 'tabular-nums'}>{t('imprest:counts.variance', 'Variance {{amount}}', { amount: money(c.variance) })}</span>
                  {c.note && <span className="min-w-0 flex-1 truncate text-muted-foreground" title={c.note}>{c.note}</span>}
                </li>
              ))}
            </ul>}
        </CardPad>
      </Card>

      <ConfirmDialog
        open={dialog?.kind === 'request'}
        title={dialog?.kind === 'request' && dialog.as === 'funding' ? t('imprest:confirm.fundingTitle', 'Request funding for this float?') : t('imprest:confirm.requestTitle', 'Request replenishment?')}
        description={<p>{dialog?.kind === 'request' && dialog.as === 'funding'
          ? t('imprest:confirm.fundingBody', 'Asks Finance to put cash into the float up to its amount.')
          : t('imprest:confirm.requestBody', 'Asks Finance to refill the float with the {{amount}} of receipts waiting.', { amount: pos ? money(pos.receipts_waiting) : '' })}</p>}
        confirmLabel={dialog?.kind === 'request' && dialog.as === 'funding' ? t('imprest:actions.requestFunding', 'Request funding') : t('imprest:actions.requestReplenishment', 'Request replenishment')}
        loading={requestRep.isPending}
        onConfirm={() => { if (dialog?.kind === 'request') void run(() => requestRep.mutateAsync({ floatId: flt.id, kind: dialog.as }), t('imprest:toast.requested', 'Request sent')); }}
        onCancel={close}
      />
      <ConfirmDialog
        open={repDialog !== null}
        tone={repDialog?.action === 'rejectReplenishment' || repDialog?.action === 'cancelReplenishment' ? 'destructive' : 'default'}
        title={repDialog ? t('imprest:confirm.repTitle', '{{action}} {{number}}: {{amount}}?', { action: repLabel, number: repDialog.rep.number, amount: money(repDialog.rep.amount) }) : ''}
        description={<div className="space-y-3">
          {repDialog?.action === 'payReplenishment' && <TextField label={t('imprest:confirm.reference', 'Payment reference (optional)')} value={reference} onChange={setReference} />}
          {repDialog?.action === 'rejectReplenishment' && <TextArea label={t('imprest:confirm.notes', 'Note (optional)')} value={notes} onChange={setNotes} />}
          {repDialog && repDialog.action !== 'payReplenishment' && repDialog.action !== 'rejectReplenishment' && <p>{money(repDialog.rep.amount)}</p>}
        </div>}
        confirmLabel={repLabel ?? ''}
        loading={transitionRep.isPending}
        onConfirm={() => {
          if (!repDialog) return;
          const to = REP_TO[repDialog.action];
          const extra = to === 'Paid' ? (reference.trim() ? { paymentReference: reference.trim() } : {}) : (notes.trim() ? { notes: notes.trim() } : {});
          void run(() => transitionRep.mutateAsync({ id: repDialog.rep.id, to, ...extra }), t('imprest:toast.updated', 'Updated'));
        }}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog?.kind === 'count'}
        title={t('imprest:confirm.countTitle', 'Record a cash count')}
        description={<div className="space-y-3">
          <p className="text-sm">{t('imprest:confirm.countBook', 'Cash in hand by the books: {{amount}}', { amount: pos ? money(pos.cash_book) : '' })}</p>
          <TextField label={t('imprest:confirm.counted', 'Counted cash')} inputMode="decimal" value={counted} onChange={setCounted} />
          <TextArea label={countDiffers ? t('imprest:confirm.noteRequired', 'Note (required: the count differs from the books)') : t('imprest:confirm.note', 'Note (optional)')} value={notes} onChange={setNotes} />
        </div>}
        confirmLabel={t('imprest:actions.recordCount', 'Record count')}
        confirmDisabled={!countValid}
        loading={recordCount.isPending}
        onConfirm={() => void run(() => recordCount.mutateAsync({ floatId: flt.id, counted: countedParsed as number, ...(notes.trim() ? { note: notes.trim() } : {}) }), t('imprest:toast.counted', 'Count recorded'))}
        onCancel={close}
      />
    </div>
  );
};
export default ImprestFloatDetail;
