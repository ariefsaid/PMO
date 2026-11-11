/** FR-OPP-090 (AC-OPP-080): the plain-words Odoo state of one purchase record, the age of the last read, and the next step. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill, type StatusVariant } from '@/src/components/ui';
import { formatRelativeTime } from '@/src/lib/format';
import { matchRefusalReasonKey, type OdooOutcome as Outcome, type OdooOutcomeClass } from '@/src/lib/procurement/odooOutcome';

const VARIANT: Record<OdooOutcomeClass, StatusVariant> = { confirmed: 'won', pending: 'progress', held: 'warn', 'needs-attention': 'warn', refused: 'lost' };
const LABEL_KEY: Record<OdooOutcomeClass, string> = { confirmed: 'confirmed', pending: 'pending', held: 'held', 'needs-attention': 'attention', refused: 'refused' };
const LABEL: Record<OdooOutcomeClass, string> = {
  confirmed: 'In Odoo', pending: 'Sent, waiting for Odoo', held: 'Needs a decision', 'needs-attention': 'Check in Odoo', refused: 'Odoo did not accept it',
};
const NEXT: Partial<Record<OdooOutcomeClass, string>> = {
  pending: 'Odoo has not confirmed it yet. PMO checks again by itself; there is nothing to do.',
  held: 'PMO cannot tell whether Odoo already made it. An Admin or Finance user checks Odoo and decides.',
  'needs-attention': 'Odoo shows a different total than PMO sent. Check the bill in Odoo before paying it.',
  refused: 'Check what you entered, then record it again.',
};

const DEFAULT_REASON: Record<string, string> = {
  revision_superseded: 'A newer revision already exists for this purchase order.',
  po_has_submitted_bill: 'This purchase order has a submitted bill in the ERP.',
  revision_not_issued: 'This purchase order revision has not been issued yet.',
  po_not_found: 'The purchase order could not be found.',
  'below-received': 'Quantity cannot be reduced below the quantity already received or billed.',
};

/** `quiet`: a settled record in a dense table reads as one muted line, not a second pill (the attention classes always keep theirs). */
export const OdooOutcome: React.FC<{ outcome: Outcome; quiet?: boolean }> = ({ outcome, quiet = false }) => {
  const { t } = useTranslation('procurement');
  const { cls, asOf } = outcome;
  const reasonKey = matchRefusalReasonKey(outcome.reason);
  const approval = cls === 'pending' && outcome.reason === 'awaiting-approval';
  const next = approval ? 'An approver in Odoo has to approve the order. Nothing to do in PMO.' : NEXT[cls];
  const nextKey = approval ? 'approval' : LABEL_KEY[cls];
  // A mirror read has an age of its own; a command that is still in flight only has the time it was sent.
  const sent = (cls === 'pending' && !approval) || cls === 'held' || cls === 'refused';
  if (quiet && cls === 'confirmed') {
    return (
      <span data-testid="odoo-outcome" data-outcome={cls} className="text-sm text-muted-foreground">
        {t('odoo.outcome.confirmed', LABEL.confirmed)}{asOf ? ` · ${t('odoo.outcome.read', 'Read {{age}}', { age: formatRelativeTime(asOf) })}` : ''}
      </span>
    );
  }
  return (
    <span data-testid="odoo-outcome" data-outcome={cls} className="inline-flex max-w-full flex-col items-start gap-0.5">
      <StatusPill variant={VARIANT[cls]} wrap>
        {approval ? t('odoo.outcome.approval', 'Waiting for approval in Odoo') : t(`odoo.outcome.${LABEL_KEY[cls]}`, LABEL[cls])}
      </StatusPill>
      {asOf && (
        <span className="text-sm text-muted-foreground">
          {sent ? t('odoo.outcome.sent', 'Sent {{age}}', { age: formatRelativeTime(asOf) }) : t('odoo.outcome.read', 'Read {{age}}', { age: formatRelativeTime(asOf) })}
        </span>
      )}
      {reasonKey && (
        <span data-testid="odoo-outcome-reason" className="text-sm text-foreground">
          {t(`odoo.outcome.reason.${reasonKey}`, DEFAULT_REASON[reasonKey])}
        </span>
      )}
      {next && <span data-testid="odoo-outcome-next" className="text-sm text-muted-foreground">{t(`odoo.outcome.next.${nextKey}`, next)}</span>}
    </span>
  );
};
