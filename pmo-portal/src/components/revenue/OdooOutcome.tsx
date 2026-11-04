/** Plain-language state of an Odoo invoice, including when PMO last read it and what happens next. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill, type StatusVariant } from '@/src/components/ui';
import { formatRelativeTime } from '@/src/lib/format';
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

export const OdooOutcome: React.FC<{ outcome: Outcome; unreachable?: boolean; compact?: boolean }> = ({ outcome, unreachable = false, compact = false }) => {
  const { t } = useTranslation();
  const sent = outcome.cls === 'pending' || outcome.cls === 'held' || outcome.cls === 'refused';
  const age = outcome.asOf ? formatRelativeTime(outcome.asOf) : null;
  return (
    <div data-testid="odoo-outcome" data-outcome={outcome.cls} className="min-w-0 space-y-1">
      {unreachable && (
        <p data-testid="odoo-unreachable" role="status" className="text-[12px] text-muted-foreground">
          {t('finance:odooOutcome.unreachable', 'Odoo cannot be reached. Showing the last data PMO read{{age}}.', { age: age ? `, ${age}` : '' })}
        </p>
      )}
      <StatusPill variant={VARIANT[outcome.cls]} wrap>{t(`finance:odooOutcome.${outcome.cls}`, LABEL[outcome.cls])}</StatusPill>
      {age && <p className="text-[12px] text-muted-foreground">{t(sent ? 'finance:odooOutcome.sent' : 'finance:odooOutcome.read', sent ? 'Sent {{age}}' : 'Read {{age}}', { age })}</p>}
      {!compact && NEXT[outcome.cls] && (
        <p data-testid="odoo-outcome-next" className="max-w-[65ch] text-[12px] text-muted-foreground">
          {t(`finance:odooOutcome.next.${outcome.cls}`, NEXT[outcome.cls]!)}
        </p>
      )}
    </div>
  );
};
