import { AdapterError } from '../contract.ts';
import { timestamptzEpochMs } from './budgetPushKey.ts';
import { budgetVersionIdOf, decodeFiscalYear, encodeFiscalYear } from './fiscalYearEncoding.ts';

export interface BudgetIdentity {
  versionId: string;
  fiscalYear: string | null;
  toFiscalYear: string | null;
  erpAccount: string | null;
  kind: 'bare' | 'legacy' | 'annual' | 'range';
}

function reject(): never {
  throw new AdapterError('commit-rejected', 'Invalid budget account identity');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeBudgetAccount(account: string): string {
  if (typeof account !== 'string' || account.length === 0 || account.trim() === '') reject();
  const bytes = new TextEncoder().encode(account);
  if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== account) reject();
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function decodeBudgetAccount(token: string): string {
  if (!/^(?:[0-9a-f]{2})+$/.test(token)) reject();
  try {
    const bytes = Uint8Array.from(token.match(/../g)!, (byte) => Number.parseInt(byte, 16));
    const account = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (encodeBudgetAccount(account) !== token) reject();
    return account;
  } catch {
    return reject();
  }
}

export function budgetAccountIdentity(versionId: string, fiscalYear: string, account: string): string {
  if (!UUID.test(versionId)) reject();
  const fy = encodeFiscalYear(fiscalYear);
  return `${versionId}:a:${fy.length}:${fy}:${encodeBudgetAccount(account)}`;
}

/** Range-qualified v16 identity; length-framed tokens keep arbitrary ERP Fiscal Year names unambiguous. */
export function budgetRangeIdentity(versionId: string, fromFiscalYear: string, toFiscalYear: string, account: string): string {
  if (!UUID.test(versionId)) reject();
  const from = encodeFiscalYear(fromFiscalYear);
  const to = encodeFiscalYear(toFiscalYear);
  return `${versionId}:r:${from.length}:${from}:${to.length}:${to}:${encodeBudgetAccount(account)}`;
}

function readLengthFramedToken(value: string, start: number): { token: string; next: number } {
  const lengthEnd = value.indexOf(':', start);
  if (lengthEnd < 0) reject();
  const decimal = value.slice(start, lengthEnd);
  if (!/^[1-9][0-9]*$/.test(decimal)) reject();
  const length = Number(decimal);
  if (!Number.isSafeInteger(length) || length > value.length) reject();
  const tokenStart = lengthEnd + 1;
  const tokenEnd = tokenStart + length;
  if (value[tokenEnd] !== ':') reject();
  return { token: value.slice(tokenStart, tokenEnd), next: tokenEnd + 1 };
}

export function parseBudgetIdentity(identity: string): BudgetIdentity {
  if (UUID.test(identity)) return { versionId: identity, fiscalYear: null, toFiscalYear: null, erpAccount: null, kind: 'bare' };
  const versionId = budgetVersionIdOf(identity);
  const rest = identity.slice(versionId.length + 1);
  if (rest.startsWith('r:')) {
    const fromToken = readLengthFramedToken(rest, 2);
    const toToken = readLengthFramedToken(rest, fromToken.next);
    const fiscalYear = decodeFiscalYear(fromToken.token);
    const toFiscalYear = decodeFiscalYear(toToken.token);
    const erpAccount = decodeBudgetAccount(rest.slice(toToken.next));
    if (!fiscalYear || !toFiscalYear || budgetRangeIdentity(versionId, fiscalYear, toFiscalYear, erpAccount) !== identity) reject();
    return { versionId, fiscalYear, toFiscalYear, erpAccount, kind: 'range' };
  }
  if (!rest.startsWith('a:')) {
    const fiscalYear = decodeFiscalYear(rest);
    if (!fiscalYear || encodeFiscalYear(fiscalYear) !== rest) reject();
    return { versionId, fiscalYear, toFiscalYear: null, erpAccount: null, kind: 'legacy' };
  }

  const framed = readLengthFramedToken(rest, 2);
  const fiscalYear = decodeFiscalYear(framed.token);
  const erpAccount = decodeBudgetAccount(rest.slice(framed.next));
  if (!fiscalYear || budgetAccountIdentity(versionId, fiscalYear, erpAccount) !== identity) reject();
  return { versionId, fiscalYear, toFiscalYear: null, erpAccount, kind: 'annual' };
}

export function budgetAccountPushKey(identity: string, activatedAt: string | null | undefined): string {
  if (!parseBudgetIdentity(identity).erpAccount || !activatedAt) reject();
  const epoch = timestamptzEpochMs(activatedAt);
  if (!Number.isFinite(epoch) || epoch < 0) reject();
  return `bud16:${identity}:${epoch}`;
}

/** Distinct recovery identity for an operator-requested archive cancellation of an existing v16 Budget. */
export function budgetAccountArchiveKey(identity: string, activatedAt: string | null | undefined): string {
  if (!parseBudgetIdentity(identity).erpAccount || !activatedAt) reject();
  const epoch = timestamptzEpochMs(activatedAt);
  if (!Number.isFinite(epoch) || epoch < 0) reject();
  return `bud16-archive:${identity}:${epoch}`;
}

/**
 * #1462 — the year-qualified identity of a LEGACY (pre-v16, year-grained) ERP Budget.
 *
 * It is the SHIPPED pre-v16 identity shape (`<version UUID>:<encoded fiscal year>`), reconstructed from
 * the legacy mirror's own `fiscal_year` rather than copied from the current account plan: a legacy
 * document's provenance is its year, and the account-grained plan cannot describe it.
 */
export function budgetLegacyIdentity(versionId: string, fiscalYear: string): string {
  if (!UUID.test(versionId) || typeof fiscalYear !== 'string' || fiscalYear.length === 0) reject();
  const fy = encodeFiscalYear(fiscalYear);
  return `${versionId}:${fy}`;
}

/**
 * #1462 — the archive cancellation key for a legacy Budget. Distinct prefix (`bud15-archive:`), distinct
 * identity (year-qualified, never account-framed), same activation-epoch binding as the account key, so
 * one archive decision can never mint a second ERP write for the same document.
 *
 * ⚑ A BARE version id is refused here. The legacy grain is one document per (project, fiscal year), so a
 * bare identity could not say WHICH old document is being cancelled; the caller must establish the year
 * first (`budgetLegacyIdentity`), or hold.
 */
export function budgetLegacyArchiveKey(identity: string, activatedAt: string | null | undefined): string {
  const parsed = parseBudgetIdentity(identity);
  if (parsed.erpAccount !== null || parsed.fiscalYear === null) reject();
  if (budgetLegacyIdentity(parsed.versionId, parsed.fiscalYear) !== identity) reject();
  if (!activatedAt) reject();
  const epoch = timestamptzEpochMs(activatedAt);
  if (!Number.isFinite(epoch) || epoch < 0) reject();
  return `bud15-archive:${identity}:${epoch}`;
}

export function isBudgetAccountPushKey(key: string): boolean {
  if (!key.startsWith('bud16:')) return false;
  const end = key.lastIndexOf(':');
  const epoch = key.slice(end + 1);
  if (!/^[0-9]{4,20}$/.test(epoch)) return false;
  try {
    return parseBudgetIdentity(key.slice(6, end)).erpAccount !== null;
  } catch {
    return false;
  }
}

export function isBudgetAccountArchiveKey(key: string): boolean {
  const prefix = 'bud16-archive:';
  if (!key.startsWith(prefix)) return false;
  const end = key.lastIndexOf(':');
  const epoch = key.slice(end + 1);
  if (!/^[0-9]{4,20}$/.test(epoch)) return false;
  try {
    return parseBudgetIdentity(key.slice(prefix.length, end)).erpAccount !== null;
  } catch {
    return false;
  }
}

/** #1462 — the legacy (year-qualified, account-less) twin of `isBudgetAccountArchiveKey`. */
export function isBudgetLegacyArchiveKey(key: string): boolean {
  const prefix = 'bud15-archive:';
  if (!key.startsWith(prefix)) return false;
  const end = key.lastIndexOf(':');
  const epoch = key.slice(end + 1);
  if (!/^[0-9]{4,20}$/.test(epoch)) return false;
  const identity = key.slice(prefix.length, end);
  try {
    const parsed = parseBudgetIdentity(identity);
    return parsed.erpAccount === null && parsed.fiscalYear !== null &&
      budgetLegacyIdentity(parsed.versionId, parsed.fiscalYear) === identity;
  } catch {
    return false;
  }
}
