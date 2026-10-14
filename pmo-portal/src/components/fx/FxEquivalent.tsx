import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useFxRate } from '@/src/hooks/useFxRates';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { formatFxEquivalent } from '@/src/lib/fxEquivalent';
import { Button } from '@/src/components/ui';

export type FxEquivalentDate = string | 'latest' | null;

export interface FxEquivalentProps {
  amount: number | null;
  currency: string | null | undefined;
  date: FxEquivalentDate;
}

const FxEquivalent: React.FC<FxEquivalentProps> = ({ amount, currency, date }) => {
  const { t } = useTranslation();
  const auth = useAuth();
  const queryClient = useQueryClient();
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
  if (!orgResolved) {
    if (orgCurrency.isError || (!auth.loading && !auth.currentUser?.org_id)) {
      return (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-destructive-text"
        >
          <span>{t('fx.orgCurrencyError', 'Could not resolve the organization currency.')}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (auth.currentUser?.org_id) {
                void queryClient.invalidateQueries({
                  queryKey: ['org-currency', auth.currentUser.org_id],
                });
              }
            }}
          >
            {t('fx.retry', 'Retry')}
          </Button>
        </div>
      );
    }
    return (
      <span
        role="status"
        className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground"
      >
        {t('fx.checkingOrgCurrency', 'Checking organization currency…')}
      </span>
    );
  }
  if (sameCurrency) return null;
  if (currency !== 'USD' || orgCurrency.currency !== 'IDR') {
    return (
      <span className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground">
        {t(
          'fx.unsupportedPair',
          'JISDOR equivalents are available for USD contracts in IDR organizations only.',
        )}
      </span>
    );
  }
  if (date === null) {
    return (
      <span className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground">
        {t('fx.missingDate', 'No publication date is available for this amount.')}
      </span>
    );
  }
  if (date === 'latest' && orgDay.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-destructive-text"
      >
        <span>{t('fx.orgDayError', 'Could not resolve the organization’s local date.')}</span>
        <Button variant="outline" size="sm" onClick={orgDay.retry}>
          {t('fx.retry', 'Retry')}
        </Button>
      </div>
    );
  }
  if (date === 'latest' && (orgDay.isPending || !orgDay.day)) {
    return (
      <span
        role="status"
        className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground"
      >
        {t('fx.checkingOrgDay', 'Checking today’s JISDOR date…')}
      </span>
    );
  }
  if (rate.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-destructive-text"
      >
        <span>{t('fx.rateError', 'Could not load JISDOR rate.')}</span>
        <Button variant="outline" size="sm" onClick={() => void rate.refetch()}>
          {t('fx.retry', 'Retry')}
        </Button>
      </div>
    );
  }
  if (rate.isPending) {
    return (
      <span
        role="status"
        className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground"
      >
        {t('fx.checkingRate', 'Checking JISDOR rate…')}
      </span>
    );
  }
  if (!rate.data) {
    return (
      <span className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground">
        {t('fx.noRateForDate', 'No JISDOR rate for {{date}}.', { date: requestedDay ?? '' })}
      </span>
    );
  }
  try {
    return (
      <span className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground">
        {formatFxEquivalent(amount, rate.data)}
      </span>
    );
  } catch {
    return (
      <span
        role="alert"
        className="block min-w-0 break-words text-xs font-normal text-destructive-text"
      >
        {t('fx.rateError', 'Could not load JISDOR rate.')}
      </span>
    );
  }
};

export default FxEquivalent;
