// @e2e-isolation: serial — the bench-host guard shared by every helper that writes ERPNext records (#1359).
/**
 * The serial e2e helpers create ERPNext documents straight on the bench (Project, Timesheet,
 * Budget, Customer fixtures...). That is safe ONLY while the bench is local: a mis-set bench URL
 * must never aim those writes at a remote, client-reachable ERP. Every bench-fetch helper in this
 * directory therefore runs its URL through `assertLocalBenchUrl`, which refuses any host outside
 * the local set unless the run explicitly opts in to a remote bench.
 *
 * The opt-in is deliberately strict (`= 1`): it exists so a deliberate, operator-chosen remote-bench
 * run is possible, never so an accidental URL typo gets tolerated. Under the opt-in, the helpers'
 * cleanups ALSO delete the ERP Projects the run created (a remote bench is shared and is not wiped
 * between runs; the local bench is disposable and keeps its old behaviour).
 */
const LOCAL_BENCH_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

/** True for the local spellings a local run may legitimately use — the IPv6 loopback (bracketed or
 *  bare), any letter case, and the DNS root-qualified `localhost.` form. */
export function isLocalBenchHost(hostname: string): boolean {
  const bare = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[/, '').replace(/\]$/, '');
  return LOCAL_BENCH_HOSTS.has(bare);
}

/** The explicit opt-in that lets a run target a remote bench on purpose. */
export function remoteErpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E2E_ALLOW_REMOTE_ERP === '1';
}

/** Refuse a bench URL whose host is not local — unless the run opted in to a remote bench. */
export function assertLocalBenchUrl(url: string, env: NodeJS.ProcessEnv = process.env): void {
  if (remoteErpAllowed(env)) return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`bench URL does not parse: "${url}"`);
  }
  if (!isLocalBenchHost(host)) {
    throw new Error(
      `refusing non-local ERP bench host "${host}" (${url}): the serial e2e helpers only write ` +
        `ERPNext records on a local bench (localhost / 127.0.0.1 / ::1 / host.docker.internal). ` +
        `Set E2E_ALLOW_REMOTE_ERP=1 to allow a remote bench on purpose.`,
    );
  }
}
