// AC-ROP-012: every RPC and table the command-line client reaches with the caller's own token appears, by kind, in the
// latest api_client_request_guard() body. A command-line sign-in carries client_id, so an unlisted name is refused
// before it runs; a mocked test never sees that (#2276).
//
// Scope: literal names only. The CLI's direct calls (`/rest/v1/...`, `api.rpc('...')`) plus, for every edge function the
// CLI posts to, each `.rpc('<name>')` / `.from('<name>')` in its non-test .ts files and the modules those import.
// Calls on a service-role client never meet the guard and are skipped by receiver name (SERVICE_RECEIVERS).
// Dynamic names (`pmo get <table>`, `pmo rpc <name>`) stay with the AC-CLI-015 list test in scripts/pmo.test.mjs.
// Role and method stay with supabase/tests/api_client_request_guard.test.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ACTIVATION_ENABLED } from './lib/pmo-budgets.mjs';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const names = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

// Receivers holding a service-role client. Each must still occur in the scanned source (checked below).
// `supabase` is the sink parameter of recordErrorEvent / checkRequestRate, which every caller feeds a service client.
const SERVICE_RECEIVERS = ['serviceClient', 'sc', 'service', 'supabase'];

// Called by a shipped CLI command, absent from the guard. A name that becomes listed, or that the CLI stops reaching,
// fails the test, so an entry cannot outlive its reason.
const DISPATCH = 'dispatch-path read on `pmo purchases receive` (ERP-owned) and external company create; tracked in issue 2278, not widened in the #2276 hotfix';
// Found by the widened scan; the receiver is a generic name (`client`, `c`, `db`), so a call may hold a service-role client.
const ALSO = 'adapter-dispatch / external-set-company helper read, reached through a generic receiver; triage tracked in issue 2278, not widened in the #2276 hotfix';
const KNOWN_UNLISTED = new Map([
  ['rpc:activate_budget_version', 'deliberate: `pmo budgets activate` is disabled until the owner rules (ACTIVATION_ENABLED)'],
  ['table:external_refs', ALSO],
  ['table:external_command_outbox', ALSO],
  ['rpc:actor_authorization_state', DISPATCH],
  ['rpc:task_domain_externally_owned', ALSO],
  ['table:external_project_bindings', ALSO],
  ['rpc:grant_sales_invoice_submit_clearance', ALSO],
  ['rpc:release_sales_invoice_submit_clearance', ALSO],
  ['rpc:claim_sales_invoice_author', ALSO],
  ['rpc:get_process_gates', ALSO],
  ['table:sales_invoices', ALSO],
  ['table:procurements', ALSO],
  ['rpc:record_only_step_refusal', ALSO],
  ['rpc:procurement_gate_violation', ALSO],
  ['rpc:procurement_create_refusal', ALSO],
  ['rpc:po_revision_push_refusal', ALSO],
  ['rpc:procurement_payment_allowed', ALSO],
  ['rpc:procurement_payment_within_ceiling', ALSO],
  ['table:budget_distribution_plans', ALSO],
  ['table:budget_year_distributions', ALSO],
  ['table:external_org_bindings', ALSO],
  ['rpc:record_connect_review', ALSO],
  ['rpc:org_has_active_erpnext_binding', DISPATCH],
  ['rpc:domain_owned_by_tier', DISPATCH],
  ['rpc:pre_cutover_procurement', DISPATCH],
  ['rpc:create_budget_draft_from_erp', ALSO],
  ['rpc:approved_timesheet_for_push', ALSO],
  ['rpc:service_feature_enabled', ALSO],
  ['table:erp_connect_runs', ALSO],
  ['table:erp_connect_census', ALSO],
  ['table:erp_connect_proposals', ALSO],
  ['table:platform_operators', ALSO],
]);

// ── the CLI source ───────────────────────────────────────────────────────────────────────────────
const cliFiles = [path.join(root, 'scripts/pmo.mjs'), ...fs.readdirSync(path.join(root, 'scripts/lib'))
  .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => path.join(root, 'scripts/lib', f))];
const cliSrc = cliFiles.map(read).join('\n');

// ── the latest guard, parsed by array name ───────────────────────────────────────────────────────
const migrations = path.join(root, 'supabase/migrations');
const latest = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /function public\.api_client_request_guard\(\)/.test(read(path.join(migrations, f)))).pop();
assert.ok(latest, 'a migration defines public.api_client_request_guard()');
const guarded = new Set();
for (const m of read(path.join(migrations, latest)).matchAll(/(?<![a-z_])([a-z_]+)\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/g)) {
  const kind = /rpcs$/.test(m[1]) ? 'rpc' : /(tables|views)$/.test(m[1]) ? 'table' : null;
  assert.ok(kind, `guard list ${m[1]} in ${latest} is neither an rpc list (…rpcs) nor a table list (…tables, …views)`);
  for (const n of names(m[2], /'([^']+)'/g)) guarded.add(`${kind}:${n}`);
}
assert.ok(guarded.size > 0, `no allow-lists parsed from ${latest}`);

// ── the edge functions the CLI posts to ──────────────────────────────────────────────────────────
const isTest = (f) => /\.test\.ts$|Fixtures?\.ts$|\.(bed|served)\./.test(f);
/** The function's non-test .ts files plus every non-test .ts module they import, transitively. */
function sources(fn) {
  const dir = path.join(root, 'supabase/functions', fn);
  const todo = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.ts') && !isTest(f)).map((f) => path.join(dir, f));
  const seen = new Set();
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const rel of names(read(f), /(?:from|import)\s*\(?\s*'(\.[^']*\.ts)'/g)) {
      const dep = path.resolve(path.dirname(f), rel);
      if (fs.existsSync(dep) && !isTest(dep)) todo.push(dep);
    }
  }
  return [...seen].map(read).join('\n');
}
const callRe = /([A-Za-z_$][\w$]*)\s*\.(rpc|from)\(\s*'([a-z_0-9]+)'/g;
const fnNames = [...new Set(names(cliSrc, /\/functions\/v1\/([a-z0-9-]+)/g))];

/** Map of `kind:name` → where the CLI reaches it with the caller's token. */
function calls() {
  const found = new Map();
  const add = (kind, n, where) => found.set(`${kind}:${n}`, [...(found.get(`${kind}:${n}`) ?? []), where]);
  for (const n of names(cliSrc, /\/rest\/v1\/rpc\/([a-z_0-9]+)/g)) add('rpc', n, 'pmo (direct)');
  for (const n of names(cliSrc, /\bapi\.rpc\(\s*'([a-z_0-9]+)'/g)) add('rpc', n, 'pmo (api.rpc)');
  for (const n of names(cliSrc, /\/rest\/v1\/([a-z_0-9]+)[?`'"]/g)) add('table', n, 'pmo (direct)');
  for (const fn of fnNames) {
    const src = sources(fn);
    const all = [...src.matchAll(callRe)];
    assert.ok(all.length > 0, `the scan sees no .rpc/.from call in function ${fn}`);
    for (const [, recv, how, n] of all) if (!SERVICE_RECEIVERS.includes(recv)) add(how === 'rpc' ? 'rpc' : 'table', n, `function ${fn}`);
  }
  return found;
}

test('AC-ROP-012: the scan covers the functions the CLI posts to, and the service-role receiver list is current', () => {
  assert.ok(fnNames.includes('purchase-capture') && fnNames.includes('adapter-dispatch'), `functions found: ${fnNames}`);
  const src = fnNames.map(sources).join('\n');
  for (const r of SERVICE_RECEIVERS) assert.match(src, new RegExp(`\\b${r}\\s*\\.(rpc|from)\\(`), `receiver ${r} no longer occurs: update SERVICE_RECEIVERS`);
  assert.ok(calls().has('rpc:purchase_capture_source_page'), 'the scan sees the purchase-capture reads');
});

test('AC-ROP-012: every RPC and table the CLI and its functions reach with the caller token is in the guard, by kind', () => {
  const found = calls();
  const unlisted = [...found.keys()].filter((k) => !guarded.has(k) && !KNOWN_UNLISTED.has(k));
  assert.deepEqual(unlisted.map((k) => `${k} (${[...new Set(found.get(k))].join(', ')})`), [], `unlisted in ${latest}`);
  for (const [k, reason] of KNOWN_UNLISTED) {
    assert.equal(guarded.has(k), false, `${k} is now listed: drop it from KNOWN_UNLISTED (${reason})`);
    assert.ok(found.has(k), `${k} is no longer called by the CLI: drop it from KNOWN_UNLISTED`);
  }
});

test('AC-ROP-012: `pmo budgets activate` stays disabled while activate_budget_version is unlisted', () => {
  assert.equal(ACTIVATION_ENABLED, false);
});
