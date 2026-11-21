#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

if (process.env.PMO_DB_LOCK_HELD !== '1') {
  console.error('Run under scripts/with-db-lock.sh.');
  process.exit(1);
}

const container = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_pmo-portal';
const ids = {
  org: 'f5020000-0000-0000-0000-000000000001',
  binding: 'f5020000-0000-0000-0000-0000000000b1',
  intent: 'f5020000-0000-0000-0000-000000000101',
  outbox: 'f5020000-0000-0000-0000-000000000201',
};

function sqlAsAdmin(sql) {
  const r = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
    { input: sql, encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'race fixture SQL failed');
  return r.stdout;
}

function start(sql) {
  const child = spawn(
    'docker',
    ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']
  );
  let out = '', err = '';
  child.stdout.on('data', (x) => { out += x; });
  child.stderr.on('data', (x) => { err += x; });
  child.stdin.end(sql);
  return {
    child,
    output: () => out,
    error: () => err,
    done: new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(err || out || `psql exit ${code}`));
      });
    }),
  };
}

async function runRace() {
  const i = ids;
  try {
    sqlAsAdmin(`
      insert into public.organizations(id, name) values ('${i.org}', 'Fiscal Race Org')
      on conflict (id) do nothing;
      insert into public.external_org_bindings(id, org_id, external_tier, site_url, secret_ref, status, config, activated_at)
      values ('${i.binding}', '${i.org}', 'erpnext', 'https://race.example.test', 'sec_race', 'active', '{"company":"Race Co"}'::jsonb, '2026-01-01 00:00:00+00')
      on conflict (id) do nothing;
      insert into public.erp_fiscal_year_intents(id, org_id, binding_id, company, site_url, activated_at, year_name, start_date, end_date)
      values ('${i.intent}', '${i.org}', '${i.binding}', 'Race Co', 'https://race.example.test', '2026-01-01 00:00:00+00', '2027', '2027-01-01', '2027-12-31');
      insert into public.external_command_outbox(id, org_id, domain, pmo_record_id, idempotency_key, payload, state, claim_generation, external_tier, operation)
      values ('${i.outbox}', '${i.org}', 'fiscal_year_setup', '${i.intent}', 'setup:fiscal-year:${i.intent}', '{"command":"ensure_fiscal_year"}'::jsonb, 'committing', 1, 'erpnext', 'create');
    `);

    // First connection begins, calls begin_fiscal_year_post, holds the row lock for 1 second before commit
    const sql1 = `
      set role service_role;
      begin;
      select public.begin_fiscal_year_post('${i.org}'::uuid, '${i.intent}'::uuid, '${i.outbox}'::uuid, 1::bigint);
      select pg_sleep(1);
      commit;
    `;
    const conn1 = start(sql1);

    // Give connection 1 a moment to acquire the row lock inside the transaction
    await delay(200);

    // Second connection attempts begin_fiscal_year_post concurrently against the same intent and generation
    const sql2 = `
      set role service_role;
      select public.begin_fiscal_year_post('${i.org}'::uuid, '${i.intent}'::uuid, '${i.outbox}'::uuid, 1::bigint);
    `;
    const conn2 = start(sql2);

    const [res1Raw, res2Raw] = await Promise.all([conn1.done, conn2.done]);
    const res1 = res1Raw.split('\n')[0].trim();
    const res2 = res2Raw.trim();

    const results = [res1, res2];
    const trues = results.filter((r) => r === 't').length;
    const falses = results.filter((r) => r === 'f').length;

    assert.equal(trues, 1, `Expected exactly 1 true, saw ${trues} (res1=${res1}, res2=${res2})`);
    assert.equal(falses, 1, `Expected exactly 1 false, saw ${falses} (res1=${res1}, res2=${res2})`);

    console.log('fiscal-year-ensure race: exactly one connection won begin_fiscal_year_post');
  } finally {
    sqlAsAdmin(`
      delete from public.erp_fiscal_year_intents where org_id = '${i.org}';
      delete from public.external_command_outbox where org_id = '${i.org}';
      delete from public.external_org_bindings where org_id = '${i.org}';
      delete from public.organizations where id = '${i.org}';
    `);
  }
}

await runRace();
