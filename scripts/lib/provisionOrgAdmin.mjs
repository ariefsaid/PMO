#!/usr/bin/env node
/**
 * provisionOrgAdmin.mjs — creates the org row for a new client (FR-PROV-006), idempotently
 * (PROV-E002: an existing org reports "already provisioned", no duplicate). The first-Admin
 * step (FR-PROV-007 v1) is printed as the documented `supabase auth-admin invite` command —
 * this script does NOT itself call auth-admin (that's a `supabase` CLI concern, not a
 * service-role Postgres write); v2 (once the ops-admin invite fn ships, MVP item 1a) will call
 * that fn's edge endpoint instead of printing the manual command.
 *
 * SCHEMA NOTE (verified against supabase/migrations/0001_init_schema.sql before writing this):
 * `organizations` has NO `slug` column — only `id`, `name`, `created_at`. The idempotency
 * dedup check below therefore keys on `name` (the client-slug argument IS the org's display
 * name at this <~5-deployment scale, per ADR-0047 — no separate slug identity exists yet).
 * Flagged for Director/owner confirmation: if a distinct `slug` identity is wanted later
 * (e.g. to let the org's display name change without breaking re-run idempotency), that is a
 * schema addition out of this slice's declared zero-migration scope for Deliverable 1.
 *
 * DEPENDENCY NOTE: `pg` is imported lazily (inside main(), not at module top-level) so that
 * createOrgIfAbsent — the pure, unit-tested function below, which takes an injected client —
 * can be imported and tested WITHOUT `pg` being installed at the repo root (this repo has no
 * root-level package.json/node_modules; `pg`/`@supabase/supabase-js` are only installed under
 * pmo-portal/node_modules for the Vite app). The live CLI invocation of this script (main())
 * DOES require `pg` to be installed at whatever location Node resolves it from when actually
 * run — flagged as an operator/environment setup dependency, not fixed here (adding a root-level
 * package.json is a tooling decision outside this task's scope).
 */

function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  return { slug: get('--slug'), dbUrl: get('--db-url') };
}

export async function createOrgIfAbsent(client, slug, name) {
  const existing = await client.query('select id from organizations where name = $1', [slug]);
  if (existing.rows.length > 0) {
    return { action: 'already-provisioned', orgId: existing.rows[0].id };
  }
  const inserted = await client.query(
    'insert into organizations (name) values ($1) returning id',
    [name],
  );
  return { action: 'created', orgId: inserted.rows[0].id };
}

async function main(argv) {
  const { slug, dbUrl } = parseArgs(argv);
  if (!slug || !dbUrl) { console.error('✗ --slug and --db-url are required.'); process.exitCode = 1; return; }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  const result = await createOrgIfAbsent(client, slug, slug);
  if (result.action === 'already-provisioned') {
    console.log(`✓ Org '${slug}' already provisioned (org_id=${result.orgId}). No duplicate created.`);
  } else {
    console.log(`✓ Org '${slug}' created (org_id=${result.orgId}).`);
    console.log('→ First-Admin step (FR-PROV-007 v1, until the ops-admin invite fn ships):');
    console.log(`    supabase auth-admin invite <admin-email> --project-ref <ref>`);
    console.log(`  Then insert the linked profiles row (role=Admin, org_id=${result.orgId}, status=active).`);
    console.log('  NOTE: the invite email requires SMTP (MVP item 2 — dependency; not wired v1).');
  }
  await client.end();
}

const isMain = process.argv[1] && process.argv[1].endsWith('provisionOrgAdmin.mjs');
if (isMain) main(process.argv.slice(2));
