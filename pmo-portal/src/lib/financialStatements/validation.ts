// Shared validation primitives for the financial-statement parsers. Leaf module:
// no imports from the sibling parser modules. Each public parser interface keeps
// ownership of its own contract and its TypeError message.

export type FinancialStatementPeriodKind = 'month' | 'quarter' | 'fiscal_year';
export type FinancialStatementKind = 'trial_balance' | 'profit_and_loss' | 'balance_sheet';
export type FinancialStatementRoundingMode = "Banker's Rounding" | "Banker's Rounding (legacy)" | 'Commercial Rounding' | 'erpnext_report_output';

export const INVALID_ROW_MESSAGE = 'Invalid financial statement row.';
const AMOUNT_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;
export const ROUNDING_METHODS = [
  "Banker's Rounding",
  "Banker's Rounding (legacy)",
  'Commercial Rounding',
  'erpnext_report_output',
] as const;
export const STATEMENTS = ['trial_balance', 'profit_and_loss', 'balance_sheet'] as const;
export const PERIOD_KINDS = ['month', 'quarter', 'fiscal_year'] as const;
export const SCOPE_KINDS = ['company', 'project'] as const;
export const VIEW_KINDS = ['account_breakdown', 'project_totals'] as const;

export function reject(): never {
  throw new TypeError(INVALID_ROW_MESSAGE);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function recordValues(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return reject();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return reject();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return reject();
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function hasExactKeysWithOptional(
  value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value);
}

export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

export function isRealTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match || !isRealDate(`${match[1]}-${match[2]}-${match[3]}`)) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function addMonthsClamped(value: string, months: number): string {
  const match = DATE_PATTERN.exec(value);
  if (!match) return reject();
  const year = Number(match[1]);
  const month = Number(match[2]) - 1 + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(Number(match[3]), new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isFiscalPeriodRange(start: string, end: string, expectedMonths: number): boolean {
  if (!isRealDate(start) || !isRealDate(end) || start > end) return false;
  const nextStart = addMonthsClamped(start, expectedMonths);
  const endDate = new Date(`${nextStart}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return endDate.toISOString().slice(0, 10) === end;
}

export function validPeriodPair(row: Record<string, unknown>): boolean {
  const currentStart = row.current_start;
  const currentEnd = row.current_end;
  const priorStart = row.prior_start;
  const priorEnd = row.prior_end;
  if (
    !isRealDate(currentStart) || !isRealDate(currentEnd) ||
    !isRealDate(priorStart) || !isRealDate(priorEnd) ||
    currentStart > currentEnd || priorStart > priorEnd
  ) return false;

  const monthCount = row.period_kind === 'month' ? 1 : row.period_kind === 'quarter' ? 3 : 12;
  const previousDay = new Date(`${currentStart}T00:00:00.000Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  return isFiscalPeriodRange(currentStart, currentEnd, monthCount) &&
    isFiscalPeriodRange(priorStart, priorEnd, monthCount) &&
    previousDay.toISOString().slice(0, 10) === priorEnd;
}

export function copyJson(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : reject();
  if (typeof value !== 'object') return reject();
  if (ancestors.has(value)) return reject();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return reject();
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) return reject();
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return reject();
        copy.push(copyJson(descriptor.value, ancestors));
      }
      return copy;
    }

    if (!isPlainRecord(value)) return reject();
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return reject();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return reject();
      Object.defineProperty(copy, key, {
        value: copyJson(descriptor.value, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

export function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]));
}
