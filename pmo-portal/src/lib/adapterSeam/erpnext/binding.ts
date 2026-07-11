/**
 * Per-org ERPNext binding activation (FR-ENA-011/012, AC-ENA-073, OQ-6). Performs the v15 version
 * handshake that gates every money command and, only on a match, resolves Company account defaults
 * (one `GET Company/<name>`, R9 §6.2). Credentials are ALWAYS the resolved `{apiKey, apiSecret}` —
 * this module never reads `secret_ref`/vault/env itself (NFR-ENA-SEC-002); that resolution happens
 * at the edge-fn boundary and is passed in.
 */
import { callMethod, getDoc, type ErpClientDeps } from './client.ts';

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
