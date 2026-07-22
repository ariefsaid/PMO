/**
 * Named server-side fault seams for the served `adapter-dispatch` money boundary (ADR-0055 P2,
 * FR-ENA-001/003, plan §2 decision 5). Every money-command e2e must exercise the REAL served fn
 * through Kong, never `page.route` — these are the injectable failure points that make R1
 * (idempotency), R2 (transition), and R3 (partial-failure window) provable at that real boundary.
 *
 * Gated by THREE conditions that must ALL hold — `Deno.env.get('ERPNEXT_TEST_FAULTS')==='1'` AND
 * the request header `x-erpnext-test-fault` naming the exact seam AND the request's own host
 * appearing in an explicit `ERPNEXT_TEST_FAULTS_ALLOW_HOST` allowlist — so this module is a pure
 * no-op in every deployed/non-test context (env unset ⇒ byte-for-byte, zero behavior change for
 * slice 0). Never wired to read any OTHER env var or make this decision on request body content —
 * a fault seam must be un-triggerable by an ordinary (non-test) caller, however it shapes its payload.
 *
 * Slice-0 fix-round finding 5 (Med — fault seams as a prod attack surface): the original two-
 * condition gate (`ERPNEXT_TEST_FAULTS='1'` + header) meant a LEAKED env var alone (e.g. a
 * misconfigured Cloud function secret) could arm a seam against real production traffic. We
 * investigated a presence-only local/Cloud env marker first (e.g. `DENO_ENV`/`SB_REGION`-style) —
 * empirically, `supabase functions serve` (local) and Supabase Cloud inject the exact SAME SET of
 * predefined env vars (`SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_ANON_KEY`,
 * `SUPABASE_SERVICE_ROLE_KEY`, ...) — only their VALUES differ (local `SUPABASE_URL` is the
 * internal `http://kong:8000`), so no var's mere PRESENCE reliably distinguishes local/CI from
 * Cloud. We therefore use the documented fallback instead: an explicit allowlist of the REQUEST's
 * own host (`x-forwarded-host`, the host the caller actually connected to — empirically
 * "127.0.0.1:54321"/"localhost:54321" for local/CI, and the project's public domain in Cloud,
 * never one of the allowlisted local values) must ALSO be present and match, via
 * `ERPNEXT_TEST_FAULTS_ALLOW_HOST` (comma-separated). Fails CLOSED: an unset/empty allowlist, or a
 * non-matching host, means NO seam can ever arm — a leaked `ERPNEXT_TEST_FAULTS=1` in a production
 * secret is inert because production traffic never arrives on an allowlisted host.
 */
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** The named seams (FR-ENA-003). PMO-side names only — never ERPNext vocabulary. */
export type FaultSeam =
  | 'after-commit-before-mirror'
  | 'after-submit-before-mirror'
  /** ⚑ HIGH-1 (money-safety audit round 5): the window INSIDE an amend — the predecessor is already
   *  CANCELLED and the replacement has not been created yet. For an `upsertOnGrain` kind (ERP `Budget`)
   *  this is the state in which ERPNext is enforcing NOTHING, and it is the one window no e2e could
   *  drive before (a healthy bench never fails between the two calls), so the recovery that must follow
   *  it was unproven end to end. */
  | 'after-cancel-before-create'
  | 'unreachable'
  | 'reject-validation'
  | 'timeout';

export interface FaultGate {
  /** `Deno.env.get('ERPNEXT_TEST_FAULTS')` — must be the literal string '1'. */
  envFaults: string | undefined;
  /** `req.headers.get('x-erpnext-test-fault')` — must equal the seam being checked. */
  header: string | null | undefined;
  /** The caller-facing host the request actually arrived on — `x-forwarded-host` (falling back to
   *  `Host`), compared against `allowedHosts`. Never `req.url`'s host: that reflects the internal
   *  Docker container hostname (`supabase_edge_runtime_...`), not what the caller connected to. */
  requestHost: string | null | undefined;
  /** `Deno.env.get('ERPNEXT_TEST_FAULTS_ALLOW_HOST')` — a comma-separated allowlist of hosts that
   *  may arm a fault seam (e.g. `"127.0.0.1:54321,localhost:54321"`). Unset/empty ⇒ fail closed:
   *  no host is allowed, so a leaked `ERPNEXT_TEST_FAULTS=1` alone can never arm a seam. */
  allowedHosts: string | undefined;
  /** Injected for the 'timeout' seam (tests supply a fast fake; production uses a real wall-clock
   *  wait). Defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The wall-clock budget the 'timeout' seam simulates exceeding (a generous edge-fn execution
 *  ceiling) — exported so the caller/tests can assert the injected sleep exceeds it. */
export const TIMEOUT_FAULT_BUDGET_MS = 30_000;

/**
 * A no-op unless armed for THIS exact seam (`envFaults==='1'` AND `header===seam`). When armed:
 * - 'unreachable'              -> AdapterError('external-unreachable') — simulates a network-down ERP.
 * - 'reject-validation'        -> AdapterError('commit-rejected') — simulates an ERP-side validation reject.
 * - 'timeout'                  -> sleeps past `TIMEOUT_FAULT_BUDGET_MS` then throws
 *                                  AdapterError('external-unreachable') — simulates a hung request.
 * - 'after-commit-before-mirror' / 'after-submit-before-mirror'
 *                               -> a PLAIN (unclassified) Error — simulates the process dying mid-flow,
 *                                  AFTER the ERP commit/submit succeeded but BEFORE the PMO mirror/ref
 *                                  write landed (the R3 partial-failure window the money outbox,
 *                                  ADR-0058, exists to recover from). Deliberately not an AdapterError:
 *                                  a real crash has no classified shape.
 */
export async function maybeFault(seam: FaultSeam, gate: FaultGate): Promise<void> {
  if (gate.envFaults !== '1' || gate.header !== seam) return;

  const allowedHosts = (gate.allowedHosts ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (allowedHosts.length === 0 || !gate.requestHost || !allowedHosts.includes(gate.requestHost)) {
    // Fail closed (finding 5): refuse to arm — a leaked/misconfigured ERPNEXT_TEST_FAULTS='1' in
    // production is not, by itself, sufficient. Logged loudly (not silently swallowed) so a real
    // misconfiguration — env set somewhere it shouldn't be — is visible in function logs.
    console.error(
      `ERPNEXT_TEST_FAULTS: refused to arm seam '${seam}' — request host '${gate.requestHost ?? '(none)'}' is not in ERPNEXT_TEST_FAULTS_ALLOW_HOST`,
    );
    return;
  }

  switch (seam) {
    case 'unreachable':
      throw new AdapterError('external-unreachable', `ERPNEXT_TEST_FAULTS: simulated seam '${seam}'`);
    case 'reject-validation':
      throw new AdapterError('commit-rejected', `ERPNEXT_TEST_FAULTS: simulated seam '${seam}'`);
    case 'timeout': {
      const sleep = gate.sleep ?? defaultSleep;
      await sleep(TIMEOUT_FAULT_BUDGET_MS + 1);
      throw new AdapterError('external-unreachable', `ERPNEXT_TEST_FAULTS: simulated seam '${seam}' (budget exceeded)`);
    }
    case 'after-cancel-before-create':
      // A TRANSPORT-shaped failure, not a process crash: the point of this seam is the RECOVERABLE
      // window (the outbox must leave the row reclaimable and the next attempt must converge), which a
      // plain crash would not exercise — a crash is already covered by the two mirror seams.
      throw new AdapterError('external-unreachable', `ERPNEXT_TEST_FAULTS: simulated seam '${seam}'`);
    case 'after-commit-before-mirror':
    case 'after-submit-before-mirror':
      throw new Error(`ERPNEXT_TEST_FAULTS: simulated crash at seam '${seam}' (R3 partial-failure window)`);
  }
}
