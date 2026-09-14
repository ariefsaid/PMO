/**
 * ERPNext version handshake + Company-defaults helpers (FR-ENA-011/012, AC-ENA-073, OQ-6; #650/ADR-0073;
 * review #650). `fetchErpVersionMajor` performs the ERPNext version handshake (supported majors
 * {15, 16}) that gates every money command; `companyDefaultsFromDoc` maps one `GET Company/<name>`
 * response onto the config account defaults. The ACTIVATION semantics these helpers used to
 * re-implement in `activateBinding` are deleted — that twin is dead now that activation is the
 * `activate_external_binding` RPC (migration 0216), invoked by `external-set-company`, the sole
 * production consumer of this module. Credentials are ALWAYS the resolved `{apiKey, apiSecret}`
 * — this module never reads `secret_ref`/vault/env itself (NFR-ENA-SEC-002); that resolution happens
 * at the edge-fn boundary and is passed in.
 */
import { callMethod, erpnextRequest, ErpError, type ErpClientDeps } from './client.ts';

/** The ERPNext majors PMO activates. `DD-OPS-10`: the local dev bench is v15.94.3, RIS's target is
 *  v16.33 — both must pass. ⚑ MIRRORED IN SQL: `activate_external_binding`'s `v_supported` array
 *  (migration 0216). The database is the authority (FR-EAC-110); this is the fast/UX gate. Change both. */
export const SUPPORTED_VERSION_MAJORS: readonly number[] = [15, 16];

export interface ErpBindingCreds {
  apiKey: string;
  apiSecret: string;
}

/** The `external_org_bindings.config` shape this module fills (R9 §6.2) — merged with any
 *  caller-supplied config keys (aging report names etc., OQ-3) by the caller, not here. */
export interface ErpBindingConfig {
  company?: string;
  default_payable_account?: string | null;
  default_cash_account?: string | null;
  default_bank_account?: string | null;
  default_expense_account?: string | null;
  cost_center?: string | null;
}

interface GetVersionsResponse {
  erpnext?: { version?: string };
  message?: { erpnext?: { version?: string } };
}

export function parseVersionMajor(body: unknown): number {
  const parsed = body as GetVersionsResponse;
  const version = parsed.erpnext?.version ?? parsed.message?.erpnext?.version;
  const major = version ? Number.parseInt(version.split('.')[0] ?? '', 10) : Number.NaN;
  if (Number.isNaN(major)) throw new Error(`unrecognized ERPNext version payload: ${JSON.stringify(body)}`);
  return major;
}

/** The ONE version handshake: `GET /api/method/frappe.utils.change_log.get_versions` → the major.
 *  Imported by `external-set-company` across the pmo-portal/src seam (the convention `erpnext-sweep`
 *  already uses) so there is never a second copy of this parse. Budget-bounded (review #650): a
 *  5s per-attempt deadline and NO retries — the handshake is a pre-write refusal gate, so a slow
 *  or flapping site must fail fast as `external-unreachable`, not stall Company selection or burn
 *  the default 3-retry budget against an edge-fn timeout.
 */
export async function fetchErpVersionMajor(deps: {
  fetchImpl: typeof fetch;
  creds: ErpBindingCreds;
  siteUrl: string;
}): Promise<number> {
  const clientDeps: ErpClientDeps = {
    fetchImpl: deps.fetchImpl, apiKey: deps.creds.apiKey, apiSecret: deps.creds.apiSecret, baseUrl: deps.siteUrl,
    timeoutMs: 5_000, maxRetries: 0,
  };
  return parseVersionMajor(await callMethod(clientDeps, 'frappe.utils.change_log.get_versions'));
}

/** ERPNext Link fields are ≤140 chars; anything longer, non-string, or empty is never a usable
 *  account default — map it to `null` ("no default") rather than persist a malformed value. */
function boundedDefault(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= 140 ? value : null;
}

/** Map one `GET Company/<name>` response onto the `config` account defaults the money bodies read
 *  (`bodies/paymentEntry.ts` `paid_from`/`paid_to`, `bodies/incomingPayment.ts`). Absent ⇒ `null`
 *  ("no default"), never a guessed account. */
export function companyDefaultsFromDoc(
  companyDoc: Record<string, unknown>, company: string,
): ErpBindingConfig {
  return {
    company,
    default_payable_account: boundedDefault(companyDoc.default_payable_account),
    default_cash_account: boundedDefault(companyDoc.default_cash_account),
    default_bank_account: boundedDefault(companyDoc.default_bank_account),
    default_expense_account: boundedDefault(companyDoc.default_expense_account),
    cost_center: boundedDefault(companyDoc.cost_center),
  };
}

// ─── AC-ENA-084 (task 8.8, R13): the read-permission probe ───────────────────────────────────────

/** The probe scope: the Frappe doctypes the feed mirrors (list-read probe) + the aging report docs
 *  (Report fetch probe). The integration user must have READ perm on every entry or the feed silently
 *  under-syncs (R13). Kept alongside the deleted `activateBinding` twin (review #650): the probe is
 *  NOT activation semantics — it is the ERP-side integration-user perm gate, and nothing server-side
 *  re-implements it.
 */
export interface ReadPermScope {
  /** Frappe DocType names to probe via a `GET /api/resource/<DocType>?limit_page_length=0` (list-read,
   *  no rows fetched — verifies the user can list/read the doctype). */
  doctypes: string[];
  /** Optional report names (e.g. 'Accounts Payable' / 'Accounts Receivable') probed via
   *  `GET /api/resource/Report/<name>` (the Report doc — verifies read access to the report). */
  reportNames?: string[];
}

export interface ReadPermFailure {
  /** `'doctype'` for a list-read failure, `'report'` for a Report-fetch failure. */
  kind: 'doctype' | 'report';
  /** The doctype or report name that failed. */
  name: string;
  /** The classified error message (status + exc_type/message) for the operator warning. */
  error: string;
}

/**
 * Probe the integration user's READ permissions on a set of doctypes + reports (AC-ENA-084, R13).
 * Returns `null` when every entry is readable, or the FIRST failure (the caller refuses activation +
 * warns the operator). Each probe is a stock-REST GET (a list-read with `limit_page_length=0` for a
 * doctype, a Report-doc fetch for a report); a non-2xx throws an `ErpError` (client.ts classifies it) →
 * the failure. PMO RLS is unaffected — this is the ERP-side integration-user perm gate only.
 */
export async function assertErpReadPermissions(
  client: ErpClientDeps,
  scope: ReadPermScope,
): Promise<ReadPermFailure | null> {
  for (const doctype of scope.doctypes) {
    try {
      await erpnextRequest(client, {
        method: 'GET',
        path: `/api/resource/${encodeURIComponent(doctype)}?limit_page_length=0`,
      });
    } catch (err) {
      return { kind: 'doctype', name: doctype, error: permErrorMessage(err) };
    }
  }
  for (const report of scope.reportNames ?? []) {
    try {
      await erpnextRequest(client, {
        method: 'GET',
        path: `/api/resource/Report/${encodeURIComponent(report)}`,
      });
    } catch (err) {
      return { kind: 'report', name: report, error: permErrorMessage(err) };
    }
  }
  return null;
}

/** Shapes an ErpError (or generic Error) into a concise operator-facing permission message. */
function permErrorMessage(err: unknown): string {
  if (err instanceof ErpError) return `${err.code} (HTTP ${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
