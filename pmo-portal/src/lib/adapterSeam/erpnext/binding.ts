/**
 * Per-org ERPNext binding activation (FR-ENA-011/012, AC-ENA-073, OQ-6). Performs the v15 version
 * handshake that gates every money command and, only on a match, resolves Company account defaults
 * (one `GET Company/<name>`, R9 §6.2). Credentials are ALWAYS the resolved `{apiKey, apiSecret}` —
 * this module never reads `secret_ref`/vault/env itself (NFR-ENA-SEC-002); that resolution happens
 * at the edge-fn boundary and is passed in.
 */
import { callMethod, erpnextRequest, getDoc, ErpError, type ErpClientDeps } from './client.ts';

/** The version_major P2 activates (FR-ENA-012) — a mismatch leaves the binding un-activated. */
export const SUPPORTED_VERSION_MAJOR = 15;

export interface ErpBindingCreds {
  apiKey: string;
  apiSecret: string;
}

export interface ActivateBindingDeps {
  fetchImpl: typeof fetch;
  creds: ErpBindingCreds;
  siteUrl: string;
  /** `external_org_bindings.config.company` — the Company doctype name to resolve defaults from. */
  company: string;
  /** AC-ENA-084 (task 8.8, R13): the integration-user read-permission probe scope. When present,
   *  activation probes a list-read + a Report fetch for each entry and REFUSES to activate if any is
   *   unreadable (the feed would silently under-sync). Omitted ⇒ no probe (byte-for-byte, back-compat). */
  readPermScope?: ReadPermScope;
}

/** The `external_org_bindings.config` shape this module fills (R9 §6.2) — merged with any
 *  caller-supplied config keys (aging report names etc., OQ-3) by the caller, not here. */
export interface ErpBindingConfig {
  company?: string;
  default_payable_account?: unknown;
  default_cash_account?: unknown;
  default_bank_account?: unknown;
  default_expense_account?: unknown;
  cost_center?: unknown;
}

export interface ActivateBindingResult {
  versionMajor: number;
  /** ISO timestamp when activated (version matched); `null` on a version mismatch — money commands
   *  are refused config-rejected downstream (the dispatch factory, 2.13) until re-activated. */
  activatedAt: string | null;
  config: ErpBindingConfig;
  /** AC-ENA-084: populated when the read-perm probe refused activation (the integration user lacks
   *  read perm on a flipped doctype/report); `undefined` when the probe passed or was not requested. */
  permissionFailure?: ReadPermFailure;
}

interface GetVersionsResponse {
  erpnext?: { version?: string };
  message?: { erpnext?: { version?: string } };
}

function parseVersionMajor(body: unknown): number {
  const parsed = body as GetVersionsResponse;
  const version = parsed.erpnext?.version ?? parsed.message?.erpnext?.version;
  const major = version ? Number.parseInt(version.split('.')[0] ?? '', 10) : Number.NaN;
  if (Number.isNaN(major)) throw new Error(`unrecognized ERPNext version payload: ${JSON.stringify(body)}`);
  return major;
}

/**
 * Perform the version handshake (`GET /api/method/frappe.utils.change_log.get_versions`); on a
 * `version_major === 15` match, resolve Company account defaults with one `GET Company/<name>` and
 * stamp `activatedAt`. A mismatch returns immediately (no Company fetch) with `activatedAt: null`.
 */
export async function activateBinding(
  deps: ActivateBindingDeps,
  now: () => string = () => new Date().toISOString(),
): Promise<ActivateBindingResult> {
  const clientDeps: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.creds.apiKey, apiSecret: deps.creds.apiSecret, baseUrl: deps.siteUrl };

  const versionsBody = await callMethod(clientDeps, 'frappe.utils.change_log.get_versions');
  const versionMajor = parseVersionMajor(versionsBody);

  if (versionMajor !== SUPPORTED_VERSION_MAJOR) {
    return { versionMajor, activatedAt: null, config: {} };
  }

  // AC-ENA-084 (task 8.8, R13): probe the integration user's READ perms on the flipped doctypes +
  // aging reports BEFORE resolving Company defaults — a perm gap would silently under-sync the feed.
  // A failure refuses activation (warn). PMO RLS stays the user-facing authority; this is the ERP-side
  // integration-user perm gate (a different concern from PMO authz).
  if (deps.readPermScope) {
    const failure = await assertErpReadPermissions(clientDeps, deps.readPermScope);
    if (failure) return { versionMajor, activatedAt: null, config: {}, permissionFailure: failure };
  }

  const companyDoc = (await getDoc(clientDeps, 'Company', deps.company)) as Record<string, unknown>;
  const config: ErpBindingConfig = {
    company: deps.company,
    default_payable_account: companyDoc.default_payable_account ?? null,
    default_cash_account: companyDoc.default_cash_account ?? null,
    default_bank_account: companyDoc.default_bank_account ?? null,
    default_expense_account: companyDoc.default_expense_account ?? null,
    cost_center: companyDoc.cost_center ?? null,
  };

  return { versionMajor, activatedAt: now(), config };
}

// ─── AC-ENA-084 (task 8.8, R13): the read-permission probe ───────────────────────────────────────

/** The probe scope: the Frappe doctypes the feed mirrors (list-read probe) + the aging report docs
 *  (Report fetch probe). The integration user must have READ perm on every entry or the feed silently
 *  under-syncs (R13). */
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
