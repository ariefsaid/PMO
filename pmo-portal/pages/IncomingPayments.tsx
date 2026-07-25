import React, { useCallback, useMemo, useState } from 'react';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  EntityFormModal,
  TextField,
  NumberField,
  Combobox,
  FormGrid,
  FormSection,
  Button,
  Icon,
  useToast,
  type Column,
  type ComboboxOption,
  type RowMenuItem,
} from '@/src/components/ui';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIncomingPayments, useSalesInvoices, useRevenueMutations } from '@/src/hooks/useRevenue';
import { useClientCompanyOptions } from '@/src/hooks/useFkOptions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { IncomingPaymentRow, IncomingPaymentStatus, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { incomingPaymentStatusVariant } from '@/src/lib/status/statusVariants';
import { type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useCommandIntent, useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import type { CommandIntent } from '@/src/lib/repositories/types';

/** Status filter segments. */
type StatusFilter = 'All' | IncomingPaymentStatus;
const STATUS_FILTERS: StatusFilter[] = ['All', 'Scheduled', 'Paid'];

/** Form values for the payment modal. */
interface FormValues {
  customerId: string;
  salesInvoiceId: string | null;
  paidAmount: string;
  receivedAmount: string;
  date: string;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.customerId.trim()) errors.customerId = 'Customer is required.';
  if (Number(v.paidAmount) <= 0) errors.paidAmount = 'Paid amount must be positive.';
  if (Number(v.receivedAmount) <= 0) errors.receivedAmount = 'Received amount must be positive.';
  if (!v.date) errors.date = 'Date is required.';
  return errors;
};

/**
 * The invoices a receipt can still be applied to, as picker options.
 *
 * "Open" = SUBMITTED to the ledger (`Submitted`/`Unpaid`) and still owing. A `Draft` has not hit
 * the GL yet (P3a creates every SI as an ERP draft — the SoD-gated submit is the commitment), and
 * `Paid`/`Cancelled` can receive nothing. A null `erp_outstanding_amount` means the ERP mirror
 * hasn't reported one yet, so the invoice stays selectable rather than silently disappearing.
 * Scoped to `customerId` when one is chosen — a receipt must never settle another client's invoice.
 */
function openInvoiceOptions(
  invoices: SalesInvoiceRow[],
  customerId?: string | null,
): ComboboxOption[] {
  return invoices
    .filter((inv) => inv.status === 'Submitted' || inv.status === 'Unpaid')
    .filter((inv) => inv.erp_outstanding_amount == null || inv.erp_outstanding_amount > 0)
    .filter((inv) => !customerId || inv.customer_id === customerId)
    .map((inv) => ({
      value: inv.id,
      label: inv.si_number ?? inv.id,
      sub:
        inv.erp_outstanding_amount != null
          ? `$${inv.erp_outstanding_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} outstanding`
          : undefined,
    }));
}

const IncomingPayments: React.FC = () => {
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useIncomingPayments();
  const { createPayment, cancelPayment, pendingPush } = useRevenueMutations();

  const canView = may('view', 'incomingPayment');
  const canCreate = may('create', 'incomingPayment');
  const canCancel = may('transition', 'incomingPayment');
  const canRowWrite = canCancel;

  const all = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  const [formTarget, setFormTarget] = useState<{ payment: IncomingPaymentRow | null } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<IncomingPaymentRow | null>(null);

  // BLOCK 2 (ADR-0058): the cancel confirm dialog is ALWAYS mounted, so its command identity is per
  // (record, verb) — a retry on payment B must never carry payment A's key. Released only after a
  // terminal success (never on error — reusing the key on retry IS the fix).
  const verbIntents = useCommandIntentMap();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((p) => statusFilter === 'All' || p.status === statusFilter)
      .filter((p) => !q || p.ip_number?.toLowerCase().includes(q));
  }, [all, search, statusFilter]);

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  if (!canView) {
    return (
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">You don't have access to Incoming Payments</h2>
          <p className="mt-2 text-muted-foreground">
            The incoming payments list is available to Finance, Project Managers, and Executives.
          </p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  const columns: Column<IncomingPaymentRow>[] = [
    {
      key: 'ip_number',
      header: 'Payment #',
      cell: (p) => (
        <span className="truncate font-mono text-[13px]" title={p.ip_number ?? ''}>
          {p.ip_number ?? '—'}
        </span>
      ),
      exportValue: (p) => p.ip_number ?? '',
    },
    {
      key: 'reference_number',
      header: 'Reference',
      cell: (p) => (
        <span className="truncate text-muted-foreground" title={p.reference_number ?? ''}>
          {p.reference_number ?? '—'}
        </span>
      ),
      exportValue: (p) => p.reference_number ?? '',
    },
    {
      key: 'customer_id',
      header: 'Customer',
      cell: (p) => (
        <span className="truncate" title={p.customer_id ?? ''}>
          {p.customer_id ?? '—'}
        </span>
      ),
      exportValue: (p) => p.customer_id ?? '',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => <StatusPill variant={incomingPaymentStatusVariant(p.status)}>{p.status}</StatusPill>,
      exportValue: (p) => p.status,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'num',
      cell: (p) => (
        <span className="tabular text-right font-mono text-[13px]">
          {p.amount != null ? `$${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
        </span>
      ),
      exportValue: (p) => p.amount?.toString() ?? '',
    },
    {
      key: 'date',
      header: 'Date',
      cell: (p) => (p.date ? new Date(p.date).toLocaleDateString() : '—'),
      exportValue: (p) => p.date ?? '',
    },
  ];

  const rowMenu = (p: IncomingPaymentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canCancel && p.status !== 'Paid')
      items.push({ label: 'Cancel', onClick: () => setCancelTarget(p), danger: true });
    return items;
  };

  const onCancelConfirm = async () => {
    if (!cancelTarget) return;
    const key = `cancel:${cancelTarget.id}`;
    try {
      await cancelPayment.mutateAsync({ ipId: cancelTarget.id, intent: verbIntents.intentFor(key) });
      verbIntents.release(key);
      toast('Payment cancelled', cancelTarget.ip_number ?? cancelTarget.id, 'success');
      setCancelTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <ListPage
      title="Incoming Payments"
      description="Payments received from clients, mirrored from ERPNext. Linked to sales invoices when applicable."
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ payment: null })}>
            <Icon name="plus" />
            Receive Payment
          </Button>
        )
      }
      filters={
        state !== 'loading' && (
          <ViewToggle<StatusFilter>
            options={STATUS_FILTERS.map((f) => ({ value: f, label: f }))}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              trackFilterApplied('status', STATUS_FILTERS.length, 'incomingPayments');
            }}
            ariaLabel="Filter by status"
          />
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder="Search payments…"
            aria-label="Search incoming payments"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            searchSurface="incoming-payments-list"
            module="incomingPayments"
            resultCount={filtered.length}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
    >
      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title="Couldn't load incoming payments"
          sub="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="dollar"
          title="No incoming payments yet"
          sub="Record your first payment received from a client."
          stateId="incoming-payments-empty"
          role={realRole ?? undefined}
          module="incomingPayments"
          action={canCreate ? { label: 'Receive Payment', onClick: () => setFormTarget({ payment: null }) } : undefined}
        />
      )}

      {state === undefined && (
        <DataTable<IncomingPaymentRow>
          rows={filtered}
          columns={columns}
          rowKey={(p) => p.id}
          onActivate={(p) => navigate(`/incoming-payments/${p.id}`)}
          rowLabel={(p) => `Open ${p.ip_number ?? p.id}`}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No payments match your filters"
          emptySub="Try a different status or clear the search."
        />
      )}

      {/* Create modal */}
      {formTarget && (
        <IncomingPaymentFormModal
          payment={formTarget.payment}
          pendingPush={pendingPush}
          onClose={() => setFormTarget(null)}
          onCreate={async (input, intent) => {
            await createPayment.mutateAsync({ ...input, intent });
            toast('Payment created', input.customerId, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {/* Cancel confirm (destructive tone) */}
      <ConfirmDialog
        open={!!cancelTarget}
        tone="destructive"
        title={cancelTarget ? `Cancel ${cancelTarget.ip_number ?? cancelTarget.id}?` : 'Cancel payment?'}
        description="This cancels the payment in ERPNext (docstatus 1→2). The payment will be marked Cancelled and the linked invoice's outstanding amount will be restored."
        confirmLabel="Cancel payment"
        loading={cancelPayment.isPending}
        onConfirm={onCancelConfirm}
        onCancel={() => setCancelTarget(null)}
      />
    </ListPage>
  );
};

// ── Create form modal ────────────────────────────────────────────────

interface IncomingPaymentFormModalProps {
  payment: IncomingPaymentRow | null;
  onClose: () => void;
  /** `intent` is the modal's OWN command identity — stable for this form session (BLOCK 2). */
  onCreate: (
    input: {
      customerId: string;
      salesInvoiceId: string | null;
      paidAmount: number;
      receivedAmount: number;
      date: string;
    },
    intent: CommandIntent,
  ) => Promise<void>;
  onError: (err: unknown) => void;
  pendingPush: PendingPushState;
}

const IncomingPaymentFormModal: React.FC<IncomingPaymentFormModalProps> = ({
  payment,
  onClose,
  onCreate,
  onError,
  pendingPush,
}) => {
  const isEdit = !!payment;
  // BLOCK 2 (ADR-0058): ONE command identity per form session. This modal is mounted only while the
  // form is open, so its mount IS the session: a retry after "external system unreachable" reuses
  // this identity (the committed Payment Entry is reconciled, NOT posted twice), while a success
  // closes the modal → the next "Receive Payment" mints a fresh one.
  const intent = useCommandIntent();
  const form = useEntityForm<FormValues>({
    initialValues: {
      customerId: '',
      salesInvoiceId: null,
      paidAmount: '0',
      receivedAmount: '0',
      date: new Date().toISOString().split('T')[0],
    },
    validate,
    idPrefix: 'incoming-payment-form',
    requiredFields: ['customerId', 'paidAmount', 'receivedAmount', 'date'],
    module: 'incomingPayments',
  });

  // FK options from the cached hooks ("hooks own data fetching"); the Combobox loaders just hand
  // back the already-fetched lists. The invoice loader depends on the chosen customer, so the
  // picker re-loads when the customer changes.
  const { data: customerOptions } = useClientCompanyOptions();
  const { data: invoices } = useSalesInvoices();
  const loadCustomers = useCallback(async (): Promise<ComboboxOption[]> => customerOptions ?? [], [customerOptions]);
  const selectedCustomerId = form.values.customerId;
  const loadOpenInvoices = useCallback(
    async (): Promise<ComboboxOption[]> => openInvoiceOptions(invoices ?? [], selectedCustomerId),
    [invoices, selectedCustomerId],
  );

  const customerField = form.fieldProps('customerId');
  const salesInvoiceField = form.fieldProps('salesInvoiceId');
  const paidAmountField = form.fieldProps('paidAmount');
  const receivedAmountField = form.fieldProps('receivedAmount');
  const dateField = form.fieldProps('date');

  const errorSummary = form.errors.customerId || form.errors.paidAmount || form.errors.receivedAmount || form.errors.date
    ? [
        ...(form.errors.customerId ? [{ fieldId: customerField.id, message: form.errors.customerId }] : []),
        ...(form.errors.paidAmount ? [{ fieldId: paidAmountField.id, message: form.errors.paidAmount }] : []),
        ...(form.errors.receivedAmount ? [{ fieldId: receivedAmountField.id, message: form.errors.receivedAmount }] : []),
        ...(form.errors.date ? [{ fieldId: dateField.id, message: form.errors.date }] : []),
      ]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input = {
        customerId: values.customerId,
        salesInvoiceId: values.salesInvoiceId,
        paidAmount: Number(values.paidAmount),
        receivedAmount: Number(values.receivedAmount),
        date: values.date,
      };
      try {
        await onCreate(input, intent);
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit payment' : 'Receive Payment'}
      subtitle={isEdit ? 'Update this incoming payment' : 'Record a new incoming payment from a client'}
      submitLabel={isEdit ? 'Save payment' : 'Record payment'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      {pendingPush.status !== 'idle' && (
        <div className="mb-3.5 flex justify-end">
          <span className="text-xs text-muted-foreground">Pushing to ERPNext…</span>
        </div>
      )}
      <FormSection legend="Payment details">
        <FormGrid>
          <Combobox
            label="Customer"
            required
            value={customerField.value}
            onChange={(value, _option) => customerField.onChange(value)}
            error={customerField.error}
            placeholder="Select or search customer…"
            loadOptions={loadCustomers}
            noun="customer"
          />
          <Combobox
            label="Sales Invoice (optional)"
            value={salesInvoiceField.value ?? ''}
            onChange={(value, _option) => salesInvoiceField.onChange(value ?? '')}
            error={salesInvoiceField.error}
            placeholder="Link to sales invoice…"
            loadOptions={loadOpenInvoices}
            noun="invoice"
          />
          <NumberField
            label="Paid Amount"
            value={String(paidAmountField.value)}
            onChange={(v) => paidAmountField.onChange(v)}
            required
            min={0}
            step={0.01}
            prefix="$"
            error={paidAmountField.error}
          />
          <NumberField
            label="Received Amount"
            value={String(receivedAmountField.value)}
            onChange={(v) => receivedAmountField.onChange(v)}
            required
            min={0}
            step={0.01}
            prefix="$"
            error={receivedAmountField.error}
          />
          <TextField
            label="Date"
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
            required
            error={dateField.error}
            type="date"
            className="w-48"
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default IncomingPayments;