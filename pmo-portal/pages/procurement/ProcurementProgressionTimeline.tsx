/** Render a procurement progression event as one row in the combined Activity list. */
import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { ProgressionEvent } from '@/src/lib/db/procurementHistory';
import { formatDateOnly, formatInstantDate } from '@/src/lib/format';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function formatEventTime(iso: string): string {
  return DATE_ONLY.test(iso) ? formatDateOnly(iso) : formatInstantDate(iso);
}

const DOCUMENT_KEYS: Record<string, string> = {
  GR: 'receipt',
  PR: 'purchaseRequest',
  RFQ: 'rfq',
  Quote: 'quote',
  PO: 'purchaseOrder',
  Receipt: 'receipt',
  Invoice: 'invoice',
  Payment: 'payment',
};

const STAGE_KEYS: Record<string, string> = {
  Draft: 'draft',
  Requested: 'requested',
  Approved: 'approved',
  'Vendor Quoted': 'vendorQuoted',
  'Quote Selected': 'quoteSelected',
  Ordered: 'ordered',
  Received: 'received',
  'Vendor Invoiced': 'vendorInvoiced',
  Paid: 'paid',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
};

const ENGLISH_DOCUMENTS: Record<string, string> = {
  GR: 'Goods receipt', PR: 'Purchase request', RFQ: 'Request for quotes', Quote: 'Quote', PO: 'Purchase order',
  Receipt: 'Goods receipt', Invoice: 'Vendor invoice', Payment: 'Payment',
};

const ENGLISH_STAGES: Record<string, string> = {
  Draft: 'Draft', Requested: 'Requested', Approved: 'Approved', 'Vendor Quoted': 'Vendor quoted',
  'Quote Selected': 'Quote selected', Ordered: 'Ordered', Received: 'Received',
  'Vendor Invoiced': 'Vendor invoiced', Paid: 'Paid', Rejected: 'Rejected', Cancelled: 'Cancelled',
};

export const ProcurementProgressionEvent: React.FC<{ event: ProgressionEvent }> = ({ event }) => {
  const { t } = useTranslation(['common', 'procurement']);
  const documentKey = DOCUMENT_KEYS[event.label];
  const stageKey = STAGE_KEYS[event.label];
  const label = event.kind === 'record'
    ? documentKey
      ? t(`procurement:activity.document.${documentKey}`, ENGLISH_DOCUMENTS[event.label] ?? event.label)
      : event.label
    : stageKey
      ? t(`procurement:activity.stage.${stageKey}`, ENGLISH_STAGES[event.label] ?? event.label)
      : event.label;
  const actor = event.actorName ?? (event.actor
    ? t('history.unknownUser', 'Unknown user')
    : t('history.system', 'System'));

  return (
    <li data-testid="procurement-activity-event" className="min-w-0 border-b border-border py-3 last:border-b-0">
      <p className="break-words text-sm font-semibold text-foreground">
        {label}
        {event.docRef && event.docHref && (
          <>
            {' · '}
            <Link
              to={event.docHref}
              className="inline-flex min-h-11 items-center break-all font-mono text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {event.docRef}
            </Link>
          </>
        )}
      </p>
      <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
        <span>{actor}</span>
        <time dateTime={event.at}>{formatEventTime(event.at)}</time>
      </div>
    </li>
  );
};

ProcurementProgressionEvent.displayName = 'ProcurementProgressionEvent';
