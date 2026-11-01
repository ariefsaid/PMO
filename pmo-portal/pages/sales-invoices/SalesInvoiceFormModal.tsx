import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Combobox, EntityFormModal, FormGrid, FormSection, Icon, NumberField, SelectField, TextField, type ComboboxOption, type SubmitError } from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useClientCompanyOptions, useInvoiceProjectOptions } from '@/src/hooks/useFkOptions';
import { useCommandIntent } from '@/src/hooks/useCommandIntent';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { DEFAULT_BILLING_KIND, type BillingKind } from '@/src/lib/billingKind';
import { currencySymbol, formatCurrencyCents } from '@/src/lib/format';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import type { CommandIntent } from '@/src/lib/repositories/types';
import { previewInvoiceDraft } from '@/src/lib/revenue/nativeInvoice';
import { nativeRevenueDetails, nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { EMPTY_LINE, isValidQuantity, needsVatRate, parseQuantity, parseRate, validate, type FormValues, type LineItem, type LineItemDraft } from './invoiceDraftValidation';

// ── Create / edit form modal ────────────────────────────────────────────────

interface SalesInvoiceFormModalProps {
  initialContext?: { projectId: string; customerId: string };
  onClose: () => void;
  /** `intent` is the modal's OWN command identity — stable for this form session (BLOCK 2). */
  onCreate: (
    input: { customerId: string; projectId: string | null; lineItems: LineItem[]; billingKind?: BillingKind },
    intent: CommandIntent,
  ) => Promise<void>;
  pendingPush: PendingPushState;
  /** #784: true while PMO owns revenue — the project is required and lines carry a description. */
  native: boolean;
}

export const SalesInvoiceFormModal: React.FC<SalesInvoiceFormModalProps> = ({
  initialContext,
  onClose,
  onCreate,
  pendingPush,
  native,
}) => {
  const { t } = useTranslation();
  // The hook is called unconditionally. Unscoped creation keeps the org default; native project
  // entry follows the selected authorized project's source currency, and unknown stays explicit.
  const orgCurrency = useOrgCurrency();
  const erpItems = useErpItemOptions('sales');
  // BLOCK 2 (ADR-0058): ONE command identity per form session. This modal is mounted only while the
  // form is open (`{formTarget && …}`), so its mount IS the session: every retry of a failed submit
  // reuses this identity (the ERP doc a lost response already committed gets reconciled, not
  // duplicated), and a success closes the modal → the next "New Invoice" mints a fresh one.
  const intent = useCommandIntent();
  // Reuse the cached option hooks.
  // Unresolved or failed reads are retried by the picker loader.
  const customerQuery = useClientCompanyOptions();
  const projectQuery = useInvoiceProjectOptions();
  const { data: customerOptions, isError: customerOptionsError, refetch: refetchCustomers } = customerQuery;
  const { data: projectOptions, isError: projectOptionsError, refetch: refetchProjects } = projectQuery;
  // Query error transitions must not replace a picker loader: Combobox reloads when its
  // source changes, and refetch itself moves the query through pending and error.
  const customerErrorRef = useRef(customerOptionsError);
  const projectErrorRef = useRef(projectOptionsError);
  useLayoutEffect(() => {
    customerErrorRef.current = customerOptionsError;
    projectErrorRef.current = projectOptionsError;
  }, [customerOptionsError, projectOptionsError]);
  const projectOptionsById = useMemo(() => new Map((projectOptions ?? []).map((p) => [p.value, p])), [projectOptions]);
  const projectById = useCallback((id: string | null) => projectOptionsById.get(id ?? ''), [projectOptionsById]);
  const form = useEntityForm<FormValues>({
    initialValues: {
      customerId: initialContext?.customerId ?? '',
      projectId: initialContext?.projectId ?? null,
      billingKind: DEFAULT_BILLING_KIND,
      lineItems: [EMPTY_LINE],
    },
    validate: (values) => validate(values, t, native, projectById(values.projectId), erpItems.connected),
    idPrefix: 'sales-invoice-form',
    requiredFields: native ? ['customerId', 'projectId', 'lineItems'] : ['customerId', 'lineItems'],
    module: 'salesInvoices',
  });

  const customerField = form.fieldProps('customerId');
  const projectField = form.fieldProps('projectId');
  const selectedProject = projectField.value ? projectById(projectField.value) : undefined;
  const selectedProjectCurrency = selectedProject?.currency?.trim() || undefined;
  const taxBaseNumerator = selectedProject?.taxBaseNumerator;
  const taxBaseDenominator = selectedProject?.taxBaseDenominator;
  const hasKnownTaxBaseFraction =
    typeof taxBaseNumerator === 'number' && Number.isInteger(taxBaseNumerator) && taxBaseNumerator > 0 &&
    typeof taxBaseDenominator === 'number' && Number.isInteger(taxBaseDenominator) &&
    taxBaseDenominator >= taxBaseNumerator && taxBaseDenominator <= 2_147_483_647;
  const moneyCurrency = (native && projectField.value ? selectedProjectCurrency : orgCurrency);
  const moneyPrefix = moneyCurrency ? currencySymbol(moneyCurrency) : undefined;
  const projectCurrencyUnavailable = native && Boolean(projectField.value) && !selectedProjectCurrency;
  // I-2: the project's page is where its contract value and VAT rate are recorded.
  const vatRateLink = (projectId: string | null) => projectId ? (
    <Link to={`/projects/${projectId}`} className="font-medium text-primary-text underline underline-offset-2">
      {t('financeCopy.recordVatRateOnProject', 'Record the VAT rate on the project')}
    </Link>
  ) : null;
  const vatMissing = native && needsVatRate(projectById(projectField.value));
  const draftTaxFacts = native && selectedProject
    ? selectedProject.subjectToVat
      ? selectedProject.taxRate != null && Number.isFinite(selectedProject.taxRate) && selectedProject.taxRate > 0 && hasKnownTaxBaseFraction
        ? {
            treatment: 'exclusive' as const,
            rate: selectedProject.taxRate,
            fraction: { numerator: taxBaseNumerator!, denominator: taxBaseDenominator! },
          }
        : null
      : { treatment: 'exclusive' as const, rate: 0, fraction: { numerator: 1, denominator: 1 } }
    : null;
  const draftReviewCurrencyCandidate = native
    ? selectedProjectCurrency
    : orgCurrency;
  const draftReviewCurrency = typeof draftReviewCurrencyCandidate === 'string' && /^[A-Z]{3}$/.test(draftReviewCurrencyCandidate)
    ? draftReviewCurrencyCandidate
    : null;

  const errorSummary = form.errors.customerId || form.errors.projectId || form.errors.lineItems
    ? [
        ...(form.errors.customerId ? [{ fieldId: customerField.id, message: form.errors.customerId }] : []),
        ...(form.errors.projectId ? [{ fieldId: projectField.id, message: form.errors.projectId }] : []),
        ...(form.errors.lineItems ? [{ fieldId: (() => {
          const requiresItemCode = !native || erpItems.connected;
          const first = form.values.lineItems.findIndex((item) => (requiresItemCode ? !item.item_code.trim() : !item.item_code.trim() && !item.description?.trim()) || !isValidQuantity(item.qty) || parseRate(item.rate) === null || parseRate(item.rate)! < 0);
          const index = Math.max(first, 0);
          const item = form.values.lineItems[index];
          return item && (parseRate(item.rate) === null || parseRate(item.rate)! < 0)
            ? `sales-invoice-line-${index}-rate`
            : item && !isValidQuantity(item.qty)
              ? `sales-invoice-line-${index}-qty`
              : native && !erpItems.connected && !item?.item_code.trim() && !item?.description?.trim()
                ? `sales-invoice-line-${index}-description`
                : `sales-invoice-line-${index}-item`;
        })(), message: form.errors.lineItems }] : []),
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
        const qty = parseQuantity(item.qty);
        const rate = parseRate(item.rate);
        // Unreachable after `validate`, which applies the same parse.
        if (qty === null || !isValidQuantity(item.qty) || rate === null) return;
        lineItems.push({ item_code: item.item_code, qty, rate, ...(item.description?.trim() ? { description: item.description.trim() } : {}) });
      }
      const input = { customerId: values.customerId, projectId: values.projectId, lineItems, ...(values.projectId ? { billingKind: values.billingKind } : {}) };
      try {
        await onCreate(input, intent);
      } catch (err) {
        // I-2: a rejected save is shown ONCE — here, persistently, in the dialog (#559) — not also as a toast. This
        // is therefore the one `save_failed` capture point for the form (ADR-0067).
        const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t), { module: 'sales', detailOverrides: nativeRevenueDetails(t) });
        const code = (err as { code?: unknown } | null)?.code;
        setSaveError({ headline, detail, ...(code === 'vat-rate-missing' ? { action: vatRateLink(values.projectId) } : {}) });
      }
    });
  };

  const loadCustomers = useCallback(async (): Promise<ComboboxOption[]> => {
    if (customerOptions && !customerErrorRef.current) return customerOptions;
    const result = await refetchCustomers();
    if (result.error || !result.data) throw result.error ?? new Error('Customer options unavailable');
    return result.data;
  }, [customerOptions, refetchCustomers]);
  // M-1: a live project of the chosen customer — the loader changes with the customer, so the picker re-loads.
  const selectedCustomerId = customerField.value;
  const loadProjects = useCallback(
    async (): Promise<ComboboxOption[]> => {
      let options = projectOptions;
      if (!options || projectErrorRef.current) {
        const result = await refetchProjects();
        if (result.error || !result.data) throw result.error ?? new Error('Project options unavailable');
        options = result.data;
      }
      return (options ?? []).filter((p) => !p.archived && (!selectedCustomerId || p.clientId === selectedCustomerId));
    },
    [projectOptions, refetchProjects, selectedCustomerId],
  );

  // Line items live IN the form (BLOCK 1b): a detached useState meant the VALIDATED values and the
  // SUBMITTED values were different objects — the user's typed lines were dropped and an invoice
  // worth $0 would have posted for someone who typed $25,000.
  const lineItems = form.values.lineItems;
  const addLineItem = () => form.setValue('lineItems', [...lineItems, EMPTY_LINE]);
  const removeLineItem = (index: number) =>
    form.setValue('lineItems', lineItems.filter((_, i) => i !== index));
  const updateLineItem = (index: number, field: keyof LineItemDraft, value: string | number) =>
    form.setValue('lineItems', lineItems.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  const draftPreview = previewInvoiceDraft(
    lineItems.map((item) => {
      const parsedRate = parseRate(item.rate);
      const parsedQty = parseQuantity(item.qty);
      const requiresItemCode = !native || erpItems.connected;
      const hasLineIdentity = requiresItemCode
        ? Boolean(item.item_code.trim())
        : Boolean(item.item_code.trim() || item.description?.trim());
      return { qty: parsedQty ?? Number.NaN, rate: parsedRate !== null && hasLineIdentity ? parsedRate : Number.NaN };
    }),
    native ? draftTaxFacts : null,
  );

  return (
    <EntityFormModal
      open
      title={t('financeCopy.newInvoiceTitle', 'New invoice')}
      subtitle={native
        ? t('financeCopy.nativeNewInvoiceSubtitle', 'Raises a draft. A different Finance or Admin user approves it.')
        : t('financeCopy.newInvoiceSubtitle', 'Create a new sales invoice for a client')}
      submitLabel={t('financeCopy.createInvoice', 'Create invoice')}
      cancelLabel={t('financeCopy.cancel', 'Cancel')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      {!native && pendingPush.status !== 'idle' && (
        <div className="mb-3.5 flex justify-end">
          <span className="text-xs text-muted-foreground">{t('financeCopy.pushingToERPNext', "Pushing to ERPNext…")}</span>
        </div>
      )}
      <FormSection legend={t('financeCopy.invoiceDetails', 'Invoice details')}>
        <FormGrid>
          <Combobox
            id={customerField.id}
            label={t('financeCopy.customer', "Customer")}
            required
            value={customerField.value}
            selectedOption={customerOptions?.find((option) => option.value === customerField.value) ?? null}
            onChange={(value, _option) => {
              // M-1: a project of another customer cannot stay picked once the customer changes.
              const project = projectById(projectField.value);
              if (project && value && project.clientId !== value) form.setValues({ customerId: value, projectId: null });
              else customerField.onChange(value);
            }}
            error={customerField.error}
            placeholder={t('financeCopy.selectOrSearchCustomer', "Select or search customer…")}
            loadOptions={loadCustomers}
            noun="customer"
          />
          <Combobox
            id={projectField.id}
            label={t('financeCopy.project', "Project")}
            required={native}
            value={projectField.value ?? ''}
            selectedOption={projectById(projectField.value) ?? null}
            onChange={(value, _option) => projectField.onChange(value ?? '')}
            // I-2: shown the moment a VAT project with no rate is picked, with the way to fix it.
            error={vatMissing ? (
              <>
                {t('financeCopy.vatRateMissingInline', 'This project has no VAT rate recorded, so it cannot be invoiced yet.')}{' '}
                {vatRateLink(projectField.value)}
              </>
            ) : projectField.error}
            placeholder={native ? t('financeCopy.nativeSelectProject', 'Select project…') : t('financeCopy.selectProjectOptional', "Select project (optional)…")}
            loadOptions={loadProjects}
            noun="project"
          />
          {projectField.value && (
            <SelectField
              id={form.fieldProps('billingKind').id}
              label={t('finance:billingKind.label', 'Billing kind')}
              value={form.values.billingKind}
              disabled={form.isSubmitting}
              options={[
                { value: 'contract', label: t('finance:billingKind.contract', 'Contract billing') },
                { value: 'other', label: t('finance:billingKind.other', 'Other billing') },
              ]}
              helper={form.values.billingKind === 'contract'
                ? t('finance:billingKind.contractHelp', 'Counts against the contract: reduces Remaining to invoice, and counts toward revenue and margin.')
                : t('finance:billingKind.otherHelp', 'Licences, reimbursables and work outside the contract: counts toward revenue and margin, never reduces Remaining to invoice.')}
              onChange={(value) => form.setValue('billingKind', value as BillingKind)}
            />
          )}
        </FormGrid>
      </FormSection>

      <FormSection legend={t('financeCopy.lineItemsSection', 'Line items')}>
        {lineItems.map((item, index) => (
          <div key={index} className="flex flex-col sm:flex-row gap-2 mb-2">
            <div className="min-w-0 flex-1 space-y-2">
              {native && (
                <TextField
                  id={`sales-invoice-line-${index}-description`}
                  label={t('financeCopy.description', 'Description')}
                  value={item.description ?? ''}
                  onChange={(value) => updateLineItem(index, 'description', value)}
                  maxLength={140}
                  placeholder={t('financeCopy.describeWorkOrGoods', 'Describe the work or goods…')}
                />
              )}
              {erpItems.connected ? (
                <Combobox
                  id={`sales-invoice-line-${index}-item`}
                  label={t('financeCopy.erpItem', 'ERP item')}
                  value={item.item_code || null}
                  selectedOption={item.item_code ? { value: item.item_code, label: item.item_code } : null}
                  onChange={(code) => updateLineItem(index, 'item_code', code)}
                  loadOptions={erpItems.loadOptions}
                  required
                  noun={t('financeCopy.erpItem', 'ERP item')}
                  placeholder={t('financeCopy.selectOrSearchItem', 'Select or search item…')}
                  searchPlaceholder={t('financeCopy.searchItemCodeOrName', 'Search item code or name…')}
                />
              ) : (
                <TextField
                  id={`sales-invoice-line-${index}-item`}
                  label={t('financeCopy.itemCode', "Item code")}
                  value={item.item_code}
                  onChange={(v) => updateLineItem(index, 'item_code', v)}
                  // FR-NAR-002 (I-3): a PMO line needs an item code OR a description.
                  required={!native}
                  maxLength={native ? 140 : undefined}
                  placeholder={t('financeCopy.iTEM001', "ITEM-001")}
                  className="flex-1"
                />
              )}
              {!native && erpItems.connected && (
                <TextField
                  id={`sales-invoice-line-${index}-description`}
                  label={t('financeCopy.description', 'Description')}
                  value={item.description ?? ''}
                  onChange={(value) => updateLineItem(index, 'description', value)}
                  maxLength={native ? 140 : undefined}
                  placeholder={t('financeCopy.describeWorkOrGoods', 'Describe the work or goods…')}
                />
              )}
            </div>
            <NumberField
              id={`sales-invoice-line-${index}-qty`}
              label={t('financeCopy.qty', "Qty")}
              value={item.qty}
              onChange={(v) => updateLineItem(index, 'qty', v)}
              required
              min={0}
              step={0.001}
              localeAware
              className="w-full sm:w-24"
            />
            <NumberField
              id={`sales-invoice-line-${index}-rate`}
              label={t('financeCopy.rate', "Rate")}
              value={item.rate}
              onChange={(v) => updateLineItem(index, 'rate', v)}
              localeAware
              required
              min={0}
              step={0.01}
              prefix={moneyPrefix}
              helper={projectCurrencyUnavailable ? t('uxs15.currencyUnavailable', 'Project currency unavailable.') : undefined}
              className="w-full sm:w-32"
            />
            {lineItems.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-end mt-5"
                onClick={() => removeLineItem(index)}
                aria-label={t('financeCopy.removeLine', 'Remove line {{line}}', { line: index + 1 })}
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

      {(draftReviewCurrency || !native || selectedProject) && (
      <section
        className="mt-4 border-t border-border pt-4"
        aria-label={t('uxs16.invoiceDraftReview', 'Invoice draft review')}
      >
        <h3 className="text-sm font-semibold">
          {t('uxs16.invoiceDraftReview', 'Invoice draft review')}
          {draftReviewCurrency && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">{draftReviewCurrency}</span>
          )}
        </h3>
        {!draftReviewCurrency ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t('uxs16.currencyUnavailable', 'Currency is unavailable, so draft totals cannot be displayed.')}
          </p>
        ) : (
          <>
            <dl className="mt-3 grid gap-2.5 text-sm">
              <div className="flex min-w-0 items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{t('uxs16.subtotal', 'Subtotal')}</dt>
                <dd className="shrink-0 text-right tabular-nums">
                  {draftPreview.subtotal === null ? '—' : formatCurrencyCents(draftPreview.subtotal, draftReviewCurrency)}
                </dd>
              </div>
              {native && (
              <>
              <div className="flex min-w-0 items-baseline justify-between gap-4">
                <dt className="min-w-0 text-muted-foreground">
                  <span>{t('uxs16.tax', 'Tax')}</span>
                </dt>
                <dd className="shrink-0 text-right tabular-nums">
                  {draftPreview.tax === null ? '—' : formatCurrencyCents(draftPreview.tax, draftReviewCurrency)}
                </dd>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-4 border-t border-border pt-2 font-semibold">
                <dt>{t('uxs16.total', 'Total')}</dt>
                <dd className="shrink-0 text-right tabular-nums">
                  {draftPreview.total === null ? '—' : formatCurrencyCents(draftPreview.total, draftReviewCurrency)}
                </dd>
              </div>
              </>
              )}
            </dl>
            {draftPreview.reason === 'invalid-lines' && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('uxs16.completeLinesForReview', 'Enter valid line details, quantities, and rates to review totals.')}
              </p>
            )}
            {native && draftPreview.reason === 'tax-unavailable' && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('uxs16.projectTaxUnavailable', 'Project tax details are unavailable, so tax and final total cannot be previewed yet.')}{' '}
                {selectedProject && (
                  <Link to={`/projects/${selectedProject.value}`} className="font-medium text-primary-text underline underline-offset-2">
                    {t('uxs16.reviewProjectTax', 'Review project tax settings')}
                  </Link>
                )}
              </p>
            )}
          </>
        )}
      </section>
      )}
    </EntityFormModal>
  );
};
