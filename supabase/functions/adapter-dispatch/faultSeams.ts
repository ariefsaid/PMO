/**
 * Named server-side fault seams for the served `adapter-dispatch` money boundary (ADR-0055 P2,
 * FR-ENA-001/003, plan §2 decision 5). Every money-command e2e must exercise the REAL served fn
 * through Kong, never `page.route` — these are the injectable failure points that make R1
 * (idempotency), R2 (transition), and R3 (partial-failure window) provable at that real boundary.
 *
 * Gated by TWO conditions that must BOTH hold — `Deno.env.get('ERPNEXT_TEST_FAULTS')==='1'` AND
 * the request header `x-erpnext-test-fault` naming the exact seam — so this module is a pure no-op
 * in every deployed/non-test context (env unset ⇒ byte-for-byte, zero behavior change for slice 0).
 * Never wired to read any OTHER env var or make this decision on request body content — a fault
 * seam must be un-triggerable by an ordinary (non-test) caller, however it shapes its payload.
 */
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** The 5 named seams (FR-ENA-003). PMO-side names only — never ERPNext vocabulary. */
export type FaultSeam =
  | 'after-commit-before-mirror'
  | 'after-submit-before-mirror'
  | 'unreachable'
  | 'reject-validation'
  | 'timeout';

export interface FaultGate {
  /** `Deno.env.get('ERPNEXT_TEST_FAULTS')` — must be the literal string '1'. */
  envFaults: string | undefined;
  /** `req.headers.get('x-erpnext-test-fault')` — must equal the seam being checked. */
  header: string | null | undefined;
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
 *                                  ADR-0057, exists to recover from). Deliberately not an AdapterError:
 *                                  a real crash has no classified shape.
 */
export async function maybeFault(seam: FaultSeam, gate: FaultGate): Promise<void> {
  if (gate.envFaults !== '1' || gate.header !== seam) return;

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
    case 'after-commit-before-mirror':
    case 'after-submit-before-mirror':
      throw new Error(`ERPNEXT_TEST_FAULTS: simulated crash at seam '${seam}' (R3 partial-failure window)`);
  }
}
