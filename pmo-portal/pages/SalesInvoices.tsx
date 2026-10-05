import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  EntityFormModal,
  type SubmitError,
  TextField,
  NumberField,
  Combobox,
  FormGrid,
  FormSection,
  Button,
  Icon,
  TaxBasisLabel,
  useToast,
  type Column,
  type ComboboxOption,
  type RowMenuItem,
} from '@/src/components/ui';
import { useNavigate } from 'react-router';
import { ExportButton, withCurrencyColumn } from '@/src/components/export';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useSalesInvoices, useRevenueMutations } from '@/src/hooks/useRevenue';
import { useClientCompanyOptions, useProjectOptions } from '@/src/hooks/useFkOptions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import { currencySymbol, formatCurrencyCents, formatDateOnly, parseMoneyInputAtScale } from '@/src/lib/format';
import type { SalesInvoiceRow, SalesInvoiceStatus } from '@/src/lib/db/revenue';
import { deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { useAuth } from '@/src/auth/useAuth';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useCommandIntent, useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import type { CommandIntent } from '@/src/lib/repositories/types';

/** Status filter segments. */
type StatusFilter = 'All' | SalesInvoiceStatus;
const STATUS_FILTERS: StatusFilter[] = ['All', 'Draft', 'Submitted', 'Unpaid', 'Paid', 'Cancelled'];

function salesInvoiceStatusLabel(status: StatusFilter, t: (key: string, fallback: string) => string): string {
  const labels: Record<StatusFilter, string> = {
    All: t('financeCopy.statusAll', 'All'),
    Draft: t('financeCopy.statusDraft', 'Draft'),
    Submitted: t('financeCopy.statusSubmitted', 'Submitted'),
    Unpaid: t('financeCopy.statusUnpaid', 'Unpaid'),
    Paid: t('financeCopy.statusPaid', 'Paid'),
    Cancelled: t('financeCopy.statusCancelled', 'Cancelled'),
  };
  return labels[status];
}

/** Line item as submitted: numeric, ready for the create command. */
interface LineItem {
  item_code: string;
  qty: number;
  rate: number;
}

/**
 * Line item as edited. The rate is money, so it stays the user's locale-formatted DRAFT until
 * submit (#684) — converting on every keystroke would drop an unfinished decimal separator.
 */
interface LineItemDraft {
  item_code: string;
  qty: number;
  rate: string;
}

interface FormValues {
  customerId: string;
  projectId: string | null;
  lineItems: LineItemDraft[];
}

const EMPTY_LINE: LineItemDraft = { item_code: '', qty: 1, rate: '0' };

/**
 * #684 (AC-PLC-009): the ONE parse of a rate draft, used by `validate` and by the submit. Rates are
 * scale-2 money, so a value that would need rounding is refused rather than silently changed.
 */
const parseRate = (raw: string): number | null => parseMoneyInputAtScale(raw, 2);

const validate = (v: FormValues, t: (key: string, fallback: string, options?: Record<string, unknown>) => string): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.customerId.trim()) errors.customerId = t('financeCopy.customerRequired', 'Customer is required.');
  if (v.lineItems.length === 0) {
    errors.lineItems = t('financeCopy.invoiceLineRequired', 'At least one line item is required.');
  } else {
    for (let i = 0; i < v.lineItems.length; i++) {
      const item = v.lineItems[i];
      const rate = parseRate(item.rate);
      if (!item.item_code.trim()) errors.lineItems = t('financeCopy.invoiceLineItemCodeRequired', 'Line {{line}}: Item code is required.', { line: i + 1 });
      if (item.qty <= 0) errors.lineItems = t('financeCopy.invoiceLineQuantityPositive', 'Line {{line}}: Quantity must be positive.', { line: i + 1 });
      if (rate === null) {
        errors.lineItems = t('financeCopy.invoiceLineRateValid', 'Line {{line}}: Enter a valid rate with no more than 2 decimal places.', { line: i + 1 });
      } else if (rate < 0) errors.lineItems = t('financeCopy.invoiceLineRateNonNegative', 'Line {{line}}: Rate cannot be negative.', { line: i + 1 });
    }
  }
  return errors;
};

const SalesInvoices: React.FC = () => {
  const { t } = useTranslation();
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
  const [submitTarget, setSubmitTarget] = useState<SalesInvoiceRow | null>(null);

  // BLOCK 2 (ADR-0058): the confirm dialogs are ALWAYS mounted, so their command identity cannot be
  // a plain ref — it must be per (record, verb) or a retry on invoice B would carry invoice A's key.
  // Released only after a terminal success (never on error — reusing the key on retry IS the fix).
  const verbIntents = useCommandIntentMap();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((inv) => statusFilter === 'All' || inv.status === statusFilter)
      .filter((inv) => !q
        || inv.si_number?.toLowerCase().includes(q)
        || inv.reference_number?.toLowerCase().includes(q)
        // #781 (AC-FIN-001): the list search also indexes the resolved customer company name.
        || inv.customer_name?.toLowerCase().includes(q));
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
          <h2 className="text-heading font-semibold">{t('financeCopy.youDonTHaveAccessToSalesInvoices', "You don't have access to Sales Invoices")}</h2>
          <p className="mt-2 text-muted-foreground">
            {t('financeCopy.theSalesInvoicesDirectoryIsAvailableToFinanceProjectManagersAndExecutives', "The sales invoices directory is available to Finance, Project Managers, and Executives.")}</p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', "Back to dashboard")}</Button>
        </div>
      </div>
    );
  }

  const columns: Column<SalesInvoiceRow>[] = [
    {
      key: 'si_number',
      header: t('financeCopy.invoice', "Invoice #"),
      cell: (inv) => (
        <span className="truncate font-mono text-[13px]" title={inv.si_number ?? ''}>
          {inv.si_number ?? '—'}
        </span>
      ),
      exportValue: (inv) => inv.si_number ?? '',
    },
    {
      key: 'reference_number',
      header: t('financeCopy.customerPO', "Customer PO"),
      cell: (inv) => (
        <span className="truncate text-muted-foreground" title={inv.reference_number ?? ''}>
          {inv.reference_number ?? '—'}
        </span>
      ),
      exportValue: (inv) => inv.reference_number ?? '',
    },
    {
      key: 'customer_id',
      header: t('financeCopy.customer', "Customer"),
      cell: (inv) => (
        <span className="truncate" title={inv.customer_name ?? ''}>
          {inv.customer_name ?? '—'}
        </span>
      ),
      exportValue: (inv) => inv.customer_name ?? '',
    },
    {
      key: 'status',
      header: t('financeCopy.status', "Status"),
      cell: (inv) => <StatusPill variant={salesInvoiceStatusVariant(inv.status)}>{salesInvoiceStatusLabel(inv.status, t)}</StatusPill>,
      exportValue: (inv) => inv.status,
    },
    {
      key: 'amount',
      header: t('financeCopy.amount', "Amount"),
      align: 'num',
      // OD-TAX-1 §2: `sales_invoices.tax_treatment` is NOT NULL (0188) — the marker exists on every
      // row, so no invoice total may be bare. The basis is the row's own; the org default
      // pre-selects a form and is never read here.
      cell: (inv) => (
        <span className="inline-flex items-baseline justify-end gap-1.5">
          <span className="tabular text-right font-mono text-[13px]">
            {inv.amount != null ? formatCurrencyCents(inv.amount, inv.currency) : '—'}
          </span>
          {inv.amount != null ? <TaxBasisLabel treatment={inv.tax_treatment} taxBaseUnknown={inv.erp_docstatus != null} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} /> : null}
        </span>
      ),
      // A NUMBER, not its string: a text cell is unsummable and locale-fragile (#701).
      exportValue: (inv) => inv.amount ?? '',
    },
    {
      key: 'erp_outstanding_amount',
      header: t('financeCopy.outstanding', "Outstanding"),
      align: 'num',
      cell: (inv) => (
        <span className="tabular text-right font-mono text-[13px]">
          {inv.erp_outstanding_amount != null ? formatCurrencyCents(inv.erp_outstanding_amount, inv.currency) : '—'}
        </span>
      ),
      exportValue: (inv) => inv.erp_outstanding_amount ?? '',
    },
    {
      key: 'invoice_date',
      header: t('financeCopy.date', "Date"),
      cell: (inv) => (inv.invoice_date ? formatDateOnly(inv.invoice_date) : '—'),
      exportValue: (inv) => inv.invoice_date ?? '',
    },
    {
      key: 'due_date',
      header: t('financeCopy.dueDate', "Due Date"),
      cell: (inv) => {
        const due = deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date);
        return due ? formatDateOnly(due) : '—';
      },
      exportValue: (inv) => deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date) ?? '',
    },
  ];

  // AC-L10N-052: the download carries each row's own ISO code beside amount (export-only).
  const exportColumns = withCurrencyColumn(columns, 'amount', (r) => r.currency);

  const rowMenu = (inv: SalesInvoiceRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit) items.push({ label: t('financeCopy.edit', "Edit"), onClick: () => setFormTarget({ invoice: inv }) });
    if (canCancel && inv.status !== 'Cancelled')
      items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(inv), danger: true });
    // Submit action: only for DRAFT status, gated by submit_sales_invoice permission with record
    // context (SoD). The oracle is the APPEND-ONLY author SET (`sales_invoice_authors`, migration
    // 0113) union the legacy scalar — the same one `submit_sales_invoice` enforces. Passing only the
    // last-writer-wins scalar showed an EARLIER body writer an enabled "Submit" that 403'd on click
    // (round-6 re-audit NIT 1). `can()` also fails closed on an unattributable invoice, so the
    // separate author-not-null guard is no longer needed here.
    if (
      inv.status === 'Draft'
      && may('submit_sales_invoice', 'salesInvoice', {
        currentUserId: currentUser?.id,
        record: { author_id: inv.author_user_id, author_ids: inv.author_user_ids },
      })
    ) {
      items.push({ label: t('financeCopy.submit', "Submit"), onClick: () => setSubmitTarget(inv) });
    }
    return items;
  };

  const onCancelConfirm = async () => {
    if (!cancelTarget) return;
    const key = `cancel:${cancelTarget.id}`;
    try {
      await cancelInvoice.mutateAsync({ siId: cancelTarget.id, intent: verbIntents.intentFor(key) });
      verbIntents.release(key);
      toast(t('financeCopy.invoiceCancelled', 'Invoice cancelled'), cancelTarget.si_number ?? cancelTarget.id, 'success');
      setCancelTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onSubmitConfirm = async () => {
    if (!submitTarget) return;
    const key = `submit:${submitTarget.id}`;
    try {
      await submitInvoice.mutateAsync({ siId: submitTarget.id, intent: verbIntents.intentFor(key) });
      verbIntents.release(key);
      toast(t('financeCopy.invoiceSubmitted', 'Invoice submitted'), submitTarget.si_number ?? submitTarget.id, 'success');
      setSubmitTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <ListPage
      title={t('financeCopy.salesInvoices', "Sales Invoices")}
      description={t('financeCopy.clientInvoicesIssuedThroughPMOMirroredFromERPNextOutstandingAmountsAreERPSourced', "Client invoices issued through PMO, mirrored from ERPNext. Outstanding amounts are ERP-sourced.")}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ invoice: null })}>
            <Icon name="plus" />
            {t('financeCopy.newInvoice', "New Invoice")}</Button>
        )
      }
      filters={
        state !== 'loading' && (
          <div
            role="region"
            aria-label={t('financeCopy.filterByStatus', "Filter by status")}
            tabIndex={0}
            className="min-w-0 max-w-full overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ViewToggle<StatusFilter>
              options={STATUS_FILTERS.map((f) => ({ value: f, label: salesInvoiceStatusLabel(f, t) }))}
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                trackFilterApplied('status', STATUS_FILTERS.length, 'salesInvoices');
              }}
              ariaLabel={t('financeCopy.filterByStatus', "Filter by status")}
            />
          </div>
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('financeCopy.searchInvoices', "Search invoices…")}
            aria-label={t('financeCopy.searchSalesInvoices', "Search sales invoices")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            searchSurface="sales-invoices-list"
            module="salesInvoices"
            resultCount={filtered.length}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
      exportAction={
        state !== 'loading' && (
          <ExportButton rows={filtered} columns={exportColumns} entity="Sales Invoices" />
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
          title={t('financeCopy.salesInvoicesLoadFailed', "Couldn't load sales invoices")}
          sub={t('financeCopy.theRequestFailedCheckYourConnectionAndTryAgain', "The request failed. Check your connection and try again.")}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="doc"
          title={t('financeCopy.noSalesInvoicesYet', "No sales invoices yet")}
          sub={t('financeCopy.createYourFirstInvoiceToStartBillingClients', "Create your first invoice to start billing clients.")}
          stateId="sales-invoices-empty"
          role={realRole ?? undefined}
          module="salesInvoices"
          action={canCreate ? { label: t('financeCopy.newInvoice', "New Invoice"), onClick: () => setFormTarget({ invoice: null }) } : undefined}
        />
      )}

      {state === undefined && (
        <DataTable<SalesInvoiceRow>
          rows={filtered}
          columns={columns}
          rowKey={(inv) => inv.id}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={t('financeCopy.noInvoicesMatchYourFilters', "No invoices match your filters")}
          emptySub={t('financeCopy.tryADifferentStatusOrClearTheSearch', "Try a different status or clear the search.")}
        />
      )}

      {/* Create / edit modal */}
      {formTarget && (
        <SalesInvoiceFormModal
          invoice={formTarget.invoice}
          pendingPush={pendingPush}
          onClose={() => setFormTarget(null)}
          onCreate={async (input, intent) => {
            await create.mutateAsync({
              customerId: input.customerId,
              projectId: input.projectId,
              items: input.lineItems,
              intent,
            });
            toast(t('financeCopy.invoiceCreated', 'Invoice created'), input.customerId, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (_id, _input) => {
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
        title={cancelTarget ? t('financeCopy.cancelInvoiceNamed', 'Cancel {{invoice}}?', { invoice: cancelTarget.si_number ?? cancelTarget.id }) : t('financeCopy.cancelInvoiceQuestion', 'Cancel invoice?')}
        description={t('financeCopy.thisCancelsTheInvoiceInERPNextDocstatus12TheInvoiceWillBeMarkedCancelledAndCanNoLongerBeSubmittedOutstandingAmountIsReleased', "This cancels the invoice in ERPNext (docstatus 1→2). The invoice will be marked Cancelled and can no longer be submitted. Outstanding amount is released.")}
        confirmLabel={t('financeCopy.cancelInvoice', "Cancel invoice")}
        loading={cancelInvoice.isPending}
        onConfirm={onCancelConfirm}
        onCancel={() => setCancelTarget(null)}
      />

      {/* Submit confirm (default tone — primary action) */}
      <ConfirmDialog
        open={!!submitTarget}
        title={submitTarget ? t('financeCopy.submitInvoiceNamed', 'Submit {{invoice}}?', { invoice: submitTarget.si_number ?? submitTarget.id }) : t('financeCopy.submitInvoiceQuestion', 'Submit invoice?')}
        description={t('financeCopy.submitInvoiceForApprovalThisCommitsItToTheLedgerAndCannotBeUndoneByTheSubmitter', "Submit invoice for approval? This commits it to the ledger and cannot be undone by the submitter.")}
        confirmLabel={t('financeCopy.submitInvoice', "Submit invoice")}
        loading={submitInvoice.isPending}
        onConfirm={onSubmitConfirm}
        onCancel={() => setSubmitTarget(null)}
      />
    </ListPage>
  );
};

// ── Create / edit form modal ────────────────────────────────────────────────

interface SalesInvoiceFormModalProps {
  invoice: SalesInvoiceRow | null;
  onClose: () => void;
  /** `intent` is the modal's OWN command identity — stable for this form session (BLOCK 2). */
  onCreate: (
    input: { customerId: string; projectId: string | null; lineItems: LineItem[] },
    intent: CommandIntent,
  ) => Promise<void>;
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
  const { t } = useTranslation();
  const isEdit = !!invoice;
  // The adornment follows the record's own currency when editing one; a create form has no record
  // yet, so it falls back to the org's operating currency (#731). The hook is called unconditionally.
  const orgCurrency = useOrgCurrency();
  const moneyPrefix = currencySymbol(invoice?.currency ?? orgCurrency);
  // BLOCK 2 (ADR-0058): ONE command identity per form session. This modal is mounted only while the
  // form is open (`{formTarget && …}`), so its mount IS the session: every retry of a failed submit
  // reuses this identity (the ERP doc a lost response already committed gets reconciled, not
  // duplicated), and a success closes the modal → the next "New Invoice" mints a fresh one.
  const intent = useCommandIntent();
  const form = useEntityForm<FormValues>({
    initialValues: {
      customerId: '',
      projectId: null,
      lineItems: [EMPTY_LINE],
    },
    validate: (values) => validate(values, t),
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

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const lineItems: LineItem[] = [];
      for (const item of values.lineItems) {
        const rate = parseRate(item.rate);
        // Unreachable after `validate`, which applies the same parse.
        if (rate === null) return;
        lineItems.push({ item_code: item.item_code, qty: item.qty, rate });
      }
      const input = { customerId: values.customerId, projectId: values.projectId, lineItems };
      try {
        if (isEdit && invoice) await onUpdate(invoice.id, input);
        else await onCreate(input, intent);
      } catch (err) {
        // `suppressCapture` only: the page's own `onError` classifies this same rejection for the
        // toast and owns the single `save_failed` event (ADR-0067).
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  // FK options come from the cached hooks ("hooks own data fetching"); the Combobox loader just
  // hands back the already-fetched list (no re-fetch on popover open).
  const { data: customerOptions } = useClientCompanyOptions();
  const { data: projectOptions } = useProjectOptions();
  const loadCustomers = useCallback(async (): Promise<ComboboxOption[]> => customerOptions ?? [], [customerOptions]);
  const loadProjects = useCallback(async (): Promise<ComboboxOption[]> => projectOptions ?? [], [projectOptions]);

  // Line items live IN the form (BLOCK 1b): a detached useState meant the VALIDATED values and the
  // SUBMITTED values were different objects — the user's typed lines were dropped and an invoice
  // worth $0 would have posted for someone who typed $25,000.
  const lineItems = form.values.lineItems;
  const addLineItem = () => form.setValue('lineItems', [...lineItems, EMPTY_LINE]);
  const removeLineItem = (index: number) =>
    form.setValue('lineItems', lineItems.filter((_, i) => i !== index));
  const updateLineItem = (index: number, field: keyof LineItemDraft, value: string | number) =>
    form.setValue('lineItems', lineItems.map((item, i) => (i === index ? { ...item, [field]: value } : item)));

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit invoice' : 'New invoice'}
      subtitle={isEdit ? 'Update this sales invoice' : 'Create a new sales invoice for a client'}
      submitLabel={isEdit ? 'Save invoice' : 'Create invoice'}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      {pendingPush.status !== 'idle' && (
        <div className="mb-3.5 flex justify-end">
          <span className="text-xs text-muted-foreground">{t('financeCopy.pushingToERPNext', "Pushing to ERPNext…")}</span>
        </div>
      )}
      <FormSection legend="Invoice details">
        <FormGrid>
          <Combobox
            label={t('financeCopy.customer', "Customer")}
            required
            value={customerField.value}
            onChange={(value, _option) => customerField.onChange(value)}
            error={customerField.error}
            placeholder={t('financeCopy.selectOrSearchCustomer', "Select or search customer…")}
            loadOptions={loadCustomers}
            noun="customer"
          />
          <Combobox
            label={t('financeCopy.project', "Project")}
            value={projectField.value ?? ''}
            onChange={(value, _option) => projectField.onChange(value ?? '')}
            error={projectField.error}
            placeholder={t('financeCopy.selectProjectOptional', "Select project (optional)…")}
            loadOptions={loadProjects}
            noun="project"
          />
        </FormGrid>
      </FormSection>

      <FormSection legend="Line items">
        {lineItems.map((item, index) => (
          <div key={index} className="flex flex-col sm:flex-row gap-2 mb-2">
            <TextField
              label={t('financeCopy.itemCode', "Item code")}
              value={item.item_code}
              onChange={(v) => updateLineItem(index, 'item_code', v)}
              required
              placeholder={t('financeCopy.iTEM001', "ITEM-001")}
              className="flex-1"
            />
            <NumberField
              label={t('financeCopy.qty', "Qty")}
              value={String(item.qty)}
              onChange={(v) => updateLineItem(index, 'qty', Number(v))}
              required
              min={0}
              step={1}
              className="w-24"
            />
            <NumberField
              label={t('financeCopy.rate', "Rate")}
              value={item.rate}
              onChange={(v) => updateLineItem(index, 'rate', v)}
              localeAware
              required
              min={0}
              step={0.01}
              prefix={moneyPrefix}
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
          {t('financeCopy.addLineItem', "Add line item")}</Button>
      </FormSection>
    </EntityFormModal>
  );
};

export default SalesInvoices;
