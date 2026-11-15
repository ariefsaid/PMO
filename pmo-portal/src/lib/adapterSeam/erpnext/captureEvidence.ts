import { currencyPrecisionFromSettings, isRecord, type CurrencyPrecisionRefusal } from './erpLineRounding.ts';
import { ErpError, erpnextRequest, unwrapFrappeDoc, type ErpClientDeps } from './client.ts';

export type CapturePrecisionRefusal = CurrencyPrecisionRefusal | 'source_precision_exceeds_mirror';
/**
 * Why System Settings could not be read (#2349): the ERP refused the read (401/403), has no such document at that
 * address (404), did not answer usably (network failure, timeout, redirect, 429 or 5xx), answered with
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

/**
 * The scale ERPNext stores purchase amounts at: the shared rule (`currencyPrecisionFromSettings`, by the binding's major
 * version). Capture's own choices over it: a per-currency format is refused as source_precision_per_currency (capture does
 * not resolve each document currency's format), and more than 2 decimals exceeds the mirror. Nothing defaults.
 */
export function capturePrecisionFromSettings(settings: Record<string, unknown>, versionMajor: number | null | undefined): CapturePrecision {
  const rule = currencyPrecisionFromSettings(settings, versionMajor);
  // The shared rule reports source_settings_unreadable only for a major version it does not know.
  if (!rule.ok) {
    if (rule.reason === 'source_settings_unreadable') return { ok: false, reason: 'source_settings_unreadable', cause: 'version_unknown' };
    return { ok: false, reason: rule.reason };
  }
  if (rule.scale > 2) return { ok: false, reason: 'source_precision_exceeds_mirror' };
  return { ok: true, scale: rule.scale };
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
 * reply, host or error detail leaves this function; the HTTP status still decides the cause. The read makes one attempt.
 */
export async function readCapturePrecision(client: CapturePrecisionClient): Promise<CapturePrecision> {
  let settings: unknown;
  try {
    settings = unwrapFrappeDoc(await erpnextRequest(client, { method: 'GET', path: '/api/resource/System%20Settings/System%20Settings', safeDiagnostic: true }));
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
