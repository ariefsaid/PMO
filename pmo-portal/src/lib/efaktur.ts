export interface EfakturInput {
  number: string | null;
  date: string | null;
}

export interface EfakturErrors {
  number?: 'invalid';
  date?: 'future' | 'invalid';
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
  return errors;
}

function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
