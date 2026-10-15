import { AdapterError } from '../contract.ts';
import { timestamptzEpochMs } from './budgetPushKey.ts';
import { budgetVersionIdOf, decodeFiscalYear, encodeFiscalYear } from './fiscalYearEncoding.ts';

export interface BudgetIdentity {
  versionId: string;
  fiscalYear: string | null;
  erpAccount: string | null;
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

export function parseBudgetIdentity(identity: string): BudgetIdentity {
  if (UUID.test(identity)) return { versionId: identity, fiscalYear: null, erpAccount: null };
  const versionId = budgetVersionIdOf(identity);
  const rest = identity.slice(versionId.length + 1);
  if (!rest.startsWith('a:')) {
    const fiscalYear = decodeFiscalYear(rest);
    if (!fiscalYear || encodeFiscalYear(fiscalYear) !== rest) reject();
    return { versionId, fiscalYear, erpAccount: null };
  }

  const lengthEnd = rest.indexOf(':', 2);
  if (lengthEnd < 0) reject();
  const decimal = rest.slice(2, lengthEnd);
  if (!/^[1-9][0-9]*$/.test(decimal)) reject();
  const length = Number(decimal);
  if (!Number.isSafeInteger(length) || length > rest.length) reject();
  const start = lengthEnd + 1;
  if (rest[start + length] !== ':') reject();
  const token = rest.slice(start, start + length);
  const fiscalYear = decodeFiscalYear(token);
  const erpAccount = decodeBudgetAccount(rest.slice(start + length + 1));
  if (!fiscalYear || budgetAccountIdentity(versionId, fiscalYear, erpAccount) !== identity) reject();
  return { versionId, fiscalYear, erpAccount };
}

export function budgetAccountPushKey(identity: string, activatedAt: string | null | undefined): string {
  if (!parseBudgetIdentity(identity).erpAccount || !activatedAt) reject();
  const epoch = timestamptzEpochMs(activatedAt);
  if (!Number.isFinite(epoch) || epoch < 0) reject();
  return `bud16:${identity}:${epoch}`;
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
