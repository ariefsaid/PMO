import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Drawer,
  Icon,
  MenuButton,
  StatusPill,
  TaxBasisLabel,
  type RowMenuItem,
  type StatusVariant,
} from '@/src/components/ui';
import { formatCurrency, formatDateOnly } from '@/src/lib/format';
import { deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
import { invoiceNumber } from '@/src/lib/revenue/nativeInvoice';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProfileRow } from '@/src/lib/db/profiles';
import InvoiceStatusTimeline from './InvoiceStatusTimeline';
import { SalesInvoiceEvidenceSection } from './SalesInvoiceEvidence';

/** The receivables embedded slide-over: one invoice's figures, timeline, evidence and row actions. */
const SalesInvoicePanelDrawer: React.FC<{
  panelInvoice: SalesInvoiceRow | null;
  panelPayments: IncomingPaymentRow[];
  profileRows: ProfileRow[];
  panelPrimary: { label: string; onClick: () => void } | null;
  invoiceStatus: (inv: SalesInvoiceRow) => { label: string; variant: StatusVariant };
  projectLabelOf: (inv: SalesInvoiceRow) => string | null | undefined;
  rowMenu: (inv: SalesInvoiceRow) => RowMenuItem[];
  odoo: boolean;
  onClose: () => void;
  onOpenFullInvoice: () => void;
  nestedOpen: boolean;
  loading: boolean;
}> = ({
  panelInvoice,
  panelPayments,
  profileRows,
  panelPrimary,
  invoiceStatus,
  projectLabelOf,
  rowMenu,
  odoo,
  onClose,
  onOpenFullInvoice,
  nestedOpen,
  loading,
}) => {
  const { t } = useTranslation();
  return (
    <Drawer
      open={Boolean(panelInvoice)}
      // N5: the title names the client; the amount lives in the figures below, so the title never wraps on money.
      title={panelInvoice ? panelInvoice.customer_name ?? t('finance:receivables.clientUnavailable', 'Client not recorded') : ''}
      subtitle={panelInvoice ? <span className="flex flex-wrap items-center gap-2">
        {invoiceNumber(panelInvoice) && <span className="font-mono text-xs">{invoiceNumber(panelInvoice)}</span>}
        {projectLabelOf(panelInvoice) && <span className="text-xs">{projectLabelOf(panelInvoice)}</span>}
      </span> : undefined}
      icon={<Icon name="doc" />}
      status={panelInvoice ? <StatusPill variant={invoiceStatus(panelInvoice).variant}>{invoiceStatus(panelInvoice).label}</StatusPill> : undefined}
      headerActions={panelInvoice ? <>
        {panelPrimary && <Button type="button" variant="primary" size="sm" onClick={panelPrimary.onClick}>{panelPrimary.label}</Button>}
        <Button type="button" variant="outline" size="sm" onClick={onOpenFullInvoice}>{t('finance:receivables.openFullRecord', 'Open full page')}</Button>
        <MenuButton items={rowMenu(panelInvoice)} ariaLabel={t('finance:receivables.rowActions', 'Invoice actions')} />
      </> : undefined}
      onClose={onClose}
      width="lg"
      loading={loading}
      nestedOpen={nestedOpen}
    >
      {panelInvoice && <div className="space-y-5 p-4 sm:p-5">
        {(() => {
          // C4: a field with nothing recorded is left out; an unknown open balance is said once, never shown as a dash.
          const due = deriveArDueDate(panelInvoice.invoice_date, panelInvoice.erp_payment_terms_days, panelInvoice.erp_due_date, panelInvoice.received_date);
          const outstandingUnknown = panelInvoice.erp_outstanding_amount == null && (panelInvoice.status === 'Unpaid' || panelInvoice.status === 'Submitted');
          const field = (key: string, label: string, value: React.ReactNode) => <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1">{value}</dd></div>;
          return <div className="border-b border-border pb-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {panelInvoice.amount != null && field('amount', t('finance:receivables.amount', 'Amount'), <span className="flex flex-wrap items-baseline gap-x-1.5"><span className="tabular font-semibold">{formatCurrency(panelInvoice.amount, panelInvoice.currency)}</span><TaxBasisLabel treatment={panelInvoice.tax_treatment} showDetails taxRate={panelInvoice.tax_rate} taxBaseNumerator={panelInvoice.tax_base_numerator} taxBaseDenominator={panelInvoice.tax_base_denominator} /></span>)}
              {panelInvoice.erp_outstanding_amount != null && field('outstanding', t('finance:receivables.outstanding', 'Outstanding · tax included'), <span className="tabular">{formatCurrency(panelInvoice.erp_outstanding_amount, panelInvoice.currency)}</span>)}
              {due && field('due', t('finance:receivables.dueDate', 'Due date'), formatDateOnly(due))}
              {panelInvoice.invoice_date && field('invoiceDate', t('finance:receivables.invoiceDate', 'Invoice date'), formatDateOnly(panelInvoice.invoice_date))}
              {panelInvoice.erp_payment_terms_days != null && field('terms', t('finance:receivables.paymentTerms', 'Terms'), t('finance:receivables.paymentTermsDays', '{{count}} days', { count: panelInvoice.erp_payment_terms_days }))}
              {panelInvoice.efaktur_number && field('efaktur', t('finance:receivables.eFaktur', 'e-Faktur'), `${panelInvoice.efaktur_number}${panelInvoice.efaktur_date ? ` · ${formatDateOnly(panelInvoice.efaktur_date)}` : ''}`)}
            </dl>
            {outstandingUnknown && <p className="mt-3 text-xs text-muted-foreground">{t('finance:receivables.outstandingUnknown', 'The outstanding balance is not known yet: the accounting system has not reported it for this invoice.')}</p>}
          </div>;
        })()}
        <InvoiceStatusTimeline invoice={panelInvoice} payments={panelPayments} profiles={profileRows} />
        <SalesInvoiceEvidenceSection invoice={panelInvoice} odoo={odoo} />
      </div>}
    </Drawer>
  );
};

export default SalesInvoicePanelDrawer;
