import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useFxRate } from '@/src/hooks/useFxRates';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { formatFxEquivalent } from '@/src/lib/fxEquivalent';

export type FxEquivalentDate = string | 'latest' | null;

export interface FxEquivalentProps {
  amount: number | null;
  currency: string | null | undefined;
  date: FxEquivalentDate;
  compact?: boolean;
  /** Own the definition row so an inapplicable conversion leaves no empty row behind. */
  as?: 'span' | 'dd';
}

const FxEquivalent: React.FC<FxEquivalentProps> = ({ amount, currency, date, compact = false, as: Element = 'span' }) => {
  const { t } = useTranslation();
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
    <Element role="alert" className="block min-w-0 break-words text-xs font-normal text-destructive-text">
      {t('fx.rateError', 'Could not load JISDOR rate.')}
    </Element>
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
  if (!rate.data) {
    return (
      <Element className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground">
        {t('fx.noRateForDate', 'No JISDOR rate for {{date}}.', { date: requestedDay ?? '' })}
      </Element>
    );
  }
  try {
    const equivalent = formatFxEquivalent(amount, rate.data);
    if (compact) {
      return (
        <Element className="block min-w-0 text-xs font-normal tabular text-muted-foreground">
          <span aria-hidden="true" title={equivalent} className="block truncate whitespace-nowrap">
            {equivalent}
          </span>
          <span className="sr-only">{equivalent}</span>
        </Element>
      );
    }
    return (
      <Element className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground">
        {equivalent}
      </Element>
    );
  } catch {
    return failure;
  }
};

export default FxEquivalent;
