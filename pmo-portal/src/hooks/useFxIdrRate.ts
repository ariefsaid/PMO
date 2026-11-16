import { useAuth } from '@/src/auth/useAuth';
import type { FxRateMatch } from '@/src/lib/repositories/types';
import { useFxOrgDay } from './useFxOrgDay';
import { useFxRate } from './useFxRates';
import { useOrgCurrencyState } from './useOrgCurrency';

export type FxIdrRateState =
  | { status: 'off' } // the organisation does not run in IDR: no equivalent applies
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'none' } // no rate has ever been uploaded on or before today
  | { status: 'ready'; match: FxRateMatch };

/** The latest USD→IDR rate on or before the organisation's today, for position cards. Display only. */
export function useFxIdrRate(enabled = true): FxIdrRateState {
  const auth = useAuth();
  const org = useOrgCurrencyState();
  const orgIdr = org.isResolved && org.currency === 'IDR' && Boolean(auth.currentUser?.org_id);
  const active = enabled && orgIdr;
  const orgDay = useFxOrgDay(active);
  const rate = useFxRate('USD', 'IDR', orgDay.day, active && Boolean(orgDay.day));
  if (!enabled) return { status: 'off' };
  if (org.isError) return { status: 'error' };
  if (!org.isResolved) return { status: 'pending' };
  if (!orgIdr) return { status: 'off' };
  if (orgDay.isError || rate.isError) return { status: 'error' };
  if (orgDay.isPending || !orgDay.day || rate.isPending) return { status: 'pending' };
  return rate.data ? { status: 'ready', match: rate.data } : { status: 'none' };
}
