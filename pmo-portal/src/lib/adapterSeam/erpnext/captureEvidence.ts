import { readErpPrecision } from './erpLineRounding.ts';
import type { ErpClientDeps } from './client.ts';

export type CapturePrecision = { ok: true; scale: number } | { ok: false; reason: 'source_precision_unknown' | 'source_precision_exceeds_mirror' };

/** The shared reader supplies Frappe field precision; absent settings never become a default. */
export async function readCapturePrecision(client: ErpClientDeps): Promise<CapturePrecision> {
  let witnessed: number | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await client.fetchImpl(input, init);
    if (response.ok) {
      try {
        const body = await response.clone().json();
        const settings = body?.data;
        const raw = settings?.currency_precision;
        if ((typeof raw === 'number' || typeof raw === 'string') && /^\d+$/.test(String(raw))) {
          const digits = Number(raw);
          // Zero delegates to the presentation format in the shared reader; it is not a field witness.
          if (Number.isSafeInteger(digits) && digits > 0) witnessed = digits;
        }
      } catch { /* Invalid settings remain unknown. */ }
    }
    return response;
  };
  const precision = await readErpPrecision({ ...client, fetchImpl });
  if (witnessed === null || precision === null || precision.currency !== witnessed) return { ok: false, reason: 'source_precision_unknown' };
  if (precision.currency > 2) return { ok: false, reason: 'source_precision_exceeds_mirror' };
  return { ok: true, scale: precision.currency };
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
