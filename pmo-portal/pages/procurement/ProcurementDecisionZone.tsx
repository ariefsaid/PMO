/**
 * ProcurementDecisionZone — the DecisionCard region of the procurement detail
 * (refactor: procurement-detail-dedup). Lifted verbatim out of the
 * ProcurementDetails god-file to shrink it; behavior + rendered output unchanged.
 *
 * ░░ DECISION STRIP — compact, non-sticky, under the stepper (IxD Change 1) ░░
 * Owner IxD: relocated from a sticky-bottom bar to a COMPACT action strip in normal
 * flow, directly below the lifecycle stepper and above the tabs. Minimal vertical
 * whitespace. Contains:
 *   • SoD hint (D6) — ONE muted inline line (condensed from a boxed GateNotice) so
 *     the viewer learns WHY they can/can't act without a heavy banner
 *   • Notes — PROGRESSIVE DISCLOSURE: a quiet "Add a note" link reveals the optional
 *     textarea inline (no always-on field); approve/reject only
 *   • O3 inline VI capture (replaces "Mark Vendor Invoiced" when clicked)
 *   • Action row: ONE primary → outline secondaries → destructive LAST (D7/D8)
 *   • GR/VI capture (D17) — quiet ghost links co-located below the primary CTA
 *   • Inline mutation error (role=alert)
 *
 * Non-sticky: the strip sits in normal flow (RecordActionZone sticky={false}); it
 * still renders THROUGH RecordActionZone so the `record-action-zone` enforcement
 * contract holds. The SoD/transition state machine (gating, pendingConfirm, RPC
 * calls, confirm dialog) is UNCHANGED — only layout + Notes disclosure changed.
 */
import React from 'react';
import {
  Card,
  CardPad,
  Button,
  Icon,
  RecordActionZone,
} from '@/src/components/ui';
import { RecordCaptureForm, RecordCaptureTrigger, type StagedRecord } from './RecordCaptureForm';
import type { ProcurementStatus, ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { useProcurementMutations } from '@/src/hooks/useProcurementDetail';

type ActionVariant = 'primary' | 'success' | 'destructive' | 'outline';

export interface DecisionAction {
  to: ProcurementStatus;
  label: string;
  variant: ActionVariant;
}

/**
 * Per-status SoD-aware ready copy for the GateNotice variant="ready".
 * Replaces the generic "You may move this request to its next lifecycle
 * stage below." with copy that teaches the SoD rule relevant to each stage.
 * Display-only — no enforcement logic.
 */
function readyGateMessage(
  status: ProcurementStatus,
  isRequester: boolean,
  isApprover: boolean,
): string {
  switch (status) {
    case 'Draft':
      // Author about to submit — teach that submission hands off to a different approver.
      return isRequester
        ? 'Submitting hands this to an approver — you can\'t approve your own request.'
        : 'Ready to submit this request for approval.';
    case 'Requested':
      // Approver viewing — teach that the requester cannot self-approve.
      return 'You may approve or reject this request. The requester cannot self-approve — separation of duties requires a different reviewer.';
    case 'Vendor Invoiced':
      // Finance payer — teach SoD-b: the approver cannot also release payment.
      return isApprover
        ? 'Ready to advance.' // SoD-b blocks them anyway; the action won't appear
        : 'Releasing payment — the approver can\'t also pay (separation of duties). You may mark this as paid below.';
    default:
      return 'Ready to advance. Select an action below to move this request to its next stage.';
  }
}

export interface ProcurementDecisionZoneProps {
  p: ProcurementDetail;
  /** Pre-sorted actions (primary → outline/success → destructive). */
  actions: DecisionAction[];
  /** The SoD blocked-gate message, when present (computed by the page). */
  gateMsg: string | null;
  isDraft: boolean;
  isRequester: boolean;
  isApprover: boolean;
  /** Whether the approve/reject notes textarea is shown. */
  showNotes: boolean;
  notesInput: string;
  setNotesInput: (v: string) => void;
  /** O3 inline VI capture toggle. */
  showVICapture: boolean;
  setShowVICapture: (v: boolean) => void;
  submitVICapture: (
    status: 'Received' | 'Scheduled',
    invoiceDate: string,
    referenceNumber: string | null,
    amount: number | null,
  ) => void;
  /** GR/VI standalone capture gating + toggles. */
  canShowGRForm: boolean;
  canShowVIForm: boolean;
  showCreateGR: boolean;
  setShowCreateGR: (v: boolean) => void;
  showCreateVI: boolean;
  setShowCreateVI: (v: boolean) => void;
  /** Stage a GR/VI for the confirm-before-commit dialog. */
  setPendingConfirm: (staged: StagedRecord) => void;
  setMutationError: (v: string | null) => void;
  mutationError: string | null;
  onActionClick: (action: DecisionAction) => void;
  mutations: ReturnType<typeof useProcurementMutations>;
}

export const ProcurementDecisionZone: React.FC<ProcurementDecisionZoneProps> = ({
  p,
  actions,
  gateMsg,
  isDraft,
  isRequester,
  isApprover,
  showNotes,
  notesInput,
  setNotesInput,
  showVICapture,
  setShowVICapture,
  submitVICapture,
  canShowGRForm,
  canShowVIForm,
  showCreateGR,
  setShowCreateGR,
  showCreateVI,
  setShowCreateVI,
  setPendingConfirm,
  setMutationError,
  mutationError,
  onActionClick,
  mutations,
}) => {
  // IxD Change 1: the strip is NON-STICKY and lives directly under the stepper
  // (above the tabs). The SoD hint is condensed from a boxed GateNotice banner to a
  // single muted inline line so the strip carries minimal vertical whitespace. The
  // wording (and its SoD meaning) is unchanged. The Draft-author case is already
  // covered by the `sod-pre-announce` line below, so the ready hint suppresses there
  // to avoid two near-identical lines.
  const showReadyHint = !gateMsg && actions.length > 0 && !(isDraft && isRequester);

  // IxD Change 1 — Notes is progressive-disclosure: NOT shown at rest. When
  // Approve/Reject is available (`showNotes`) a quiet "Add a note" link reveals the
  // optional textarea inline, before the confirm. The note still flows through the
  // existing notesInput → commitTransition path (SoD/transition machine untouched).
  const [notesRevealed, setNotesRevealed] = React.useState(false);

  return (
    <RecordActionZone sticky={false} className="mb-4">
      <Card data-testid="decision-card">
        <CardPad className="flex flex-col gap-2.5 py-3">
          {/* D6: SoD / readiness hint — co-located with the (absent or present) action
              buttons so the viewer never hunts for the reason they can't act. Condensed
              to ONE muted inline line (IxD Change 1) instead of a boxed banner. */}
          {gateMsg ? (
            <p
              data-testid="sod-blocked-hint"
              className="text-[13px] text-muted-foreground"
            >
              <b className="font-semibold text-foreground">Separation-of-duties gate.</b> {gateMsg}
            </p>
          ) : showReadyHint ? (
            <p
              data-testid="sod-ready-hint"
              className="text-[13px] text-muted-foreground"
            >
              {readyGateMessage(p.status, isRequester, isApprover)}
            </p>
          ) : null}

          {/* B-IMP-2 (AC-S6-2): SoD pre-announce for the author on a Draft record.
              The author (requester) is about to submit their own request; they need to know
              that submission hands it to a different approver — self-approval is not allowed.
              This is an AUTHOR-side pre-announce on Draft only; the VIEWER-side SoD hint
              (blocked line at Requested) already handles the non-author blocker path. */}
          {isDraft && isRequester && (
            <p
              data-testid="sod-pre-announce"
              className="text-[13px] text-muted-foreground"
            >
              Submitting hands this to another approver — you can&apos;t approve your own request.
            </p>
          )}

          {/* IxD Change 1 — progressive-disclosure Notes. At rest only the quiet
              "Add a note" link shows; clicking it reveals the optional textarea
              inline (no always-on field taking vertical space). */}
          {showNotes && !notesRevealed && (
            <button
              type="button"
              data-testid="procurement-notes-reveal"
              onClick={() => setNotesRevealed(true)}
              className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-[hsl(var(--nav-active-text))] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Icon name="plus" className="size-3.5" />
              Add a note <span className="font-normal text-muted-foreground">(optional)</span>
            </button>
          )}

          {showNotes && notesRevealed && (
            <div className="flex max-w-md flex-col gap-1">
              <label htmlFor="procurement-notes-input" className="text-[12px] font-semibold text-muted-foreground">
                Notes <span className="font-normal">(optional)</span>
              </label>
              <textarea
                id="procurement-notes-input"
                data-testid="procurement-notes-input"
                rows={2}
                autoFocus
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="Add a note for the approval or rejection…"
                className="rounded-md border border-input bg-background px-2.5 py-1.5 text-[13.5px] outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
          )}

          {/* O3 (AC-W3-O3): inline VI capture replaces the "Mark Vendor Invoiced" button
              when the user clicks it, co-locating invoice capture with the transition action. */}
          {showVICapture ? (
            <VIInlineCapture
              busy={mutations.transition.isPending || mutations.createInvoice.isPending}
              onSubmit={(viStatus, invoiceDate, referenceNumber, amount) => void submitVICapture(viStatus, invoiceDate, referenceNumber, amount)}
              onCancel={() => { setShowVICapture(false); setMutationError(null); }}
            />
          ) : actions.length > 0 ? (
            // D8: actions are pre-sorted (primary → outline/success → destructive) by
            // sortActions() above, so Cancel/Reject always render last in DOM order.
            // The flex-wrap direction preserves this: the destructive action wraps
            // below the primary on narrow layouts, never above it.
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => {
                // D10 (AC-W3-D10): block Draft → Requested when there are no line items.
                // Only the Submit Request action (Draft→Requested) is gated; all other
                // actions on later stages are unaffected.
                const isSubmitBlocked =
                  action.to === 'Requested' && isDraft && p.items.length === 0;
                return (
                  <Button
                    key={action.to}
                    // The solid `destructive` fill belongs ONLY inside the confirm
                    // dialog (the system's single solid status fill) — at rest a
                    // destructive action (Reject / Cancel) is a quiet OUTLINE so it
                    // does not compete with the blue primary (the I4 two-solid-fills
                    // tell). onActionClick still reads action.variant for the
                    // dialog tone, so a kept destructive confirm stays red.
                    variant={action.variant === 'destructive' ? 'outline' : action.variant}
                    loading={mutations.transition.isPending}
                    disabled={isSubmitBlocked}
                    onClick={() => onActionClick(action)}
                  >
                    {action.label}
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No further lifecycle actions are available to you at this stage.
            </p>
          )}

          {/* D10 (AC-W3-D10): gate message below the action bar when Draft with no items. */}
          {isDraft && p.items.length === 0 && actions.some((a) => a.to === 'Requested') && (
            <p className="text-[13px] text-muted-foreground" data-testid="line-items-gate">
              Add at least one line item before submitting.
            </p>
          )}

          {/* D17 (AC-IXD-PROC-W5-C3-D17): GR/VI create affordances — demoted to quiet
              ghost links co-located inside the DecisionCard, below the primary CTA.
              The collapsed trigger is a ghost/link (NOT solid blue) so the stage's ONE
              primary CTA is the only blue on screen (One-Blue Rule). The separate
              competing Card containers are removed. The create logic, gating
              (canShowGRForm / canShowVIForm), and role/state predicates are UNCHANGED.
              When the inline form is open, its submit is the only affordance and MAY be
              primary/success — it is the focused task at that point. */}
          {/* GR/VI capture — folded into the shared RecordCaptureForm (refactor:
              procurement-detail-dedup). The standalone GR/VI forms do NOT create
              directly: `onStage` hands a `pendingConfirm`-shaped payload to the
              confirm-before-commit flow (the KEY behavioral difference from the
              PR/RFQ/PO/Payment kinds, which use `onCreate`). The trigger stays a
              quiet ghost link (One-Blue Rule); `onCreate` is never invoked on this
              path so it is a typed no-op. */}
          {canShowGRForm && (
            <div className="border-t border-border/50 pt-3">
              <RecordCaptureTrigger
                kind="goods_receipt"
                open={showCreateGR}
                onOpen={() => setShowCreateGR(true)}
              />
              {showCreateGR && (
                <RecordCaptureForm
                  kind="goods_receipt"
                  busy={mutations.createReceipt.isPending}
                  onCreate={() => Promise.resolve()}
                  onStage={(staged) => {
                    setMutationError(null);
                    setPendingConfirm(staged);
                  }}
                  onClose={() => setShowCreateGR(false)}
                />
              )}
            </div>
          )}

          {canShowVIForm && (
            <div className="border-t border-border/50 pt-3">
              <RecordCaptureTrigger
                kind="vendor_invoice"
                open={showCreateVI}
                onOpen={() => setShowCreateVI(true)}
              />
              {showCreateVI && (
                <RecordCaptureForm
                  kind="vendor_invoice"
                  busy={mutations.createInvoice.isPending}
                  onCreate={() => Promise.resolve()}
                  onStage={(staged) => {
                    setMutationError(null);
                    setPendingConfirm(staged);
                  }}
                  onClose={() => setShowCreateVI(false)}
                />
              )}
            </div>
          )}

          {mutationError && (
            <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <Icon name="alert" className="mt-px size-4 shrink-0" />
              <span>{mutationError}</span>
            </div>
          )}
        </CardPad>
      </Card>
    </RecordActionZone>
  );
};

ProcurementDecisionZone.displayName = 'ProcurementDecisionZone';

// ---------------------------------------------------------------------------
// O3 (AC-W3-O3): inline VI capture — appears in the action bar when the user
// clicks "Mark Vendor Invoiced", co-locating invoice capture with the transition.
// N1 (AC-W3-N1): Paid is excluded from status options here too.
// ---------------------------------------------------------------------------
interface VIInlineCaptureProps {
  busy: boolean;
  onSubmit: (
    status: 'Received' | 'Scheduled',
    invoiceDate: string,
    referenceNumber: string | null,
    amount: number | null,
  ) => void;
  onCancel: () => void;
}

const VIInlineCapture: React.FC<VIInlineCaptureProps> = ({ busy, onSubmit, onCancel }) => {
  const [viStatus, setViStatus] = React.useState<'Received' | 'Scheduled'>('Received');
  const [invoiceDate, setInvoiceDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [refNum, setRefNum] = React.useState('');
  const [amtStr, setAmtStr] = React.useState('');

  const handleSubmit = () => {
    const ref = refNum.trim() || null;
    const amt = amtStr.trim() === '' ? null : Number(amtStr.replace(/,/g, ''));
    onSubmit(viStatus, invoiceDate, ref, amt);
  };

  return (
    <div data-testid="vi-inline-capture" className="flex flex-col gap-3">
      <p className="text-[12px] font-semibold text-muted-foreground">
        Enter invoice details to mark as Vendor Invoiced:
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Invoice # <span className="font-normal">(optional)</span>
          <input
            type="text"
            value={refNum}
            onChange={(e) => setRefNum(e.target.value)}
            placeholder="e.g. INV-2291"
            maxLength={64}
            data-testid="vi-ref-input"
            className="h-8 w-36 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Amount <span className="font-normal">(optional)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amtStr}
            onChange={(e) => setAmtStr(e.target.value)}
            placeholder="0.00"
            data-testid="vi-amount-input"
            className="h-8 w-28 rounded-md border border-input bg-background px-2 text-[13.5px] tabular-nums outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Invoice status
          <select
            value={viStatus}
            onChange={(e) => setViStatus(e.target.value as 'Received' | 'Scheduled')}
            data-testid="vi-status-select"
            className="h-8 w-40 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="Received">Received</option>
            <option value="Scheduled">Scheduled</option>
            {/* N1 (AC-W3-N1): Paid excluded — Mark as Paid is the sole PR→Paid authority. */}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Invoice date
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            data-testid="vi-date-input"
            className="h-8 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
        <Button
          variant="success"
          size="sm"
          loading={busy}
          disabled={!invoiceDate}
          data-testid="btn-submit-vi-capture"
          onClick={handleSubmit}
        >
          Confirm &amp; Mark Invoiced
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="btn-cancel-vi-capture"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};
