import { numberFormatPrecision } from './erpLineRounding.ts';
import { getDoc, type ErpClientDeps } from './client.ts';

export type CapturePrecisionRefusal =
  | 'source_precision_unknown' | 'source_precision_exceeds_mirror' | 'source_settings_unreadable' | 'source_precision_per_currency';
export type CapturePrecision = { ok: true; scale: number } | { ok: false; reason: CapturePrecisionRefusal };
/** The ERP client plus the binding's handshake-stamped major (`external_org_bindings.version_major`, via erpClientForOrg). */
export type CapturePrecisionClient = ErpClientDeps & { versionMajor: number | null };

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A System Settings Check field: true / false, or null when the value is absent or not a check value. */
function checkValue(value: unknown): boolean | null {
  if (value === 1 || value === '1' || value === true) return true;
  if (value === 0 || value === '0' || value === false) return false;
  return null;
}

/**
 * The scale ERPNext stores purchase amounts at, from System Settings, the way Frappe's get_field_precision decides it on
 * the binding's major version:
 * - an explicit positive Currency Precision wins on both;
 * - an explicit 0 is a real scale on version 16 and later (get_currency_precision returns None only for None or ''), and
 *   behaves as blank on version 15;
 * - blank on version 16 and later with "use number format from currency" on takes each document currency's own format,
 *   which capture does not resolve: refused as source_precision_per_currency;
 * - otherwise blank takes the System Settings number format's decimals; a format PMO does not know is unknown.
 * A major that is not known is source_settings_unreadable. More than 2 decimals exceeds the mirror. Nothing defaults.
 */
export function capturePrecisionFromSettings(settings: Record<string, unknown>, versionMajor: number | null | undefined): CapturePrecision {
  if (typeof versionMajor !== 'number' || !Number.isInteger(versionMajor) || versionMajor < 15) return { ok: false, reason: 'source_settings_unreadable' };
  const v16 = versionMajor >= 16;
  const raw = settings.currency_precision;
  let explicit: number | null = null;
  if (raw !== undefined && raw !== null && raw !== '') {
    if (!((typeof raw === 'number' || typeof raw === 'string') && /^\d+$/.test(String(raw)) && Number.isSafeInteger(Number(raw)))) {
      return { ok: false, reason: 'source_precision_unknown' };
    }
    explicit = Number(raw);
  }
  let scale: number | null;
  if (explicit !== null && (explicit > 0 || v16)) {
    scale = explicit;
  } else {
    if (v16) {
      const perCurrency = checkValue(settings.use_number_format_from_currency);
      if (perCurrency === null) return { ok: false, reason: 'source_precision_unknown' };
      if (perCurrency) return { ok: false, reason: 'source_precision_per_currency' };
    }
    scale = numberFormatPrecision(settings.number_format);
  }
  if (scale === null) return { ok: false, reason: 'source_precision_unknown' };
  if (scale > 2) return { ok: false, reason: 'source_precision_exceeds_mirror' };
  return { ok: true, scale };
}

/** One System Settings GET. A refused, failed or malformed read is source_settings_unreadable, never a guessed scale. */
export async function readCapturePrecision(client: CapturePrecisionClient): Promise<CapturePrecision> {
  let settings: unknown;
  try {
    settings = await getDoc(client, 'System Settings', 'System Settings');
  } catch {
    return { ok: false, reason: 'source_settings_unreadable' };
  }
  if (!isRecord(settings)) return { ok: false, reason: 'source_settings_unreadable' };
  return capturePrecisionFromSettings(settings, client.versionMajor);
}

/** One cache per preview or apply; a new run rechecks the source settings. */
export function createCapturePrecisionReader(client: CapturePrecisionClient) {
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
