import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useInRouterContext } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useFxRate } from '@/src/hooks/useFxRates';
import type { FxRateMatch } from '@/src/lib/repositories/types';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { formatDay } from '@/src/lib/format';
import { formatFxEquivalent, fxRateSourceNote } from '@/src/lib/fxEquivalent';

export type FxEquivalentDate = string | 'latest' | null;

export interface FxEquivalentProps {
  amount: number | null;
  currency: string | null | undefined;
  date: FxEquivalentDate;
  compact?: boolean;
}

export const EXCHANGE_RATES_PATH = '/administration/exchange-rates';

/** No rate on file for the day: dev's #2088 message with the formatted day, plus the way to upload one for a person who may. */
export const FxNoRate: React.FC<{ day?: string | null; className?: string }> = ({ day, className }) => {
  const { t } = useTranslation(['common', 'finance']);
  const may = usePermission();
  const inRouter = useInRouterContext();
  const canUpload = may('upload', 'fxRate');
  const linkClass = 'font-medium text-primary-text underline underline-offset-2 hover:text-foreground';
  const label = t('finance:fx.uploadRate', 'Upload an exchange rate');
  return (
    <span className={className ?? 'block min-w-0 break-words text-control font-normal tabular text-muted-foreground'}>
      <span>{t('common:fx.noRateForDate', 'No JISDOR rate for {{date}}.', { date: day ? formatDay(day) : '' })}</span>
      {canUpload && (
        <>
          {' '}
          {inRouter
            ? <Link to={EXCHANGE_RATES_PATH} className={linkClass}>{label}</Link>
            : <a href={EXCHANGE_RATES_PATH} className={linkClass}>{label}</a>}
        </>
      )}
    </span>
  );
};

const FxEquivalent: React.FC<FxEquivalentProps> = ({ amount, currency, date, compact = false }) => {
  const { t } = useTranslation(['common', 'finance']);
  const auth = useAuth();
  const orgCurrency = useOrgCurrencyState();
  const hasAmount = amount !== null && Number.isFinite(amount);
  const orgResolved = orgCurrency.isResolved && Boolean(auth.currentUser?.org_id);
  const sameCurrency = orgResolved && currency === orgCurrency.currency;
  const eligible =
    hasAmount &&
    orgResolved &&
    !sameCurrency &&
    currency === 'USD' &&
    orgCurrency.currency === 'IDR';
  const needsOrgDay = date === 'latest' && Boolean(eligible);
  const orgDay = useFxOrgDay(needsOrgDay);
  const requestedDay = date === 'latest' ? orgDay.day : date;
  const rate = useFxRate('USD', 'IDR', requestedDay, Boolean(eligible && requestedDay));

  if (!hasAmount) return null;
  // FIN-S4: a quiet component. Not applicable (other currency pair, no date) or still loading renders nothing;
  // a failure is one short line with no retry control.
  const failure = (
    <span role="alert" className="block min-w-0 break-words text-control font-normal text-destructive-text">
      {t('fx.rateError', 'Could not load JISDOR rate.')}
    </span>
  );
  if (!orgResolved) {
    return orgCurrency.isError || (!auth.loading && !auth.currentUser?.org_id) ? failure : null;
  }
  if (sameCurrency) return null;
  if (currency !== 'USD' || orgCurrency.currency !== 'IDR') return null;
  if (date === null) return null;
  if (date === 'latest' && orgDay.isError) return failure;
  if (date === 'latest' && (orgDay.isPending || !orgDay.day)) return null;
  if (rate.isError) return failure;
  if (rate.isPending) return null;
  const props = { amount, compact, date, requestedDay, failure };
  if (rate.data) return <FxMatch {...props} match={rate.data} />;
  if (date === 'latest') return <FxNoRate day={requestedDay} />;
  // A dated document with no rate on or before its date falls back to the latest rate available (today's lookup).
  return <FxFallback {...props} />;
};

interface FxViewProps {
  amount: number;
  compact: boolean;
  date: string;
  requestedDay: string | null;
  failure: React.ReactElement;
}

const FxFallback: React.FC<FxViewProps> = (props) => {
  const fallbackDay = useFxOrgDay(true);
  const fallback = useFxRate('USD', 'IDR', fallbackDay.day, Boolean(fallbackDay.day));
  if (fallbackDay.isError || fallback.isError) return props.failure;
  if (fallbackDay.isPending || !fallbackDay.day || fallback.isPending) return null;
  if (!fallback.data) return <FxNoRate day={props.requestedDay} />;
  return <FxMatch {...props} match={fallback.data} />;
};

const FxMatch: React.FC<FxViewProps & { match: FxRateMatch }> = ({ amount, compact, date, requestedDay, failure, match }) => {
  const { t } = useTranslation(['common', 'finance']);
  try {
    const equivalent = formatFxEquivalent(amount, match, t);
    const note = fxRateSourceNote(match, t, date === 'latest' ? requestedDay : date);
    if (compact) {
      return (
        <span className="block min-w-0 text-control font-normal tabular text-muted-foreground">
          <span aria-hidden="true" title={note ? `${equivalent} · ${note}` : undefined} className="block truncate whitespace-nowrap">
            {equivalent}
          </span>
          <span className="sr-only">{note ? `${equivalent} (${note})` : equivalent}</span>
        </span>
      );
    }
    return (
      <span title={note ?? undefined} className="block min-w-0 break-words text-control font-normal tabular text-muted-foreground">
        <span>{equivalent}</span>
        {note && <span className="sr-only">{` (${note})`}</span>}
      </span>
    );
  } catch {
    return failure;
  }
};

export default FxEquivalent;
