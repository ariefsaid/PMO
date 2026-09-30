/**
 * ERPNext version handshake + Company-defaults helpers (FR-ENA-011/012, AC-ENA-073, OQ-6; #650/ADR-0073;
 * review #650). `fetchErpVersionMajor` performs the ERPNext version handshake (supported majors
 * {15, 16}) that gates every money command; `companyDefaultsFromDoc` maps one `GET Company/<name>`
 * response onto the config account defaults; `probeActivationReadPermissions` is the pre-activation
 * read-permission gate (#656). The ACTIVATION semantics these helpers used to
 * re-implement in `activateBinding` are deleted — that twin is dead now that activation is the
 * `activate_external_binding` RPC (migration 0216), invoked by `external-set-company`, the sole
 * production consumer of this module. Credentials are ALWAYS the resolved `{apiKey, apiSecret}`
 * — this module never reads `secret_ref`/vault/env itself (NFR-ENA-SEC-002); that resolution happens
 * at the edge-fn boundary and is passed in.
 */
import { callMethod, erpnextRequest, ErpError, type ErpClientDeps } from './client.ts';
import { sweepKindsForOrg } from './feedKinds.ts';
import { LEDGER_MIRROR_DOCTYPES } from './ledgerFetch.ts';

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
  return parseVersionMajor(await callMethod(activationClient(deps), 'frappe.utils.change_log.get_versions'));
}

/**
 * The activation time budget (#656 review). `external-set-company` makes three kinds of ERP call before
 * it writes — the Company lookup, the handshake, the read-permission probe — and the browser abandons the
 * request at `DEFAULT_INVOKE_TIMEOUT_MS` (20s). Anything still running after that would activate behind a
 * dialog that already said "failed", so the worst case of all three must end well inside it:
 * 5s (Company) + 5s (handshake) + 7s (whole probe) = 17s, leaving the rest for the database round trips.
 * `binding.test.ts` asserts that sum against the client constant so the two cannot drift apart.
 */
export const ACTIVATION_CALL_TIMEOUT_MS = 5_000;
/** How many read-permission probes run at once — enough to fit a full scope inside the budget, few
 *  enough to be a courteous load on the client's ERP. */
export const ACTIVATION_PROBE_CONCURRENCY = 4;
/** The deadline for the WHOLE probe; past it the probe aborts what is in flight and fails as unreachable. */
export const ACTIVATION_PROBE_TOTAL_BUDGET_MS = 7_000;

/** The per-call activation budget shared by the pre-write refusal gates (the handshake and each
 *  read-perm probe): `ACTIVATION_CALL_TIMEOUT_MS` per attempt and NO retries, so a slow site fails fast. */
function activationClient(deps: { fetchImpl: typeof fetch; creds: ErpBindingCreds; siteUrl: string }): ErpClientDeps {
  return {
    fetchImpl: deps.fetchImpl, apiKey: deps.creds.apiKey, apiSecret: deps.creds.apiSecret, baseUrl: deps.siteUrl,
    timeoutMs: ACTIVATION_CALL_TIMEOUT_MS, maxRetries: 0,
  };
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

// ─── AC-ENA-074 (task 8.8, R13; #656): the read-permission probe ─────────────────────────────────

/** The probe scope: the Frappe doctypes the feed mirrors (list-read probe) + optional report docs
 *  (Report fetch probe). The integration user must have READ perm on every entry or the feed silently
 *  under-syncs (R13). This is the ERP-side integration-user perm gate; PMO RLS is unaffected.
 */
export interface ReadPermScope {
  /** Frappe DocType names to probe via `GET /api/resource/<DocType>?limit_page_length=1` (a one-row
   *  list-read — verifies the user can list/read the doctype without pulling the table). */
  doctypes: string[];
  /** Optional report names probed via `GET /api/resource/Report/<name>` (the Report doc). */
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

/** HTTP answers that mean "this user cannot read that" (Frappe: 403 PermissionError, 401 when the user
 *  is not allowed at all, 404 when the doctype/report is not there). Anything else — a timeout, a 5xx, a
 *  redirect — says nothing about permissions and is rethrown for the caller to report as unreachable. */
const MISSING_READ_STATUSES = new Set([401, 403, 404]);

/**
 * The activation probe scope (#656): exactly what the sweep will read for this org once activated —
 * the doctypes of the domains it owns NOW (`sweepKindsForOrg`, the sweep's own rule; Payment Entry is
 * shared by two kinds and probed once) plus the ledger doctypes the ledger feed reads for every org.
 * The aging reports are deliberately absent: the aging refresh falls back to the ledger mirror, so an
 * unreadable report is not a silent under-sync. Domains employed AFTER activation are not covered.
 */
export function activationReadPermScope(ownedDomains: readonly string[]): ReadPermScope {
  const doctypes = new Set(sweepKindsForOrg(ownedDomains).map(({ doctype }) => doctype));
  for (const ledger of LEDGER_MIRROR_DOCTYPES) doctypes.add(ledger);
  return { doctypes: [...doctypes] };
}

/** Optional limits on a probe run: how many probes at once (default 1) and a deadline for the whole
 *  run (default none). Past the deadline every in-flight probe is aborted and the run rejects. */
export interface ReadPermProbeLimits {
  concurrency?: number;
  totalBudgetMs?: number;
}

/**
 * Probe the integration user's READ permissions on a set of doctypes + reports (AC-ENA-074, R13).
 * Returns EVERY unreadable entry, in scope order (empty when all are readable), so the caller can refuse
 * activation naming them all at once. A non-permission failure (unreachable, 5xx, redirect) — or the
 * whole run outlasting `limits.totalBudgetMs` — rejects: it is not evidence of a missing permission.
 */
export async function assertErpReadPermissions(
  client: ErpClientDeps,
  scope: ReadPermScope,
  limits: ReadPermProbeLimits = {},
): Promise<ReadPermFailure[]> {
  const probes = [
    ...scope.doctypes.map((name) => ({
      kind: 'doctype' as const, name, path: `/api/resource/${encodeURIComponent(name)}?limit_page_length=1`,
    })),
    ...(scope.reportNames ?? []).map((name) => ({
      kind: 'report' as const, name, path: `/api/resource/Report/${encodeURIComponent(name)}`,
    })),
  ];
  // One controller spans the run: aborting it (deadline, a fatal probe, or completion) cancels every
  // request still in flight, so nothing outlives the answer this function gives.
  const run = new AbortController();
  const bounded: ErpClientDeps = {
    ...client,
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => client.fetchImpl(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, run.signal]) : run.signal,
    })) as typeof fetch,
  };
  const results: Array<ReadPermFailure | null> = probes.map(() => null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < probes.length && !run.signal.aborted) {
      const index = next++;
      const probe = probes[index];
      try {
        await erpnextRequest(bounded, { method: 'GET', path: probe.path });
      } catch (err) {
        if (!(err instanceof ErpError) || !MISSING_READ_STATUSES.has(err.status)) throw err;
        results[index] = { kind: probe.kind, name: probe.name, error: `${err.code} (HTTP ${err.status}): ${err.message}` };
      }
    }
  };
  const workers = Math.min(Math.max(1, limits.concurrency ?? 1), probes.length);
  const pool = Promise.all(Array.from({ length: workers }, worker));
  pool.catch(() => undefined); // a rejection after the deadline already answered is expected, not unhandled

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = limits.totalBudgetMs;
  const deadline = budget === undefined ? null : new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ErpError(
      0, 'external-unreachable', `ERPNext read-permission probe exceeded its ${budget}ms budget`, true,
    )), budget);
  });
  try {
    await (deadline ? Promise.race([pool, deadline]) : pool);
  } finally {
    clearTimeout(timer);
    run.abort();
  }
  return results.filter((r): r is ReadPermFailure => r !== null);
}

/** The activation read-permission probe (#656): `activationReadPermScope` with the per-call activation
 *  budget, `ACTIVATION_PROBE_CONCURRENCY` at a time, inside `ACTIVATION_PROBE_TOTAL_BUDGET_MS` overall.
 *  Resolves to the unreadable entries; rejects on an unreachable site or an exhausted budget. */
export function probeActivationReadPermissions(deps: {
  fetchImpl: typeof fetch;
  creds: ErpBindingCreds;
  siteUrl: string;
  ownedDomains: readonly string[];
}): Promise<ReadPermFailure[]> {
  return assertErpReadPermissions(activationClient(deps), activationReadPermScope(deps.ownedDomains), {
    concurrency: ACTIVATION_PROBE_CONCURRENCY,
    totalBudgetMs: ACTIVATION_PROBE_TOTAL_BUDGET_MS,
  });
}
