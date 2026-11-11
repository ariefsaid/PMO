/**
 * #1505 P8 (FR-OPP-093): the bill's taxes and the payment's journal, chosen from PMO's mirror of Odoo's directories. Disabled with
 * a plain reason when the directory is empty or was last read more than a day ago, so a pick is never made from nothing or from a
 * list nobody has refreshed. Ceiling: one page of 100 taxes (a company has far fewer purchase taxes); search arrives if that bites.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/src/components/ui';
import { useMasterRecords, useMasterSummary } from '@/src/hooks/useOdoo';
import { formatRelativeTime } from '@/src/lib/format';
import type { MirrorKind, MasterRecord } from '@/src/lib/repositories/types';

const STALE_AFTER_MS = 24 * 3_600_000;

function useDirectory(kind: MirrorKind, purpose?: 'purchase', pageSize = 100) {
  const records = useMasterRecords({ kind, purpose, page: 1, pageSize });
  const summary = useMasterSummary(kind);
  const rows: MasterRecord[] = (records.data?.rows ?? []) as MasterRecord[];
  const asOf = summary.data?.asOf ?? null;
  const age = asOf === null ? Number.NaN : Date.parse(asOf);
  const stale = !Number.isFinite(age) || Date.now() - age > STALE_AFTER_MS;
  const state: 'loading' | 'empty' | 'stale' | 'ready' = records.data === undefined && !records.isError ? 'loading' : rows.length === 0 ? 'empty' : stale ? 'stale' : 'ready';
  return { rows, asOf, state };
}

export const OdooTaxPicker: React.FC<{ value: string[]; onChange: (ids: string[]) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation('procurement');
  const { rows, asOf, state } = useDirectory('tax', 'purchase');
  const disabled = state !== 'ready';
  const reason = state === 'empty' ? t('odoo.taxes.emptyReason', 'No taxes have been read from Odoo yet.')
    : state === 'stale' ? t('odoo.taxes.staleReason', 'The tax list was last read {{age}}; refresh the Odoo connection first.', { age: formatRelativeTime(asOf) }) : null;
  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0" aria-describedby={reason ? 'odoo-tax-reason' : undefined}>
      <legend className="mb-1 text-sm font-semibold text-muted-foreground">{t('odoo.taxes.label', 'Taxes')}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <label key={r.external_id} className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[hsl(var(--primary))]"
              checked={value.includes(r.external_id)}
              onChange={() => onChange(value.includes(r.external_id) ? value.filter((v) => v !== r.external_id) : [...value, r.external_id])}
            />
            {r.name}
          </label>
        ))}
      </div>
      <p id={reason ? 'odoo-tax-reason' : undefined} className="mt-1 text-sm text-muted-foreground">
        {reason ?? t('odoo.taxes.defaultHint', "Leave all unticked to use your organisation's default taxes.")}
      </p>
    </fieldset>
  );
};

export const OdooJournalSelect: React.FC<{ value: string; onChange: (id: string) => void; id?: string; label?: string }> = ({ value, onChange, id = 'odoo-payment-journal', label }) => {
  const { t } = useTranslation('procurement');
  const { rows, asOf, state } = useDirectory('journal');
  // Only a bank or cash journal can pay a bill; the database re-checks (set_odoo_payment_journal_default / the payment body).
  const payable = rows.filter((r) => ['bank', 'cash'].includes(String((r.attrs as { type?: unknown }).type)));
  const disabled = state !== 'ready' || payable.length === 0;
  const reason = state === 'stale' ? t('odoo.journal.staleReason', 'The journal list was last read {{age}}; refresh the Odoo connection first.', { age: formatRelativeTime(asOf) })
    : state === 'empty' || (state === 'ready' && payable.length === 0) ? t('odoo.journal.emptyReason', 'No payment journals have been read from Odoo yet.') : undefined;
  return (
    <SelectField
      id={id}
      label={label ?? t('odoo.journal.label', 'Pay from')}
      value={value}
      onChange={onChange}
      disabled={disabled}
      helper={reason}
      options={[{ value: '', label: t('odoo.journal.default', 'Default journal') }, ...payable.map((r) => ({ value: r.external_id, label: r.name }))]}
    />
  );
};

/** Selects an Odoo account from the mirrored directory; unavailable or old data cannot be chosen. */
// ponytail: one page of 500 accounts covers a normal chart of accounts; a searchable picker replaces this when a company's chart is larger.
export const OdooAccountSelect: React.FC<{ value: string; onChange: (id: string) => void; id: string; label: string; hideLabel?: boolean }> = ({ value, onChange, id, label, hideLabel }) => {
  const { t } = useTranslation('procurement');
  const { rows, asOf, state } = useDirectory('account', undefined, 500);
  const disabled = state !== 'ready';
  const reason = state === 'empty' ? t('odoo.accounts.emptyReason', 'No accounts have been read from Odoo yet.')
    : state === 'stale' ? t('odoo.accounts.staleReason', 'The account list was last read {{age}}; refresh the Odoo connection first.', { age: formatRelativeTime(asOf) }) : undefined;
  return (
    <SelectField
      id={id}
      label={label}
      hideLabel={hideLabel}
      value={value}
      onChange={onChange}
      disabled={disabled}
      helper={reason}
      options={[
        { value: '', label: t('odoo.accounts.choose', 'Choose an account') },
        // A saved account the list does not hold (old or empty list) must not read as "not set".
        ...(value && !rows.some((row) => row.external_id === value) ? [{ value, label: t('odoo.accounts.saved', 'Saved account {{id}}', { id: value }) }] : []),
        ...rows.map((row) => ({ value: row.external_id, label: [row.code, row.name].filter(Boolean).join(' · ') })),
      ]}
    />
  );
};
