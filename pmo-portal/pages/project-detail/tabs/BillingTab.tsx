import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, ListState, useToast, type Column,
} from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { currencySymbol, formatCurrencyCents, formatNumber, formatNumberExact, formatUtcMonthYear } from '@/src/lib/format';
import { claimNet, remainingQuantity, summarizeBilling } from '@/src/lib/progressBilling';
import type {
  BoqItemInput, BoqItemRow, ProgressAssessmentInput, ProgressClaimInput, ProgressClaimWithInvoice,
} from '@/src/lib/db/progressBilling';
import { useBoqItems, useProgressBillingMutations, useProjectBilling, useProjectClaims } from '@/src/hooks/useProgressBilling';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import BoqItemFormModal from '../BoqItemFormModal';
import ProgressAssessmentModal from '../ProgressAssessmentModal';
import ProgressClaimModal from '../ProgressClaimModal';
import ClaimEvidenceModal from '../ClaimEvidenceModal';

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
}

/** `YYYY-MM` in the browser's zone. ponytail: only the dialog's default — the user can change it and the
 *  server truncates to the month; switch to the org timezone if month-end entries land in the wrong month. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const Figure: React.FC<{ testId: string; label: string; value: string; note?: string }> = ({ testId, label, value, note }) => (
  <div>
    <dt className="text-[12px] text-muted-foreground">{label}</dt>
    <dd className="tabular text-[15px] font-semibold" data-testid={testId}>{value}</dd>
    {note && <dd className="text-[11px] text-muted-foreground">{note}</dd>}
  </div>
);

const BillingTab: React.FC<BillingTabProps> = ({ projectId, currency, clientId, projectManagerId }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const erp = useErpItemOptions('sales');
  const billing = useProjectBilling(projectId);
  const boq = useBoqItems(projectId);
  const claims = useProjectClaims(projectId);
  const workOrders = useProjectWorkOrders(projectId);
  const documents = useDocuments(projectId);
  const mutations = useProgressBillingMutations(projectId);

  // `undefined` = closed · `null` = add a line · a row = edit it.
  const [boqFormFor, setBoqFormFor] = useState<BoqItemRow | null | undefined>(undefined);
  const [deleteFor, setDeleteFor] = useState<BoqItemRow | null>(null);
  const [claimFormOpen, setClaimFormOpen] = useState(false);
  const [assessOpen, setAssessOpen] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  // The idempotency key is minted when the confirm opens, so a retry of the same confirm reuses it (ADR-0058).
  const [raiseFor, setRaiseFor] = useState<{ claim: ProgressClaimWithInvoice; idempotencyKey: string } | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<ProgressClaimWithInvoice | null>(null);

  const boqRows = boq.data ?? [];
  const claimRows = claims.data ?? [];
  const summary = billing.data ? summarizeBilling(billing.data) : null;
  const excl = t('projectDetail.billing.summary.exclTax', 'excl. PPN');
  const money = (value: number) => `${formatCurrencyCents(value, currency)} ${excl}`;
  const cents = (value: number | string) => formatCurrencyCents(Number(value), currency);
  const monthLabel = (iso: string) => formatUtcMonthYear(new Date(`${iso}T00:00:00Z`));

  const canBill = may('create', 'progressClaim') && erp.connected && clientId !== null;
  const canAssess = may('edit', 'projectProgress', { currentUserId: currentUser?.id, record: { project_manager_id: projectManagerId } });
  const liveDownPayment = claimRows.some((c) => c.kind === 'down_payment' && !c.withdrawn_at && c.invoice?.status !== 'Cancelled');

  const fail = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
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
      fail(err);
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

  const boqColumns: Column<BoqItemRow>[] = [
    { key: 'item', header: t('projectDetail.billing.boq.column.item', 'Item'), cell: (row) => (
      <div className="flex flex-col">
        <span className="font-semibold">{row.item_code}</span>
        <span className="text-[11px] text-muted-foreground">{row.description}</span>
      </div>
    ) },
    { key: 'quantity', header: t('projectDetail.billing.boq.column.quantity', 'Quantity'), align: 'num',
      cell: (row) => <span className="tabular">{formatNumberExact(Number(row.quantity))} {row.unit}</span> },
    { key: 'rate', header: t('projectDetail.billing.boq.column.rate', 'Rate'), align: 'num',
      cell: (row) => <span className="tabular">{cents(row.rate)}</span> },
    { key: 'assessed', header: t('projectDetail.billing.boq.column.assessed', 'Assessed'), align: 'num', cell: (row) => {
      const assessed = summary?.assessedByBoqItem[row.id];
      return <span className="tabular" data-testid={`boq-assessed-${row.id}`}>{assessed === undefined ? '—' : formatNumberExact(assessed)}</span>;
    } },
    { key: 'claimed', header: t('projectDetail.billing.boq.column.claimed', 'Claimed'), align: 'num', cell: (row) => (
      <span className="tabular" data-testid={`boq-claimed-${row.id}`}>
        {summary ? formatNumberExact(summary.claimedByBoqItem[row.id] ?? 0) : '—'}
      </span>
    ) },
    { key: 'remaining', header: t('projectDetail.billing.boq.column.remaining', 'Left to claim'), align: 'num', cell: (row) => {
      if (!summary) return <span data-testid={`boq-remaining-${row.id}`}>—</span>;
      const left = remainingQuantity(Number(row.quantity), summary.claimedByBoqItem[row.id] ?? 0);
      return (
        <span className="tabular" data-testid={`boq-remaining-${row.id}`}>
          {formatNumberExact(left)}
          {left < 0 && <span className="ml-1 text-[11px] text-destructive-text">{t('projectDetail.billing.boq.overClaimed', 'Over-claimed')}</span>}
        </span>
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
    { key: 'gross', header: t('projectDetail.billing.claims.column.gross', 'Claimed'), align: 'num',
      cell: (c) => <span className="tabular">{cents(c.gross_amount)}</span> },
    { key: 'recovery', header: t('projectDetail.billing.claims.column.recovery', 'Down payment recovered'), align: 'num',
      cell: (c) => <span className="tabular">{cents(c.dp_recovery_amount)}</span> },
    { key: 'net', header: t('projectDetail.billing.claims.column.net', 'Net'), align: 'num',
      cell: (c) => <span className="tabular">{cents(claimNet(Number(c.gross_amount), Number(c.dp_recovery_amount)))}</span> },
    { key: 'invoice', header: t('projectDetail.billing.claims.column.invoice', 'Invoice'), cell: (c) => (
      <span>{c.withdrawn_at
        ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn')
        : c.invoice
          ? `${c.invoice.si_number ?? ''} · ${c.invoice.status}`
          : t('projectDetail.billing.claims.notRaised', 'Not raised')}</span>
    ) },
    { key: 'evidence', header: t('projectDetail.billing.claims.column.evidence', 'Evidence'), align: 'num',
      cell: (c) => <span className="tabular" data-testid={`claim-evidence-${c.id}`}>{formatNumber(c.evidence.length)}</span> },
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

  const evidenceClaim = claimRows.find((c) => c.id === evidenceFor);

  return (
    <div className="space-y-6">
      <Card variant="bare">
        <CardHead>{t('projectDetail.billing.summary.title', 'Billing summary')}</CardHead>
        <CardPad>
          {billing.isPending ? (
            <ListState variant="loading" rows={2} />
          ) : billing.isError || !summary ? (
            <ListState variant="error" title={t('projectDetail.billing.summary.error', "Couldn't load billing")} onRetry={() => void billing.refetch()} />
          ) : (
            <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Figure testId="billing-contract" label={t('projectDetail.billing.summary.contract', 'Contract value')} value={money(summary.contractNet)} />
              <Figure testId="billing-billed" label={t('projectDetail.billing.summary.billed', 'Billed to date')} value={money(summary.workBilled)} />
              <Figure testId="billing-assessed" label={t('projectDetail.billing.summary.assessed', 'Assessed to date')}
                value={summary.assessedToDate === null ? t('projectDetail.billing.summary.noAssessment', 'No assessment yet') : money(summary.assessedToDate)}
                note={summary.assessment ? t('projectDetail.billing.summary.assessedAsOf', 'as of {{month}}, {{pct}}% complete',
                  { month: monthLabel(summary.assessment.month), pct: formatNumberExact(summary.assessment.pctComplete) }) : undefined} />
              {summary.unbilledWork !== null && (
                <Figure testId="billing-gap" label={t('projectDetail.billing.summary.gap', 'Work done, not yet billed')} value={money(summary.unbilledWork)} />
              )}
              <Figure testId="billing-dp-held" label={t('projectDetail.billing.summary.dpHeld', 'Down payment held')} value={money(summary.dpHeld)} />
              <Figure testId="billing-remaining" label={t('projectDetail.billing.summary.remaining', 'Contract not yet billed')} value={money(summary.remaining)} />
              <Figure testId="billing-not-submitted" label={t('projectDetail.billing.summary.notSubmitted', 'Raised, not yet submitted')} value={money(summary.notSubmitted)} />
            </dl>
          )}
        </CardPad>
      </Card>

      <Card variant="bare">
        <CardHead className="justify-between">
          <span>{t('projectDetail.billing.boq.title', 'Bill of quantities')}</span>
          <div className="flex gap-1.5">
            {canAssess && boqRows.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setAssessOpen(true)}>
                {t('projectDetail.billing.assessment.record', 'Record progress')}
              </Button>
            )}
            {may('create', 'boqItem') && (
              <Button variant="primary" size="sm" onClick={() => setBoqFormFor(null)}>{t('projectDetail.billing.boq.add', 'Add line')}</Button>
            )}
          </div>
        </CardHead>
        <CardPad>
          <DataTable<BoqItemRow>
            rows={boqRows}
            columns={boqColumns}
            rowKey={(row) => row.id}
            state={boq.isPending ? 'loading' : boq.isError ? 'error' : boqRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('projectDetail.billing.boq.empty', 'No bill of quantities yet')}
            emptySub={t('projectDetail.billing.boq.emptySub', "Add the contract's priced lines to assess progress and bill by quantity.")}
            errorTitle={t('projectDetail.billing.boq.error', 'Couldn’t load the bill of quantities')}
            errorSub={t('projectDetail.billing.boq.errorSub', 'Retry, or reopen the project.')}
            onRetry={() => boq.refetch()}
          />
        </CardPad>
      </Card>

      <Card variant="bare">
        <CardHead className="justify-between">
          <span>{t('projectDetail.billing.claims.title', 'Billing claims')}</span>
          {canBill && (
            <Button variant="primary" size="sm" onClick={() => setClaimFormOpen(true)}>{t('projectDetail.billing.claims.new', 'New claim')}</Button>
          )}
        </CardHead>
        <CardPad>
          <DataTable<ProgressClaimWithInvoice>
            rows={claimRows}
            columns={claimColumns}
            rowKey={(row) => row.id}
            state={claims.isPending ? 'loading' : claims.isError ? 'error' : claimRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('projectDetail.billing.claims.empty', 'No billing claims yet')}
            emptySub={t('projectDetail.billing.claims.emptySub', 'A claim bills a down payment or quantities done, as one ERP invoice.')}
            errorTitle={t('projectDetail.billing.claims.error', 'Couldn’t load the billing claims')}
            errorSub={t('projectDetail.billing.claims.errorSub', 'Retry, or reopen the project.')}
            onRetry={() => claims.refetch()}
          />
        </CardPad>
      </Card>

      {boqFormFor !== undefined && (
        <BoqItemFormModal item={boqFormFor} workOrders={workOrders.data ?? []} currencySymbolPrefix={currencySymbol(currency)}
          onClose={() => setBoqFormFor(undefined)} onSave={saveBoq} onError={fail} />
      )}
      {assessOpen && (
        <ProgressAssessmentModal boqItems={boqRows} assessedByBoqItem={summary?.assessedByBoqItem ?? {}} defaultMonth={thisMonth()}
          onClose={() => setAssessOpen(false)} onSave={saveAssessment} onError={fail} />
      )}
      {claimFormOpen && (
        <ProgressClaimModal boqItems={boqRows} workOrders={workOrders.data ?? []} contractNet={summary?.contractNet ?? 0}
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
