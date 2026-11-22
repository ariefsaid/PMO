import { ReturnedBanner } from '@/src/components/ui/ReturnedBanner';
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, ConfirmDialog, DataTable, ListState, ReasonDialog, RecordHeader, RecordSection, RecordStack, StatusPill, TextArea, TextField, useToast, type Column,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import {
  useImprestCounts, useImprestFloat, useImprestFloatChanges, useImprestFloatClaims, useImprestPlans, useImprestPosition, useImprestPostingStates, useImprestReplenishments,
  useRecordCount, useRequestReplenishment, useTransitionReplenishment,
} from '@/src/hooks/useImprest';
import { availableFloatActions, availableReplenishmentActions, booksState, toCents, type ImprestAction } from '@/src/lib/imprest/imprestRules';
import { LIST_LIMIT, type ImprestReplenishmentWithRejecter as ImprestReplenishmentRow } from '@/src/lib/db/imprest';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatDay, formatMonthYearShort, parseMoneyInputAtScale } from '@/src/lib/format';
import { PlansSection } from './imprest/PlansSection';
import { FloatAmountSection } from './imprest/FloatAmountSection';
import { CashAccountSection } from './imprest/CashAccountSection';

type PlanLineUsage = { budget_category: string; planned: number; drawn: number; remaining: number;
  exceptions: Array<{ id: string; number: string | null; kind: string; amount: string; status: string }> };
type Dialog =
  | { kind: 'request'; as: 'replenishment' | 'funding' }
  | { kind: 'rep'; rep: ImprestReplenishmentRow; action: 'approveReplenishment' | 'rejectReplenishment' | 'payReplenishment' | 'cancelReplenishment' }
  | { kind: 'count' }
  | null;
const REP_TO = { approveReplenishment: 'Approved', rejectReplenishment: 'Rejected', payReplenishment: 'Paid', cancelReplenishment: 'Cancelled' } as const;

const Figure: React.FC<{ label: string; value: React.ReactNode; id: string; lead?: boolean; note?: React.ReactNode }> = ({ label, value, id, lead, note }) => (
  <div data-testid={`figure-${id}`} className={lead ? 'col-span-full' : 'max-sm:last:col-span-2'}>
    <dt className={lead ? 'text-control font-medium text-foreground' : 'text-control text-muted-foreground'}>{label}</dt>
    <dd className={lead ? 'text-metric font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    {note && <dd className="text-control text-muted-foreground">{note}</dd>}
  </div>
);

/** `/imprest/:floatId` (FR-IMP-071): position, month plan, plans, receipts, replenishments and counts. The RPCs decide; this hides. */
const ImprestFloatDetail: React.FC = () => {
  const { t } = useTranslation();
  const { floatId } = useParams<{ floatId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const floats = useImprestFloat(floatId);
  // The change and plan sections mount once the float is read; their reads need only the route id, so start them now.
  const limitChanges = useImprestFloatChanges(floatId);
  useImprestPlans(floatId);
  const position = useImprestPosition(floatId);
  const reps = useImprestReplenishments(floatId);
  const counts = useImprestCounts(floatId);
  useImprestPlans(floatId);
  const claims = useImprestFloatClaims(floatId);
  const postings = useImprestPostingStates(floatId);
  const requestRep = useRequestReplenishment();
  const transitionRep = useTransitionReplenishment();
  const recordCount = useRecordCount();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [counted, setCounted] = useState('');
  const close = () => { setDialog(null); setDialogError(null); setNotes(''); setReference(''); setCounted(''); };
  const backLabel = t('imprest:detail.back', 'Site cash');
  const goBack = () => navigate('/imprest');

  if (floats.isPending) return <><BackBar label={backLabel} phoneOnly onBack={goBack} /><ListState variant="loading" shape="detail" rows={5} /></>;
  if (floats.isError) {
    return <><BackBar label={backLabel} phoneOnly onBack={goBack} />
      <ListState variant="error" title={t('imprest:detail.errorTitle', "Couldn't load this site cash")} onRetry={() => void floats.refetch()} /></>;
  }
  const flt = floats.data;
  if (!flt) {
    return <><BackBar label={backLabel} phoneOnly onBack={goBack} />
      <ListState variant="empty" icon="doc" title={t('imprest:detail.notFound', 'Site cash not found')}
        sub={t('imprest:detail.notFoundSub', "It doesn't exist, or you don't have access to it.")} /></>;
  }
  const postingOf = new Map((postings.data?.rows ?? []).map((p) => [p.movementId, p.state]));
  const posting = (id: string) => {
    const state = postingOf.get(id);
    if (!state) return null;
    const text = { pending: t('imprest:posting.pending', 'Posting to ERP'), failed: t('imprest:posting.failed', 'ERP posting failed'), uncertain: t('imprest:posting.uncertain', 'ERP posting unconfirmed') }[state];
    return <span className={state === 'failed' ? 'text-destructive-text' : 'text-muted-foreground'}>{text}</span>;
  };
  const cur = flt.currency;
  // Position figures and table cells print whole units; the money-transaction surfaces (confirm
  // dialogs, cash counts and their difference) keep the currency's own minor units (owner ruling D4:
  // USD shows cents, rupiah has none, owner 15 Nov).
  const money = (v: number | string) => formatCurrency(Number(v), cur);
  const moneyCents = (v: number | string) => formatCurrency(Number(v), cur, { precision: 'minor' });
  const pos = position.data ?? null;
  const repRows = reps.data?.rows ?? [];
  // A receipt is replenished only once the replenishment it was swept into is Paid (the position's receipts-waiting rule).
  const settlement = (repId: string | null): 'paid' | 'requested' | 'waiting' => {
    const rep = repId ? repRows.find((r) => r.id === repId) : undefined;
    return !rep ? 'waiting' : rep.status === 'Paid' ? 'paid' : 'requested';
  };
  // C16: the receipt's status names the replenishment request it sits in, so the number is not table-only.
  const requestNumberOf = (repId: string | null): string | null => (repId ? repRows.find((r) => r.id === repId)?.number ?? null : null);
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
  // A proposed limit still waiting for its approver: said beside the Limit figure, so "IDR 0" is not read as the agreed limit.
  const pendingLimit = (limitChanges.data?.rows ?? []).find((c) => c.status === 'Proposed') ?? null;
  const books = pos ? booksState(pos) : null;

  const run = async (work: () => Promise<unknown>, success: string) => {
    setDialogError(null);
    try { await work(); toast(success, flt.project?.name, 'success'); close(); }
    catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setDialogError(detail ? `${headline}. ${detail}` : headline);
      toast(headline, detail, 'warning');
    }
  };
  const countedParsed = parseMoneyInputAtScale(counted, 2);
  const countDiffers = pos !== null && countedParsed !== null && Math.round(countedParsed * 100) !== toCents(pos.cash_book);
  const countValid = countedParsed !== null && countedParsed >= 0 && (!countDiffers || notes.trim().length > 0);

  const planColumns: Column<PlanLineUsage>[] = [
    { key: 'category', header: t('imprest:plan.category', 'Budget category'), rowHeader: true,
      cell: (r) => <span className="font-semibold">{budgetCategoryLabel(r.budget_category, t)}</span> },
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
    { key: 'number', header: t('imprest:rep.number', 'Number'), rowHeader: true, cell: (r) => <span className="whitespace-nowrap font-semibold">{r.number}</span> },
    { key: 'kind', header: t('imprest:rep.kind', 'Type'), cell: (r) => r.kind === 'funding' ? t('imprest:rep.funding', 'Funding') : t('imprest:rep.replenishment', 'Top-up') },
    { key: 'amount', header: t('imprest:rep.amount', 'Amount'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.amount)}</span> },
    { key: 'status', header: t('imprest:rep.status', 'Status'), cell: (r) => <div className="flex flex-wrap items-center gap-x-2">
      <StatusPill record="imprest" state={r.status} />{posting(r.id)}{r.status === 'Rejected' && <ReturnedBanner record="imprest" reason={r.decided_notes} person={r.rejecter?.full_name} at={r.rejected_at} className="mb-0" />}</div> },
    { key: 'actions', header: <span className="sr-only">{t('imprest:rep.actions', 'Actions')}</span>, cell: (r) => {
      const acts = availableReplenishmentActions({ userId, realRole, custodianId: flt.custodian_id, rep: r });
      const btn = (a: ImprestAction, label: string, variant: 'primary' | 'outline' | 'ghost') => acts.includes(a) &&
        <Button variant={variant} size="sm" onClick={() => setDialog({ kind: 'rep', rep: r, action: a as never })}>{label}</Button>;
      return <span className="flex flex-wrap gap-1">
        {btn('rejectReplenishment', t('imprest:actions.reject', 'Reject'), 'outline')}
        {btn('approveReplenishment', t('imprest:actions.approve', 'Approve'), 'primary')}
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

  const mayBindCash = may('edit', 'imprestFloat');
  const noReceipts = !claims.isPending && !claims.isError && (claims.data?.rows ?? []).length === 0;
  const noReps = !reps.isPending && !reps.isError && repRows.length === 0;
  const noCounts = !counts.isPending && !counts.isError && (counts.data?.rows ?? []).length === 0;
  const historyEmpty = noReceipts && noReps && noCounts;

  return (
    <div>
      <div className="hidden max-[920px]:block"><BackBar label={backLabel} onBack={goBack} /></div>
      {/* The project names the float; the short identifier is a muted second element (floats carry no human number). */}
      <RecordHeader panelInset name={<>{flt.project?.name ?? '—'}<span className="ml-2 text-control font-normal text-muted-foreground">{t('imprest:detail.floatRef', 'Ref. {{id}}', { id: flt.id.slice(0, 8) })}</span></>}
        status={flt.archived_at
          ? <StatusPill variant="neutral">{t('imprest:detail.archived', 'Archived')}</StatusPill>
          : <StatusPill record="imprest" state="Active" />}
        meta={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t('imprest:detail.custodian', 'Custodian: {{name}}', { name: flt.custodian?.full_name ?? '—' })}</span>
          {flt.erp_cash_account_ref && <span data-testid="cash-account">{t('imprest:cash.title', 'ERP cash account')}: <span className="font-medium text-foreground">{flt.erp_cash_account_ref}</span> {t('imprest:cash.fixed', '· set once, cannot be changed')}</span>}
        </span>}>
        {/* Nothing for a viewer who can bind it to act on: one muted line in the header, not a panel of its own. */}
        {!flt.erp_cash_account_ref && !mayBindCash && <p>{t('imprest:cash.unset', 'Not linked to an accounting cash account yet, so these movements stay in PMO.')}</p>}
      </RecordHeader>

      <RecordStack>
      {position.isPending && <ListState variant="loading" rows={3} />}
      {!position.isPending && (position.isError || !pos) && (
        <ListState variant="error" title={t('imprest:detail.positionError', "Couldn't load the cash position")}
          sub={t('imprest:detail.positionErrorSub', 'No figure is shown and actions are paused until the position loads.')}
          onRetry={() => void position.refetch()} />
      )}
      {pos && (
        <RecordSection
          title={t('imprest:detail.position', 'Position')}
          actions={floatActions.length > 0 && (
            <>
              {/* One filled action: the state's job (top-up when receipts wait, else funding when it is short). */}
              {floatActions.includes('requestReplenishment') && <Button variant="primary" size="sm" onClick={() => setDialog({ kind: 'request', as: 'replenishment' })}>{t('imprest:actions.requestReplenishment', 'Request top-up')}</Button>}
              {floatActions.includes('requestFunding') && <Button variant={floatActions.includes('requestReplenishment') ? 'outline' : 'primary'} size="sm" onClick={() => setDialog({ kind: 'request', as: 'funding' })}>{t('imprest:actions.requestFunding', 'Request funding')}</Button>}
              {floatActions.includes('recordCount') && <Button variant={floatActions.some((a) => a === 'requestReplenishment' || a === 'requestFunding') ? 'outline' : 'primary'} size="sm" onClick={() => setDialog({ kind: 'count' })}>{t('imprest:actions.recordCount', 'Record count')}</Button>}
            </>
          )}
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {/* The custodian's one question first: how much cash is in hand. */}
            <Figure id="cash" lead label={t('imprest:position.cash', 'Cash in hand')} value={money(pos.cash_book)} />
            <Figure id="float" label={t('imprest:position.float', 'Limit')} value={money(pos.float_amount)}
              note={pendingLimit ? t('imprest:position.limitPending', '{{amount}} waiting for approval', { amount: money(pendingLimit.proposed_amount) }) : undefined} />
            <Figure id="advances" label={t('imprest:position.advancesOut', 'Advances given')} value={money(pos.advances_out)} />
            <Figure id="receipts" label={t('imprest:position.receiptsWaiting', 'Receipts waiting')} value={money(pos.receipts_waiting)} />
            <Figure id="in-flight" label={t('imprest:position.inFlight', 'Top-up on its way')} value={money(pos.replenishment_in_flight)} />
            <Figure id="gap" label={t('imprest:position.gap', 'Still needed')} value={
              books?.kind === 'broken' ? <span role="status" className="text-destructive-text"><span>{t('imprest:position.gapFlag', 'Books do not balance')}</span> ({money(books.short)})</span>
              : books?.kind === 'unfunded' ? <span className="font-normal text-muted-foreground">{t('imprest:position.notFunded', 'Not funded yet')}</span>
              : books?.kind === 'topUp' ? money(books.due)
              : money(0)} />
          </dl>
          {pos.last_count_at && (
            <p className="mt-4 text-control text-muted-foreground">
              {t('imprest:position.lastCount', 'Last count {{date}}: difference {{variance}}', { date: formatDay(pos.last_count_at), variance: pos.last_count_variance == null ? '—' : moneyCents(pos.last_count_variance) })}
              {pos.last_count_variance != null && toCents(pos.last_count_variance) !== 0 && <> · <span className="text-destructive-text">{t('imprest:position.varianceFlag', 'Count differs')}</span></>}
            </p>
          )}
        </RecordSection>
      )}

      <PlansSection floatId={flt.id} custodianId={flt.custodian_id} currency={cur} currentMonth={pos?.month ?? new Date().toISOString().slice(0, 7) + '-01'}
        usageEmpty={planLines.length === 0}
        usage={pos ? (
          <div data-testid="month-plan-usage">
            <h3 className="px-[var(--panel-inset)] pb-3 text-sm font-semibold text-foreground">{t('imprest:plan.title', 'This month\'s plan ({{month}})', { month: formatMonthYearShort(pos.month) })}</h3>
            {planLines.length === 0
              ? <p className="px-[var(--panel-inset)] text-sm text-muted-foreground">{t('imprest:plan.emptyLine', 'No approved plan this month. Spend is out of plan until one is approved.')}</p>
              : <DataTable<PlanLineUsage> embedded rows={planLines} columns={planColumns} rowKey={(r) => r.budget_category}
                tableId="imprest-plan-usage" />}
          </div>
        ) : undefined} />

      <FloatAmountSection floatId={flt.id} custodianId={flt.custodian_id} currency={cur} />

      {!flt.erp_cash_account_ref && mayBindCash && <CashAccountSection floatId={flt.id} account={flt.erp_cash_account_ref} />}

      {historyEmpty ? (
        <RecordSection title={t('imprest:history.title', 'History')}>
          <ul data-testid="float-history-empty" className="divide-y divide-border text-sm text-muted-foreground">
            <li className="py-2 first:pt-0">{t('imprest:history.noReceipts', 'No receipts yet')}</li>
            <li className="py-2">{t('imprest:history.noReplenishments', 'No top-ups yet')}</li>
            <li className="py-2 last:pb-0">{t('imprest:history.noCounts', 'No cash counts yet')}</li>
          </ul>
        </RecordSection>
      ) : (
        <>
      <RecordSection title={t('imprest:receipts.title', 'Receipts')}>
          {claims.isError ? <ListState variant="error" title={t('imprest:receipts.error', "Couldn't load these records")} onRetry={() => void claims.refetch()} />
            : claims.isPending ? <ListState variant="loading" rows={2} />
            : noReceipts ? <p className="text-sm text-muted-foreground">{t('imprest:history.noReceipts', 'No receipts yet')}</p>
            : <ul className="divide-y divide-border text-sm">
              {(claims.data?.rows ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <Link to={`/expenses/${c.id}`} className="font-semibold text-primary-text hover:underline">{c.claim_number ?? c.title}</Link>
                  <span className="min-w-0 basis-full truncate sm:basis-0 sm:flex-1">{c.title}</span>
                  {c.is_plan_exception && <StatusPill variant="warn">{t('imprest:plan.exception', 'Out of plan')}</StatusPill>}
                  <span className="tabular-nums">{money(c.amount)}</span>
                  {/* One status per receipt: a paid claim says where its cash stands; anything else shows its claim status. */}
                  {c.kind === 'claim' && c.status === 'Paid' ? (settlement(c.imprest_replenishment_id) === 'paid'
                    ? <StatusPill variant="won">{t('imprest:receipts.replenished', 'Paid, topped up')}</StatusPill>
                    : settlement(c.imprest_replenishment_id) === 'requested'
                      ? <span className="inline-flex flex-wrap items-baseline gap-x-1">
                        <StatusPill variant="progress">{t('imprest:receipts.inRequest', 'Paid, in a top-up request')}</StatusPill>
                        {requestNumberOf(c.imprest_replenishment_id) && <span className="text-muted-foreground">{requestNumberOf(c.imprest_replenishment_id)}</span>}
                      </span>
                      : <StatusPill variant="warn">{t('imprest:receipts.waiting', 'Paid, waiting for top-up')}</StatusPill>)
                    : <StatusPill record="expense" state={c.status} />}
                  {posting(c.id)}
                </li>
              ))}
            </ul>}
      </RecordSection>

      <RecordSection title={t('imprest:rep.title', 'Top-ups')} flush={!noReps && !reps.isError}>
        <div className={noReps || reps.isError || postings.isError || postings.data?.truncated ? 'px-[var(--panel-inset)] pb-[var(--panel-inset)]' : undefined}>
          {postings.isError
            ? <ListState variant="error" title={t('imprest:posting.error', "Couldn't load the ERP posting status")} retryLabel={t('ui.listState.retry', 'Retry')} onRetry={() => void postings.refetch()} />
            : null}
          {postings.data?.truncated && <p role="status" className="mb-2 text-sm text-muted-foreground">
            {t('imprest:posting.truncated', 'Showing posting status for the first {{count}} movements only.', { count: LIST_LIMIT })}
          </p>}
          {reps.isError ? <ListState variant="error" title={t('imprest:rep.error', "Couldn't load top-ups")} onRetry={() => void reps.refetch()} />
            : noReps
              ? <p className="text-sm text-muted-foreground">{t('imprest:history.noReplenishments', 'No top-ups yet')}</p>
              : <DataTable<ImprestReplenishmentRow> embedded rows={repRows} columns={repColumns} rowKey={(r) => r.id}
                state={reps.isPending ? 'loading' : undefined}
                tableId="imprest-replenishments" />}
        </div>
      </RecordSection>

      <RecordSection title={t('imprest:counts.title', 'Cash counts')}>
          {counts.isError ? <ListState variant="error" title={t('imprest:counts.error', "Couldn't load counts")} onRetry={() => void counts.refetch()} />
            : counts.isPending ? <ListState variant="loading" rows={2} loadingRole="status" loadingLabel={t('imprest:counts.loading', 'Loading cash counts…')} loadingAriaLabel={t('imprest:counts.loading', 'Loading cash counts…')} />
            : noCounts ? <p className="text-sm text-muted-foreground">{t('imprest:history.noCounts', 'No cash counts yet')}</p>
            : <ul className="divide-y divide-border text-sm">
              {(counts.data?.rows ?? []).map((c) => (
                // Label above value, like the Position figures: nothing is cut on a phone; the note is read whole.
                <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-semibold">{formatDay(c.counted_at)}</p>
                  <dl className="mt-1 grid max-w-2xl grid-cols-3 gap-x-4 gap-y-1">
                    <div><dt className="text-control text-muted-foreground">{t('imprest:counts.countedLabel', 'Counted')}</dt><dd className="tabular-nums">{moneyCents(c.counted_amount)}</dd></div>
                    <div><dt className="text-control text-muted-foreground">{t('imprest:counts.bookLabel', 'Expected')}</dt><dd className="tabular-nums">{moneyCents(c.book_amount)}</dd></div>
                    <div><dt className="text-control text-muted-foreground">{t('imprest:counts.varianceLabel', 'Difference')}</dt><dd className={toCents(c.variance) !== 0 ? 'tabular-nums text-destructive-text' : 'tabular-nums'}>{moneyCents(c.variance)}</dd></div>
                  </dl>
                  {c.note && <p className="mt-1 break-words text-control text-muted-foreground">{c.note}</p>}
                </li>
              ))}
            </ul>}
      </RecordSection>
        </>
      )}
      </RecordStack>

      <ConfirmDialog
        open={dialog?.kind === 'request'}
        title={dialog?.kind === 'request' && dialog.as === 'funding' ? t('imprest:confirm.fundingTitle', 'Request funding for this site cash?') : t('imprest:confirm.requestTitle', 'Request a top-up?')}
        description={<p>{dialog?.kind === 'request' && dialog.as === 'funding'
          ? t('imprest:confirm.fundingBody', 'Asks Finance to put cash in, up to the limit.')
          : t('imprest:confirm.requestBody', 'Asks Finance to top up the site cash with the {{amount}} of receipts waiting.', { amount: moneyCents(requestable / 100) })}</p>}
        confirmLabel={dialog?.kind === 'request' && dialog.as === 'funding' ? t('imprest:actions.requestFunding', 'Request funding') : t('imprest:actions.requestReplenishment', 'Request top-up')}
        loading={requestRep.isPending}
        error={dialogError}
        onConfirm={() => { if (dialog?.kind === 'request') void run(() => requestRep.mutateAsync({ floatId: flt.id, kind: dialog.as }), t('imprest:toast.requested', 'Request sent')); }}
        onCancel={close}
      />
      <ReasonDialog
        open={repDialog?.action === 'rejectReplenishment'}
        kind="reject"
        subject={repDialog?.rep.number ?? ''}
        context={repDialog ? moneyCents(repDialog.rep.amount) : undefined}
        loading={transitionRep.isPending}
        error={dialogError}
        onConfirm={(reason) => {
          if (!repDialog) return;
          void run(() => transitionRep.mutateAsync({ id: repDialog.rep.id, to: REP_TO[repDialog.action], notes: reason }), t('imprest:toast.updated', 'Updated'));
        }}
        onCancel={close}
      />
      <ConfirmDialog
        open={repDialog !== null && repDialog.action !== 'rejectReplenishment'}
        tone={repDialog?.action === 'rejectReplenishment' || repDialog?.action === 'cancelReplenishment' ? 'destructive' : 'default'}
        title={repDialog ? t('imprest:confirm.repTitle', '{{action}} {{number}}: {{amount}}?', { action: repLabel, number: repDialog.rep.number, amount: moneyCents(repDialog.rep.amount) }) : ''}
        description={<div className="space-y-3">
          {repDialog?.action === 'payReplenishment' && <TextField label={t('imprest:confirm.reference', 'Payment reference (optional)')} value={reference} onChange={setReference} />}
          {repDialog && repDialog.action !== 'payReplenishment' && <p>{moneyCents(repDialog.rep.amount)}</p>}
        </div>}
        confirmLabel={repLabel ?? ''}
        loading={transitionRep.isPending}
        error={dialogError}
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
          <p className="text-sm">{t('imprest:confirm.countBook', 'Expected cash in hand: {{amount}}', { amount: pos ? moneyCents(pos.cash_book) : '' })}</p>
          <TextField label={t('imprest:confirm.counted', 'Counted cash')} inputMode="decimal" value={counted} onChange={setCounted} />
          <TextArea label={countDiffers ? t('imprest:confirm.noteRequired', 'Note (required: the count differs from the books)') : t('imprest:confirm.note', 'Note (optional)')} value={notes} onChange={setNotes} />
        </div>}
        confirmLabel={t('imprest:actions.recordCount', 'Record count')}
        confirmDisabled={!countValid}
        loading={recordCount.isPending}
        error={dialogError}
        onConfirm={() => void run(() => recordCount.mutateAsync({ floatId: flt.id, counted: countedParsed as number, ...(notes.trim() ? { note: notes.trim() } : {}) }), t('imprest:toast.counted', 'Count recorded'))}
        onCancel={close}
      />
    </div>
  );
};
export default ImprestFloatDetail;
