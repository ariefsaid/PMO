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
 * Run: node scripts/check-edge-fn-test-binding.mjs   (from the repo root; wired into the verify lane)
 */
import { readFileSync, existsSync } from 'node:fs';

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
  if (!existsSync(file)) { fail(file, 'expected edge-fn test file is missing'); continue; }
  const src = readFileSync(file, 'utf8');

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

for (const [file, symbol] of Object.entries(SHIPPED)) {
  if (!existsSync(file)) { fail(file, 'expected edge fn is missing'); continue; }
  const src = readFileSync(file, 'utf8');
  if (!new RegExp(`export\\s+(async\\s+)?function\\s+${symbol}\\b`).test(src)) {
    fail(file, `must export the shipped handler: export async function ${symbol}(req: Request)`);
  }
  if (/Deno\.serve\s*\(/.test(src) && !/if\s*\(\s*import\.meta\.main\s*\)/.test(src)) {
    fail(file, 'Deno.serve must be guarded by `if (import.meta.main)` — otherwise importing it in a test starts an HTTP server');
  }
}

if (failed) {
  console.error('\nEdge-function tests must bind to the shipped handler (import the real handler + mock globalThis.fetch).');
  console.error('See docs/decisions.md OD-INT-8 and https://supabase.com/docs/guides/functions/unit-test');
  process.exit(1);
}
console.log('✓ edge-fn tests bind to shipped handlers (6/6)');
