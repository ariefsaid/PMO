/** Stable `RSV_*` error codes raised by the reservation RPCs and triggers (#2693). The copy lives in the `stock` i18n namespace under `reservations.errors`. */
export const RESERVATION_ERROR_CODES = [
  'RSV_OFF', 'RSV_FORBIDDEN', 'RSV_INVALID', 'RSV_NOT_FOUND', 'RSV_WORK_ORDER', 'RSV_LOCATION', 'RSV_EXCEEDS_FREE', 'RSV_EXCEEDS_REMAINING',
  'RSV_NOT_ACTIVE', 'RSV_NO_BORROW_APPROVER', 'RSV_BORROW_CHANGED', 'RSV_OVERDRAW', 'RSV_IMMUTABLE',
] as const;
export type ReservationErrorCode = (typeof RESERVATION_ERROR_CODES)[number];
const CODE_RE = /^(RSV_[A-Z_]+):\s*(.*)$/s;

/** The code and the first number of a reservation failure; null for anything else so the caller falls back to the shared classifier. */
export function parseReservationError(err: unknown): { code: ReservationErrorCode; number: string | null } | null {
  if (err === null || typeof err !== 'object') return null;
  const { message } = err as { message?: unknown };
  if (typeof message !== 'string') return null;
  const m = CODE_RE.exec(message);
  if (!m || !(RESERVATION_ERROR_CODES as readonly string[]).includes(m[1])) return null;
  return { code: m[1] as ReservationErrorCode, number: /\d+(?:\.\d+)?/.exec(m[2])?.[0] ?? null };
}
