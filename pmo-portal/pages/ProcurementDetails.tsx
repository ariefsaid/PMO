import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PageHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  StatusPill,
  LifecycleStepper,
  GateNotice,
  StatTiles,
  ListState,
  Icon,
  ConfirmDialog,
  useToast,
  type StatTile,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProcurementDetail, useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency } from '@/src/lib/format';
import {
  isLegalTransition,
  canCancel,
  ProcurementError,
  type ProcurementStatus,
  type ProcurementDetail,
} from '@/src/lib/db/procurementLifecycle';
import {
  lifecycleSteps,
  pillVariantForStatus,
  stageLabelForStatus,
} from '../components/procurement';

// ---------------------------------------------------------------------------
// Role sets for cosmetic gating (FR-PROC-006, OD-PROC-1 matrix, AC-805)
// The RPC is the real authority — this is display-only. PRESERVED VERBATIM.
// ---------------------------------------------------------------------------
const APPROVE_REJECT_ROLES = new Set(['Project Manager', 'Finance', 'Executive', 'Admin']);
const SOURCING_ROLES = new Set(['Project Manager', 'Finance', 'Admin']);
const RECEIPT_ROLES = new Set(['Project Manager', 'Admin']); // requester also allowed — handled below
const INVOICE_PAY_ROLES = new Set(['Finance', 'Admin']);

type ActionVariant = 'primary' | 'success' | 'destructive' | 'outline';

/** A staged, not-yet-committed mutation awaiting the ConfirmDialog. */
type PendingConfirm =
  | {
      kind: 'transition';
      to: ProcurementStatus;
      title: string;
      confirmLabel: string;
      tone: 'default' | 'destructive';
    }
  | {
      kind: 'createGR';
      status: 'Partial' | 'Complete';
      receiptDate: string;
    }
  | {
      kind: 'createVI';
      status: 'Received' | 'Scheduled' | 'Paid';
      invoiceDate: string;
    };

/**
 * Returns the list of (from→to) transitions that should be shown to this role.
 * Cosmetic only — the RPC enforces for real (AC-805, FR-PROC-006). PRESERVED:
 * the matrix below is byte-identical to the prior implementation, only the
 * button-variant vocabulary maps onto the design-system Button variants.
 */
function allowedActions(
  status: ProcurementStatus,
  role: string,
  isRequester: boolean,
  isApprover: boolean,
): { to: ProcurementStatus; label: string; variant: ActionVariant }[] {
  const actions: { to: ProcurementStatus; label: string; variant: ActionVariant }[] = [];

  const legal = (to: ProcurementStatus) => isLegalTransition(status, to);

  // Draft → Requested: any member (FR-PROC-005)
  if (legal('Requested')) {
    actions.push({ to: 'Requested', label: 'Submit Request', variant: 'primary' });
  }

  // Requested → Approved / Rejected: PM/Finance/Exec/Admin and NOT the requester (SoD-a) (FR-PROC-006)
  if (legal('Approved') && APPROVE_REJECT_ROLES.has(role) && !isRequester) {
    actions.push({ to: 'Approved', label: 'Approve', variant: 'success' });
  }
  if (legal('Rejected') && APPROVE_REJECT_ROLES.has(role) && !isRequester) {
    actions.push({ to: 'Rejected', label: 'Reject', variant: 'destructive' });
  }

  // Rejected → Draft: requester rework (FR-PROC-007)
  if (legal('Draft') && isRequester) {
    actions.push({ to: 'Draft', label: 'Rework (Back to Draft)', variant: 'outline' });
  }

  // Approved → Vendor Quoted / Ordered (skip): PM/Finance/Admin (FR-PROC-008)
  if (legal('Vendor Quoted') && SOURCING_ROLES.has(role)) {
    actions.push({ to: 'Vendor Quoted', label: 'Request Vendor Quotes', variant: 'primary' });
  }
  if (legal('Ordered') && SOURCING_ROLES.has(role) && status === 'Approved') {
    actions.push({ to: 'Ordered', label: 'Generate Purchase Order', variant: 'primary' });
  }

  // Vendor Quoted → Quote Selected: PM/Finance/Admin
  if (legal('Quote Selected') && SOURCING_ROLES.has(role)) {
    actions.push({ to: 'Quote Selected', label: 'Select Quote', variant: 'primary' });
  }

  // Quote Selected → Ordered: PM/Finance/Admin. status is exactly one value, so
  // legal('Ordered') holds for at most one of these branches — they cannot collide.
  if (legal('Ordered') && SOURCING_ROLES.has(role) && status === 'Quote Selected') {
    actions.push({ to: 'Ordered', label: 'Generate Purchase Order', variant: 'primary' });
  }

  // Ordered → Received: requester or PM (FR-PROC-008)
  if (legal('Received') && (isRequester || RECEIPT_ROLES.has(role))) {
    actions.push({ to: 'Received', label: 'Confirm Receipt', variant: 'primary' });
  }

  // Received → Vendor Invoiced: Finance only (FR-PROC-009)
  if (legal('Vendor Invoiced') && INVOICE_PAY_ROLES.has(role)) {
    actions.push({ to: 'Vendor Invoiced', label: 'Mark Vendor Invoiced', variant: 'primary' });
  }

  // Vendor Invoiced → Paid: Finance only, AND not the user who approved the
  // request. SoD-b is enforced server-side and ALWAYS rejects pay-by-approver,
  // so offering it cosmetically produced a "click that does nothing" — gate it.
  if (legal('Paid') && INVOICE_PAY_ROLES.has(role) && !isApprover) {
    actions.push({ to: 'Paid', label: 'Mark as Paid', variant: 'success' });
  }

  // Cancel: subject to canCancel boundary (FR-PROC-009, OD-PROC-B)
  if (legal('Cancelled') && canCancel(role, isRequester, status)) {
    actions.push({ to: 'Cancelled', label: 'Cancel', variant: 'destructive' });
  }

  return actions;
}

/** Whether the effective role/identity may not yet advance — drives the SoD gate copy. */
function sodGateMessage(p: ProcurementDetail, role: string, isRequester: boolean): string | null {
  // Approval gate: a Requested PR awaiting a non-requester approver.
  if (p.status === 'Requested' && isRequester) {
    return `This request was raised by ${p.requested_by?.full_name ?? 'you'}. A different user holding the Project-Manager, Finance, or Executive role must review it — the requester cannot self-approve their own request.`;
  }
  // Receipt gate: an Ordered PR where the viewer cannot confirm receipt.
  if (p.status === 'Ordered' && !(isRequester || RECEIPT_ROLES.has(role))) {
    return 'To advance from Purchase Order to Goods Receipt, the requester or a Project-Manager must confirm receipt of the goods.';
  }
  return null;
}

/**
 * Classifies a transition/mutation error into a human toast headline by the
 * preserved Postgres/PostgREST code, keeping the verbatim RPC message as the
 * secondary detail (the silent-no-op bug fix — sub-task b):
 *   P0001 => illegal stage transition; 42501 => not permitted / SoD.
 */
function classifyMutationError(err: unknown): { headline: string; detail: string } {
  const detail = err instanceof Error ? err.message : 'An error occurred';
  // Read the preserved Postgres/PostgREST code structurally — it is carried by
  // ProcurementError but also by any error object exposing a string `.code`.
  const code =
    err instanceof ProcurementError
      ? err.code
      : typeof (err as { code?: unknown })?.code === 'string'
        ? (err as { code: string }).code
        : undefined;
  if (code === 'P0001') {
    return { headline: "That move isn't allowed from the current stage.", detail };
  }
  if (code === '42501') {
    return { headline: "You don't have permission to do that.", detail };
  }
  return { headline: 'Update failed', detail };
}

const ProcurementDetails: React.FC = () => {
  const { procurementId } = useParams<{ procurementId: string }>();
  const { effectiveRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const detailQuery = useProcurementDetail(procurementId);
  const mutations = useProcurementMutations(procurementId ?? '');

  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState('');
  const [showCreateGR, setShowCreateGR] = useState(false);
  const [showCreateVI, setShowCreateVI] = useState(false);
  // Confirm-before-write (owner rule): a transition action / GR / VI is staged
  // here and only commits when the ConfirmDialog's Confirm is pressed.
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const data = detailQuery.data;

  // Back to the Procurement index — a plain navigate, no tab (AC-NAV-007). The
  // breadcrumb resolves the record title from the cached list in App.tsx.
  const goBack = () => navigate('/procurement');

  // ── Loading (AC-804, NFR-PROC-UI-001) ────────────────────────────────────
  if (detailQuery.isPending) {
    return (
      <>
        <BackBar label="Procurement" onBack={goBack} />
        <div data-testid="procurement-loading">
          <ListState variant="loading" rows={6} />
        </div>
      </>
    );
  }

  // ── Error (AC-804) ────────────────────────────────────────────────────────
  if (detailQuery.isError) {
    return (
      <>
        <BackBar label="Procurement" onBack={goBack} />
        <ListState
          variant="error"
          title="Couldn't load procurement"
          sub="Something went wrong fetching the procurement details."
          onRetry={() => detailQuery.refetch()}
        />
      </>
    );
  }

  // ── Empty / not-found (AC-804) ───────────────────────────────────────────
  if (!data) {
    return (
      <>
        <BackBar label="Procurement" onBack={goBack} />
        <div data-testid="procurement-empty">
          <ListState
            variant="error"
            icon="inbox"
            title="Procurement not found"
            sub="This procurement does not exist or you don't have access to it."
          />
        </div>
      </>
    );
  }

  const p: ProcurementDetail = data;
  const role = effectiveRole ?? '';
  const isRequester = p.requested_by_id === currentUser?.id;
  // SoD-b: a user cannot pay a request they themselves approved.
  const isApprover = !!currentUser?.id && p.approved_by_id === currentUser.id;
  const actions = allowedActions(p.status, role, isRequester, isApprover);
  const selectedQuote = p.quotations.find((q) => q.is_selected);
  const showNotes = actions.some((a) => a.to === 'Approved' || a.to === 'Rejected');
  const gateMsg = sodGateMessage(p, role, isRequester);
  const canShowGRForm =
    (p.status === 'Ordered' ||
      p.status === 'Received' ||
      p.status === 'Vendor Invoiced' ||
      p.status === 'Paid') &&
    SOURCING_ROLES.has(role);
  const canShowVIForm =
    (p.status === 'Vendor Invoiced' || p.status === 'Paid') && INVOICE_PAY_ROLES.has(role);

  // ── Stage a transition for confirmation (owner rule: no single-click write).
  //    Destructive targets (Reject / Cancel) open the destructive modal; all
  //    forward steps open the lightweight default confirm. PRESERVED RPC contract.
  const stageTransition = (action: { to: ProcurementStatus; label: string; variant: ActionVariant }) => {
    setMutationError(null);
    const destructive = action.variant === 'destructive';
    // Disambiguate the destructive "Cancel" action from the dialog's own
    // Cancel button: the commit reads "Cancel request" (plan P2 copy).
    const confirmLabel = action.to === 'Cancelled' ? 'Cancel request' : action.label;
    setPendingConfirm({
      kind: 'transition',
      to: action.to,
      title: destructive ? `${action.label} this request` : `Move request to ${action.to}?`,
      confirmLabel,
      tone: destructive ? 'destructive' : 'default',
    });
  };

  // ── Commit the staged mutation (AC-805, AC-806). Toast is classified by the
  //    preserved RPC error code (sub-task b) so an illegal-stage / SoD failure
  //    reads as such instead of a silent no-op.
  const commitConfirm = async () => {
    if (!pendingConfirm) return;
    setMutationError(null);
    try {
      if (pendingConfirm.kind === 'transition') {
        await mutations.transition.mutateAsync({
          to: pendingConfirm.to,
          notes: notesInput || undefined,
        });
        setNotesInput('');
        toast('Request updated', `Moved to ${pendingConfirm.to}`, 'success');
      } else if (pendingConfirm.kind === 'createGR') {
        await mutations.createReceipt.mutateAsync({
          status: pendingConfirm.status,
          receiptDate: pendingConfirm.receiptDate,
        });
        setShowCreateGR(false);
        toast('Goods receipt recorded', undefined, 'success');
      } else {
        await mutations.createInvoice.mutateAsync({
          status: pendingConfirm.status,
          invoiceDate: pendingConfirm.invoiceDate,
        });
        setShowCreateVI(false);
        toast('Vendor invoice recorded', undefined, 'success');
      }
      setPendingConfirm(null);
    } catch (err) {
      // Close the confirm; surface the classified toast + keep the verbatim
      // inline error (forms keep redundant errors — that is correct).
      setPendingConfirm(null);
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setMutationError(detail);
    }
  };

  const confirmInFlight =
    mutations.transition.isPending ||
    mutations.createReceipt.isPending ||
    mutations.createInvoice.isPending;

  const stats: StatTile[] = [
    {
      label: 'PR value',
      value: formatCurrency(Number(p.total_value)),
      sub: p.project?.name ?? undefined,
    },
    {
      label: 'Selected quote',
      value: selectedQuote ? formatCurrency(Number(selectedQuote.total_amount)) : 'Pending',
      sub: `${p.quotations.length} received`,
    },
    {
      label: 'PO committed',
      value: p.po_number ? formatCurrency(Number(p.total_value)) : 'Pending',
      sub: p.vendor?.name ?? (p.po_number ? undefined : 'no PO yet'),
    },
    {
      label: 'Goods received',
      value: p.receipts.length > 0 ? `${p.receipts.length} receipt${p.receipts.length > 1 ? 's' : ''}` : 'None yet',
      sub: p.receipts.length > 0 ? p.receipts[p.receipts.length - 1].status : 'awaiting delivery',
    },
  ];

  const meta = [
    p.code ? <span key="code" className="font-mono">{p.code}</span> : null,
    p.project?.name ? <span key="proj"> · {p.project.name}</span> : null,
    p.requested_by?.full_name ? <span key="req"> · requested by {p.requested_by.full_name}</span> : null,
  ].filter(Boolean);

  return (
    <div>
      {/* I7: no in-page BackBar on the success render — the top-bar breadcrumb
          (Procurement > record) owns wayfinding. BackBar is kept on the
          loading / error / not-found branches above, where there is no in-page
          header to orient from and the crumb shows only the raw id. */}
      <PageHeader
        name={p.title}
        iconColor={p.status === 'Paid' ? 'hsl(var(--success))' : 'hsl(var(--primary))'}
        icon={<Icon name="cart" />}
        status={
          <span data-testid="procurement-status-badge" data-status={p.status}>
            <StatusPill variant={pillVariantForStatus(p.status)}>
              {stageLabelForStatus(p.status)}
            </StatusPill>
          </span>
        }
        meta={meta.length ? <span>{meta}</span> : undefined}
      />

      {/* Full lifecycle node stepper (PR → VQ → PO → GR → VI → Paid) */}
      <Card className="mb-4">
        <CardPad>
          <LifecycleStepper
            variant="node"
            steps={lifecycleSteps(p.status, {
              pr_number: p.pr_number,
              vq_number: selectedQuote?.vq_number,
              po_number: p.po_number,
              gr_number: p.receipts[0]?.gr_number,
              vi_number: p.invoices[0]?.vi_number,
            })}
            aria-label="Procurement lifecycle"
          />
        </CardPad>
      </Card>

      {/* SoD / readiness gate */}
      {gateMsg ? (
        <div className="mb-4">
          <GateNotice variant="blocked">
            <b>Separation-of-duties gate.</b> {gateMsg}
          </GateNotice>
        </div>
      ) : actions.length > 0 ? (
        <div className="mb-4">
          <GateNotice variant="ready">
            <b>Ready to advance.</b> You may move this request to its next lifecycle stage below.
          </GateNotice>
        </div>
      ) : null}

      {/* Stat strip */}
      <StatTiles tiles={stats} className="mb-4" />

      {/* Action bar (AC-805) */}
      <Card className="mb-4">
        <CardPad className="flex flex-col gap-3">
          {showNotes && (
            <div className="flex max-w-md flex-col gap-1">
              <label htmlFor="procurement-notes-input" className="text-[12px] font-semibold text-muted-foreground">
                Notes <span className="font-normal">(optional)</span>
              </label>
              <textarea
                id="procurement-notes-input"
                data-testid="procurement-notes-input"
                rows={2}
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="Add a note for the approval or rejection…"
                className="rounded-md border border-input bg-background px-2.5 py-1.5 text-[13.5px] outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
          )}
          {actions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action.to}
                  variant={action.variant}
                  loading={mutations.transition.isPending}
                  onClick={() => stageTransition(action)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No further lifecycle actions are available to you at this stage.
            </p>
          )}
          {mutationError && (
            <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <Icon name="alert" className="mt-px size-4 shrink-0" />
              <span>{mutationError}</span>
            </div>
          )}
        </CardPad>
      </Card>

      {/* GR creation panel (AC-816) */}
      {canShowGRForm && (
        <Card className="mb-4">
          <CardPad>
            {!showCreateGR ? (
              <Button variant="primary" size="sm" data-testid="btn-create-gr" onClick={() => setShowCreateGR(true)}>
                <Icon name="plus" />
                Create Goods Receipt
              </Button>
            ) : (
              <form
                data-testid="form-create-gr"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  setMutationError(null);
                  // Stage the GR for confirmation (commit fires on Confirm).
                  setPendingConfirm({
                    kind: 'createGR',
                    status: fd.get('gr-status') as 'Partial' | 'Complete',
                    receiptDate: fd.get('gr-date') as string,
                  });
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
                  Status
                  <select
                    name="gr-status"
                    defaultValue="Complete"
                    data-testid="gr-status-select"
                    className="h-8 w-40 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <option value="Partial">Partial</option>
                    <option value="Complete">Complete</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
                  Receipt date
                  <input
                    type="date"
                    name="gr-date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    data-testid="gr-date-input"
                    className="h-8 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                </label>
                <Button type="submit" variant="success" size="sm" loading={mutations.createReceipt.isPending} data-testid="btn-save-gr">
                  Save GR
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateGR(false)}>
                  Cancel
                </Button>
              </form>
            )}
          </CardPad>
        </Card>
      )}

      {/* VI creation panel (AC-816) */}
      {canShowVIForm && (
        <Card className="mb-4">
          <CardPad>
            {!showCreateVI ? (
              <Button variant="primary" size="sm" data-testid="btn-create-vi" onClick={() => setShowCreateVI(true)}>
                <Icon name="plus" />
                Create Vendor Invoice
              </Button>
            ) : (
              <form
                data-testid="form-create-vi"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  setMutationError(null);
                  // Stage the VI for confirmation (commit fires on Confirm).
                  setPendingConfirm({
                    kind: 'createVI',
                    status: fd.get('vi-status') as 'Received' | 'Scheduled' | 'Paid',
                    invoiceDate: fd.get('vi-date') as string,
                  });
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
                  Status
                  <select
                    name="vi-status"
                    defaultValue="Received"
                    data-testid="vi-status-select"
                    className="h-8 w-40 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <option value="Received">Received</option>
                    <option value="Scheduled">Scheduled</option>
                    <option value="Paid">Paid</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
                  Invoice date
                  <input
                    type="date"
                    name="vi-date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    data-testid="vi-date-input"
                    className="h-8 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                </label>
                <Button type="submit" variant="success" size="sm" loading={mutations.createInvoice.isPending} data-testid="btn-save-vi">
                  Save VI
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateVI(false)}>
                  Cancel
                </Button>
              </form>
            )}
          </CardPad>
        </Card>
      )}

      {/* Line items + linked quotations */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead>Linked quotations</CardHead>
          <CardPad className="flex flex-col gap-px">
            {p.quotations.length === 0 ? (
              <p className="py-2 text-[13px] text-muted-foreground">No quotations received yet.</p>
            ) : (
              p.quotations.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-2.5 border-b border-dashed border-border py-2.5 last:border-b-0"
                >
                  <span
                    aria-hidden
                    className={`size-[9px] shrink-0 rounded-full ${q.is_selected ? 'bg-success' : 'bg-secondary'}`}
                  />
                  {q.vq_number && <span className="font-mono text-[11px] text-muted-foreground">{q.vq_number}</span>}
                  {q.is_selected && <StatusPill variant="won">Selected</StatusPill>}
                  <span className="ml-auto text-[13.5px] font-semibold tabular">
                    {formatCurrency(Number(q.total_amount))}
                  </span>
                </div>
              ))
            )}
          </CardPad>
        </Card>

        <Card>
          <CardHead>Document trail</CardHead>
          <CardPad className="flex flex-col gap-2">
            <DocRow label="PR#" value={p.pr_number} />
            {selectedQuote && <DocRow label="VQ#" value={selectedQuote.vq_number} />}
            <DocRow label="PO#" value={p.po_number} />
            {p.receipts.map((r) => (
              <DocRow key={r.id} label="GR#" value={r.gr_number} sub={r.status} />
            ))}
            {p.invoices.map((inv) => (
              <DocRow key={inv.id} label="VI#" value={inv.vi_number} sub={inv.status} />
            ))}
          </CardPad>
        </Card>
      </div>

      {/* Approval / rejection notes */}
      {p.approval_notes && (
        <Card className="mt-4">
          <CardHead>Approval notes</CardHead>
          <CardPad>
            <p className="text-[13.5px]">{p.approval_notes}</p>
          </CardPad>
        </Card>
      )}
      {p.rejection_notes && (
        <Card className="mt-4">
          <CardHead>Rejection notes</CardHead>
          <CardPad>
            <p className="text-[13.5px] text-destructive">{p.rejection_notes}</p>
          </CardPad>
        </Card>
      )}

      {/* P1-P4 — confirm-before-write. One dialog drives every staged mutation;
          forward steps + GR/VI are default-tone, Reject/Cancel are destructive. */}
      <ConfirmDialog
        open={pendingConfirm !== null}
        tone={pendingConfirm?.kind === 'transition' ? pendingConfirm.tone : 'default'}
        title={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.title
            : pendingConfirm?.kind === 'createGR'
              ? 'Record this goods receipt?'
              : 'Record this vendor invoice?'
        }
        description={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.tone === 'destructive'
              ? 'This is a terminal action for this request and cannot be undone.'
              : `This moves ${p.title} to its next lifecycle stage.`
            : pendingConfirm?.kind === 'createGR'
              ? `This records a ${pendingConfirm.status.toLowerCase()} goods receipt against ${p.title}.`
              : `This records a vendor invoice against ${p.title}.`
        }
        confirmLabel={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.confirmLabel
            : pendingConfirm?.kind === 'createGR'
              ? 'Save GR'
              : 'Save VI'
        }
        loading={confirmInFlight}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => void commitConfirm()}
      />
    </div>
  );
};

/** Mono doc-reference row (PR/VQ/PO/GR/VI) with an optional status sub-label. */
const DocRow: React.FC<{ label: string; value: string | null | undefined; sub?: string }> = ({
  label,
  value,
  sub,
}) => {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <span className="w-9 shrink-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono font-semibold">{value}</span>
      {sub && <StatusPill variant="neutral" className="ml-auto">{sub}</StatusPill>}
    </div>
  );
};

export default ProcurementDetails;
