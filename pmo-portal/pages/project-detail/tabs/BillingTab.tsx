import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, Drawer, ListState, StatusPill, Tooltip, useToast, type Column,
} from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { currencySymbol, formatCurrencyAuto, formatDateOnly, formatNumber, formatNumberExact, formatNumberMax2, formatUtcMonthYear } from '@/src/lib/format';
import { claimNet, percentOfLot, remainingQuantity, summarizeBilling } from '@/src/lib/progressBilling';
import type {
  BoqItemInput, BoqItemRow, ProgressAssessmentInput, ProgressClaimInput, ProgressClaimWithInvoice,
} from '@/src/lib/db/progressBilling';
import { useBoqItems, useProgressBillingMutations, useProjectBilling, useProjectClaims } from '@/src/hooks/useProgressBilling';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useProjectWorkOrderLines } from '@/src/hooks/useWorkOrderAcceptances';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import BoqItemFormModal from '../BoqItemFormModal';
import ProgressAssessmentModal from '../ProgressAssessmentModal';
import ProgressClaimModal from '../ProgressClaimModal';
import ClaimEvidenceModal from '../ClaimEvidenceModal';
import ProjectBillingStart from '../ProjectBillingStart';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { useRevenueRouteReady } from '@/src/hooks/useOwnershipCacheSync';

/**
 * The project's Billing tab (#766). Three things on one page, kept visibly apart (DD-PBL-2):
 *   • the PM's ASSESSMENT of progress ("Record progress") — operational, never an invoice;
 *   • the bill of quantities both are measured against;
 *   • Finance's BILLING CLAIMS — evidence first, then one ERP invoice each.
 * Figures come from get_project_billing and are derived with the management pack's helpers (DD-PBL-9).
 * ⚑ Nothing ERP-bound or destructive writes on one click; the server is the authority on every rule.
 */
export interface BillingTabProps {
  projectId: string;
  currency: string;
  /** The project's client — the invoice customer. No client, no billing buttons. */
  clientId: string | null;
  /** Decides who may record progress (#765's rule). */
  projectManagerId: string | null;
  /** Keep contract line tools available while the contract cascade owns the reading surface. */
  mode?: 'full' | 'contract-tools';
}

/** `YYYY-MM` in the browser's zone. ponytail: only the dialog's default — the user can change it and the
 *  server truncates to the month; switch to the org timezone if month-end entries land in the wrong month. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** A lump-sum line is one lot: its progress is a fraction (0.4) shown as a percent (40%). */

const Figure: React.FC<{ testId: string; label: string; value: string; note?: string; source: string }> = ({ testId, label, value, note, source }) => (
  <div>
    <dt className="text-[12px] text-muted-foreground">{label}</dt>
    <dd className="cursor-help tabular text-[15px] font-semibold" data-testid={testId}><Tooltip content={source}><span>{value}</span></Tooltip></dd>
    {note && <dd className="text-[11px] text-muted-foreground">{note}</dd>}
  </div>
);

const SourcedFigure: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div>
    <dt className="text-[12px] text-muted-foreground">{label}</dt>
    <dd className="cursor-help tabular text-[15px] font-semibold"><Tooltip content={detail}><span>{value}</span></Tooltip></dd>
  </div>
);

const BillingTab: React.FC<BillingTabProps> = ({ projectId, currency, clientId, projectManagerId, mode = 'full' }) => {
  const { t } = useTranslation('project');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const erp = useErpItemOptions('sales');
  const revenueMode = useRevenueMode();
  const revenueRouteReady = useRevenueRouteReady(revenueMode);
  const billing = useProjectBilling(projectId);
  const boq = useBoqItems(projectId);
  const claims = useProjectClaims(projectId);
  const workOrders = useProjectWorkOrders(projectId);
  const allocations = useProjectWorkOrderLines(projectId);
  const documents = useDocuments(projectId);
  const mutations = useProgressBillingMutations(projectId);

  // `undefined` = closed · `null` = add a line · a row = edit it.
  const [boqFormFor, setBoqFormFor] = useState<BoqItemRow | null | undefined>(undefined);
  const [boqDetailFor, setBoqDetailFor] = useState<BoqItemRow | null>(null);
  const [claimDetailFor, setClaimDetailFor] = useState<ProgressClaimWithInvoice | null>(null);
  const [deleteFor, setDeleteFor] = useState<BoqItemRow | null>(null);
  const [claimFormOpen, setClaimFormOpen] = useState(false);
  const [assessOpen, setAssessOpen] = useState(false);
  const [contractLinesOpen, setContractLinesOpen] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  // The idempotency key is minted when the confirm opens, so a retry of the same confirm reuses it (ADR-0058).
  const [raiseFor, setRaiseFor] = useState<{ claim: ProgressClaimWithInvoice; idempotencyKey: string } | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<ProgressClaimWithInvoice | null>(null);

  const boqRows = useMemo(() => boq.data ?? [], [boq.data]);
  const claimRows = useMemo(() => claims.data ?? [], [claims.data]);
  const canViewMoney = may('view', 'salesInvoice');
  const openRecordId = searchParams.get('open');
  const openRecordType = searchParams.get('openType');
  const setOpenRecord = (id: string, type: 'billingBoq' | 'billingClaim') => {
    const next = new URLSearchParams(searchParams);
    next.set('open', id);
    next.set('openType', type);
    setSearchParams(next);
  };
  const closeRecord = (id: string, type: 'billingBoq' | 'billingClaim') => {
    if (openRecordId === id && openRecordType === type) {
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      next.delete('openType');
      setSearchParams(next, { replace: true });
    }
    if (type === 'billingBoq') setBoqDetailFor(null);
    else setClaimDetailFor(null);
  };
  useEffect(() => {
    if (openRecordType === 'billingBoq') {
      setBoqDetailFor(boqRows.find((row) => row.id === openRecordId) ?? null);
      setClaimDetailFor(null);
    } else if (openRecordType === 'billingClaim' && canViewMoney) {
      setClaimDetailFor(claimRows.find((row) => row.id === openRecordId) ?? null);
      setBoqDetailFor(null);
    } else {
      setBoqDetailFor(null);
      setClaimDetailFor(null);
    }
  }, [openRecordId, openRecordType, boqRows, claimRows, canViewMoney]);
  const summary = billing.data ? summarizeBilling(billing.data) : null;
  const excl = t('projectDetail.billing.summary.exclTax', 'excl. PPN');
  // C5: no padded .00, but a real fraction is money and is never rounded away. In-page figures are bare (the
  // heading names currency + basis once, C6); drawers and confirmations, which have no such heading, keep the currency.
  const money = (value: number) => formatNumberMax2(value);
  const cents = (value: number | string) => formatCurrencyAuto(Number(value), currency);
  const monthLabel = (iso: string) => formatUtcMonthYear(new Date(`${iso}T00:00:00Z`));

  // A claim's scope comes from the allocations: until they are loaded no scope is offered (never a guessed one).
  const claimScopeReady = !allocations.isPending && !allocations.isError;
  const canBill = may('create', 'progressClaim') && erp.connected && clientId !== null && claimScopeReady;
  const canStartInvoice = may('create', 'salesInvoice') && revenueRouteReady && clientId !== null;
  const canAssess = may('edit', 'projectProgress', { currentUserId: currentUser?.id, record: { project_manager_id: projectManagerId } });
  const liveDownPayment = claimRows.some((c) => c.kind === 'down_payment' && !c.withdrawn_at && c.invoice?.status !== 'Cancelled');

  const fail = (err: unknown, headlineOverrides?: Record<string, string>) => {
    const { headline, detail } = classifyMutationError(err, headlineOverrides);
    toast(headline, detail, 'warning');
  };

  const saveBoq = async (input: BoqItemInput) => {
    if (boqFormFor) await mutations.updateBoq.mutateAsync({ id: boqFormFor.id, input });
    else await mutations.createBoq.mutateAsync(input);
    toast(t('projectDetail.billing.boq.toast.saved', 'Bill of quantities line saved'), input.itemCode, 'success');
    setBoqFormFor(undefined);
  };
  const saveAssessment = async (input: Omit<ProgressAssessmentInput, 'projectId'>) => {
    const pct = await mutations.recordAssessment.mutateAsync(input);
    toast(t('projectDetail.billing.assessment.toast.saved', 'Progress recorded: {{pct}}% complete', { pct: formatNumberExact(Number(pct)) }), undefined, 'success');
    setAssessOpen(false);
  };
  const saveClaim = async (input: Omit<ProgressClaimInput, 'projectId'>) => {
    const id = await mutations.createClaim.mutateAsync(input);
    toast(t('projectDetail.billing.claims.toast.created', 'Billing claim created'), undefined, 'success');
    setClaimFormOpen(false);
    if (typeof id === 'string') setEvidenceFor(id); // the next step is always the evidence (DD-PBL-7)
  };
  const attachEvidence = async (documentId: string) => {
    if (!evidenceFor) return;
    await mutations.attachEvidence.mutateAsync({ claimId: evidenceFor, documentId });
    toast(t('projectDetail.billing.claims.toast.evidenceAttached', 'Evidence attached'), undefined, 'success');
    setEvidenceFor(null);
  };
  const runRaise = async () => {
    if (!raiseFor || !clientId) return;
    const { claim, idempotencyKey } = raiseFor;
    try {
      await mutations.raiseInvoice.mutateAsync({ claimId: claim.id, customerId: clientId, intent: { id: claim.id, idempotencyKey } });
      toast(t('projectDetail.billing.claims.toast.raised', 'Invoice raised in the ERP'), undefined, 'success');
    } catch (err) {
      // 55000 is the database's own refusal to raise a WITHDRAWN claim's invoice (0250's fence,
      // carried by dispatchClient as AppError code). The generic headline says nothing about the
      // one situation this confirm can hit — name it in the user's language (BW001's precedent,
      // InvoiceWorkOrderModal).
      fail(err, {
        '55000': t('projectDetail.billing.claims.errors.claimWithdrawn', "This claim was withdrawn. Its invoice can't be raised."),
      });
    } finally {
      setRaiseFor(null);
    }
  };
  const runWithdraw = async () => {
    if (!withdrawFor) return;
    try {
      await mutations.withdrawClaim.mutateAsync(withdrawFor.id);
      toast(t('projectDetail.billing.claims.toast.withdrawn', 'Claim withdrawn'), undefined, 'success');
    } catch (err) {
      fail(err);
    } finally {
      setWithdrawFor(null);
    }
  };
  const runDelete = async () => {
    if (!deleteFor) return;
    try {
      await mutations.deleteBoq.mutateAsync(deleteFor.id);
      toast(t('projectDetail.billing.boq.toast.deleted', 'Bill of quantities line deleted'), deleteFor.item_code, 'success');
    } catch (err) {
      fail(err);
    } finally {
      setDeleteFor(null);
    }
  };

  // Contract-quantity facts exist per BoQ line once the project has lines; until the summary loads (or if it
  // fails) the cells say "—" — a quantity is never shown as zero because it is unknown.
  const lineFactsById = new Map((summary?.contractLines ?? []).map((line) => [line.boqItemId, line] as const));
  const hasLines = summary ? summary.contractLines.length > 0 : boqRows.length > 0;
  const milliOf = (value: number): number => Math.round(value * 1000);
  const quantityText = (row: BoqItemRow, quantity: number): string =>
    row.earning_basis === 'lump_sum' ? percentOfLot(quantity) : `${formatNumberExact(quantity)} ${row.unit}`;
  const lineProject = Boolean(summary && summary.contractLines.length > 0);

  const boqColumns: Column<BoqItemRow>[] = [
    { key: 'item', header: t('projectDetail.billing.boq.column.item', 'Item'), cell: (row) => (
      <div className="flex flex-col">
        <span className="font-semibold">{row.item_code}</span>
        <span className="text-[11px] text-muted-foreground">{row.description}</span>
      </div>
    ) },
    { key: 'quantity', header: t('projectDetail.billing.boq.column.quantity', 'Contract'), align: 'num',
      cell: (row) => <Tooltip content={t('projectDetail.billing.boq.source.contract', 'Source: priced contract line quantity and unit.')}><span className="cursor-help tabular">{row.earning_basis === 'lump_sum'
        ? t('projectTabs:contractQuantities.billing.boq.lumpSum', 'Lump sum')
        : `${formatNumberExact(Number(row.quantity))} ${row.unit}`}</span></Tooltip> },
    ...(canViewMoney ? [{ key: 'rate', header: t('projectDetail.billing.boq.column.rate', 'Rate'), align: 'num' as const,
      cell: (row: BoqItemRow) => <Tooltip content={t('projectDetail.billing.boq.rateSource', 'Source: the priced contract line rate.') }><span className="cursor-help tabular">{cents(row.rate)}</span></Tooltip> }] : []),
    ...(hasLines ? [
      { key: 'ordered', header: t('projectTabs:contractQuantities.billing.boq.column.ordered', 'Ordered'), align: 'num' as const, cell: (row: BoqItemRow) => {
        const f = lineFactsById.get(row.id);
        return <Tooltip content={t('projectDetail.billing.boq.source.ordered', 'Source: quantities allocated to customer orders.')}><span className="cursor-help tabular" data-testid={`boq-ordered-${row.id}`}>{f ? quantityText(row, f.orderedQuantity) : '—'}</span></Tooltip>;
      } },
      { key: 'balance', header: t('projectTabs:contractQuantities.billing.boq.column.balance', 'Not yet ordered'), align: 'num' as const, cell: (row: BoqItemRow) => {
        const f = lineFactsById.get(row.id);
        return (
          <Tooltip content={t('projectDetail.billing.boq.source.balance', 'Computed as contract quantity less ordered quantity.')}><span className="cursor-help tabular" data-testid={`boq-balance-${row.id}`}>
            {f ? quantityText(row, f.contractBalance) : '—'}
            {f && f.contractBalance < 0 && (
              <span className="ml-1 block text-[11px] text-destructive-text">
                {t('projectTabs:contractQuantities.billing.boq.overOrdered', 'Over-ordered by {{qty}}', { qty: quantityText(row, -f.contractBalance) })}
              </span>
            )}
          </span></Tooltip>
        );
      } },
      { key: 'accepted', header: t('projectTabs:contractQuantities.billing.boq.column.accepted', 'Accepted (BAST)'), align: 'num' as const, cell: (row: BoqItemRow) => {
        const f = lineFactsById.get(row.id);
        return (
          <Tooltip content={t('projectDetail.billing.boq.source.accepted', 'Source: quantities on confirmed BASTs.')}><span className="cursor-help tabular" data-testid={`boq-accepted-${row.id}`}>
            {f ? quantityText(row, f.acceptedQuantity) : '—'}
            {f && milliOf(f.acceptedQuantity) > milliOf(f.orderedQuantity) && (
              <span className="ml-1 block text-[11px] text-destructive-text">{t('projectTabs:contractQuantities.billing.boq.overMeasured', 'More than ordered')}</span>
            )}
          </span></Tooltip>
        );
      } },
    ] : []),
    { key: 'assessed', header: t('projectDetail.billing.boq.column.assessed', 'Assessed'), align: 'num', cell: (row) => {
      const assessed = summary?.assessedByBoqItem[row.id];
      return (
        <Tooltip content={t('projectDetail.billing.boq.source.assessed', 'Source: latest recorded progress assessment for this line.')}><span className="cursor-help tabular" data-testid={`boq-assessed-${row.id}`}>
          {assessed === undefined ? '—' : row.earning_basis === 'lump_sum' ? percentOfLot(assessed) : formatNumberExact(assessed)}
        </span></Tooltip>
      );
    } },
    ...(hasLines ? [
      { key: 'earned', header: t('projectTabs:contractQuantities.billing.boq.column.earned', 'Earned'), align: 'num' as const, cell: (row: BoqItemRow) => {
        const f = lineFactsById.get(row.id);
        return (
          <Tooltip content={t('projectDetail.billing.boq.source.earned', 'Source: earned quantity from project billing facts.')}><span className="cursor-help tabular" data-testid={`boq-earned-${row.id}`}>
            {f ? (row.earning_basis === 'lump_sum' ? percentOfLot(f.earnedQuantity) : quantityText(row, f.earnedQuantity)) : '—'}
          </span></Tooltip>
        );
      } },
    ] : []),
    { key: 'claimed', header: t('projectDetail.billing.boq.column.claimed', 'Claimed'), align: 'num', cell: (row) => (
      <Tooltip content={t('projectDetail.billing.boq.source.claimed', 'Source: quantities on live progress claims.')}><span className="cursor-help tabular" data-testid={`boq-claimed-${row.id}`}>
        {summary ? formatNumberExact(summary.claimedByBoqItem[row.id] ?? 0) : '—'}
      </span></Tooltip>
    ) },
    { key: 'remaining', header: t('projectDetail.billing.boq.column.remaining', 'Left to claim'), align: 'num', cell: (row) => {
      if (!summary) return <Tooltip content={t('projectDetail.billing.boq.source.remaining', 'Computed as contract quantity less quantities claimed.')}><span data-testid={`boq-remaining-${row.id}`}>—</span></Tooltip>;
      const left = remainingQuantity(Number(row.quantity), summary.claimedByBoqItem[row.id] ?? 0);
      return (
        <Tooltip content={t('projectDetail.billing.boq.source.remaining', 'Computed as contract quantity less quantities claimed.')}><span className="cursor-help tabular" data-testid={`boq-remaining-${row.id}`}>
          {formatNumberExact(left)}
          {left < 0 && <span className="ml-1 text-[11px] text-destructive-text">{t('projectDetail.billing.boq.overClaimed', 'Over-claimed')}</span>}
        </span></Tooltip>
      );
    } },
    { key: 'actions', header: t('projectDetail.billing.boq.column.actions', 'Actions'), cell: (row) => (
      <div className="flex gap-1.5">
        {may('edit', 'boqItem') && (
          <Button variant="ghost" size="sm" onClick={() => setBoqFormFor(row)}>{t('projectDetail.billing.boq.edit', 'Edit')}</Button>
        )}
        {may('delete', 'boqItem') && (
          <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
            onClick={() => setDeleteFor(row)}>{t('projectDetail.billing.boq.delete', 'Delete')}</Button>
        )}
      </div>
    ) },
  ];

  const claimColumns: Column<ProgressClaimWithInvoice>[] = [
    { key: 'claim', header: t('projectDetail.billing.claims.column.claim', 'Claim'), cell: (c) => (
      <span>{c.kind === 'down_payment'
        ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment')
        : t('projectDetail.billing.claims.kind.progress', 'Progress')}</span>
    ) },
    { key: 'gross', header: t('projectDetail.billing.claims.column.claimedLabel', 'Claimed'), align: 'num',
      cell: (c) => <Tooltip content={t('projectDetail.billing.claims.source.gross', 'Source: the progress claim gross amount, copied from accepted quantities and contract rates.') }><span className="cursor-help tabular">{cents(c.gross_amount)}</span></Tooltip> },
    { key: 'recovery', header: t('projectDetail.billing.claims.column.recoveryLong', 'Down payment recovered'), align: 'num',
      cell: (c) => <Tooltip content={t('projectDetail.billing.claims.source.recovery', 'Source: the down-payment amount recovered on this claim.') }><span className="cursor-help tabular">{cents(c.dp_recovery_amount)}</span></Tooltip> },
    { key: 'net', header: t('projectDetail.billing.claims.column.net', 'Net'), align: 'num',
      cell: (c) => <Tooltip content={t('projectDetail.billing.claims.source.net', 'Computed as gross less down-payment recovery.') }><span className="cursor-help tabular">{cents(claimNet(Number(c.gross_amount), Number(c.dp_recovery_amount)))}</span></Tooltip> },
    { key: 'invoice', header: t('projectDetail.billing.claims.column.invoice', 'Invoice'), cell: (c) => {
      const label = c.withdrawn_at
        ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn')
        : c.invoice
          ? `${c.invoice.si_number ?? ''} · ${c.invoice.status}`
          : t('projectDetail.billing.claims.notRaised', 'Not raised');
      const variant = c.withdrawn_at ? 'lost' : c.invoice?.status === 'Paid' ? 'won' : c.invoice?.status === 'Unpaid' || c.invoice?.status === 'Submitted' ? 'warn' : 'neutral';
      return <Tooltip content={t('projectDetail.billing.claims.source.invoice', 'Source: invoice status linked to this claim.') }><span className="cursor-help"><StatusPill variant={variant}>{label}</StatusPill></span></Tooltip>;
    } },
    { key: 'evidence', header: t('projectDetail.billing.claims.column.evidence', 'Evidence'), align: 'num',
      cell: (c) => <Tooltip content={t('projectDetail.billing.claims.source.evidence', 'Source: linked evidence documents on the claim.') }><span className="cursor-help tabular" data-testid={`claim-evidence-${c.id}`}>{formatNumber(c.evidence.length)}</span></Tooltip> },
    { key: 'actions', header: t('projectDetail.billing.claims.column.actions', 'Actions'), cell: (c) => {
      const open = !c.withdrawn_at && !c.invoice;
      return (
        <div className="flex flex-wrap items-center gap-1.5" data-testid={`claim-actions-${c.id}`}>
          {open && canBill && (
            <Button variant="outline" size="sm" onClick={() => setEvidenceFor(c.id)}>
              {t('projectDetail.billing.claims.attachEvidence', 'Attach evidence')}
            </Button>
          )}
          {open && canBill && (c.evidence.length > 0 ? (
            <Button variant="primary" size="sm" onClick={() => setRaiseFor({ claim: c, idempotencyKey: crypto.randomUUID() })}>
              {t('projectDetail.billing.claims.raise', 'Raise invoice')}
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {t('projectDetail.billing.claims.evidenceNeeded', 'Attach evidence before raising')}
            </span>
          ))}
          {open && canBill && (
            <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
              onClick={() => setWithdrawFor(c)}>{t('projectDetail.billing.claims.withdraw', 'Withdraw')}</Button>
          )}
        </div>
      );
    } },
  ];

  // No BoQ and no claims (both loaded): quantity billing is not in use — fold it away (SUB-B).
  const quantityEmpty = !boq.isPending && !boq.isError && boqRows.length === 0
    && !claims.isPending && !claims.isError && claimRows.length === 0;
  const evidenceClaim = claimRows.find((c) => c.id === evidenceFor);

  const boqCard = (
    <Card>
      <CardHead
        level={2}
        className="text-base"
        actions={
          <>
            {mode === 'full' && canAssess && boqRows.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setAssessOpen(true)}>
                {t('projectDetail.billing.assessment.record', 'Record progress')}
              </Button>
            )}
            {may('create', 'boqItem') && (
              <Button variant="primary" size="sm" onClick={() => setBoqFormFor(null)}>{t('projectDetail.billing.boq.add', 'Add line')}</Button>
            )}
          </>
        }
      >
        {t('projectDetail.billing.boq.title', 'Bill of quantities')}
      </CardHead>
      <CardPad flush>
        <DataTable<BoqItemRow>
          embedded
          rows={boqRows}
          columns={boqColumns}
          rowKey={(row) => row.id}
          state={boq.isPending ? 'loading' : boq.isError ? 'error' : boqRows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('projectDetail.billing.boq.empty', 'No bill of quantities yet')}
          emptySub={t('projectDetail.billing.boq.emptySub', "Add the contract's priced lines to assess progress and bill by quantity.")}
          errorTitle={t('projectDetail.billing.boq.error', 'Couldn’t load the bill of quantities')}
          errorSub={t('projectDetail.billing.boq.errorSub', 'Retry, or reopen the project.')}
          onRetry={() => boq.refetch()}
          rowLabel={(row) => t('projectDetail.billing.boq.openLine', 'Open {{item}} contract line', { item: `${row.item_code} — ${row.description}` })}
          onActivate={(row) => setOpenRecord(row.id, 'billingBoq')}
          rowMenu={(row) => [
            ...(may('edit', 'boqItem') ? [{ label: t('projectDetail.billing.boq.edit', 'Edit'), onClick: () => setBoqFormFor(row) }] : []),
            ...(may('delete', 'boqItem') ? [{ label: t('projectDetail.billing.boq.delete', 'Delete'), danger: true, onClick: () => setDeleteFor(row) }] : []),
          ]}
        tableId="project-detail-tabs-billingtab-1-table" />
      </CardPad>
    </Card>
  );

  const boqDetailDrawer = boqDetailFor && (() => {
    const item = boqDetailFor;
    const fact = lineFactsById.get(item.id);
    return <Drawer open title={item.description} subtitle={`${item.item_code} · ${item.unit}`}
      status={<StatusPill variant="neutral">{t('projectDetail.billing.boq.lineStatus', 'Contract line')}</StatusPill>}
      onClose={() => closeRecord(item.id, 'billingBoq')}
      headerActions={<div className="flex flex-wrap items-center gap-2">
        {may('edit', 'boqItem') && <Button variant="outline" size="sm" onClick={() => { closeRecord(item.id, 'billingBoq'); setBoqFormFor(item); }}>{t('projectDetail.billing.boq.edit', 'Edit')}</Button>}
      <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/projects/${encodeURIComponent(projectId)}/billing`} onClick={() => closeRecord(item.id, 'billingBoq')}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>
      </div>}>
      <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
        <SourcedFigure label={t('projectDetail.billing.boq.column.quantity', 'Contract')} value={quantityText(item, Number(item.quantity))} detail={t('projectDetail.billing.boq.source.contract', 'Source: priced contract line quantity and unit.')} />
        {canViewMoney && <SourcedFigure label={t('projectDetail.billing.boq.column.rate', 'Rate')} value={cents(item.rate)} detail={t('projectDetail.billing.boq.rateSource', 'Source: the priced contract line rate.')} />}
        {fact && <>
          <SourcedFigure label={t('projectTabs:contractQuantities.billing.boq.column.ordered', 'Ordered')} value={quantityText(item, fact.orderedQuantity)} detail={t('projectDetail.billing.boq.source.ordered', 'Source: quantities allocated to customer orders.')} />
          <SourcedFigure label={t('projectDetail.cascade.colLeftToOrder', 'Left to order')} value={quantityText(item, fact.contractBalance)} detail={t('projectDetail.billing.boq.source.balance', 'Computed as contract quantity less ordered quantity.')} />
          <SourcedFigure label={t('projectTabs:contractQuantities.billing.boq.column.accepted', 'Accepted (BAST)')} value={quantityText(item, fact.acceptedQuantity)} detail={t('projectDetail.billing.boq.source.accepted', 'Source: quantities on confirmed BASTs.')} />
          <SourcedFigure label={t('projectTabs:contractQuantities.billing.boq.column.earned', 'Earned')} value={quantityText(item, fact.earnedQuantity)} detail={t('projectDetail.billing.boq.source.earned', 'Source: earned quantity from project billing facts.')} />
        </>}
        {summary && <>
          <SourcedFigure label={t('projectDetail.billing.boq.column.claimed', 'Claimed')} value={formatNumberExact(summary.claimedByBoqItem[item.id] ?? 0)} detail={t('projectDetail.billing.boq.source.claimed', 'Source: quantities on live progress claims.')} />
          <SourcedFigure label={t('projectDetail.billing.boq.column.remaining', 'Left to claim')} value={formatNumberExact(remainingQuantity(Number(item.quantity), summary.claimedByBoqItem[item.id] ?? 0))} detail={t('projectDetail.billing.boq.source.remaining', 'Computed as contract quantity less quantities claimed.') } />
        </>}
      </dl>
      {fact && <section className="border-t border-border px-4 py-3" aria-labelledby="billing-boq-history">
        <h3 id="billing-boq-history" className="mb-2 text-sm font-semibold">{t('projectDetail.cascade.quantityHistory', 'Quantity history')}</h3>
        {fact.allocations.length === 0 ? <p className="text-sm text-muted-foreground">{t('projectDetail.cascade.noQuantityHistory', 'No customer order quantities yet.')}</p> : <ul className="divide-y divide-border text-sm">
          {fact.allocations.map((allocation) => {
            const order = workOrders.data?.find((candidate) => candidate.id === allocation.workOrderId);
            return <li key={allocation.workOrderId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{order?.wo_number ?? order?.title ?? allocation.workOrderId}</span>
              <Tooltip content={t('projectDetail.cascade.source.lineOrdered', 'Source: quantity allocated to this work order.')}><span className="cursor-help tabular">{quantityText(item, allocation.quantity)}</span></Tooltip>
            </li>;
          })}
        </ul>}
      </section>}
    </Drawer>;
  })();

  const claimsCard = (
    <Card>
      <CardHead
        level={2}
        className="text-base"
        actions={
          canBill && !canStartInvoice && (
            <Button variant="primary" size="sm" onClick={() => setClaimFormOpen(true)}>{t('projectDetail.billing.claims.new', 'New claim')}</Button>
          )
        }
      >
        {t('projectDetail.billing.claims.billingTitle', 'Billing claims')}
      </CardHead>
      <CardPad flush>
        <DataTable<ProgressClaimWithInvoice>
          embedded
          rows={claimRows}
          columns={claimColumns}
          rowKey={(row) => row.id}
          state={claims.isPending ? 'loading' : claims.isError ? 'error' : claimRows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('projectDetail.billing.claims.empty', 'No billing claims yet')}
          emptySub={t('projectDetail.billing.claims.billingEmptySub', 'A claim bills a down payment or quantities done, as one ERP invoice.')}
          errorTitle={t('projectDetail.billing.claims.error', 'Couldn’t load the billing claims')}
          errorSub={t('projectDetail.billing.claims.errorSub', 'Retry, or reopen the project.')}
          onRetry={() => claims.refetch()}
          rowLabel={(claim) => t('projectDetail.billing.claims.openLabel', 'Open {{kind}} claim from {{date}}', {
            kind: claim.kind === 'down_payment' ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment') : t('projectDetail.billing.claims.kind.progress', 'Progress'),
            date: formatDateOnly(claim.created_at),
          })}
          onActivate={(claim) => setOpenRecord(claim.id, 'billingClaim')}
          rowMenu={(claim) => {
            const open = !claim.withdrawn_at && !claim.invoice;
            return [
              ...(open && canBill ? [{ label: t('projectDetail.billing.claims.attachEvidence', 'Attach evidence'), onClick: () => setEvidenceFor(claim.id) }] : []),
              ...(open && canBill && claim.evidence.length > 0 ? [{ label: t('projectDetail.billing.claims.raise', 'Raise invoice'), onClick: () => setRaiseFor({ claim, idempotencyKey: crypto.randomUUID() }) }] : []),
              ...(open && canBill ? [{ label: t('projectDetail.billing.claims.withdraw', 'Withdraw'), danger: true, onClick: () => setWithdrawFor(claim) }] : []),
            ];
          }}
        tableId="project-detail-tabs-billingtab-2-table" />
      </CardPad>
    </Card>
  );

  const claimDetailDrawer = canViewMoney && claimDetailFor && <Drawer open
    title={claimDetailFor.kind === 'down_payment'
      ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment')
      : t('projectDetail.billing.claims.kind.progress', 'Progress')}
    subtitle={formatDateOnly(claimDetailFor.created_at)}
    status={<StatusPill variant={claimDetailFor.withdrawn_at ? 'lost' : claimDetailFor.invoice?.status === 'Paid' ? 'won' : 'neutral'}>{claimDetailFor.withdrawn_at
      ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn')
      : claimDetailFor.invoice?.status ?? t('projectDetail.billing.claims.notRaised', 'Not raised')}</StatusPill>}
    onClose={() => closeRecord(claimDetailFor.id, 'billingClaim')}
    headerActions={<div className="flex flex-wrap items-center gap-2">
      {!claimDetailFor.withdrawn_at && !claimDetailFor.invoice && canBill && (claimDetailFor.evidence.length > 0
        ? <Button variant="primary" size="sm" onClick={() => { closeRecord(claimDetailFor.id, 'billingClaim'); setRaiseFor({ claim: claimDetailFor, idempotencyKey: crypto.randomUUID() }); }}>{t('projectDetail.billing.claims.raise', 'Raise invoice')}</Button>
        : <Button variant="outline" size="sm" onClick={() => { closeRecord(claimDetailFor.id, 'billingClaim'); setEvidenceFor(claimDetailFor.id); }}>{t('projectDetail.billing.claims.attachEvidence', 'Attach evidence')}</Button>)}
      <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/projects/${encodeURIComponent(projectId)}/billing`} onClick={() => closeRecord(claimDetailFor.id, 'billingClaim')}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>
    </div>}>
    <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
      <SourcedFigure label={t('projectDetail.billing.claims.column.claimedLabel', 'Claimed')} value={cents(claimDetailFor.gross_amount)} detail={t('projectDetail.billing.claims.source.gross', 'Source: the progress claim gross amount, copied from accepted quantities and contract rates.')} />
      <SourcedFigure label={t('projectDetail.billing.claims.column.recoveryLong', 'Down payment recovered')} value={cents(claimDetailFor.dp_recovery_amount)} detail={t('projectDetail.billing.claims.source.recovery', 'Source: the down-payment amount recovered on this claim.')} />
      <SourcedFigure label={t('projectDetail.billing.claims.column.net', 'Net')} value={cents(claimNet(Number(claimDetailFor.gross_amount), Number(claimDetailFor.dp_recovery_amount)))} detail={t('projectDetail.billing.claims.source.net', 'Computed as gross less down-payment recovery.')} />
      <SourcedFigure label={t('projectDetail.billing.claims.column.evidence', 'Evidence')} value={formatNumberExact(claimDetailFor.evidence.length)} detail={t('projectDetail.billing.claims.source.evidence', 'Source: linked evidence documents on the claim.')} />
    </dl>
    <section className="border-t border-border px-4 py-3">
      <h3 className="text-sm font-semibold">{t('projectDetail.billing.claims.evidence', 'Evidence')}</h3>
      {claimDetailFor.evidence.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.billing.claims.noEvidence', 'No evidence attached yet.')}</p> : <ul className="mt-2 divide-y divide-border text-sm">
        {claimDetailFor.evidence.map((evidence) => <li key={evidence.id} className="flex items-center justify-between gap-3 py-2"><span>{evidence.document_id}</span><StatusPill variant={evidence.document_status === 'active' ? 'won' : 'neutral'}>{evidence.document_status}</StatusPill></li>)}
      </ul>}
    </section>
  </Drawer>;

  if (mode === 'contract-tools') {
    return (
      <>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {canStartInvoice && <Link
            className="touch-target inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            to={`/sales-invoices?create=1&project=${encodeURIComponent(projectId)}`}
          >
            {t('uxs15.contractInvoice', 'Contract invoice')}
          </Link>}
          <Button variant="ghost" size="sm" className="h-auto min-h-8 px-1 text-xs text-muted-foreground underline underline-offset-4"
            onClick={() => setContractLinesOpen(true)}>
            {t('projectDetail.billing.boq.manage', 'Edit contract lines')}
          </Button>
        </div>
        <Drawer open={contractLinesOpen} nestedOpen={Boolean(boqDetailFor)} title={t('projectDetail.billing.boq.title', 'Bill of quantities')}
          onClose={() => setContractLinesOpen(false)}>
          <div className="p-4">{boqCard}</div>
        </Drawer>
        {boqDetailDrawer}
        {claimDetailDrawer}
        {boqFormFor !== undefined && (
          <BoqItemFormModal item={boqFormFor} currencySymbolPrefix={currencySymbol(currency)}
            onClose={() => setBoqFormFor(undefined)} onSave={saveBoq} onError={fail} />
        )}
        {assessOpen && (
          <ProgressAssessmentModal boqItems={boqRows} assessedByBoqItem={summary?.assessedByBoqItem ?? {}} defaultMonth={thisMonth()}
            onClose={() => setAssessOpen(false)} onSave={saveAssessment} onError={fail} />
        )}
        {deleteFor && (
          <ConfirmDialog
            open
            tone="destructive"
            title={t('projectDetail.billing.boq.confirmDelete.title', 'Delete this line?')}
            description={t('projectDetail.billing.boq.confirmDelete.body', 'The line is removed from the bill of quantities. A line already assessed or claimed cannot be deleted.')}
            confirmLabel={t('projectDetail.billing.boq.confirmDelete.confirm', 'Delete line')}
            loading={mutations.deleteBoq.isPending}
            onConfirm={() => void runDelete()}
            onCancel={() => setDeleteFor(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {canViewMoney && <>
      <Card>
        <CardHead
          level={2}
          className="text-base"
          actions={
            canStartInvoice && (
              <ProjectBillingStart
                projectId={projectId}
                clientId={clientId}
                buttonLabel={t('projectDetail.billing.summary.raiseInvoice', 'Raise invoice')}
                onWorkOrder={() => {
                  navigate(`/projects/${encodeURIComponent(projectId)}/work-orders`);
                }}
                onQuantity={canBill ? () => setClaimFormOpen(true) : undefined}
              />
            )
          }
        >
          {t('projectDetail.billing.summary.title', 'Billing summary')}
          <span className="ml-2 text-[12px] font-normal text-muted-foreground">{currency} · {excl}</span>
        </CardHead>
        <CardPad>
          {billing.isPending ? (
            <ListState variant="loading" rows={2} />
          ) : billing.isError || !summary ? (
            <ListState variant="error" title={t('projectDetail.billing.summary.error', "Couldn't load billing")} onRetry={() => void billing.refetch()} />
          ) : (
            <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Figure testId="billing-contract" label={t('projectDetail.billing.summary.contract', 'Contract value')} value={money(summary.contractNet)} source={t('projectDetail.billing.source.contract', 'Source: net contract value from the project billing summary.')} />
      <Figure testId="billing-billed" label={t('projectDetail.billing.summary.billed', 'Billed to date')} value={money(summary.workBilled)} source={t('projectDetail.billing.source.billed', 'Source: work and down-payment claims billed to date.')} />
              {summary.assessedToDate !== null && summary.assessedToDate !== 0 && (lineProject || summary.assessment) && (
                <Figure testId="billing-assessed"
                  label={lineProject
                    ? t('projectTabs:contractQuantities.billing.summary.earned', 'Earned to date')
                    : t('projectDetail.billing.summary.assessed', 'Assessed to date')}
                  value={money(summary.assessedToDate)}
                  source={t('projectDetail.billing.source.assessed', 'Source: earned contract line value or the latest recorded progress assessment.')}
                  note={summary.assessment
                    ? t('projectDetail.billing.summary.assessedAsOf', 'as of {{month}}, {{pct}}% complete',
                      { month: monthLabel(summary.assessment.month), pct: formatNumberExact(summary.assessment.pctComplete) })
                    : undefined} />
              )}
              {summary.unbilledWork !== null && summary.unbilledWork !== 0 && (
                <Figure testId="billing-gap" label={t('projectDetail.billing.summary.gap', 'Work done, not yet billed')} value={money(summary.unbilledWork)} source={t('projectDetail.billing.source.unbilled', 'Computed as earned or assessed work less work billed to date.')} />
              )}
              {summary.dpHeld !== 0 && (
                <Figure testId="billing-dp-held" label={t('projectDetail.billing.summary.dpHeld', 'Down payment held')} value={money(summary.dpHeld)} source={t('projectDetail.billing.source.dpHeld', 'Computed as down payment billed less down payment recovered.')} />
              )}
              <Figure testId="billing-remaining" label={t('projectDetail.billing.summary.remaining', 'Contract not yet billed')} value={money(summary.remaining)} source={t('projectDetail.billing.source.remaining', 'Computed as net contract value less claims billed to date.')} />
              {summary.notSubmitted !== 0 && (
                <Figure testId="billing-not-submitted" label={t('projectDetail.billing.summary.notSubmitted', 'Claims raised, not yet submitted')} value={money(summary.notSubmitted)} source={t('projectDetail.billing.source.notSubmitted', 'Source: claim invoices created in accounting but not yet submitted.')} />
              )}
            </dl>
          )}
          {summary && lineProject && !summary.assessment && (
            <p className="mt-3 text-[12px] text-muted-foreground" data-testid="billing-unassessed">
              {t('projectTabs:contractQuantities.billing.summary.noAssessment', 'No assessment yet')}
            </p>
          )}
        </CardPad>
      </Card>
      </>}

      {quantityEmpty ? (
        <details className="group">
          <summary className="cursor-pointer rounded text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t('projectTabs:billing.quantity', 'Quantity billing')}
          </summary>
          <div className="mt-3 space-y-6">
            {boqCard}
            {canViewMoney && claimsCard}
          </div>
        </details>
      ) : (
        <>
          {boqCard}
          {canViewMoney && claimsCard}
        </>
      )}

      {boqFormFor !== undefined && (
        <BoqItemFormModal item={boqFormFor} currencySymbolPrefix={currencySymbol(currency)}
          onClose={() => setBoqFormFor(undefined)} onSave={saveBoq} onError={fail} />
      )}
      {boqDetailDrawer}
      {claimDetailDrawer}
      {assessOpen && (
        <ProgressAssessmentModal boqItems={boqRows} assessedByBoqItem={summary?.assessedByBoqItem ?? {}} defaultMonth={thisMonth()}
          onClose={() => setAssessOpen(false)} onSave={saveAssessment} onError={fail} />
      )}
      {claimFormOpen && (
        <ProgressClaimModal boqItems={boqRows} workOrders={workOrders.data ?? []}
          allocations={allocations.data ?? []} contractLines={summary?.contractLines ?? []} contractNet={summary?.contractNet ?? 0}
          currencySymbolPrefix={currencySymbol(currency)} hasDownPayment={liveDownPayment}
          claimedByBoqItem={summary?.claimedByBoqItem ?? {}} assessedByBoqItem={summary?.assessedByBoqItem ?? {}}
          assessmentMonth={summary?.assessment?.month ?? null}
          onClose={() => setClaimFormOpen(false)} onSave={saveClaim} onError={fail} />
      )}
      {evidenceFor && (
        <ClaimEvidenceModal documents={documents.data ?? []}
          attachedDocumentIds={(evidenceClaim?.evidence ?? []).map((e) => e.document_id)}
          onClose={() => setEvidenceFor(null)} onAttach={attachEvidence} onError={fail} />
      )}
      {raiseFor && (
        <ConfirmDialog
          open
          title={t('projectDetail.billing.claims.confirmRaise.title', "Raise this claim's invoice?")}
          description={
            <div className="flex flex-col gap-2">
              <p>{t('projectDetail.billing.claims.confirmRaise.body', 'An ERP sales invoice draft is created from this claim. A different Admin or Finance user submits it.')}</p>
              <p data-testid="raise-figures">
                {t('projectDetail.billing.claims.confirmRaise.figures', 'Claimed {{gross}} · down payment recovered {{recovery}} · net {{net}} (excl. PPN)', {
                  gross: cents(raiseFor.claim.gross_amount),
                  recovery: cents(raiseFor.claim.dp_recovery_amount),
                  net: cents(claimNet(Number(raiseFor.claim.gross_amount), Number(raiseFor.claim.dp_recovery_amount))),
                  interpolation: { escapeValue: false },
                })}
              </p>
            </div>
          }
          confirmLabel={t('projectDetail.billing.claims.confirmRaise.confirm', 'Create ERP invoice')}
          loading={mutations.raiseInvoice.isPending}
          onConfirm={() => void runRaise()}
          onCancel={() => setRaiseFor(null)}
        />
      )}
      {withdrawFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectDetail.billing.claims.confirmWithdraw.title', 'Withdraw this claim?')}
          description={t('projectDetail.billing.claims.confirmWithdraw.body', 'Withdrawing is final. Its quantities and down payment recovery are released for a new claim.')}
          confirmLabel={t('projectDetail.billing.claims.confirmWithdraw.confirm', 'Withdraw claim')}
          loading={mutations.withdrawClaim.isPending}
          onConfirm={() => void runWithdraw()}
          onCancel={() => setWithdrawFor(null)}
        />
      )}
      {deleteFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectDetail.billing.boq.confirmDelete.title', 'Delete this line?')}
          description={t('projectDetail.billing.boq.confirmDelete.body', 'The line is removed from the bill of quantities. A line already assessed or claimed cannot be deleted.')}
          confirmLabel={t('projectDetail.billing.boq.confirmDelete.confirm', 'Delete line')}
          loading={mutations.deleteBoq.isPending}
          onConfirm={() => void runDelete()}
          onCancel={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
};

export default BillingTab;
