import { AppError } from '@/src/lib/appError';

/**
 * Shared wire-document validator for data-layer responses (#2983).
 *
 * Strict by default: every validator throws a field-named `AppError` on a missing or malformed
 * value so a broken figure never turns into a plausible 0, blank string, or `NaN`.
 *
 * Callers that intentionally want coercion must opt in explicitly via `lenient.*` so the policy
 * is visible at the call site.
 */
export type WireRecord = Record<string, unknown>;

const SCALE_TWO_RE = /^-?\d+(?:\.\d{1,2})?$/;
const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;

export const isRec = (v: unknown): v is WireRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface WireValidator {
  /** Throw a field-named `AppError` with this validator's context and error code. */
  fail(field: string, detail?: string): never;
  /** Strict non-empty string. */
  str(v: unknown, field: string): string;
  /** Strict string (allows empty string `''`). */
  text(v: unknown, field: string): string;
  /** Nullable string: `null`/`undefined` → `null`; string → string; any other type throws. */
  strOrNull(v: unknown, field: string): string | null;
  /** Nullable non-empty string: `null`/`undefined` → `null`; non-empty string → string; `''` or non-string throws. */
  nonEmptyStrOrNull(v: unknown, field: string): string | null;
  /** Exact scale-two money text (e.g. `'1200.00'`, `'-50'`, `'0.5'`). String only; rejects JS numbers and scientific notation. */
  money(v: unknown, field: string): string;
  /** Nullable scale-two money text: `null`/`undefined` → `null`; else `money()`. */
  moneyOrNull(v: unknown, field: string): string | null;
  /** Exact decimal string of any scale (e.g. `'8.800'`, `'0.050000'`, `'0'`). String only. */
  decimal(v: unknown, field: string): string;
  /** Nullable exact decimal string: `null`/`undefined` → `null`; else `decimal()`. */
  decimalOrNull(v: unknown, field: string): string | null;
  /** Strict boolean flag. */
  bool(v: unknown, field: string): boolean;
  /** Strict finite number (JS number or non-empty numeric string; rejects `null`, `undefined`, `''`, `NaN`, `Infinity`). */
  num(v: unknown, field: string): number;
  /** Nullable finite number: `null`/`undefined` → `null`; else `num()`. */
  numOrNull(v: unknown, field: string): number | null;
  /** Strict JS integer (optionally lower-bounded via `opts.min`, e.g. `{ min: 0 }` for counts). */
  int(v: unknown, field: string, opts?: { min?: number }): number;
  /** Strict array. */
  arr(v: unknown, field: string): unknown[];
  /** Strict plain record (non-null, non-array object). */
  rec(v: unknown, field: string): WireRecord;
  /** Strict string enum check. */
  oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T;
}

export function wireValidator(context: string, code = 'malformed-response'): WireValidator {
  const fail = (field: string, detail = 'is missing or malformed'): never => {
    throw new AppError(`${context}: ${field} ${detail}`, code);
  };
  const str = (v: unknown, field: string): string =>
    typeof v === 'string' && v !== '' ? v : fail(field);
  const text = (v: unknown, field: string): string =>
    typeof v === 'string' ? v : fail(field);
  const strOrNull = (v: unknown, field: string): string | null =>
    v === null || v === undefined ? null : typeof v === 'string' ? v : fail(field);
  const nonEmptyStrOrNull = (v: unknown, field: string): string | null =>
    v === null || v === undefined ? null : str(v, field);
  const money = (v: unknown, field: string): string =>
    typeof v === 'string' && SCALE_TWO_RE.test(v) ? v : fail(field);
  const moneyOrNull = (v: unknown, field: string): string | null =>
    v === null || v === undefined ? null : money(v, field);
  const decimal = (v: unknown, field: string): string =>
    typeof v === 'string' && DECIMAL_RE.test(v) ? v : fail(field);
  const decimalOrNull = (v: unknown, field: string): string | null =>
    v === null || v === undefined ? null : decimal(v, field);
  const bool = (v: unknown, field: string): boolean =>
    typeof v === 'boolean' ? v : fail(field);
  const num = (v: unknown, field: string): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
    if (!Number.isFinite(n)) return fail(field);
    return n;
  };
  const numOrNull = (v: unknown, field: string): number | null =>
    v === null || v === undefined ? null : num(v, field);
  const int = (v: unknown, field: string, opts?: { min?: number }): number => {
    if (typeof v !== 'number' || !Number.isInteger(v)) return fail(field);
    if (opts?.min !== undefined && v < opts.min) return fail(field);
    return v;
  };
  const arr = (v: unknown, field: string): unknown[] =>
    Array.isArray(v) ? v : fail(field);
  const rec = (v: unknown, field: string): WireRecord =>
    isRec(v) ? v : fail(field);
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], field: string): T => {
    const s = str(v, field);
    if (!allowed.includes(s as T)) return fail(field, `is malformed (unexpected value ${s})`);
    return s as T;
  };

  return {
    fail, str, text, strOrNull, nonEmptyStrOrNull, money, moneyOrNull,
    decimal, decimalOrNull, bool, num, numOrNull, int, arr, rec, oneOf,
  };
}

/** Default strict validators using `'Server response'` context and `'malformed-response'` code. */
const defaultValidator = wireValidator('Server response');
export const {
  fail, str, text, strOrNull, nonEmptyStrOrNull, money, moneyOrNull,
  decimal, decimalOrNull, bool, num, numOrNull, int, arr, rec, oneOf,
} = defaultValidator;

/**
 * Explicit lenient coercers for callers that intentionally accept degraded/partial wire values.
 * Never leaks `NaN` or `Infinity`.
 */
export const lenient = {
  str: (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)),
  strOrNull: (v: unknown): string | null => (typeof v === 'string' ? v : null),
  nonEmptyStrOrNull: (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null),
  numOrNull: (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  },
  bool: (v: unknown): boolean => v === true,
  arr: (v: unknown): unknown[] => (Array.isArray(v) ? v : []),
  rec: (v: unknown): WireRecord | null => (isRec(v) ? v : null),
} as const;
