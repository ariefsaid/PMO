import { currencyPrecisionFromSettings, type CurrencyPrecisionRefusal } from './erpLineRounding.ts';
import { getDoc, type ErpClientDeps } from './client.ts';

export type CapturePrecisionRefusal = CurrencyPrecisionRefusal | 'source_precision_exceeds_mirror';
export type CapturePrecision = { ok: true; scale: number } | { ok: false; reason: CapturePrecisionRefusal };
/** The ERP client plus the binding's handshake-stamped major (`external_org_bindings.version_major`, via erpClientForOrg). */
export type CapturePrecisionClient = ErpClientDeps & { versionMajor: number | null };

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The scale ERPNext stores purchase amounts at: the shared rule (`currencyPrecisionFromSettings`, by the binding's major
 * version). Capture's own choices over it: a per-currency format is refused as source_precision_per_currency (capture does
 * not resolve each document currency's format), and more than 2 decimals exceeds the mirror. Nothing defaults.
 */
export function capturePrecisionFromSettings(settings: Record<string, unknown>, versionMajor: number | null | undefined): CapturePrecision {
  const rule = currencyPrecisionFromSettings(settings, versionMajor);
  if (!rule.ok) return rule;
  if (rule.scale > 2) return { ok: false, reason: 'source_precision_exceeds_mirror' };
  return { ok: true, scale: rule.scale };
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
