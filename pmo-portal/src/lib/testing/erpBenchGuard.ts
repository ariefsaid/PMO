/**
 * #1359 — the ONE guard every serial e2e helper/spec routes its ERPNext bench URL through.
 *
 * The serial helpers create ERPNext `Project` / `Timesheet` / `Customer` documents over the bench's
 * own REST API (`e2e/serial/_tspHelpers.ts`, `_budHelpers.ts`, `_sarHelpers.ts`, and the specs' own
 * `BENCH_URL` consts). Their cleanup was only ever proven against the disposable LOCAL bench, so a
 * run pointed at a real ERPNext — the 2026-09-14 crossing dry run did that deliberately — left
 * `PMO-E2E-*` Projects behind on it.
 *
 * So: a bench host that is not `localhost` / `127.0.0.1` / `host.docker.internal` / `[::1]` is REFUSED unless
 * the operator exports `E2E_ALLOW_REMOTE_ERP=1`. The opt-in also buys the cleanup: helpers register
 * every Project they create with `trackErpProject`, and their teardown calls
 * `deleteTrackedErpProjects()`, which DELETEs those documents from the bench.
 *
 * ⚑ Repo rule: never gate on `process.env.CI` (scripts/check-e2e-isolation.sh enforces it). The only
 * question asked here is "is this bench local, or did the operator explicitly opt in".
 *
 * Lives beside `localErpNextUrl.ts` / `localSupabaseUrl.ts` — the repo's home for the local-target
 * guards the e2e lane reads — so the unit test runs under the stock `src/lib/**` Vitest project with
 * no extra config. Unit-tested by `erpBenchGuard.test.ts`.
 */

/** The explicit opt-in that unlocks a non-local bench. */
export const E2E_ALLOW_REMOTE_ERP = 'E2E_ALLOW_REMOTE_ERP';

/** The env var the helpers read their host-side bench base URL from. */
export const BENCH_URL_VAR = 'ERPNEXT_BENCH_URL';

/** The env var carrying the bench origin the SERVED functions reach (container-facing locally). */
export const SITE_URL_VAR = 'ERPNEXT_SITE_URL';

const DEFAULT_BENCH_URL = 'http://localhost:8080';
const DEFAULT_SITE_URL = 'http://host.docker.internal:8080';

// `[::1]` is IPv6 loopback — the WHATWG URL parser keeps the brackets in `hostname`, so that is the
// form compared here (an unbracketed `::1` never reaches this set).
const LOCAL_BENCH_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal', '[::1]']);

/** True when `hostname` is one of the local bench hosts the helpers may write to freely. */
export function isLocalBenchHost(hostname: string): boolean {
  return LOCAL_BENCH_HOSTS.has(hostname.toLowerCase());
}

/** True only when the operator exported `E2E_ALLOW_REMOTE_ERP=1` (any other value opts out). */
export function remoteErpOptedIn(): boolean {
  return process.env[E2E_ALLOW_REMOTE_ERP] === '1';
}

/**
 * Validate a bench base URL and return it. Empty/undefined → `''` (specs that skip when no bench is
 * configured keep that behaviour). A non-local host throws — naming the variable and the opt-in —
 * unless `E2E_ALLOW_REMOTE_ERP=1`. Never rewrites the URL beyond trimming whitespace.
 */
export function guardBenchUrl(raw: string | undefined, varName: string = BENCH_URL_VAR): string {
  const url = (raw ?? '').trim();
  if (url === '') return '';

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(
      `${varName}=${url} is not a valid URL — point it at the bench's base URL (e.g. ${DEFAULT_BENCH_URL})`,
    );
  }
  if (isLocalBenchHost(hostname) || remoteErpOptedIn()) return url;

  throw new Error(
    `Refusing non-local ERPNext bench ${varName}=${url}: the e2e helpers write ERP documents through ` +
      `it and their cleanup is only proven against a LOCAL bench (#1359). Point ${varName} at ` +
      `localhost, 127.0.0.1 or host.docker.internal — or export ${E2E_ALLOW_REMOTE_ERP}=1 to opt in ` +
      `(cleanup then also deletes the ERP Projects these helpers created).`,
  );
}

/** The standard read for a bench variable: env value (or `fallback`), guarded. */
export function benchUrl(varName: string = BENCH_URL_VAR, fallback: string = DEFAULT_BENCH_URL): string {
  return guardBenchUrl(process.env[varName] ?? fallback, varName);
}

/** The container-facing bench origin the served functions use (`ERPNEXT_SITE_URL`), guarded. */
export function siteUrl(): string {
  return benchUrl(SITE_URL_VAR, DEFAULT_SITE_URL);
}

/**
 * Guarded read that stays `''` when the variable is unset — for specs whose no-bench path must SKIP
 * rather than fall back to the local default. A non-local value still throws.
 */
export function benchUrlOrEmpty(varName: string = BENCH_URL_VAR): string {
  return guardBenchUrl(process.env[varName], varName);
}

/**
 * Guarded `ERPNEXT_SITE_URL` that stays `''` when the variable is unset — for specs whose no-bench
 * path must SKIP rather than fall back to the local default. A non-local value still throws.
 */
export function siteUrlOrEmpty(): string {
  return benchUrlOrEmpty(SITE_URL_VAR);
}

/**
 * The one place the bench token header is built (`Authorization: token key:secret`). The e2e helpers
 * spread this into their own headers so credential plumbing cannot drift from the guard's DELETE.
 */
export function benchAuthHeaders(): Record<string, string> {
  const key = process.env.ERPNEXT_BENCH_API_KEY ?? '';
  const secret = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
  return { Authorization: `token ${key}:${secret}` };
}

// ── ERP Project ledger (the opted-in cleanup) ────────────────────────────────────────────────
// Per-process: each Playwright worker is its own process and the serial lane runs `--workers=1`,
// so this ledger exactly mirrors "Projects this process's helpers created since the last cleanup".

const createdErpProjects = new Set<string>();

/** Helpers call this right after a successful `POST /api/resource/Project`. Idempotent per name. */
export function trackErpProject(name: string): void {
  createdErpProjects.add(name);
}

/** The ledger, in insertion order — exposed for tests and diagnostics. */
export function trackedErpProjects(): string[] {
  return [...createdErpProjects];
}

/** Drop everything from the ledger without deleting (test reset / after a successful cleanup). */
export function forgetErpProjects(): void {
  createdErpProjects.clear();
}

/** DELETE one ERPNext document over the stock REST surface, with the helpers' bench credentials. */
export async function deleteErpProject(name: string): Promise<void> {
  const base = benchUrl();
  if (base === '') return;
  const res = await fetch(`${base}/api/resource/Project/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: benchAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`bench DELETE Project/${name} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

/**
 * Cleanup path: DELETE every Project the helpers created this run — but ONLY when
 * `E2E_ALLOW_REMOTE_ERP=1` is set (the issue's deal: the opt-in buys the deletion too; the local
 * bench keeps its pre-existing reset behaviour). Best-effort per project — a document still blocked
 * by linked docs is recorded in `failed`, never thrown, so teardown never masks the test's own
 * result. The ledger is always cleared, so a later cleanup in the same process cannot re-delete.
 */
export async function deleteTrackedErpProjects(): Promise<{ deleted: string[]; failed: string[] }> {
  const names = trackedErpProjects();
  forgetErpProjects();
  if (!remoteErpOptedIn()) return { deleted: [], failed: [] };

  const deleted: string[] = [];
  const failed: string[] = [];
  for (const name of names) {
    try {
      await deleteErpProject(name);
      deleted.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { deleted, failed };
}
