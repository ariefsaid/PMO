export type WinRateBasis = 'count' | 'value';

export interface BidCurrencyTotals {
  currency: string;
  wins_count: number;
  losses_count: number;
  open_count: number;
  wins_value: number;
  losses_value: number;
  open_value: number;
}

export type UnavailableRateReason = 'no_bids' | 'no_decided_bids' | 'no_bid_value' | 'no_decided_value';

export interface BidRateFigure {
  numerator: number;
  denominator: number;
  rate: number | null;
  reason: UnavailableRateReason | null;
}

export interface BidRatePair {
  decided: BidRateFigure;
  allBids: BidRateFigure;
}

function usableAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Calculates decided-bid win rate and all-bid conversion for one currency.
 * The caller supplies counts and amounts from the same period cohort.
 */
export function calculateBidRates(totals: BidCurrencyTotals, basis: WinRateBasis): BidRatePair {
  const won = usableAmount(basis === 'count' ? totals.wins_count : totals.wins_value);
  const lost = usableAmount(basis === 'count' ? totals.losses_count : totals.losses_value);
  const open = usableAmount(basis === 'count' ? totals.open_count : totals.open_value);
  const decidedDenominator = won + lost;
  const allBidsDenominator = decidedDenominator + open;
  const allBidsCountDenominator =
    usableAmount(totals.wins_count) + usableAmount(totals.losses_count) + usableAmount(totals.open_count);
  const emptyDecidedReason: UnavailableRateReason = basis === 'count'
    ? allBidsCountDenominator > 0 ? 'no_decided_bids' : 'no_bids'
    : allBidsCountDenominator > 0 ? 'no_decided_value' : 'no_bid_value';
  const emptyAllReason: UnavailableRateReason = basis === 'count' ? 'no_bids' : 'no_bid_value';

  return {
    decided: {
      numerator: won,
      denominator: decidedDenominator,
      rate: decidedDenominator > 0 ? won / decidedDenominator : null,
      reason: decidedDenominator > 0 ? null : emptyDecidedReason,
    },
    allBids: {
      numerator: won,
      denominator: allBidsDenominator,
      rate: allBidsDenominator > 0 ? won / allBidsDenominator : null,
      reason: allBidsDenominator > 0 ? null : emptyAllReason,
    },
  };
}
