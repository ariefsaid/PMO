import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProcurementDetail, useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency } from '@/src/lib/format';
import {
  isLegalTransition,
  canCancel,
  type ProcurementStatus,
  type ProcurementDetail,
} from '@/src/lib/db/procurementLifecycle';

// ---------------------------------------------------------------------------
// Role sets for cosmetic gating (FR-PROC-006, OD-PROC-1 matrix, AC-805)
// The RPC is the real authority — this is display-only.
// ---------------------------------------------------------------------------
const APPROVE_REJECT_ROLES = new Set(['Project Manager', 'Finance', 'Executive', 'Admin']);
const SOURCING_ROLES = new Set(['Project Manager', 'Finance', 'Admin']);
const RECEIPT_ROLES = new Set(['Project Manager', 'Admin']); // requester also allowed — handled below
const INVOICE_PAY_ROLES = new Set(['Finance', 'Admin']);

/**
 * Returns the list of (from→to) transitions that should be shown to this role.
 * Cosmetic only — the RPC enforces for real (AC-805, FR-PROC-006).
 */
function allowedActions(
  status: ProcurementStatus,
  role: string,
  isRequester: boolean,
): { to: ProcurementStatus; label: string; variant: 'primary' | 'success' | 'danger' | 'warning' | 'neutral' }[] {
  const actions: { to: ProcurementStatus; label: string; variant: 'primary' | 'success' | 'danger' | 'warning' | 'neutral' }[] = [];

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
    actions.push({ to: 'Rejected', label: 'Reject', variant: 'danger' });
  }

  // Rejected → Draft: requester rework (FR-PROC-007)
  if (legal('Draft') && isRequester) {
    actions.push({ to: 'Draft', label: 'Rework (Back to Draft)', variant: 'neutral' });
  }

  // Approved → Vendor Quoted / Ordered (skip): PM/Finance/Admin (FR-PROC-008)
  if (legal('Vendor Quoted') && SOURCING_ROLES.has(role)) {
    actions.push({ to: 'Vendor Quoted', label: 'Request Vendor Quotes', variant: 'primary' });
  }
  if (legal('Ordered') && SOURCING_ROLES.has(role) && status === 'Approved') {
    actions.push({ to: 'Ordered', label: 'Generate Purchase Order', variant: 'warning' });
  }

  // Vendor Quoted → Quote Selected: PM/Finance/Admin
  if (legal('Quote Selected') && SOURCING_ROLES.has(role)) {
    actions.push({ to: 'Quote Selected', label: 'Select Quote', variant: 'primary' });
  }

  // Quote Selected → Ordered: PM/Finance/Admin. No dedup needed vs the Approved→Ordered push above:
  // a procurement has exactly one `status`, so legal('Ordered') holds for at most one of those
  // branches (status is either 'Approved' or 'Quote Selected', never both) — they cannot collide.
  if (legal('Ordered') && SOURCING_ROLES.has(role) && status === 'Quote Selected') {
    actions.push({ to: 'Ordered', label: 'Generate Purchase Order', variant: 'warning' });
  }

  // Ordered → Received: requester or PM (FR-PROC-008)
  if (legal('Received') && (isRequester || RECEIPT_ROLES.has(role))) {
    actions.push({ to: 'Received', label: 'Confirm Receipt', variant: 'primary' });
  }

  // Received → Vendor Invoiced: Finance only (FR-PROC-009)
  if (legal('Vendor Invoiced') && INVOICE_PAY_ROLES.has(role)) {
    actions.push({ to: 'Vendor Invoiced', label: 'Mark Vendor Invoiced', variant: 'primary' });
  }

  // Vendor Invoiced → Paid: Finance only, not the approver (SoD-b checked server-side; cosmetically allow)
  if (legal('Paid') && INVOICE_PAY_ROLES.has(role)) {
    actions.push({ to: 'Paid', label: 'Mark as Paid', variant: 'success' });
  }

  // Cancel: subject to canCancel boundary (FR-PROC-009, OD-PROC-B)
  if (legal('Cancelled') && canCancel(role, isRequester, status)) {
    actions.push({ to: 'Cancelled', label: 'Cancel', variant: 'danger' });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Button variant styles
// ---------------------------------------------------------------------------
const btnBase =
  'px-4 py-2 rounded-md font-medium shadow-sm transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50';

const variantClass: Record<string, string> = {
  primary: 'bg-primary-600 hover:bg-primary-700 text-white focus:ring-primary-500',
  success: 'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50 dark:bg-gray-800 dark:border-red-900 dark:text-red-400',
  warning: 'bg-orange-600 hover:bg-orange-700 text-white focus:ring-orange-500',
  neutral:
    'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600',
};

// Status badge palette — terminal/negative states stand apart from in-flight ones so the lifecycle
// stage is legible at a glance (Paid = success, Cancelled/Rejected = muted/negative, rest = in-flight).
const statusBadgeClass: Record<ProcurementStatus, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  Requested: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  Approved: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
  Rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  'Vendor Quoted': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  'Quote Selected': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  Ordered: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  Received: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
  'Vendor Invoiced': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  Paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  Cancelled: 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

// ---------------------------------------------------------------------------
// Doc-trail badge helper
// ---------------------------------------------------------------------------
const TrailBadge: React.FC<{ label: string; value: string | null | undefined; sub?: string }> = ({
  label,
  value,
  sub,
}) => {
  if (!value) return null;
  return (
    <div className="flex flex-col items-center px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-200 dark:border-gray-700 min-w-[120px]">
      <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="mt-1 text-xs font-mono font-semibold text-gray-900 dark:text-white">{value}</span>
      {sub && (
        <span className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">{sub}</span>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const ProcurementDetails: React.FC = () => {
  const { procurementId } = useParams<{ procurementId: string }>();
  const { effectiveRole } = useEffectiveRole();
  const { currentUser } = useAuth();

  const detailQuery = useProcurementDetail(procurementId);
  const mutations = useProcurementMutations(procurementId ?? '');

  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState('');

  // GR/VI creation state (D3 — AC-816 journey support)
  const [showCreateGR, setShowCreateGR] = useState(false);
  const [showCreateVI, setShowCreateVI] = useState(false);

  // ── Loading state (AC-804, NFR-PROC-UI-001) ──────────────────────────────
  if (detailQuery.isPending) {
    return (
      <div data-testid="procurement-loading" className="animate-pulse space-y-4">
        <div className="h-10 w-96 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded-xl" />
      </div>
    );
  }

  // ── Error state (AC-804) ─────────────────────────────────────────────────
  if (detailQuery.isError) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          Couldn&apos;t load procurement
        </h3>
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          Something went wrong fetching the procurement details.
        </p>
        <button
          onClick={() => detailQuery.refetch()}
          className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state (AC-804) ─────────────────────────────────────────────────
  if (!detailQuery.data) {
    return (
      <div data-testid="procurement-empty" className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Procurement not found</h3>
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          This procurement does not exist or you don&apos;t have access to it.
        </p>
        <Link
          to="/procurement"
          className="mt-4 inline-block text-primary-600 hover:text-primary-500 font-medium text-sm"
        >
          Back to Procurement
        </Link>
      </div>
    );
  }

  const p: ProcurementDetail = detailQuery.data;
  const role = effectiveRole ?? '';
  const isRequester = p.requested_by_id === currentUser?.id;
  const actions = allowedActions(p.status, role, isRequester);

  // Derive selected quotation for the VQ trail
  const selectedQuote = p.quotations.find((q) => q.is_selected);

  // Approve/Reject carry an optional reviewer note (OD-PROC-1) — show the notes field only when
  // one of those actions is offered, so the input is contextual to the decision being recorded.
  const showNotes = actions.some((a) => a.to === 'Approved' || a.to === 'Rejected');

  // ── Transition handler (AC-805, AC-806) ─────────────────────────────────
  const handleTransition = async (to: ProcurementStatus) => {
    setMutationError(null);
    try {
      await mutations.transition.mutateAsync({ to, notes: notesInput || undefined });
      setNotesInput('');
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => window.history.back()}
              aria-label="Go back"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <nav className="flex text-sm font-medium text-gray-500 dark:text-gray-400">
              <Link to="/procurement" className="hover:text-gray-700 dark:hover:text-gray-200">
                Procurement
              </Link>
              <span className="mx-2">/</span>
              <span className="font-mono text-gray-700 dark:text-gray-300">{p.code}</span>
            </nav>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{p.title}</h1>
            {/* Status badge — inline span (ProcurementStatusBadge uses the old enum type;
                we render a generic badge here to stay off mock-data imports) */}
            <span
              data-testid="procurement-status-badge"
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass[p.status]}`}
            >
              {p.status}
            </span>
          </div>
        </div>

        {/* Action bar (AC-805) */}
        <div className="flex flex-col gap-2 lg:mt-6">
          {/* Optional approval/rejection notes (OD-PROC-1) — stamped as approval_notes/rejection_notes
              by transition_procurement; shown only when an Approve/Reject action is available. */}
          {showNotes && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="procurement-notes-input"
                className="text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                Notes <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                id="procurement-notes-input"
                data-testid="procurement-notes-input"
                rows={2}
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="Add a note for the approval or rejection…"
                className="block w-full min-w-[16rem] rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.to}
                onClick={() => handleTransition(action.to)}
                disabled={mutations.transition.isPending}
                className={`${btnBase} ${variantClass[action.variant]}`}
              >
                {action.label}
              </button>
            ))}
          </div>
          {/* RPC error display (AC-806, NFR-PROC-UI-001) */}
          {mutationError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {mutationError}
            </p>
          )}
        </div>
      </div>

      {/* GR creation panel (AC-816): shown when status is Ordered/Received and role allows writes) */}
      {(p.status === 'Ordered' || p.status === 'Received' || p.status === 'Vendor Invoiced' || p.status === 'Paid') && SOURCING_ROLES.has(role) && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          {!showCreateGR ? (
            <button
              data-testid="btn-create-gr"
              onClick={() => setShowCreateGR(true)}
              className={`${btnBase} ${variantClass.primary}`}
            >
              + Create Goods Receipt
            </button>
          ) : (
            <form
              data-testid="form-create-gr"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                setMutationError(null);
                try {
                  await mutations.createReceipt.mutateAsync({
                    status: fd.get('gr-status') as 'Partial' | 'Complete',
                    receiptDate: fd.get('gr-date') as string,
                  });
                  setShowCreateGR(false);
                } catch (err) {
                  setMutationError(err instanceof Error ? err.message : 'An error occurred');
                }
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select name="gr-status" defaultValue="Complete"
                  className="block w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
                  data-testid="gr-status-select"
                >
                  <option value="Partial">Partial</option>
                  <option value="Complete">Complete</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Receipt Date</label>
                <input type="date" name="gr-date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="block rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
                  data-testid="gr-date-input"
                />
              </div>
              <button type="submit" disabled={mutations.createReceipt.isPending}
                data-testid="btn-save-gr"
                className={`${btnBase} ${variantClass.success}`}>
                Save GR
              </button>
              <button type="button" onClick={() => setShowCreateGR(false)}
                className={`${btnBase} ${variantClass.neutral}`}>
                Cancel
              </button>
            </form>
          )}
        </div>
      )}

      {/* VI creation panel (AC-816): shown when status is Vendor Invoiced and role is Finance/Admin) */}
      {(p.status === 'Vendor Invoiced' || p.status === 'Paid') && INVOICE_PAY_ROLES.has(role) && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          {!showCreateVI ? (
            <button
              data-testid="btn-create-vi"
              onClick={() => setShowCreateVI(true)}
              className={`${btnBase} ${variantClass.primary}`}
            >
              + Create Vendor Invoice
            </button>
          ) : (
            <form
              data-testid="form-create-vi"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                setMutationError(null);
                try {
                  await mutations.createInvoice.mutateAsync({
                    status: fd.get('vi-status') as 'Received' | 'Scheduled' | 'Paid',
                    invoiceDate: fd.get('vi-date') as string,
                  });
                  setShowCreateVI(false);
                } catch (err) {
                  setMutationError(err instanceof Error ? err.message : 'An error occurred');
                }
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select name="vi-status" defaultValue="Received"
                  className="block w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
                  data-testid="vi-status-select"
                >
                  <option value="Received">Received</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Paid">Paid</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Invoice Date</label>
                <input type="date" name="vi-date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="block rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
                  data-testid="vi-date-input"
                />
              </div>
              <button type="submit" disabled={mutations.createInvoice.isPending}
                data-testid="btn-save-vi"
                className={`${btnBase} ${variantClass.success}`}>
                Save VI
              </button>
              <button type="button" onClick={() => setShowCreateVI(false)}
                className={`${btnBase} ${variantClass.neutral}`}>
                Cancel
              </button>
            </form>
          )}
        </div>
      )}

      {/* Document trail (D3 — PR / VQ / PO / GR / VI) */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
          Document Trail
        </h2>
        <div className="flex flex-wrap gap-3">
          <TrailBadge label="PR#" value={p.pr_number} />
          {selectedQuote && <TrailBadge label="VQ#" value={selectedQuote.vq_number} />}
          <TrailBadge label="PO#" value={p.po_number} />
          {p.receipts.map((r) => (
            <TrailBadge key={r.id} label="GR#" value={r.gr_number} sub={r.status} />
          ))}
          {p.invoices.map((inv) => (
            <TrailBadge key={inv.id} label="VI#" value={inv.vi_number} sub={inv.status} />
          ))}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Value</p>
          <p className="text-base font-bold text-gray-900 dark:text-white mt-0.5">
            {formatCurrency(Number(p.total_value))}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Project</p>
          <p className="text-base font-bold text-gray-900 dark:text-white mt-0.5">
            {p.project?.name ?? 'N/A'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Vendor</p>
          <p className="text-base font-bold text-gray-900 dark:text-white mt-0.5">
            {p.vendor?.name ?? <span className="text-gray-400 italic font-normal">Pending Selection</span>}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Requested By</p>
          <p className="text-base font-bold text-gray-900 dark:text-white mt-0.5">
            {p.requested_by?.full_name ?? 'Unknown'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            on {new Date(p.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Quotations section */}
      {p.quotations.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Vendor Quotations
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {p.quotations.map((q) => (
              <div
                key={q.id}
                className={`flex flex-col border rounded-xl p-4 ${
                  q.is_selected
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/10 dark:border-green-500'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                {q.vq_number && (
                  <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{q.vq_number}</p>
                )}
                <p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                  {formatCurrency(Number(q.total_amount))}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Received: {q.received_date ? new Date(q.received_date).toLocaleDateString() : '—'}
                </p>
                {q.is_selected && (
                  <span className="mt-2 self-start text-xs font-bold text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded">
                    Selected
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Receipts section */}
      {p.receipts.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Goods Receipts
          </h3>
          <div className="space-y-2">
            {p.receipts.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
              >
                <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                  {r.gr_number}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {r.receipt_date ? new Date(r.receipt_date).toLocaleDateString() : '—'}
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invoices section */}
      {p.invoices.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Vendor Invoices
          </h3>
          <div className="space-y-2">
            {p.invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
              >
                <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                  {inv.vi_number}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '—'}
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300">
                  {inv.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approval notes */}
      {p.approval_notes && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 border border-indigo-100 dark:border-indigo-800">
          <h4 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-1">
            Approval Notes
          </h4>
          <p className="text-sm text-indigo-900 dark:text-indigo-100">{p.approval_notes}</p>
        </div>
      )}

      {/* Rejection notes */}
      {p.rejection_notes && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-100 dark:border-red-800">
          <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
            Rejection Notes
          </h4>
          <p className="text-sm text-red-900 dark:text-red-100">{p.rejection_notes}</p>
        </div>
      )}
    </div>
  );
};

export default ProcurementDetails;
