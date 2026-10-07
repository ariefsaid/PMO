export interface EfakturInput {
  number: string | null;
  date: string | null;
}

export interface EfakturErrors {
  /** `missing`: a date was given without its number (DD-EFK-2, both or neither). */
  number?: 'invalid' | 'missing';
  /** `missing`: a number was given without its date (DD-EFK-2, both or neither). */
  date?: 'future' | 'invalid' | 'missing';
}

/** The setters' known refusals, keyed by the stable DETAIL they raise (0271). */
export type EfakturRefusal = 'cancelled' | 'incomplete' | 'future-date';

const REFUSAL_BY_DETAIL: Record<string, EfakturRefusal> = {
  'efaktur-cancelled': 'cancelled',
  'efaktur-incomplete': 'incomplete',
  'efaktur-future-date': 'future-date',
};

/**
 * Which known setter refusal `error` is, read from its check-violation code + DETAIL — never from the
 * message text, which is diagnostics and may be reworded. Unknown errors return null.
 */
export function efakturRefusal(error: unknown): EfakturRefusal | null {
  if (!error || typeof error !== 'object') return null;
  const { code, details } = error as { code?: unknown; details?: unknown };
  if (code !== '23514' || typeof details !== 'string') return null;
  return REFUSAL_BY_DETAIL[details] ?? null;
}

/** Normalize optional text/date controls before a write; blank values are valid and become NULL. */
export function normalizeEfakturValues(values: { number: string | null; date: string | null }): EfakturInput {
  const number = values.number?.trim() ?? '';
  const date = values.date?.trim() ?? '';
  return { number: number || null, date: date || null };
}

/** Pure client-side UX validation; the SECURITY DEFINER setters remain authoritative. */
export function validateEfakturValues(
  values: EfakturInput,
  today = localToday(),
): EfakturErrors {
  const errors: EfakturErrors = {};
  const number = values.number?.trim() ?? '';
  if (number && (number.length > 32 || !/^[0-9.-]+$/.test(number))) errors.number = 'invalid';
  if (values.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || Number.isNaN(Date.parse(`${values.date}T00:00:00`))) {
      errors.date = 'invalid';
    } else if (values.date > today) {
      errors.date = 'future';
    }
  }
  // DD-EFK-2: both or neither — a number without its date falls out of the monthly VAT register.
  if (number && !values.date) errors.date = 'missing';
  if (values.date && !number && !errors.number) errors.number = 'missing';
  return errors;
}

/** The browser's local calendar date as YYYY-MM-DD (the server re-checks on the org's calendar). */
export function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
