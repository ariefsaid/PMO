/**
 * The ERPNext activation refusals an Admin can act on (#656), carried from the `external-set-company`
 * 422 body to the Company dialog. The endpoint's `message` is English-only; these structured reasons let
 * the dialog say what to fix in the viewer's language. Attached to the thrown `AppError` via a cast (the
 * same marker pattern as `CommandHeldOutboxMarker`), so plain `.message`/`.code` consumers are unaffected.
 */
import type { AppError } from '@/src/lib/appError';

export type ErpActivationRefusal =
  | { kind: 'missing-reads'; doctypes: string[] }
  | { kind: 'unsupported-version'; versionMajor: number; supportedMajors: number[] };

interface RefusalMarker {
  erpActivationRefusal?: ErpActivationRefusal;
}

/** Reads a recognised refusal off an `external-set-company` error body; `null` for anything else or
 *  any malformed shape (the dialog then shows its generic failure copy). */
export function parseErpActivationRefusal(body: unknown): ErpActivationRefusal | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.reason === 'erpnext-missing-read-permissions') {
    const missing = b.missing;
    if (!Array.isArray(missing) || missing.length === 0 || !missing.every((d) => typeof d === 'string')) return null;
    return { kind: 'missing-reads', doctypes: missing as string[] };
  }
  if (b.reason === 'erpnext-unsupported-version') {
    const isMajor = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const supported = b.supportedMajors;
    if (!isMajor(b.versionMajor) || !Array.isArray(supported) || supported.length === 0 || !supported.every(isMajor)) {
      return null;
    }
    // The supported set comes from the server (`SUPPORTED_VERSION_MAJORS`), never from UI copy.
    return { kind: 'unsupported-version', versionMajor: b.versionMajor, supportedMajors: supported };
  }
  return null;
}

/** Attaches a refusal to an `AppError` (returns the same instance). */
export function withErpActivationRefusal(err: AppError, refusal: ErpActivationRefusal): AppError {
  (err as AppError & RefusalMarker).erpActivationRefusal = refusal;
  return err;
}

/** The refusal attached to a thrown value, or `null`. */
export function erpActivationRefusalOf(err: unknown): ErpActivationRefusal | null {
  return (err as RefusalMarker | null | undefined)?.erpActivationRefusal ?? null;
}
