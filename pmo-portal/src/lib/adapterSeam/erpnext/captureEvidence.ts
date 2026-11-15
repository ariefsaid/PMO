import { numberFormatPrecision } from './erpLineRounding.ts';
import { ErpError, erpnextRequest, unwrapFrappeDoc, type ErpClientDeps } from './client.ts';

export type CapturePrecisionRefusal =
  | 'source_precision_unknown' | 'source_precision_exceeds_mirror' | 'source_settings_unreadable' | 'source_precision_per_currency';
/**
 * Why System Settings could not be read (#2349): the ERP refused the read (401/403), has no such document at that
 * address (404), did not answer usably after retries (network failure, timeout, redirect, 429 or 5xx), answered with
 * anything else (another 4xx, or a reply that is not a settings record, an oversized one included), or the binding's
 * ERP major version is not known. A class only: no reply body, host or credential detail.
 */
export type SettingsUnreadableCause = 'refused' | 'not_found' | 'unreachable' | 'malformed_reply' | 'version_unknown';
export type CapturePrecision =
  | { ok: true; scale: number }
  | { ok: false; reason: 'source_settings_unreadable'; cause: SettingsUnreadableCause }
  | { ok: false; reason: Exclude<CapturePrecisionRefusal, 'source_settings_unreadable'> };
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
  if (typeof versionMajor !== 'number' || !Number.isInteger(versionMajor) || versionMajor < 15) return { ok: false, reason: 'source_settings_unreadable', cause: 'version_unknown' };
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

/**
 * The HTTP status decides the cause. Status 0 is a failure before any answer (network, timeout, the safe-mode
 * failure); a 3xx is a refused redirect; a 2xx here is a reply the client would not consume (over the size cap).
 */
function failedReadCause(error: unknown): Exclude<SettingsUnreadableCause, 'version_unknown'> {
  const status = error instanceof ErpError ? error.status : 0;
  if (status === 401 || status === 403) return 'refused';
  if (status === 404) return 'not_found';
  if (status === 0 || (status >= 300 && status < 400) || status === 429 || status >= 500) return 'unreachable';
  return 'malformed_reply';
}

/**
 * One System Settings GET. A refused, failed or malformed read is source_settings_unreadable with its cause, never a
 * guessed scale. The read runs in the client's safe-diagnostic mode: static error text and nothing logged, so no ERP
 * reply, host or error detail leaves this function; the HTTP status still decides the cause. A transient failure
 * (network, timeout, 429, 5xx) is retried with the client's usual budget and backoff, still in safe mode.
 */
export async function readCapturePrecision(client: CapturePrecisionClient): Promise<CapturePrecision> {
  let settings: unknown;
  try {
    settings = unwrapFrappeDoc(await erpnextRequest(client, { method: 'GET', path: '/api/resource/System%20Settings/System%20Settings', safeDiagnostic: true, safeDiagnosticRetries: true }));
  } catch (error) {
    return { ok: false, reason: 'source_settings_unreadable', cause: failedReadCause(error) };
  }
  if (!isRecord(settings)) return { ok: false, reason: 'source_settings_unreadable', cause: 'malformed_reply' };
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
