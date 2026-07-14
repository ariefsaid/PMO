import React, { useMemo, useState } from 'react';
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
  FieldError,
  Button,
  Icon,
  useToast,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useSalesInvoices, useRevenueMutations } from '@/src/hooks/useRevenue';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { SalesInvoiceRow, SalesInvoiceStatus } from '@/src/lib/db/revenue';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { IDLE_PENDING_PUSH, type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { formatCurrency } from '@/src/lib/format';
import { useAuth } from '@/src/auth/useAuth';
import { useEntityForm } from '@/src/components/ui/useEntityForm';

/** Status filter segments. */
type StatusFilter = 'All' | SalesInvoiceStatus;
const STATUS_FILTERS: StatusFilter[] = ['All', 'Draft', 'Submitted', 'Unpaid', 'Paid', 'Cancelled'];

/** Line item type for the invoice form. */
interface LineItem {
  item_code: string;
  qty: number;
  rate: number;
}

interface FormValues {
  customerId: string;
  projectId: string | null;
  lineItems: LineItem[];
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.customerId.trim()) errors.customerId = 'Customer is required.';
  if (v.lineItems.length === 0) {
    errors.lineItems = 'At least one line item is required.';
  } else {
    for (let i = 0; i < v.lineItems.length; i++) {
      const item = v.lineItems[i];
      if (!item.item_code.trim()) errors.lineItems = `Line ${i + 1}: Item code is required.`;
      if (item.qty <= 0) errors.lineItems = `Line ${i + 1}: Quantity must be positive.`;
      if (item.rate < 0) errors.lineItems = `Line ${i + 1}: Rate cannot be negative.`;
    }
  }
  return errors;
};

const SalesInvoices: React.FC = () => {
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useSalesInvoices();
  const { create, submitInvoice, cancelInvoice, pendingPush } = useRevenueMutations();

  const canView = may('view', 'salesInvoice');
  const canCreate = may('create', 'salesInvoice');
  const canEdit = may('edit', 'salesInvoice');
  const canCancel = may('transition', 'salesInvoice');
  const canRowWrite = canEdit || canCancel;

  const all = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  const [formTarget, setFormTarget] = useState<{ invoice: SalesInvoiceRow | null } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SalesInvoiceRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((inv) => statusFilter === 'All' || inv.status === statusFilter)
      .filter((inv) => !q || inv.si_number?.toLowerCase().includes(q) || inv.reference_number?.toLowerCase().includes(q));
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
          <h2 className="text-heading font-semibold">You don't have access to Sales Invoices</h2>
          <p className="mt-2 text-muted-foreground">
            The sales invoices directory is available to Finance, Project Managers, and Executives.
          </p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  const columns: Column<SalesInvoiceRow>[] = [
    {
      key: 'si_number',
      header: 'Invoice #',
      cell: (inv) => (
        <span className="truncate font-mono text-[13px]" title={inv.si_number ?? ''}>
          {inv.si_number ?? '—'}
        </span>
      ),
      exportValue: (inv) => inv.si_number ?? '',
    },
    {
      key: 'reference_number',
      header: 'Customer PO',
      cell: (inv) => (
        <span className="truncate text-muted-foreground" title={inv.reference_number ?? ''}>
          {inv.reference_number ?? '—'}
        </span>
      ),
      exportValue: (inv) => inv.reference_number ?? '',
    },
    {
      key: 'customer_id',
      header: 'Customer',
      cell: (inv) => (
        <span className="truncate" title={inv.customer_id ?? ''}>
          {inv.customer_id ?? '—'}
        </span>
      ),
      exportValue: (inv) => inv.customer_id ?? '',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (inv) => <StatusPill variant={salesInvoiceStatusVariant(inv.status)}>{inv.status}</StatusPill>,
      exportValue: (inv) => inv.status,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'num',
      cell: (inv) => (
        <span className="tabular text-right font-mono text-[13px]">
          {inv.amount != null ? `$${inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
        </span>
      ),
      exportValue: (inv) => inv.amount?.toString() ?? '',
    },
    {
      key: 'erp_outstanding_amount',
      header: 'Outstanding',
      align: 'num',
      cell: (inv) => (
        <span className="tabular text-right font-mono text-[13px]">
          {inv.erp_outstanding_amount != null
            ? `$${inv.erp_outstanding_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            : '—'}
        </span>
      ),
      exportValue: (inv) => inv.erp_outstanding_amount?.toString() ?? '',
    },
    {
      key: 'invoice_date',
      header: 'Date',
      cell: (inv) => (inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '—'),
      exportValue: (inv) => inv.invoice_date ?? '',
    },
  ];

  const rowMenu = (inv: SalesInvoiceRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit) items.push({ label: 'Edit', onClick: () => setFormTarget({ invoice: inv }) });
    if (canCancel && inv.status !== 'Cancelled')
      items.push({ label: 'Cancel', onClick: () => setCancelTarget(inv), danger: true });
    return items;
  };

  const onCancelConfirm = async () => {
    if (!cancelTarget) return;
    try {
      await cancelInvoice.mutateAsync(cancelTarget.id);
      toast('Invoice cancelled', cancelTarget.si_number ?? cancelTarget.id, 'success');
      setCancelTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <ListPage
      title="Sales Invoices"
      description="Client invoices issued through PMO, mirrored from ERPNext. Outstanding amounts are ERP-sourced."
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ invoice: null })}>
            <Icon name="plus" />
            New Invoice
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
              trackFilterApplied('status', STATUS_FILTERS.length, 'salesInvoices');
            }}
            ariaLabel="Filter by status"
          />
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder="Search invoices…"
            aria-label="Search sales invoices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            searchSurface="sales-invoices-list"
            module="salesInvoices"
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
          title="Couldn't load sales invoices"
          sub="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="doc"
          title="No sales invoices yet"
          sub="Create your first invoice to start billing clients."
          stateId="sales-invoices-empty"
          role={realRole ?? undefined}
          module="salesInvoices"
          action={canCreate ? { label: 'New Invoice', onClick: () => setFormTarget({ invoice: null }) } : undefined}
        />
      )}

      {state === undefined && (
        <DataTable<SalesInvoiceRow>
          rows={filtered}
          columns={columns}
          rowKey={(inv) => inv.id}
          onActivate={(inv) => navigate(`/sales-invoices/${inv.id}`)}
          rowLabel={(inv) => `Open ${inv.si_number ?? inv.id}`}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No invoices match your filters"
          emptySub="Try a different status or clear the search."
        />
      )}

      {/* Create / edit modal */}
      {formTarget && (
        <SalesInvoiceFormModal
          invoice={formTarget.invoice}
          pendingPush={pendingPush}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync({
              customerId: input.customerId,
              projectId: input.projectId,
              items: input.lineItems,
            });
            toast('Invoice created', input.customerId, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            // In a full implementation, we'd have an update mutation
            // For now, just close the modal
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
        title={cancelTarget ? `Cancel ${cancelTarget.si_number ?? cancelTarget.id}?` : 'Cancel invoice?'}
        description="This cancels the invoice in ERPNext (docstatus 1→2). The invoice will be marked Cancelled and can no longer be submitted. Outstanding amount is released."
        confirmLabel="Cancel invoice"
        loading={cancelInvoice.isPending}
        onConfirm={onCancelConfirm}
        onCancel={() => setCancelTarget(null)}
      />
    </ListPage>
  );
};

// ── Create / edit form modal ────────────────────────────────────────────────

interface SalesInvoiceFormModalProps {
  invoice: SalesInvoiceRow | null;
  onClose: () => void;
  onCreate: (input: { customerId: string; projectId: string | null; lineItems: LineItem[] }) => Promise<void>;
  onUpdate: (id: string, input: { customerId: string; projectId: string | null; lineItems: LineItem[] }) => Promise<void>;
  onError: (err: unknown) => void;
  pendingPush: PendingPushState;
}

const SalesInvoiceFormModal: React.FC<SalesInvoiceFormModalProps> = ({
  invoice,
  onClose,
  onCreate,
  onUpdate,
  onError,
  pendingPush,
}) => {
  const isEdit = !!invoice;
  const form = useEntityForm<FormValues>({
    initialValues: {
      customerId: '',
      projectId: null,
      lineItems: [{ item_code: '', qty: 1, rate: 0 }],
    },
    validate,
    idPrefix: 'sales-invoice-form',
    requiredFields: ['customerId', 'lineItems'],
    module: 'salesInvoices',
  });

  const customerField = form.fieldProps('customerId');
  const projectField = form.fieldProps('projectId');

  const errorSummary = form.errors.customerId || form.errors.lineItems
    ? [
        ...(form.errors.customerId ? [{ fieldId: customerField.id, message: form.errors.customerId }] : []),
        ...(form.errors.lineItems ? [{ fieldId: 'line-items', message: form.errors.lineItems }] : []),
      ]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input = { customerId: values.customerId, projectId: values.projectId, lineItems: values.lineItems };
      try {
        if (isEdit && invoice) await onUpdate(invoice.id, input);
        else await onCreate(input);
      } catch (err) {
        onError(err);
      }
    });
  };

  // Line items management
  const [lineItems, setLineItems] = useState<LineItem[]>([{ item_code: '', qty: 1, rate: 0 }]);

  const addLineItem = () => setLineItems([...lineItems, { item_code: '', qty: 1, rate: 0 }]);
  const removeLineItem = (index: number) => setLineItems(lineItems.filter((_, i) => i !== index));
  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) =>
    setLineItems(lineItems.map((item, i) => (i === index ? { ...item, [field]: value } : item)));

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit invoice' : 'New invoice'}
      subtitle={isEdit ? 'Update this sales invoice' : 'Create a new sales invoice for a client'}
      submitLabel={isEdit ? 'Save invoice' : 'Create invoice'}
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
      <FormSection legend="Invoice details">
        <FormGrid>
          <Combobox
            label="Customer"
            required
            value={customerField.value}
            onChange={(value, option) => customerField.onChange(value)}
            error={customerField.error}
            placeholder="Select or search customer…"
            loadOptions={async () => []} // TODO: load from companies list (type=Client)
            noun="customer"
          />
          <Combobox
            label="Project"
            value={projectField.value ?? ''}
            onChange={(value, option) => projectField.onChange(value ?? '')}
            error={projectField.error}
            placeholder="Select project (optional)…"
            loadOptions={async () => []} // TODO: load from projects list
            noun="project"
          />
        </FormGrid>
      </FormSection>

      <FormSection legend="Line items">
        {lineItems.map((item, index) => (
          <div key={index} className="flex flex-col sm:flex-row gap-2 mb-2">
            <TextField
              label="Item code"
              value={item.item_code}
              onChange={(v) => updateLineItem(index, 'item_code', v)}
              required
              placeholder="ITEM-001"
              className="flex-1"
            />
            <NumberField
              label="Qty"
              value={String(item.qty)}
              onChange={(v) => updateLineItem(index, 'qty', Number(v))}
              required
              min={0}
              step={1}
              className="w-24"
            />
            <NumberField
              label="Rate"
              value={String(item.rate)}
              onChange={(v) => updateLineItem(index, 'rate', Number(v))}
              required
              min={0}
              step={0.01}
              prefix="$"
              className="w-32"
            />
            {lineItems.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-end mt-5"
                onClick={() => removeLineItem(index)}
              >
                <Icon name="trash" className="size-4" />
              </Button>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
          <Icon name="plus" className="size-4 mr-1.5" />
          Add line item
        </Button>
      </FormSection>
    </EntityFormModal>
  );
};

export default SalesInvoices;