// AC-ROP-012: every RPC and table the command-line client reaches with the caller's own token appears, by kind, in the
// latest api_client_request_guard() body. A command-line sign-in carries client_id, so an unlisted name is refused
// before it runs; a mocked test never sees that (#2276).
//
// Scope: literal names only. The CLI's direct calls (`/rest/v1/...`, `api.rpc('...')`) plus, for every edge function the
// CLI posts to, each `.rpc('<name>')` / `.from('<name>')` in its non-test .ts files and the modules those import, and each
// literal name passed to a local wrapper that forwards it (`rpc(c, fn, args)` → `c.rpc(fn, args)`), read at the wrapper's
// call site with the call site's receiver (#2278).
// Calls on a service-role client never meet the guard and are skipped by receiver name (SERVICE_RECEIVERS).
// Dynamic names (`pmo get <table>`, `pmo rpc <name>`) stay with the AC-CLI-015 list test in scripts/pmo.test.mjs.
// Role and method stay with supabase/tests/api_client_request_guard.test.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ACTIVATION_ENABLED } from './lib/pmo-budgets.mjs';

const SELF_TEST = process.argv.includes('--self-test');
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const names = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

// Receivers holding a service-role client. Each must still occur in the scanned source (checked below).
// `supabase` is the sink parameter of recordErrorEvent / checkRequestRate, which every caller feeds a service client.
const SERVICE_RECEIVERS = ['serviceClient', 'sc', 'service', 'supabase'];

// Called by a shipped CLI command, absent from the guard. A name that becomes listed, or that the CLI stops reaching,
// fails the test, so an entry cannot outlive its reason.
const BUDGET_GATE = 'adapter-dispatch budget-domain employment read (authGuard / budget push); reached only by budget activation, which the CLI keeps disabled (ACTIVATION_ENABLED)';
// Found by the wrapper scan (#2278): external-set-company's connect actions pass the name through `rpc(c, fn, args)` on the
// caller token (receiver `c` or `ctx.callerClient`). The CLI posts only readiness / list-projects / verify-links to that
// function; the connect actions are the app's connect review flow. Not widened.
const CONNECT = 'external-set-company connect action via the rpc(c, fn, args) wrapper on the caller token; the CLI sends no connect action';
// Found by the widened scan through a generic receiver (`client`, `c`, `db`, `operatorClient`); each was triaged by its
// call sites and needs no tracking issue.
// Every call site that reaches the helper passes the function's service-role client (`serviceClient` / `ctx.serviceClient`).
const SERVICE_ONLY = 'service-role only: every caller of the helper passes the function\'s service-role client, so the read never meets the guard';
// Caller token, but only on a budget command, which the CLI keeps disabled (same gate as BUDGET_GATE).
const BUDGET_ONLY = 'adapter-dispatch budget-domain read on the caller token (budget occupant / distribution); reached only by budget activation, which the CLI keeps disabled (ACTIVATION_ENABLED)';
// Caller token, but only for a command the CLI never sends to adapter-dispatch.
const APP_ONLY = 'adapter-dispatch read on the caller token for a command the CLI never sends (sales-invoice submit author claim, timesheet push approval check)';
// Operator onboarding (`pmo org create` and its plan and feature steps) under a command-line sign-in.
const OPERATOR = 'operator onboarding call; whether a command-line sign-in may carry operator actions is tracked in issue 2280';
const KNOWN_UNLISTED = new Map([
  ['rpc:import_purchase_history', 'pending: `pmo purchases import-history` (#1855) reaches it from migration 0890; the guard-list migration lands later and removes this entry (it fails once the name is listed)'],
  ['rpc:activate_budget_version', 'deliberate: `pmo budgets activate` is disabled until the owner rules (ACTIVATION_ENABLED)'],
  ['table:external_refs', SERVICE_ONLY],
  ['table:external_command_outbox', SERVICE_ONLY],
  ['rpc:task_domain_externally_owned', SERVICE_ONLY],
  ['table:external_project_bindings', SERVICE_ONLY],
  ['rpc:grant_sales_invoice_submit_clearance', SERVICE_ONLY],
  ['rpc:release_sales_invoice_submit_clearance', SERVICE_ONLY],
  ['rpc:claim_sales_invoice_author', APP_ONLY],
  // #895: manual journals are posted from the app only; no CLI command sends one, so a command-line token stays refused here.
  ['rpc:approved_journal_for_push', APP_ONLY],
  ['rpc:get_process_gates', SERVICE_ONLY],
  ['table:sales_invoices', SERVICE_ONLY],
  ['table:procurements', SERVICE_ONLY],
  ['rpc:record_only_step_refusal', SERVICE_ONLY],
  ['rpc:procurement_gate_violation', SERVICE_ONLY],
  ['rpc:procurement_create_refusal', SERVICE_ONLY],
  ['rpc:po_revision_push_refusal', SERVICE_ONLY],
  ['rpc:procurement_payment_allowed', SERVICE_ONLY],
  ['rpc:procurement_payment_within_ceiling', SERVICE_ONLY],
  ['table:budget_distribution_plans', BUDGET_ONLY],
  ['table:budget_year_distributions', BUDGET_ONLY],
  ['table:external_org_bindings', SERVICE_ONLY],
  ['rpc:record_connect_review', SERVICE_ONLY],
  ['rpc:write_stock_erp_mirror', 'service-role only: EXECUTE is revoked from anon and authenticated and granted only to service_role (0879), so it is not reachable by a client token and never meets the guard'],
  ['rpc:org_has_active_erpnext_binding', BUDGET_GATE],
  ['rpc:create_budget_draft_from_erp', BUDGET_ONLY],
  ['rpc:approved_timesheet_for_push', APP_ONLY],
  ['rpc:service_feature_enabled', SERVICE_ONLY],
  ['table:erp_connect_runs', CONNECT],
  ['table:erp_connect_census', CONNECT],
  ['table:erp_connect_proposals', CONNECT],
  ['table:platform_operators', SERVICE_ONLY],
  ['rpc:connect_proposal_counts', CONNECT],
  ['rpc:list_unlinkable_connect_matches', CONNECT],
  ['rpc:accept_connect_proposals', CONNECT],
  ['rpc:search_connect_staged', CONNECT],
  ['rpc:decide_connect_review', CONNECT],
  ['rpc:unlink_connect_match', CONNECT],
  ['rpc:retry_connect_send', CONNECT],
  ['rpc:operator_set_org_plan', OPERATOR],
  ['rpc:operator_toggle_feature', OPERATOR],
  ['rpc:operator_set_org_lifecycle_state', OPERATOR],
  ['rpc:is_operator', OPERATOR],
  ['rpc:is_active_member', OPERATOR],
  ['rpc:operator_org_plan', OPERATOR],
  ['rpc:operator_plan_catalogue', OPERATOR],
  ['rpc:operator_create_org', OPERATOR],
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
/** The function's non-test .ts files plus every non-test .ts module they import, transitively (one text per file). */
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
  return [...seen].map(read);
}
/**
 * Calls through a local wrapper that forwards a computed name: a function or arrow function whose parameters start with a
 * client and a string (`function rpc<T>(c: SupabaseClient, fn: string, …)`, `const rpc = async (c: SupabaseClient,
 * fn: string) => …`) and whose body calls `c.rpc(fn` or `c.from(fn`. Each call
 * of the wrapper with a literal second argument (`rpc<T>(ctx.callerClient, 'name', …)`) yields [receiver, kind, name];
 * the receiver is the call site's (last dotted segment), so service-role call sites are skipped like direct ones.
 */
export function wrappedCalls(text) {
  const out = [];
  const defRe = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(\s*([A-Za-z_$][\w$]*)\s*:[^,()]*,\s*([A-Za-z_$][\w$]*)\s*:\s*string\b/g;
  // The arrow form: `const rpc = async <T>(c: SupabaseClient, fn: string, …) => c.rpc(fn, …)`.
  const arrowRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:<[^>()]*>)?\s*\(\s*([A-Za-z_$][\w$]*)\s*:[^,()]*,\s*([A-Za-z_$][\w$]*)\s*:\s*string\b/g;
  for (const d of [...text.matchAll(defRe), ...text.matchAll(arrowRe)]) {
    const [, name, client, param] = d;
    const body = text.slice(d.index, d.index + 600);
    const inner = body.match(new RegExp(`\\b${client}\\s*\\.(rpc|from)\\(\\s*${param}\\b`));
    if (!inner) continue;
    const kind = inner[1];
    const useRe = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*(?=[<(])`, 'g');
    for (const u of text.matchAll(useRe)) {
      if (/(?:function|const|let|var)\s+$/.test(text.slice(Math.max(0, u.index - 20), u.index))) continue; // the definition itself
      let i = u.index + u[0].length;
      if (text[i] === '<') { // skip balanced type arguments (`=>` inside a type is not a closer)
        let depth = 0;
        for (; i < text.length; i++) {
          if (text[i] === '<') depth++;
          else if (text[i] === '>' && text[i - 1] !== '=' && --depth === 0) { i++; break; }
        }
      }
      const call = text.slice(i).match(/^\s*\(\s*([A-Za-z_$][\w$.]*)\s*,\s*'([a-z_0-9]+)'/);
      if (call) out.push([call[1].split('.').pop(), kind, call[2]]);
    }
  }
  return out;
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
    const files = sources(fn);
    const all = files.flatMap((t) => [...t.matchAll(callRe)].map(([, recv, how, n]) => [recv, how, n]));
    assert.ok(all.length > 0, `the scan sees no .rpc/.from call in function ${fn}`);
    for (const [recv, how, n] of [...all, ...files.flatMap(wrappedCalls)]) {
      if (!SERVICE_RECEIVERS.includes(recv)) add(how === 'rpc' ? 'rpc' : 'table', n, `function ${fn}`);
    }
  }
  return found;
}

// --self-test: the wrapper detection itself, on a fixture (also runs under node --test).
const WRAPPER_FIXTURE = `
async function rpc<T>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  return data as T;
}
function table(db: SupabaseClient, name: string) { return db.from(name).select('*'); }
function label(c: SupabaseClient, text: string) { return text.trim(); }
const a = await rpc<Record<string, { n: number; f: (x: number) => string }>>(ctx.callerClient, 'fixture_caller_read', {});
await rpc(ctx.serviceClient, 'fixture_service_write', {});
await rpc(c, 'fixture_plain_receiver', {});
table(callerClient, 'fixture_table');
label(c, 'not_a_call');
obj.rpc(c, 'fixture_method_not_wrapper');
const arrowRpc = async <T>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data } = await c.rpc(fn, args);
  return data as T;
};
const arrowTable = (db: SupabaseClient, name: string) => db.from(name).select('*');
await arrowRpc<{ ok: boolean }>(callerClient, 'fixture_arrow_caller_read', {});
arrowTable(ctx.userClient, 'fixture_arrow_table');
`;
function selfTest() {
  assert.deepEqual(wrappedCalls(WRAPPER_FIXTURE), [
    ['callerClient', 'rpc', 'fixture_caller_read'],
    ['serviceClient', 'rpc', 'fixture_service_write'],
    ['c', 'rpc', 'fixture_plain_receiver'],
    ['callerClient', 'from', 'fixture_table'],
    ['callerClient', 'rpc', 'fixture_arrow_caller_read'],
    ['userClient', 'from', 'fixture_arrow_table'],
  ]);
  // The real wrapper in external-set-company is seen at a call site with a literal name.
  const connect = read(path.join(root, 'supabase/functions/external-set-company/connect.ts'));
  assert.ok(wrappedCalls(connect).some(([r, k, n]) => r === 'callerClient' && k === 'rpc' && n === 'accept_connect_proposals'),
    'the wrapper scan sees accept_connect_proposals in external-set-company/connect.ts');
}
test('AC-ROP-012 self-test: a literal name passed to a forwarding wrapper is found, with the call site receiver', selfTest);

// An exception's reason must name a live follow-up, not the issue that closes with this slice (#2278).
test('AC-ROP-012: no KNOWN_UNLISTED reason is tracked in the issue this check shipped with', () => {
  const stale = [...KNOWN_UNLISTED].filter(([, reason]) => /\b(?:issue|#)\s*2278\b/.test(reason)).map(([k]) => k);
  assert.deepEqual(stale, []);
});

if (!SELF_TEST) {
test('AC-ROP-012: the scan covers the functions the CLI posts to, and the service-role receiver list is current', () => {
  assert.ok(fnNames.includes('purchase-capture') && fnNames.includes('adapter-dispatch'), `functions found: ${fnNames}`);
  const src = fnNames.flatMap(sources).join('\n');
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
} // !SELF_TEST
