/**
 * Shared helper for negative-grep gate tests (e.g. AC-AR-010, AC-MC-010, AC-AR-011):
 * "assert this pattern has ZERO matches under a directory."
 *
 * Uses `grep -rlE` (present on every CI runner + macOS — unlike ripgrep, which is not
 * guaranteed to be installed) as the search tool.
 *
 * Correctness-critical distinction: a grep exit status of 1 means "ran fine, found
 * nothing" — the actual pass condition for these gates. ANY other failure (ENOENT/127
 * when the grep binary is missing, exit 2 on a grep usage/IO error, etc.) must NOT be
 * silently treated as "no matches" — that would let the gate pass for the wrong reason
 * and give false confidence. Those failures throw so the gate fails loudly instead.
 */
import { execSync } from 'node:child_process';

export interface RunNegativeGrepOptions {
  /** Working directory to search from. */
  cwd: string;
  /** Filename globs to exclude (grep --exclude=<glob>), e.g. the test file itself. */
  excludeGlobs?: string[];
  /** Directory subtrees to exclude (grep --exclude-dir=<dir>), e.g. the adapter's own directory. */
  excludeDirs?: string[];
}

/**
 * Directories `grep -r` would otherwise crawl but that ripgrep skips automatically
 * via .gitignore-awareness. grep has no such awareness, so these must be excluded
 * explicitly (most importantly node_modules — multi-hundred-MB and irrelevant to
 * a source-literal gate).
 */
const ALWAYS_EXCLUDED_DIRS = ['node_modules', 'dist', 'dist-ssr', 'coverage', '.git'];

/**
 * Runs `grep -rlE <pattern> .` under `opts.cwd` and returns the matching file list
 * (empty string when there are no matches — the pass condition for negative-grep gates).
 *
 * Throws `Error('grep gate could not run: <message>')` for any non-"no matches" failure
 * (missing binary, grep usage error, etc.) so the gate fails loudly instead of silently
 * passing.
 */
export function runNegativeGrep(pattern: string, opts: RunNegativeGrepOptions): string {
  const excludeDirArgs = [...ALWAYS_EXCLUDED_DIRS, ...(opts.excludeDirs ?? [])]
    .map((dir) => `--exclude-dir=${dir}`)
    .join(' ');
  const excludeFileArgs = (opts.excludeGlobs ?? [])
    .map((glob) => `--exclude=${glob}`)
    .join(' ');
  const cmd = `grep -rlE ${excludeDirArgs} ${excludeFileArgs} ${JSON.stringify(pattern)} .`
    .replace(/\s+/g, ' ')
    .trim();
  try {
    return execSync(cmd, { cwd: opts.cwd }).toString();
  } catch (err) {
    const execErr = err as NodeJS.ErrnoException & { status?: number };
    if (execErr.status === 1) {
      // grep's "ran fine, no matches" exit code — the pass condition.
      return '';
    }
    throw new Error(`grep gate could not run: ${execErr.message}`, { cause: err });
  }
}
