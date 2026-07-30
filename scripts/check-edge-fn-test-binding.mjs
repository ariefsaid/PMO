#!/usr/bin/env node
/**
 * Guard: edge-function tests MUST bind to the SHIPPED handler.
 *
 * Why this exists (2026-07-17): three separate rounds shipped "all green" edge-fn suites that did not
 * test the deployed code — `unlink.test.ts` re-implemented the handler as a local
 * `handleUnlinkRequestWithDeps` copy, `connect.test.ts` copied the validators, and the
 * external-companies / external-set-company suites never imported their handlers at all. A dead
 * ERPNext Company picker and a `mutateAsync(tier)` bug both shipped green because of it.
 *
 * The rule (per Supabase's official Edge Function testing guidance): import the real handler and mock
 * `globalThis.fetch` — no dependency injection in production code. This script makes "green but not
 * shipped" mechanically impossible: a suite cannot pass CI unless it imports the handler it claims to
 * test, and copied handler/validator logic in a test file is a hard failure.
 *
 * Run: node scripts/check-edge-fn-test-binding.mjs   (paths resolve from this script; wired into verify)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoPath = (file) => resolve(REPO, file);

/** test file -> the shipped handler symbol it must import from ./index.ts */
const REQUIRED = {
  'supabase/functions/external-connect/connect.test.ts': 'handleConnectRequest',
  'supabase/functions/external-companies/companies.test.ts': 'handleCompaniesRequest',
  'supabase/functions/external-set-company/set-company.test.ts': 'handleSetCompanyRequest',
  'supabase/functions/external-link/link.test.ts': 'handleLinkRequest',
  'supabase/functions/external-lists/lists.test.ts': 'handleListsRequest',
  'supabase/functions/external-unlink/unlink.test.ts': 'handleUnlinkRequest',
};

/** Copy anti-patterns: a test re-implementing what it should import. */
const COPY_SMELLS = [
  { re: /\bhandle\w*WithDeps\s*\(/, why: 're-implements the handler locally (handle*WithDeps)' },
  { re: /^\s*(async\s+)?function\s+validateClickUpToken\s*\(/m, why: 'copies validateClickUpToken instead of importing it' },
  { re: /^\s*(async\s+)?function\s+validateErpNextCredentials\s*\(/m, why: 'copies validateErpNextCredentials instead of importing it' },
  { re: /^\s*(async\s+)?function\s+validateErpNextCompany\s*\(/m, why: 'copies validateErpNextCompany instead of importing it' },
  { re: /^\s*(async\s+)?function\s+isPrivateOrReservedHost\s*\(/m, why: 'copies the SSRF host guard instead of importing it' },
];

/** The shipped fn must export the handler and guard Deno.serve, or a test cannot import it safely. */
const SHIPPED = Object.fromEntries(
  Object.entries(REQUIRED).map(([test, symbol]) => [test.replace(/\/[^/]+\.test\.ts$/, '/index.ts'), symbol]),
);

let failed = false;
const fail = (file, msg) => { console.error(`✗ ${file}\n    ${msg}`); failed = true; };

for (const [file, symbol] of Object.entries(REQUIRED)) {
  if (!existsSync(repoPath(file))) { fail(file, 'expected edge-fn test file is missing'); continue; }
  const src = readFileSync(repoPath(file), 'utf8');

  const staticImport = new RegExp(
    `import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*['"]\\./index\\.ts['"]`,
  ).test(src);
  const dynamicImport = new RegExp(
    `\\b${symbol}\\b[^\\n]*=\\s*await\\s+import\\(\\s*['"]\\./index\\.ts['"]\\s*\\)`,
  ).test(src);

  if (!staticImport && !dynamicImport) {
    fail(file, `must import the SHIPPED handler: import { ${symbol} } from './index.ts'\n    (a test that does not import the handler cannot prove the deployed code works)`);
  }
  for (const { re, why } of COPY_SMELLS) {
    if (re.test(src)) fail(file, `${why} — import it from ./index.ts instead`);
  }
}

/**
 * True when `src` contains a serve call — `Deno.serve(` OR `serveWithErrorReporting(` — that is
 * NOT guarded by `if (import.meta.main)`. Exported/pure so a unit test can prove this directly.
 *
 * SILENT-VACUOUSNESS (review round, 2026-07-28): the original check matched ONLY `Deno\.serve\s*\(`.
 * C8 routed the 6 protected files through `serveWithErrorReporting(...)` instead — after that
 * change none of them contain a literal `Deno.serve(` any more, so the original regex's condition
 * could never be true again: it silently stopped enforcing the very guard it exists to protect
 * (a fix that disarms a NEIGHBOURING gate — a fix to the shape a gate matches on, without checking
 * what else matches on that shape). Widened to catch either serve call.
 */
export function hasUnguardedServeCall(src) {
  return /(Deno\.serve|serveWithErrorReporting)\s*\(/.test(src) && !/if\s*\(\s*import\.meta\.main\s*\)/.test(src);
}

for (const [file, symbol] of Object.entries(SHIPPED)) {
  if (!existsSync(repoPath(file))) { fail(file, 'expected edge fn is missing'); continue; }
  const src = readFileSync(repoPath(file), 'utf8');
  if (!new RegExp(`export\\s+(async\\s+)?function\\s+${symbol}\\b`).test(src)) {
    fail(file, `must export the shipped handler: export async function ${symbol}(req: Request)`);
  }
  if (hasUnguardedServeCall(src)) {
    fail(file, 'the serve call (Deno.serve or serveWithErrorReporting) must be guarded by `if (import.meta.main)` — otherwise importing it in a test starts an HTTP server');
  }
}

if (failed) {
  console.error('\nEdge-function tests must bind to the shipped handler (import the real handler + mock globalThis.fetch).');
  console.error('See docs/decisions.md OD-INT-8 and https://supabase.com/docs/guides/functions/unit-test');
  process.exit(1);
}
console.log('✓ edge-fn tests bind to shipped handlers (6/6)');
