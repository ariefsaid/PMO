import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApprovalRow, Button, Icon, ProjectNameLink, TaxBasisLabel } from '@/src/components/ui';
import { useInvoiceProjectOptions } from '@/src/hooks/useFkOptions';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { formatCurrencyCents, formatNumber } from '@/src/lib/format';
import FxEquivalent from '@/src/components/fx/FxEquivalent';
import { invoiceGross, invoiceNet, nativeInvoiceSummary } from '@/src/lib/revenue/nativeInvoice';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const EYEBROW = 'type-metadata uppercase text-muted-foreground';

/**
 * I-1 (#784, FR-NAR-006): what the approver reads before approving a PMO draft — project, customer, customer PO, who
 * raised it, every line, and net / tax / total due. Display only; migration 0275 fixed every figure at creation.
 */
export const SalesInvoiceApprovalPreview: React.FC<{
  inv: SalesInvoiceRow;
  showFx?: boolean;
  showIdentity?: boolean;
  showLineItems?: boolean;
  showTotals?: boolean;
  readableWholeUnits?: boolean;
}> = ({ inv, showFx = false, showIdentity = true, showLineItems = true, showTotals = true, readableWholeUnits = false }) => {
  const { t } = useTranslation();
  const { data: projects } = useInvoiceProjectOptions();
  const { data: profiles } = useAssignableProfiles();
  const projectName = useMemo(() => projects?.find((p) => p.value === inv.project_id)?.contractualName ?? null, [projects, inv.project_id]);
  const authorName = useMemo(() => profiles?.find((p) => p.id === inv.author_user_id)?.full_name ?? null, [profiles, inv.author_user_id]);
  const money = (n: number | null) => (n != null
    ? readableWholeUnits ? formatNumber(n) : formatCurrencyCents(n, inv.currency)
    : '—');
  const net = invoiceNet(inv);
  const lines = inv.native_lines ?? [];

  const facts: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('financeCopy.project', 'Project'), value: <ProjectNameLink projectId={inv.project_id} name={projectName} className="text-sm" /> },
    // The record page (showFx) already headlines the customer; the approval card still names it.
    ...(showFx ? [] : [{ label: t('financeCopy.customer', 'Customer'), value: inv.customer_name ?? '—' }]),
    ...(inv.pmo_native || inv.reference_number ? [{ label: t('financeCopy.customerPO', 'Customer PO'), value: inv.reference_number ?? '—' }] : []),
    ...(inv.pmo_native ? [{ label: t('approvals.salesInvoices.raisedBy', 'Raised by'), value: authorName ?? '—' }] : []),
  ];

  return (
    <div className="space-y-3">
      {showIdentity && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0 border-b border-border/70 pb-2">
              <dt className="type-label text-muted-foreground">{f.label}</dt>
              <dd title={f.label === t('financeCopy.project', 'Project') ? projectName ?? undefined : undefined} className="type-value mt-1 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {showLineItems && inv.pmo_native && (
        <section>
          <h3 className={readableWholeUnits ? 'mb-2 type-section-head text-heading' : `mb-2 ${EYEBROW}`}>
            {readableWholeUnits
              ? t('moneyIn:financeCopy.invoiceLinesCurrency', 'Line items · {{currency}}', { currency: inv.currency })
              : t('financeCopy.lineItemsSection', 'Line items')}
          </h3>
          <ul className="space-y-1.5" aria-label={t('financeCopy.lineItemsSection', 'Line items')}>
            {lines.map((line, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-border/70 px-3 py-2 text-sm">
                {/* The line text wraps rather than truncates: the approver must read every word of what is billed. */}
                <span className="min-w-[12rem] flex-1 break-words">
                  <span className="block">{line.description ?? line.item_code ?? '—'}</span>
                  {line.description && line.item_code && (
                    <span className="block font-mono type-metadata text-muted-foreground">{line.item_code}</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 tabular text-muted-foreground">
                  {line.qty} × {money(line.rate)} ={' '}
                  <span className="font-medium text-foreground">{money(line.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {showLineItems && !inv.pmo_native && !showFx && (
        <p className="type-value text-muted-foreground">
          {t('financeCopy.erpLineItemsStoredInErpNext', 'Line items are kept in ERPNext for this invoice.')}
        </p>
      )}

      {showTotals && <section aria-label={t('moneyIn:financeCopy.invoiceTotals', 'Invoice totals')} className="max-w-xl">
        {readableWholeUnits && <h3 className="mb-2 type-section-head text-heading">{t('moneyIn:financeCopy.invoiceTotalsCurrency', 'Invoice totals · {{currency}}', { currency: inv.currency })} · <TaxBasisLabel treatment={inv.tax_treatment} showDetails={false} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} /></h3>}
        <dl className="space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{t('approvals.salesInvoices.net', 'Net (before tax)')}</dt>
          <dd className="tabular">
            {money(net)}
            {showFx && <FxEquivalent amount={net} currency={inv.currency} date={inv.invoice_date} />}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{t('approvals.salesInvoices.tax', 'Tax')}</dt>
          <dd className="flex flex-wrap items-baseline justify-end gap-x-1.5 tabular">
            {!readableWholeUnits && <TaxBasisLabel treatment={inv.tax_treatment} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} showDetails={false} />}
            <span>{money(inv.tax_amount)}</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1 font-semibold">
          <dt>{t('approvals.salesInvoices.gross', 'Total due')}</dt>
          <dd className="tabular">
            {money(invoiceGross(inv))}
            {showFx && <FxEquivalent amount={invoiceGross(inv)} currency={inv.currency} date={inv.invoice_date} />}
          </dd>
        </div>
        </dl>
      </section>}
    </div>
  );
};

/**
 * One PMO draft awaiting the viewer: the collapsed row reads customer, first line and amount; the disclosure opens the
 * full invoice with Approve at its foot, so an invoice is never approved unseen (I-1). Mirrors `ProcurementApprovalRow`.
 */
export const SalesInvoiceApprovalRow: React.FC<{ inv: SalesInvoiceRow; onApprove: (inv: SalesInvoiceRow) => void }> = ({ inv, onApprove }) => {
  const { t } = useTranslation();
  const panelId = `si-approval-panel-${useId()}`;
  const [expanded, setExpanded] = useState(false);
  const customer = inv.customer_name ?? '—';

  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className="min-w-0 break-words">{nativeInvoiceSummary(inv) ?? '—'}</span>
      <span className="inline-flex items-baseline gap-1.5">
        <span className="tabular font-medium text-foreground">{inv.amount != null ? formatCurrencyCents(inv.amount, inv.currency) : '—'}</span>
        <TaxBasisLabel
          treatment={inv.tax_treatment}
          taxRate={inv.tax_rate}
          taxBaseNumerator={inv.tax_base_numerator}
          taxBaseDenominator={inv.tax_base_denominator}
          taxBaseUnknown={inv.erp_docstatus != null}
          detailsMode="disclosure"
        />
      </span>
    </span>
  );

  return (
    <>
      <ApprovalRow
        name={customer}
        subtitle={subtitle}
        onActivate={() => setExpanded((v) => !v)}
        disclosure={
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={t('approvals.salesInvoices.showDetails', 'Show invoice details for {{customer}}', { customer })}
            onClick={() => setExpanded((v) => !v)}
            className={expanded ? '[&_svg]:rotate-90 [&_svg]:transition-transform' : '[&_svg]:transition-transform'}
          >
            <Icon name="chev" />
          </Button>
        }
        className="border-b-0 px-4"
      />
      {expanded && (
        <div id={panelId} className="mx-3.5 mb-3 rounded-lg border border-border bg-secondary/20 p-3">
          <SalesInvoiceApprovalPreview inv={inv} />
          <div className="mt-3 flex justify-end">
            <Button variant="primary" size="sm" className="min-h-11" onClick={() => onApprove(inv)}>
              <Icon name="check" />
              {t('financeCopy.approve', 'Approve')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
