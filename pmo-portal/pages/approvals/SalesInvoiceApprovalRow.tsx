import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApprovalRow, Button, Icon, ProjectNameLink, TaxBasisLabel } from '@/src/components/ui';
import { useInvoiceProjectOptions } from '@/src/hooks/useFkOptions';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { formatCurrencyCents } from '@/src/lib/format';
import { invoiceGross, nativeInvoiceSummary } from '@/src/lib/revenue/nativeInvoice';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground';

/**
 * I-1 (#784, FR-NAR-006): what the approver reads before approving a PMO draft — project, customer, customer PO, who
 * raised it, every line, and net / tax / total due. Display only; migration 0275 fixed every figure at creation.
 */
export const SalesInvoiceApprovalPreview: React.FC<{ inv: SalesInvoiceRow }> = ({ inv }) => {
  const { t } = useTranslation();
  const { data: projects } = useInvoiceProjectOptions();
  const { data: profiles } = useAssignableProfiles();
  const projectName = useMemo(() => projects?.find((p) => p.value === inv.project_id)?.label ?? null, [projects, inv.project_id]);
  const authorName = useMemo(() => profiles?.find((p) => p.id === inv.author_user_id)?.full_name ?? null, [profiles, inv.author_user_id]);
  const money = (n: number | null) => (n != null ? formatCurrencyCents(n, inv.currency) : '—');
  const lines = inv.native_lines ?? [];

  const facts: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('financeCopy.project', 'Project'), value: <ProjectNameLink projectId={inv.project_id} name={projectName} className="text-[13px]" /> },
    { label: t('financeCopy.customer', 'Customer'), value: inv.customer_name ?? '—' },
    { label: t('financeCopy.customerPO', 'Customer PO'), value: inv.reference_number ?? '—' },
    { label: t('approvals.salesInvoices.raisedBy', 'Raised by'), value: authorName ?? '—' },
  ];

  return (
    <div className="space-y-3">
      <dl className="grid gap-2 sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0 rounded-lg border border-border/70 px-3 py-2">
            <dt className={EYEBROW}>{f.label}</dt>
            <dd className="mt-1 truncate text-[13px] font-medium">{f.value}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h3 className={`mb-2 ${EYEBROW}`}>{t('financeCopy.lineItemsSection', 'Line items')}</h3>
        <ul className="space-y-1.5" aria-label={t('financeCopy.lineItemsSection', 'Line items')}>
          {lines.map((line, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-border/70 px-3 py-2 text-[13px]">
              {/* The line text wraps rather than truncates: the approver must read every word of what is billed. */}
              <span className="min-w-[12rem] flex-1 break-words">
                <span className="block">{line.description ?? line.item_code ?? '—'}</span>
                {line.description && line.item_code && (
                  <span className="block font-mono text-[12px] text-muted-foreground">{line.item_code}</span>
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

      <dl className="space-y-1 text-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{t('approvals.salesInvoices.net', 'Net (before tax)')}</dt>
          <dd className="tabular">{money(inv.amount)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{t('approvals.salesInvoices.tax', 'Tax')}</dt>
          <dd className="flex flex-wrap items-baseline justify-end gap-x-1.5 tabular">
            <TaxBasisLabel treatment={inv.tax_treatment} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} />
            <span>{money(inv.tax_amount)}</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1 font-semibold">
          <dt>{t('approvals.salesInvoices.gross', 'Total due')}</dt>
          <dd className="tabular">{money(invoiceGross(inv))}</dd>
        </div>
      </dl>
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
      <span className="min-w-0 truncate">{nativeInvoiceSummary(inv) ?? '—'}</span>
      <span className="inline-flex items-baseline gap-1.5">
        <span className="tabular font-medium text-foreground">{inv.amount != null ? formatCurrencyCents(inv.amount, inv.currency) : '—'}</span>
        <TaxBasisLabel treatment={inv.tax_treatment} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} />
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
            <Button variant="primary" size="sm" onClick={() => onApprove(inv)}>
              <Icon name="check" />
              {t('financeCopy.approve', 'Approve')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
