#!/usr/bin/env node
/**
 * register-oauth-client — one-time admin setup: register the PMO CLI as a PUBLIC OAuth client of
 * Supabase Auth's OAuth 2.1 server (issue #728, DD-API-2).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/register-oauth-client.mjs [--name "PMO CLI"]
 *
 * Prints JSON { created, client_id, client_name, redirect_uris }. The client id is not a secret (a
 * public client has none); hand it to CLI users as PMO_CLIENT_ID. Idempotent: an existing client of
 * the same name is reported, not duplicated.
 *
 * ⛔ OWNER-GATED ON THE HOSTED PROJECT. Against the local stack this is routine setup. Against a
 *    hosted Supabase project it is an infrastructure change (DD-API-2): the OAuth server must first
 *    be enabled there, and registering a client needs the owner's explicit go-ahead. The script
 *    refuses any non-local URL unless --hosted is passed.
 *
 * Uses the GoTrue admin endpoint with the service-role key — the ONLY place the CLI tooling touches
 * that key; the CLI itself (scripts/pmo.mjs) never does. Node 22 standard library only.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { loopbackRedirectUris } from './pmo.mjs';

export function clientPayload(name) {
  return {
    client_name: name,
    redirect_uris: loopbackRedirectUris(),
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/** Parse `[--name <value>] [--hosted]`; a missing or empty --name value is an error. */
export function parseRegisterArgs(argv) {
  const out = { name: 'PMO CLI', hosted: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hosted') out.hosted = true;
    else if (argv[i] === '--name') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('--name needs a value');
      out.name = value;
    } else throw new Error(`Unknown option ${argv[i]}`);
  }
  return out;
}

/** An existing client is reusable only if it is exactly the public loopback client this script creates. */
function assertReusable(client) {
  const expected = [...loopbackRedirectUris()].sort();
  const actual = [...(client.redirect_uris ?? [])].sort();
  const sameRedirects = expected.length === actual.length && expected.every((u, i) => u === actual[i]);
  if (client.client_type !== 'public' || client.token_endpoint_auth_method !== 'none' || !sameRedirects) {
    throw new Error(
      `A client named '${client.client_name}' already exists but is not the public loopback client (type ${client.client_type}, ` +
        `auth ${client.token_endpoint_auth_method}, redirects ${actual.join(' ')}). Fix or remove it in the Supabase dashboard, or use --name.`,
    );
  }
}

function isLocal(url) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
}

export async function register({ supabaseUrl, serviceRoleKey, name, hosted = false }) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const base = supabaseUrl.replace(/\/+$/, '');
  if (!isLocal(base) && !hosted) {
    throw new Error(`${base} is not the local stack. Registering on a hosted project is owner-gated — pass --hosted only with the owner's go-ahead.`);
  }
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' };
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/auth/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${data.msg ?? data.message ?? text}`);
    return data;
  };

  const list = await call('GET', '/admin/oauth/clients?per_page=1000');
  const existing = (list.clients ?? []).find((c) => c.client_name === name);
  if (existing) {
    assertReusable(existing);
    return { created: false, client_id: existing.client_id, client_name: existing.client_name, redirect_uris: existing.redirect_uris };
  }
  const created = await call('POST', '/admin/oauth/clients', clientPayload(name));
  return { created: true, client_id: created.client_id, client_name: created.client_name, redirect_uris: created.redirect_uris };
}

const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  Promise.resolve()
    .then(() => {
      const { name, hosted } = parseRegisterArgs(process.argv.slice(2));
      return register({
        supabaseUrl: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        name,
        hosted,
      });
    })
    .then((out) => process.stdout.write(`${JSON.stringify(out, null, 2)}\n`))
    .catch((e) => {
      process.stderr.write(`${JSON.stringify({ error: { message: e.message } })}\n`);
      process.exitCode = 1;
    });
}
