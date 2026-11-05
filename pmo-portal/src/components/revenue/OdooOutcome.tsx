/** Plain-language state of an Odoo invoice, including when PMO last read it and what happens next. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill, type StatusVariant } from '@/src/components/ui';
import { formatCurrencyCents, formatRelativeTime } from '@/src/lib/format';
import type { OdooOutcome as Outcome, OdooOutcomeClass } from '@/src/lib/procurement/odooOutcome';

const VARIANT: Record<OdooOutcomeClass, StatusVariant> = {
  confirmed: 'won', pending: 'progress', held: 'warn', 'needs-attention': 'warn', refused: 'lost',
};
const LABEL: Record<OdooOutcomeClass, string> = {
  confirmed: 'In Odoo', pending: 'Sent, waiting for Odoo', held: 'Needs a decision',
  'needs-attention': 'Check in Odoo', refused: 'Odoo did not accept it',
};
const NEXT: Partial<Record<OdooOutcomeClass, string>> = {
  pending: 'Odoo has not confirmed it yet. PMO checks again by itself; there is nothing to do.',
  held: 'PMO cannot tell whether Odoo already made it. An Admin or Finance user checks Odoo and decides.',
  'needs-attention': 'Check the invoice in Odoo before you continue.',
  refused: 'Check what you entered, then record it again.',
};

/** Why Odoo's copy needs a look, keyed by the code the read-back records. An unknown code shows no reason rather than the code. */
const REASON: Record<string, string> = {
  'total-mismatch': 'The total in Odoo is not what PMO sent.',
  'cost-account-missing': 'A posted line has no cost account for the project.',
  'money-unreadable': 'PMO could not read the amounts from Odoo.',
  'lines-unreadable': 'PMO could not read the invoice lines from Odoo.',
  'advance-account-mismatch': 'A customer advance was posted to a different account than the one chosen in setup.',
};

export const OdooOutcome: React.FC<{ outcome: Outcome; unreachable?: boolean; compact?: boolean; sentTotal?: { amount: number; currency: string } | null }> = ({ outcome, unreachable = false, compact = false, sentTotal = null }) => {
  const { t } = useTranslation();
  const sent = outcome.cls === 'pending' || outcome.cls === 'held' || outcome.cls === 'refused';
  const age = outcome.asOf ? formatRelativeTime(outcome.asOf) : null;
  return (
    <div data-testid="odoo-outcome" data-outcome={outcome.cls} className="min-w-0 space-y-1">
      {unreachable && !compact && (
        <p data-testid="odoo-unreachable" role="status" className="text-[12px] text-muted-foreground">
          {t('finance:odooOutcome.unreachable', 'Odoo cannot be reached. Showing the last data PMO read{{age}}.', { age: age ? `, ${age}` : '' })}
        </p>
      )}
      <StatusPill variant={VARIANT[outcome.cls]} wrap>{t(`finance:odooOutcome.${outcome.cls}`, LABEL[outcome.cls])}</StatusPill>
      {age && <p className="text-[12px] text-muted-foreground">{t(sent ? 'finance:odooOutcome.sent' : 'finance:odooOutcome.read', sent ? 'Sent {{age}}' : 'Read {{age}}', { age })}</p>}
      {!compact && outcome.cls === 'needs-attention' && outcome.reason && REASON[outcome.reason] && (
        <p data-testid="odoo-outcome-reason" className="max-w-[65ch] text-[12px] text-foreground">
          {t(`finance:odooOutcome.reason.${outcome.reason}`, REASON[outcome.reason])}
          {outcome.reason === 'total-mismatch' && sentTotal && ` ${t('finance:odooOutcome.sentTotal', 'PMO sent {{amount}}.', { amount: formatCurrencyCents(sentTotal.amount, sentTotal.currency) })}`}
        </p>
      )}
      {!compact && NEXT[outcome.cls] && (
        <p data-testid="odoo-outcome-next" className="max-w-[65ch] text-[12px] text-muted-foreground">
          {t(`finance:odooOutcome.next.${outcome.cls}`, NEXT[outcome.cls]!)}
        </p>
      )}
    </div>
  );
};
