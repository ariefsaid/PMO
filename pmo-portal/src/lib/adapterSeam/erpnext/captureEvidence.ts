import { numberFormatPrecision } from './erpLineRounding.ts';
import { getDoc, type ErpClientDeps } from './client.ts';

export type CapturePrecisionRefusal = 'source_precision_unknown' | 'source_precision_exceeds_mirror' | 'source_settings_unreadable';
export type CapturePrecision = { ok: true; scale: number } | { ok: false; reason: CapturePrecisionRefusal };

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The scale ERPNext stores purchase amounts at, from System Settings, the way Frappe's get_field_precision decides it: an
 * explicit positive Currency Precision, else (blank or 0) the number format's decimals. A number format PMO does not know,
 * or a precision that is not a whole number, is unknown; nothing becomes a default scale.
 */
export function capturePrecisionFromSettings(settings: Record<string, unknown>): CapturePrecision {
  const raw = settings.currency_precision;
  let scale: number | null = null;
  if (raw === undefined || raw === null || raw === '') {
    scale = numberFormatPrecision(settings.number_format);
  } else if ((typeof raw === 'number' || typeof raw === 'string') && /^\d+$/.test(String(raw)) && Number.isSafeInteger(Number(raw))) {
    scale = Number(raw) === 0 ? numberFormatPrecision(settings.number_format) : Number(raw);
  }
  if (scale === null) return { ok: false, reason: 'source_precision_unknown' };
  if (scale > 2) return { ok: false, reason: 'source_precision_exceeds_mirror' };
  return { ok: true, scale };
}

/** One System Settings GET. A refused, failed or malformed read is source_settings_unreadable, never a guessed scale. */
export async function readCapturePrecision(client: ErpClientDeps): Promise<CapturePrecision> {
  let settings: unknown;
  try {
    settings = await getDoc(client, 'System Settings', 'System Settings');
  } catch {
    return { ok: false, reason: 'source_settings_unreadable' };
  }
  if (!isRecord(settings)) return { ok: false, reason: 'source_settings_unreadable' };
  return capturePrecisionFromSettings(settings);
}

/** One cache per preview or apply; a new run rechecks the source settings. */
export function createCapturePrecisionReader(client: ErpClientDeps) {
  const cache = new Map<string, Promise<CapturePrecision>>();
  return {
    read(company: string, kind: 'order' | 'supplier_invoice' | 'journal'): Promise<CapturePrecision> {
      if (!company.trim()) return Promise.resolve({ ok: false, reason: 'source_precision_unknown' });
      const key = JSON.stringify([company, kind]);
      let result = cache.get(key);
      if (!result) { result = readCapturePrecision(client); cache.set(key, result); }
      return result;
    },
  };
}
