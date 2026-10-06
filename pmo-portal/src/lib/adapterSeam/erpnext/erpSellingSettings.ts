/**
 * The ERP site's Selling Settings that progress billing needs (#766 / DD-PBL-12a). A claim's recovery line is a
 * NEGATIVE-rate line, and ERPNext refuses it at SUBMIT unless Selling Settings "Allow Negative rates for Items" is on
 * (a site-wide switch — docs/reviews/2026-10-06-progress-billing-erp-spike.md). `ensureErpSellingSettings` turns it on
 * during onboarding; `readNegativeRatesAllowed` lets the dispatch fail fast, before a draft is created, when it is off.
 */
import { getDoc, updateDoc, type ErpClientDeps } from './client.ts';

const DOCTYPE = 'Selling Settings';
export const NEGATIVE_RATES_FIELD = 'allow_negative_rates_for_items';

export type SellingSettingOutcome =
  | { name: string; outcome: 'exists' | 'enabled' }
  | { name: string; outcome: 'failed'; message: string };

export async function readNegativeRatesAllowed(deps: ErpClientDeps): Promise<boolean> {
  const doc = (await getDoc(deps, DOCTYPE, DOCTYPE)) as Record<string, unknown> | null;
  return Number(doc?.[NEGATIVE_RATES_FIELD] ?? 0) === 1;
}

/** Idempotent. A failure (typically the integration user lacking the right to edit settings) is REPORTED, never thrown:
 *  it must not block party onboarding — the dispatch-time check then names the action to take. */
export async function ensureErpSellingSettings(deps: ErpClientDeps): Promise<SellingSettingOutcome[]> {
  const name = `${DOCTYPE}.${NEGATIVE_RATES_FIELD}`;
  try {
    if (await readNegativeRatesAllowed(deps)) return [{ name, outcome: 'exists' }];
    await updateDoc(deps, DOCTYPE, DOCTYPE, { [NEGATIVE_RATES_FIELD]: 1 });
    return [{ name, outcome: 'enabled' }];
  } catch (err) {
    return [{ name, outcome: 'failed', message: err instanceof Error ? err.message : String(err) }];
  }
}
