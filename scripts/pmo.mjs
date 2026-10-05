#!/usr/bin/env node
/**
 * pmo — read and write PMO records from the command line, signed in as yourself (issue #728).
 *
 * The CLI signs in through Supabase's OAuth 2.1 server (authorization code + PKCE S256, a
 * pre-registered PUBLIC client, loopback redirect — DD-API-2). The token it holds is an ordinary
 * user session token, so row-level security treats every call exactly like your browser. It never
 * uses a service-role key. Runbook: docs/runbooks/pmo-cli.md.
 *
 *   pmo login | logout | whoami
 *   pmo get <table> [--select a,b] [--filter col=op.value ...] [--limit n]
 *   pmo create <table> <json | @file | ->
 *   pmo update <table> --filter col=op.value [...] <json | @file | ->
 *   pmo rpc <name> [<json | @file | ->]
 *   pmo load <file.json | -> [--dry-run]   (active Admin only — #796)
 *
 * Output is JSON on stdout; errors are JSON on stderr. Exit 0 = ok, 1 = the server refused or
 * failed, 2 = the CLI refused (usage, allow-list, DD-API-3 guard) before sending anything.
 *
 * ⚑ The allow-lists and the contract_value / project-status refusals below are a CLI-level guard
 *   (DD-API-3) — they keep this surface small. The DATABASE remains the authority: RLS and the
 *   security-definer RPCs decide every write, whatever a caller sends.
 *
 * Node 22 standard library only.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { applyLoad, countActions, resolveLoad, validateLoadFile } from './lib/pmo-load.mjs';

// ── the public surface (DD-API-1 / DD-API-3) ─────────────────────────────────────────────────────

/** The only tables the CLI reads or writes — DD-API-3's "open first" entities. */
export const ALLOWED_TABLES = Object.freeze([
  'projects',
  'project_milestones',
  'tasks',
  'meetings',
  'crm_activities',
  'companies',
  'contacts',
]);

/**
 * Tables the CLI may READ but never write, each through a fixed set of columns (the default
 * `--select`; a narrower one is allowed, `*` is not, and filters are limited to the same columns).
 * `profiles` is here so ids can be looked up for `project_manager_id` / `assignee_id`: the app's
 * people pickers render exactly id → full_name; role, title and status help pick the right person.
 * Contact details and personal settings stay out.
 */
export const READ_ONLY_TABLES = Object.freeze({
  profiles: Object.freeze(['id', 'full_name', 'role', 'title', 'status']),
  // #796: `pmo load` reads whether ERPNext owns companies — the rows the app shows on Integrations.
  external_domain_ownership: Object.freeze(['domain', 'external_tier']),
});

/**
 * The only RPCs the CLI calls. Creating and updating the entities above needs none — the app
 * writes them as plain table rows — so this holds one read helper (SECURITY INVOKER, under RLS).
 * Never a money, transition or budget-activation RPC (DD-API-3).
 */
export const ALLOWED_RPCS = Object.freeze(['get_project_milestones']);

/**
 * The ACTIVE-ADMIN tier (#796, ADR-0074), used only by `pmo load` — never by get/create/update/rpc.
 * The database guard (migration 0234) allows these only to an active Admin's OAuth token: POST on the
 * RPCs, GET/POST on the tables. The RPCs keep their own org, role, SoD and audit rules.
 */
export const LOAD_RPCS = Object.freeze(['set_project_contract_value', 'transition_project']);
export const LOAD_TABLES = Object.freeze(['budget_versions', 'budget_line_items']);

/** The verbs. There is deliberately no delete (DD-API-3). */
export const COMMANDS = Object.freeze(['login', 'logout', 'whoami', 'get', 'create', 'update', 'rpc', 'load']);

const DELETE_VERBS = new Set(['delete', 'del', 'rm', 'remove', 'destroy']);

/** A project is originated as one of these; every other status is reached by a transition in the app. */
export const PROJECT_ORIGINATION_STATUSES = Object.freeze(['Leads', 'Internal Project']);

/**
 * The loopback ports the CLI listens on for the OAuth redirect. Supabase Auth matches a redirect
 * URI EXACTLY (it has no RFC 8252 any-port rule for loopback), so these ports are registered with
 * the client (scripts/register-oauth-client.mjs) and the CLI binds the first free one.
 */
export const LOOPBACK_PORTS = Object.freeze([53917, 53918, 53919]);
const CALLBACK_PATH = '/callback';

export const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:54321';
const DEFAULT_LOGIN_TIMEOUT_S = 300;
/** Refresh this many seconds before the access token actually expires. */
const REFRESH_SKEW_S = 60;

const FILTER_OPERATORS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'match', 'imatch',
  'is', 'isdistinct', 'in', 'cs', 'cd', 'ov', 'fts', 'plfts', 'phfts', 'wfts',
];
const FILTER_VALUE = new RegExp(`^(not\\.)?(${FILTER_OPERATORS.join('|')})(\\([a-z_]+\\))?\\.`, 's');
const COLUMN = /^[a-z_][a-z0-9_]*$/;
const SELECT = /^(\*|[a-z_][a-z0-9_]*)(,(\*|[a-z_][a-z0-9_]*))*$/;
const RESERVED_PARAMS = new Set(['select', 'limit', 'offset', 'order', 'on_conflict', 'columns', 'or', 'and', 'not']);

export function loopbackRedirectUris(ports = LOOPBACK_PORTS) {
  return ports.map((p) => `http://127.0.0.1:${p}${CALLBACK_PATH}`);
}

// ── errors ───────────────────────────────────────────────────────────────────────────────────────

class CliError extends Error {
  /** @param {string} message @param {{exit?: number, code?: string, status?: number, details?: unknown, hint?: unknown}} [info] */
  constructor(message, info = {}) {
    super(message);
    this.exit = info.exit ?? 1;
    this.code = info.code;
    this.status = info.status;
    this.details = info.details;
    this.hint = info.hint;
  }
}
const usage = (message) => new CliError(message, { exit: 2 });

// ── PKCE ─────────────────────────────────────────────────────────────────────────────────────────

export function challengeFor(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function createPkce() {
  const verifier = crypto.randomBytes(48).toString('base64url'); // 64 chars, within RFC 7636's 43..128
  return { verifier, challenge: challengeFor(verifier) };
}

export function buildAuthorizeUrl({ supabaseUrl, clientId, redirectUri, challenge, state }) {
  const url = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();
  return url.toString();
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── query building + write guards ────────────────────────────────────────────────────────────────

/**
 * @param {{select?: string, filters?: string[], limit?: string|number, table?: string, columns?: readonly string[]}} args
 *   `columns` narrows a read-only table: it is the default select, and the only columns that may be
 *   selected or filtered on.
 */
export function buildQuery({ select, filters = [], limit, table = 'this table', columns } = {}) {
  const q = new URLSearchParams();
  if (select !== undefined) {
    if (!SELECT.test(select)) {
      throw usage(`--select takes '*' or comma-separated column names (no embeds): got '${select}'`);
    }
    if (columns && select.split(',').some((c) => !columns.includes(c))) {
      throw usage(`--select on ${table} is limited to: ${columns.join(', ')}`);
    }
    q.set('select', select);
  } else if (columns) {
    q.set('select', columns.join(','));
  }
  for (const f of filters) {
    const eq = f.indexOf('=');
    if (eq <= 0) throw usage(`--filter must be col=op.value (e.g. status=eq.Leads): got '${f}'`);
    const col = f.slice(0, eq);
    const value = f.slice(eq + 1);
    if (RESERVED_PARAMS.has(col)) throw usage(`--filter column '${col}' is a reserved query parameter`);
    if (!COLUMN.test(col)) throw usage(`--filter column '${col}' is not a column name`);
    if (columns && !columns.includes(col)) throw usage(`--filter on ${table} is limited to: ${columns.join(', ')}`);
    if (!FILTER_VALUE.test(value)) {
      throw usage(`--filter '${f}' needs an operator, e.g. ${col}=eq.value (operators: ${FILTER_OPERATORS.join(', ')}, optionally prefixed by not.)`);
    }
    q.append(col, value);
  }
  if (limit !== undefined) {
    if (!/^[1-9]\d*$/.test(String(limit))) throw usage(`--limit must be a positive integer: got '${limit}'`);
    q.set('limit', String(limit));
  }
  return q;
}

function assertTable(table, mode) {
  if (Object.hasOwn(READ_ONLY_TABLES, table)) {
    if (mode === 'read') return;
    throw usage(`${table} is read-only from the CLI. Change it in the app.`);
  }
  if (LOAD_TABLES.includes(table)) {
    throw usage(`Table '${table}' is not available to get/create/update; only \`pmo load\` writes it (draft budgets). Change budgets in the app.`);
  }
  if (!ALLOWED_TABLES.includes(table)) {
    throw usage(
      `Table '${table}' is not available from the CLI. Available: ${ALLOWED_TABLES.join(', ')}; read-only: ${Object.keys(READ_ONLY_TABLES).join(', ')}`,
    );
  }
}

function assertRpc(name) {
  if (LOAD_RPCS.includes(name)) {
    throw usage(`RPC '${name}' is not available to \`pmo rpc\`; only \`pmo load\` uses it. Move stages and set contract values in the app.`);
  }
  if (!ALLOWED_RPCS.includes(name)) {
    throw usage(`RPC '${name}' is not available from the CLI. Available: ${ALLOWED_RPCS.join(', ')}`);
  }
}

/**
 * DD-API-3's closed fields, refused before anything is sent. A CLI-level guard only — the
 * database's grants, RLS and RPCs remain the authority on every write.
 */
export function guardWritePayload(table, body, mode) {
  const rows = Array.isArray(body) ? body : [body];
  if (rows.length === 0) throw usage('The payload is an empty list');
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw usage('Each row must be a JSON object');
    }
    if (Object.hasOwn(row, 'archived_at')) {
      throw usage('archived_at cannot be set from the CLI. Archive and restore records in the app.');
    }
    if (Object.hasOwn(row, 'contract_value')) {
      throw usage('contract_value cannot be set from the CLI (DD-API-3). Set it in the app, where its approval rules apply.');
    }
    if (table === 'projects' && Object.hasOwn(row, 'status')) {
      if (mode === 'update') {
        throw usage('A project status cannot be changed from the CLI (DD-API-3). Move a project through its stages in the app.');
      }
      if (!PROJECT_ORIGINATION_STATUSES.includes(row.status)) {
        throw usage(`A project can only be created as ${PROJECT_ORIGINATION_STATUSES.map((s) => `'${s}'`).join(' or ')} (DD-API-3); got '${row.status}'.`);
      }
    }
  }
}

// ── credentials store ────────────────────────────────────────────────────────────────────────────

function configDir(env) {
  if (env.PMO_CONFIG_DIR) return env.PMO_CONFIG_DIR;
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'pmo');
}

function credentialsFile(env) {
  return path.join(configDir(env), 'credentials.json');
}

function readAll(env) {
  let text;
  try {
    text = fs.readFileSync(credentialsFile(env), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new CliError(`${credentialsFile(env)} is not valid JSON — remove it and run \`pmo login\` again`);
  }
}

/** Write the whole store owner-only: dir 0700, file 0600, atomically (temp file + rename). */
function writeAll(env, all) {
  const dir = configDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const file = credentialsFile(env);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function readCredentials(env, supabaseUrl) {
  return readAll(env)[supabaseUrl] ?? null;
}

export function writeCredentials(env, supabaseUrl, entry) {
  const all = readAll(env);
  all[supabaseUrl] = entry;
  writeAll(env, all);
}

function deleteCredentials(env, supabaseUrl) {
  const all = readAll(env);
  delete all[supabaseUrl];
  writeAll(env, all);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────

async function send(ctx, method, url, { headers = {}, body, form } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      redirect: 'error', // never carry the user's token to wherever a redirect points
      headers: {
        apikey: ctx.key,
        accept: 'application/json',
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: form ? new URLSearchParams(form).toString() : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (/redirect/i.test(String(e.cause?.message ?? ''))) {
      throw new CliError(`Refused to follow a redirect from ${new URL(url).origin} — check the Supabase URL`);
    }
    throw new CliError(`Could not reach ${ctx.supabaseUrl} (${e.cause?.code ?? e.message})`);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, ok: res.ok, data };
}

function apiError(r) {
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  const message = d.message ?? d.msg ?? d.error_description ?? (typeof d.error === 'string' ? d.error : null) ?? (typeof r.data === 'string' && r.data) ?? `HTTP ${r.status}`;
  const code = typeof d.code === 'string' ? d.code : (d.error_code ?? (typeof d.error === 'string' ? d.error : undefined));
  return new CliError(message, { status: r.status, code, details: d.details ?? undefined, hint: d.hint ?? undefined });
}

const nowSeconds = (ctx) => Math.floor(ctx.now() / 1000);

function sessionFrom(ctx, tokens, clientId, user) {
  return {
    client_id: clientId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: nowSeconds(ctx) + Number(tokens.expires_in ?? 3600),
    user,
  };
}

function requireSession(ctx) {
  const creds = readCredentials(ctx.env, ctx.supabaseUrl);
  if (!creds || !creds.refresh_token) {
    throw new CliError(`Not signed in to ${ctx.supabaseUrl}. Run \`pmo login\`.`);
  }
  return creds;
}

/** Exchange the refresh token (rotation: the server issues a NEW one, which is persisted). */
async function refresh(ctx, creds) {
  const r = await send(ctx, 'POST', `${ctx.supabaseUrl}/auth/v1/oauth/token`, {
    form: { grant_type: 'refresh_token', refresh_token: creds.refresh_token, client_id: creds.client_id },
  });
  if (!r.ok || !r.data?.access_token) {
    const e = apiError(r);
    throw new CliError(`Your session could not be refreshed (${e.message}). Run \`pmo login\` again.`, {
      status: e.status,
      code: e.code,
    });
  }
  const next = sessionFrom(ctx, r.data, creds.client_id, creds.user);
  writeCredentials(ctx.env, ctx.supabaseUrl, next);
  return next;
}

/** An authenticated call under the user's own token; refreshes when expiring or on one 401. */
async function authed(ctx, method, pathAndQuery, opts = {}) {
  let creds = requireSession(ctx);
  if (Number(creds.expires_at ?? 0) - REFRESH_SKEW_S <= nowSeconds(ctx)) creds = await refresh(ctx, creds);
  const call = (c) =>
    send(ctx, method, `${ctx.supabaseUrl}${pathAndQuery}`, {
      ...opts,
      headers: { ...opts.headers, authorization: `Bearer ${c.access_token}` },
    });
  let r = await call(creds);
  if (r.status === 401) {
    creds = await refresh(ctx, creds);
    r = await call(creds);
  }
  if (!r.ok) throw apiError(r);
  return r.data;
}

// ── logout ─────────────────────────────────────────────────────────────────────────────────────

/**
 * End this session on the server, then forget it locally. An expired access token is refreshed
 * first so the revoke is authenticated. If the server does not confirm the revoke, the credentials
 * are KEPT (so `pmo logout` can be retried) and the command fails. A refresh the server refuses
 * (400) means the session has already ended there; then only the local copy is removed.
 */
async function logout(ctx) {
  let creds = readCredentials(ctx.env, ctx.supabaseUrl);
  if (!creds) return { signed_out: true, url: ctx.supabaseUrl };
  if (Number(creds.expires_at ?? 0) - REFRESH_SKEW_S <= nowSeconds(ctx)) {
    try {
      creds = await refresh(ctx, creds);
    } catch (e) {
      if (e.status === 400) {
        deleteCredentials(ctx.env, ctx.supabaseUrl);
        return { signed_out: true, url: ctx.supabaseUrl, already_ended: true };
      }
      throw e;
    }
  }
  // scope=local revokes THIS session only — the user's browser sessions stay signed in.
  const r = await send(ctx, 'POST', `${ctx.supabaseUrl}/auth/v1/logout?scope=local`, {
    headers: { authorization: `Bearer ${creds.access_token}` },
  });
  if (!r.ok) {
    const e = apiError(r);
    throw new CliError(`The server did not confirm the sign-out (${e.message}); your credentials were kept. Run \`pmo logout\` again.`, {
      status: e.status,
      code: e.code,
    });
  }
  deleteCredentials(ctx.env, ctx.supabaseUrl);
  return { signed_out: true, url: ctx.supabaseUrl };
}

// ── login ────────────────────────────────────────────────────────────────────────────────────────

const PAGE = (title, body) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body></html>`;

function listenOnFirstFreePort(server, ports) {
  return new Promise((resolve, reject) => {
    const tryAt = (i) => {
      if (i >= ports.length) {
        reject(new CliError(`None of the sign-in ports are free (${ports.join(', ')}). Close the other \`pmo login\` and retry.`));
        return;
      }
      const onError = (e) => {
        server.off('listening', onListening);
        if (e.code === 'EADDRINUSE') tryAt(i + 1);
        else reject(e);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(server.address().port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(ports[i], '127.0.0.1');
    };
    tryAt(0);
  });
}

async function login(ctx, flags) {
  const clientId = flags['client-id'] ?? ctx.env.PMO_CLIENT_ID;
  if (!clientId) {
    throw usage('Set PMO_CLIENT_ID (or pass --client-id) to the PMO CLI OAuth client id — see docs/runbooks/pmo-cli.md');
  }
  const timeoutS = flags.timeout === undefined ? DEFAULT_LOGIN_TIMEOUT_S : Number(flags.timeout);
  if (!(timeoutS > 0)) throw usage(`--timeout must be a positive number of seconds: got '${flags.timeout}'`);

  const { verifier, challenge } = createPkce();
  const state = crypto.randomBytes(24).toString('base64url');

  let settle;
  const callback = new Promise((resolve, reject) => (settle = { resolve, reject }));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end();
      return;
    }
    const reply = (status, title, body) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(PAGE(title, body));
    };
    // Only the genuine redirect settles the login: it must be addressed to the exact registered
    // loopback host and carry this login's state. Anything else is answered 400 and ignored.
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || !sameSecret(url.searchParams.get('state') ?? '', state)) {
      reply(400, 'Not this sign-in', 'This response does not belong to the sign-in in progress.');
      return;
    }
    const error = url.searchParams.get('error');
    if (error) {
      reply(400, 'Sign-in was not completed', 'You can close this tab.');
      settle.reject(new CliError(`Sign-in was not completed: ${error}${url.searchParams.get('error_description') ? ` — ${url.searchParams.get('error_description')}` : ''}`, { code: error }));
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      reply(400, 'Sign-in failed', 'No authorization code was returned.');
      settle.reject(new CliError('Sign-in failed: no authorization code was returned'));
      return;
    }
    reply(200, 'Signed in to PMO', 'You can close this tab and return to the terminal.');
    settle.resolve(code);
  });

  const port = await listenOnFirstFreePort(server, ctx.ports);
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const authorizeUrl = buildAuthorizeUrl({ supabaseUrl: ctx.supabaseUrl, clientId, redirectUri, challenge, state });
  const timer = setTimeout(
    () => settle.reject(new CliError(`Sign-in timed out after ${timeoutS} s. Run \`pmo login\` again.`)),
    timeoutS * 1000,
  );
  try {
    ctx.stderr.write(`Open this URL in your browser to sign in to PMO:\n${authorizeUrl}\n`);
    if (!flags['no-browser']) {
      Promise.resolve()
        .then(() => ctx.openBrowser(authorizeUrl))
        .catch(() => {});
    }
    const code = await callback;
    const r = await send(ctx, 'POST', `${ctx.supabaseUrl}/auth/v1/oauth/token`, {
      form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier },
    });
    if (!r.ok || !r.data?.access_token) throw apiError(r);
    const user = await send(ctx, 'GET', `${ctx.supabaseUrl}/auth/v1/user`, {
      headers: { authorization: `Bearer ${r.data.access_token}` },
    });
    if (!user.ok) throw apiError(user);
    const who = { id: user.data.id, email: user.data.email };
    writeCredentials(ctx.env, ctx.supabaseUrl, sessionFrom(ctx, r.data, clientId, who));
    return { signed_in: true, url: ctx.supabaseUrl, user: who };
  } finally {
    clearTimeout(timer);
    server.closeAllConnections?.();
    server.close();
  }
}

function defaultOpenBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['explorer.exe', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

// ── argument parsing ─────────────────────────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['url', 'key', 'client-id', 'select', 'filter', 'limit', 'timeout']);
const BOOL_FLAGS = new Set(['no-browser', 'help', 'dry-run']);

export function parseArgs(argv) {
  const flags = { filter: [] };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '-' || !arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (BOOL_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw usage(`Unknown option --${name}`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined) throw usage(`--${name} needs a value`);
    if (name === 'filter') flags.filter.push(value);
    else flags[name] = value;
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags };
}

async function readPayload(ctx, arg, { optional = false } = {}) {
  if (arg === undefined) {
    if (optional) return {};
    throw usage('A JSON payload is required (inline JSON, @file, or - for stdin)');
  }
  let text;
  if (arg === '-') {
    const chunks = [];
    for await (const chunk of ctx.stdin) chunks.push(chunk);
    text = Buffer.concat(chunks.map((c) => (typeof c === 'string' ? Buffer.from(c) : c))).toString('utf8');
  } else if (arg.startsWith('@')) {
    try {
      text = fs.readFileSync(arg.slice(1), 'utf8');
    } catch (e) {
      throw usage(`Could not read ${arg.slice(1)}: ${e.code ?? e.message}`);
    }
  } else {
    text = arg;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw usage('The payload is not valid JSON');
  }
}

function resolveTarget(env, flags) {
  const raw = (flags.url ?? env.PMO_SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw usage(`Not a URL: '${raw}'`);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    throw usage(`The Supabase URL must use https (plain http is allowed only for the local stack): '${raw}'`);
  }
  const key = flags.key ?? env.PMO_SUPABASE_KEY;
  if (!key) {
    throw usage("Set PMO_SUPABASE_KEY to the project's publishable (anon) key — for the local stack, `supabase status` prints it");
  }
  return { supabaseUrl: raw, key };
}

const USAGE = `usage:
  pmo login [--client-id <id>] [--no-browser] [--timeout <seconds>]
  pmo logout
  pmo whoami
  pmo get <table> [--select a,b] [--filter col=op.value ...] [--limit n]
  pmo create <table> <json | @file | ->
  pmo update <table> --filter col=op.value [...] <json | @file | ->
  pmo rpc <name> [<json | @file | ->]
  pmo load <file.json | -> [--dry-run]   (active Admin: companies, projects, draft budgets)

common options: --url <supabase url> (PMO_SUPABASE_URL, default ${DEFAULT_SUPABASE_URL})
                --key <publishable key> (PMO_SUPABASE_KEY)
tables: ${ALLOWED_TABLES.join(', ')}
read-only: ${Object.entries(READ_ONLY_TABLES).map(([t, c]) => `${t} (${c.join(', ')})`).join('; ')}
rpcs:   ${ALLOWED_RPCS.join(', ')}
There is no delete. See docs/runbooks/pmo-cli.md.
`;

// ── commands ─────────────────────────────────────────────────────────────────────────────────────

/** The signed-in user and their profile (role, status) — read live, as RLS does. */
async function readMe(ctx) {
  const user = await authed(ctx, 'GET', '/auth/v1/user');
  const q = new URLSearchParams({ id: `eq.${user.id}`, select: 'full_name,role,status' });
  const rows = await authed(ctx, 'GET', `/rest/v1/profiles?${q}`);
  return { user, profile: Array.isArray(rows) && rows[0] ? rows[0] : {} };
}

/** The LoadApi `pmo load` writes through — the user's own token, nothing else (scripts/lib/pmo-load.mjs). */
function loadApi(ctx) {
  const representation = { prefer: 'return=representation' };
  return {
    get: (table, q) => authed(ctx, 'GET', `/rest/v1/${table}?${q}`),
    post: (table, body) => authed(ctx, 'POST', `/rest/v1/${table}`, { body, headers: representation }),
    patch: (table, q, body) => authed(ctx, 'PATCH', `/rest/v1/${table}?${q}`, { body, headers: representation }),
    rpc: (name, body) => authed(ctx, 'POST', `/rest/v1/rpc/${name}`, { body }),
  };
}

async function dispatch(ctx, command, positionals, flags) {
  switch (command) {
    case 'login':
      return login(ctx, flags);
    case 'logout':
      return logout(ctx);
    case 'whoami': {
      const { user, profile } = await readMe(ctx);
      return {
        url: ctx.supabaseUrl,
        id: user.id,
        email: user.email,
        full_name: profile.full_name ?? null,
        role: profile.role ?? null,
        status: profile.status ?? null,
      };
    }
    case 'get': {
      const [table] = positionals;
      if (!table) throw usage('get needs a table');
      assertTable(table, 'read');
      const q = buildQuery({
        select: flags.select,
        filters: flags.filter,
        limit: flags.limit,
        table,
        columns: Object.hasOwn(READ_ONLY_TABLES, table) ? READ_ONLY_TABLES[table] : undefined,
      });
      const qs = q.toString();
      return authed(ctx, 'GET', `/rest/v1/${table}${qs ? `?${qs}` : ''}`);
    }
    case 'create': {
      const [table, payload] = positionals;
      if (!table) throw usage('create needs a table');
      assertTable(table, 'write');
      const body = await readPayload(ctx, payload);
      guardWritePayload(table, body, 'create');
      return authed(ctx, 'POST', `/rest/v1/${table}`, { body, headers: { prefer: 'return=representation' } });
    }
    case 'update': {
      const [table, payload] = positionals;
      if (!table) throw usage('update needs a table');
      assertTable(table, 'write');
      if (flags.filter.length === 0) throw usage('update needs at least one --filter naming the rows to change');
      const q = buildQuery({ filters: flags.filter });
      const body = await readPayload(ctx, payload);
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw usage('update takes one JSON object');
      guardWritePayload(table, body, 'update');
      const rows = await authed(ctx, 'PATCH', `/rest/v1/${table}?${q}`, { body, headers: { prefer: 'return=representation' } });
      if (Array.isArray(rows) && rows.length === 0) {
        throw new CliError('No row was updated — none matched the filter, or you are not allowed to change it (the database decides).', { code: 'no_rows' });
      }
      return rows;
    }
    case 'rpc': {
      const [name, payload] = positionals;
      if (!name) throw usage('rpc needs a function name');
      assertRpc(name);
      const body = await readPayload(ctx, payload, { optional: true });
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw usage('rpc takes one JSON object of arguments');
      return authed(ctx, 'POST', `/rest/v1/rpc/${name}`, { body });
    }
    case 'load': {
      const [file] = positionals;
      if (!file) throw usage('load needs a JSON file: pmo load <file.json | -> [--dry-run]');
      const doc = await readPayload(ctx, file === '-' ? '-' : `@${file.replace(/^@/, '')}`);
      const problems = validateLoadFile(doc);
      if (problems.length > 0) {
        throw new CliError(`The load file has ${problems.length} problem(s); nothing was sent.`, { exit: 2, code: 'invalid_load_file', details: problems });
      }
      const { profile } = await readMe(ctx);
      if (profile.role !== 'Admin' || profile.status !== 'active') {
        throw usage("pmo load is for an active Admin (the owner). Sign in as the organisation's Admin.");
      }
      const api = loadApi(ctx);
      const resolved = await resolveLoad(doc, api);
      if (resolved.problems.length > 0) {
        throw new CliError(`${resolved.problems.length} problem(s) must be fixed before loading; nothing was written.`, { exit: 2, code: 'load_preflight', details: resolved.problems });
      }
      const dryRun = Boolean(flags['dry-run']);
      try {
        const actions = await applyLoad(resolved.plan, api, { dryRun });
        return { dry_run: dryRun, counts: countActions(actions), actions };
      } catch (e) {
        const err = e instanceof CliError ? e : new CliError(e?.message ?? String(e), { code: e?.code });
        err.details = { cause: err.details ?? null, ...(e?.loadReport ?? {}) };
        throw err;
      }
    }
    default:
      throw usage(`Unknown command '${command}'.\n${USAGE}`);
  }
}

/**
 * Run the CLI. Returns the exit code; never calls process.exit (so tests can drive it).
 * @param {string[]} argv
 * @param {{env?: Record<string,string|undefined>, stdout?: {write(s:string):unknown}, stderr?: {write(s:string):unknown},
 *   stdin?: AsyncIterable<Buffer|string>, openBrowser?: (url:string)=>unknown, ports?: number[], now?: ()=>number}} [io]
 */
export async function run(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const fail = (e) => {
    const error = { message: e.message };
    for (const k of ['code', 'status', 'details', 'hint']) if (e[k] !== undefined && e[k] !== null) error[k] = e[k];
    stderr.write(`${JSON.stringify({ error })}\n`);
    return e.exit ?? 1;
  };
  try {
    const { command, positionals, flags } = parseArgs(argv);
    if (flags.help || command === 'help') {
      stdout.write(USAGE);
      return 0;
    }
    if (!command) {
      stderr.write(USAGE);
      return 2;
    }
    if (DELETE_VERBS.has(command)) {
      throw usage('The PMO CLI offers no delete (DD-API-3). Archive or delete records in the app, where the rules for removing them apply.');
    }
    if (!COMMANDS.includes(command)) throw usage(`Unknown command '${command}'.\n${USAGE}`);
    const ctx = {
      env,
      stdout,
      stderr,
      stdin: io.stdin ?? process.stdin,
      openBrowser: io.openBrowser ?? defaultOpenBrowser,
      ports: io.ports ?? [...LOOPBACK_PORTS],
      now: io.now ?? Date.now,
      ...resolveTarget(env, flags),
    };
    const result = await dispatch(ctx, command, positionals, flags);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof CliError) return fail(e);
    return fail(new CliError(e?.message ?? String(e)));
  }
}

const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
