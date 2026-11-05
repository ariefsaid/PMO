/**
 * #1515 §9 — ERPNext's half of binding a site float's cash account: read the Account and apply the one rule the sweep re-runs
 * before every float posting (`imprestCashAccountFits`). The edge function `imprest-cash-account` reaches this only through its
 * tier-keyed validator registry.
 */
import { AppError } from '../../appError.ts';
import { splitAuthPair } from './credentials.ts';
import { ErpError, getDoc, type ErpClientDeps } from './client.ts';
import { imprestCashAccountFits, type ErpAccountFacts } from './expenseAccountRules.ts';

export interface CashAccountCheck {
  fetchImpl: typeof fetch;
  siteUrl: string;
  /** The vault secret as stored (`<key>:<secret>` for ERPNext). */
  secret: string;
  /** The bound ERPNext Company. */
  company: string | null;
  account: string;
}

export async function validateErpnextCashAccount(check: CashAccountCheck): Promise<boolean> {
  let pair: { apiKey: string; apiSecret: string };
  try {
    pair = splitAuthPair(check.secret);
  } catch {
    throw new AppError('The ERPNext connection is not fully set up', 'config-rejected');
  }
  if (!check.company) throw new AppError('The ERPNext connection is not fully set up', 'config-rejected');
  const client: ErpClientDeps = { fetchImpl: check.fetchImpl, ...pair, baseUrl: check.siteUrl };
  try {
    const doc = await getDoc(client, 'Account', check.account);
    return imprestCashAccountFits({ ...(doc as Record<string, unknown>), name: check.account } as ErpAccountFacts, check.company);
  } catch (err) {
    if (err instanceof ErpError && err.status === 404) return false;
    throw err;
  }
}
