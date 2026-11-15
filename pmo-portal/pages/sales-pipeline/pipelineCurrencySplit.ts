import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import { orderByCurrency } from '@/src/components/dashboard/restructure/currencyOrder';

/** One currency's amount as an exact decimal string ("10000.1"), never a float sum. */
export interface CurrencyAmount {
  currency: string;
  amount: string;
}

/** A stage's per-currency figures; null when they cannot be trusted (see splitStageByCurrency). */
export interface StageCurrencySplit {
  totals: CurrencyAmount[] | null;
  weighted: CurrencyAmount[] | null;
}

/** An exact decimal: units x 10^-scale. */
interface Dec { units: bigint; scale: number }

/** A JSON number or numeric string as an exact decimal; null for anything else (exponent forms included). */
function decOf(value: unknown): Dec | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : typeof value === 'string' ? value : '';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const units = BigInt(match[2] + fraction);
  return { units: match[1] ? -units : units, scale: fraction.length };
}

const rescale = (d: Dec, scale: number): bigint => d.units * 10n ** BigInt(scale - d.scale);
const add = (a: Dec, b: Dec): Dec => {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescale(a, scale) + rescale(b, scale), scale };
};
const mul = (a: Dec, b: Dec): Dec => ({ units: a.units * b.units, scale: a.scale + b.scale });
const ZERO: Dec = { units: 0n, scale: 0 };

/** Whole minor units (cents), rounding half away from zero. */
function cents(d: Dec): bigint {
  if (d.scale <= 2) return rescale(d, 2);
  const divisor = 10n ** BigInt(d.scale - 2);
  const negative = d.units < 0n;
  const abs = negative ? -d.units : d.units;
  const rounded = (abs + divisor / 2n) / divisor;
  return negative ? -rounded : rounded;
}

/** The shortest exact decimal string ("10000.1", "0.3", "5"). */
function decString(d: Dec): string {
  const negative = d.units < 0n;
  const digits = (negative ? -d.units : d.units).toString().padStart(d.scale + 1, '0');
  const whole = digits.slice(0, digits.length - d.scale);
  const fraction = digits.slice(digits.length - d.scale).replace(/0+$/, '');
  return `${negative && (whole !== '0' || fraction) ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** The deal's own chance (go x get, as the stage aggregate weighs it); its win probability when the row lacks them. */
function chanceOf(deal: PipelineProject): Dec | null {
  if (deal.go_probability !== undefined && deal.go_probability !== null && deal.get_probability !== undefined && deal.get_probability !== null) {
    const go = decOf(deal.go_probability);
    const get = decOf(deal.get_probability);
    return go && get ? mul(go, get) : null;
  }
  return decOf(deal.win_probability);
}

function byCurrency(entries: Array<{ currency: string; value: Dec }>, orgCurrency: string): CurrencyAmount[] {
  const sums = new Map<string, Dec>();
  for (const { currency, value } of entries) sums.set(currency, add(sums.get(currency) ?? ZERO, value));
  return orderByCurrency([...sums].map(([currency, value]) => ({ currency, amount: decString(value) })), orgCurrency);
}

/**
 * #2199: a stage's totals and weighted values per currency, summed in exact decimals from its open
 * deals. They are used only when they reconcile with the stage aggregate: the same deal count and the
 * same total to the cent (else both are null). The weighted split must also land within one cent of
 * the aggregate's weighted value (the JSON number cannot carry every digit of the exact product), else
 * it alone is null. A missing aggregate stage is a real, empty split only while no deal sits in it.
 */
export function splitStageByCurrency(stage: PipelineStage | undefined, deals: readonly PipelineProject[], orgCurrency: string): StageCurrencySplit {
  const unavailable = { totals: null, weighted: null };
  if (!stage) return deals.length === 0 ? { totals: [], weighted: [] } : unavailable;
  if (stage.count !== deals.length) return unavailable;

  const read = deals.map((deal) => decOf(deal.contract_value));
  const aggregateTotal = decOf(stage.total_value);
  if (read.some((value) => value === null) || aggregateTotal === null) return unavailable;
  const values = read as Dec[];
  if (cents(values.reduce(add, ZERO)) !== cents(aggregateTotal)) return unavailable;
  const totals = byCurrency(deals.map((deal, i) => ({ currency: deal.currency, value: values[i] })), orgCurrency);

  const weightedValues = deals.map((deal, i) => {
    const chance = chanceOf(deal);
    return chance === null ? null : mul(values[i], chance);
  });
  const aggregateWeighted = decOf(stage.weighted_value);
  if (weightedValues.some((value) => value === null) || aggregateWeighted === null) return { totals, weighted: null };
  const weightedSum = (weightedValues as Dec[]).reduce(add, ZERO);
  const gap = cents(weightedSum) - cents(aggregateWeighted);
  if (gap > 1n || gap < -1n) return { totals, weighted: null };
  return { totals, weighted: byCurrency(deals.map((deal, i) => ({ currency: deal.currency, value: (weightedValues as Dec[])[i] })), orgCurrency) };
}

/** Per-currency amounts added across stages, exactly; null when any stage's split is unavailable. */
export function sumByCurrency(splits: ReadonlyArray<readonly CurrencyAmount[] | null>, orgCurrency: string): CurrencyAmount[] | null {
  if (splits.some((split) => split === null)) return null;
  const entries = (splits as CurrencyAmount[][]).flat().map(({ currency, amount }) => ({ currency, value: decOf(amount) }));
  if (entries.some((entry) => entry.value === null)) return null;
  return byCurrency(entries as Array<{ currency: string; value: Dec }>, orgCurrency);
}
