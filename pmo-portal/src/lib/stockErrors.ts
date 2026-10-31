/** Stable `STK_*` error codes raised by the stock RPCs (spec FR-STK-080). The copy lives in the `stock` i18n namespace. */
export const STOCK_ERROR_CODES = [
  'STK_INSUFFICIENT', 'STK_NOT_KEEPER', 'STK_OWNED_BY_ERP', 'STK_SELF_APPROVE', 'STK_RANK', 'STK_PROJECT_NOT_ACTIVE',
  'STK_BOQ_MISMATCH', 'STK_RETURN_EXCEEDS', 'STK_ARCHIVED', 'STK_FRACTION', 'STK_BACKDATE',
  'STK_HAS_STOCK', 'STK_UNIT_LOCKED', 'STK_INVALID', 'STK_NOT_FOUND', 'STK_TOO_MANY', 'STK_KIND_UNAVAILABLE', 'STK_IMMUTABLE',
] as const;
export type StockErrorCode = (typeof STOCK_ERROR_CODES)[number];

export interface ParsedStockError { code: StockErrorCode; message: string; numbers: Record<string, string> }

const CODE_RE = /^(STK_[A-Z_]+):\s*(.*)$/s;

function readNumbers(details: unknown): Record<string, string> {
  if (typeof details !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>);
    return entries.every(([, v]) => typeof v === 'string') ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Parses a stock RPC failure; null for anything else so the caller falls back to `classifyMutationError`. */
export function parseStockError(err: unknown): ParsedStockError | null {
  if (err === null || typeof err !== 'object') return null;
  const { message, details } = err as { message?: unknown; details?: unknown };
  if (typeof message !== 'string') return null;
  const m = CODE_RE.exec(message);
  if (!m || !(STOCK_ERROR_CODES as readonly string[]).includes(m[1])) return null;
  return { code: m[1] as StockErrorCode, message: m[2], numbers: readNumbers(details) };
}
