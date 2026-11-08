/** Where a ledger figure comes from and how far to trust it (FR-ODA-030/031/040/050): freshness, reconciliation to Odoo, and what is not in any category or project. */
import { useTranslation } from 'react-i18next';
import { StatusPill, type StatusVariant } from '@/src/components/ui';
import { formatDate, formatRelativeTime } from '@/src/lib/format';
import type { OdooAmountGroup, OdooLedgerCheck, OdooLedgerState, OdooUnmappedGroup } from '@/src/lib/db/odooLedger';
import { formatLedgerAmount, netDebit } from './ledgerFormat';

export interface LedgerProvenanceProps {
  state: OdooLedgerState;
  asOf: string | null;
  /** `undefined`: this role does not see the reconciliation. `null`: no check has run yet. */
  check?: OdooLedgerCheck | null;
  unmapped?: OdooUnmappedGroup | null;
  unattributed?: OdooAmountGroup | null;
  unlinked?: OdooAmountGroup | null;
  /** Currency code the amounts are in; printed as "Amounts in X" above the figures. */
  currency?: string;
  className?: string;
}

const FRESHNESS: Record<OdooLedgerState, StatusVariant> = { fresh: 'won', stale: 'warn', 'catching-up': 'progress', unavailable: 'lost' };

/** Debits and credits side by side: income credits must not net against costs into one signed figure. */
function Remainder({ group, text }: { group: OdooAmountGroup | null | undefined; text: (debit: string, credit: string, count: number) => string }) {
  if (!group || group.count === 0) return null;
  return <li>{text(formatLedgerAmount(group.debit), formatLedgerAmount(group.credit), group.count)}</li>;
}

export function LedgerProvenance({ state, asOf, check, unmapped, unattributed, unlinked, currency, className }: LedgerProvenanceProps) {
  const { t } = useTranslation('finance');
  const freshness: Record<OdooLedgerState, string> = {
    fresh: t('odooLedger.state.fresh', 'Up to date'),
    stale: t('odooLedger.state.stale', 'Not updated for over 30 minutes'),
    'catching-up': t('odooLedger.state.catchingUp', 'Still reading Odoo history'),
    unavailable: t('odooLedger.state.unavailable', 'Odoo not reachable, showing the last data'),
  };
  let reconciliation: { variant: StatusVariant; label: string } | null = null;
  if (check !== undefined) {
    if (check === null || check.status === 'not-checked') reconciliation = { variant: 'neutral', label: t('odooLedger.check.notChecked', 'Not checked against Odoo') };
    else if (check.stale) reconciliation = { variant: 'warn', label: t('odooLedger.check.outOfDate', 'Check is out of date') };
    else if (check.status === 'matches') reconciliation = { variant: 'won', label: t('odooLedger.check.matches', 'Matches Odoo') };
    else reconciliation = { variant: 'lost', label: t('odooLedger.check.differs', 'Differs from Odoo') };
  }
  const hasRemainder = Boolean((unmapped && unmapped.count > 0) || (unattributed && unattributed.count > 0) || (unlinked && unlinked.count > 0));
  return (
    <section className={className} aria-label={t('odooLedger.provenance.aria', 'Where these figures come from')} data-testid="ledger-provenance">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <StatusPill variant={FRESHNESS[state]}>{freshness[state]}</StatusPill>
        <span className="text-muted-foreground">
          {asOf ? t('odooLedger.provenance.asOf', 'Odoo ledger as of {{time}}', { time: `${formatDate(asOf)} · ${formatRelativeTime(asOf)}` }) : t('odooLedger.provenance.noData', 'Nothing read from the Odoo ledger yet')}
        </span>
        {reconciliation && <StatusPill variant={reconciliation.variant}>{reconciliation.label}</StatusPill>}
        {check && check.checkedAt && check.status !== 'not-checked' && (
          <span className="text-muted-foreground">{t('odooLedger.check.checkedAt', 'Checked {{time}}', { time: formatRelativeTime(check.checkedAt) })}</span>
        )}
      </div>
      {currency && (hasRemainder || (check?.status === 'differs' && !check.stale && check.accounts.length > 0)) && (
        <p className="mt-2 text-sm text-muted-foreground">{t('odooLedger.amountsIn', 'Amounts in {{currency}}', { currency })}</p>
      )}
      {check && check.status === 'differs' && !check.stale && check.accounts.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-foreground" aria-label={t('odooLedger.check.differsAria', 'Accounts that differ from Odoo')}>
          {check.accounts.map((a) => (
            <li key={a.account}>
              {t('odooLedger.check.account', 'Account {{account}}: PMO {{pmo}}, Odoo {{odoo}}', {
                account: a.account,
                pmo: formatLedgerAmount(netDebit(a.pmo.debit, a.pmo.credit)),
                odoo: formatLedgerAmount(netDebit(a.odoo.debit, a.odoo.credit)),
              })}
            </li>
          ))}
        </ul>
      )}
      {hasRemainder && (
        <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground" aria-label={t('odooLedger.remainder.aria', 'Amounts not counted in a category or project')}>
          <Remainder group={unmapped} text={(debit, credit, count) => t('odooLedger.remainder.unmapped', 'Accounts without a budget category ({{accounts}}): debits {{debit}}, credits {{credit}} ({{count}} lines). Not counted in any category.', { debit, credit, count, accounts: (unmapped?.accounts ?? []).join(', ') || '—' })} />
          <Remainder group={unattributed} text={(debit, credit, count) => t('odooLedger.remainder.unattributed', 'Belong to no project: debits {{debit}}, credits {{credit}} ({{count}} lines).', { debit, credit, count })} />
          <Remainder group={unlinked} text={(debit, credit, count) => t('odooLedger.remainder.unlinked', 'In cost accounts no project is linked to: debits {{debit}}, credits {{credit}} ({{count}} lines).', { debit, credit, count })} />
        </ul>
      )}
    </section>
  );
}
