import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readInventory, renderInclude } from './anon-definer-inventory.mjs';
import { compareDenominators, DENOMINATOR_PATH, formatEntry, readActualCatalog, readDenominator } from './check-isolation-denominator.mjs';

const historyGate = readFileSync(new URL('../supabase/tests/record-changes-catalog-gaps.inc', import.meta.url), 'utf8');
const callableGate = readFileSync(new URL('../supabase/tests/anon-definer-write-sweep.inc', import.meta.url), 'utf8');

function query(sql, before = '') {
  return execFileSync('docker', [
    'exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres',
    '-XqAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: `begin;\n${before}\n${sql}\nrollback;\n`, encoding: 'utf8' }).trim();
}

function check({ before = '', inventory, denominator }) {
  const sql = `
    ${historyGate}
    create temp table client_callable_rpc_names (proname text primary key) on commit drop;
    ${renderInclude(inventory)}
    ${callableGate}
    select json_build_object(
      'history', coalesce((select json_agg(gap order by gap) from chg_gate_gaps), '[]'),
      'callable', coalesce((
        select json_agg(entry order by entry->>'name', entry->>'signature')
        from (
          select distinct jsonb_build_object(
            'name', proname,
            'signature', oid::regprocedure::text,
            'anonymous', has_function_privilege('anon', oid, 'EXECUTE')
          ) as entry
          from anon_definer_write_sweep
        ) registrations
      ), '[]'),
      'stale', coalesce((
        select json_agg(proname order by proname) from client_callable_rpc_names c
        where (select count(*) from pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname = c.proname) <> 1
           or not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname = c.proname and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      ), '[]')
    );`;
  const findings = JSON.parse(query(sql, before));
  const actual = readActualCatalog({ execFile: (_command, args) => query(args.at(-1), before) });
  return [
    ...findings.history.map((gap) => {
      const unclassified = /^(.*)\.(.*) unclassified$/.exec(gap);
      if (!unclassified) return `record_history_config: ${gap}`;
      const [, table, column] = unclassified;
      return `record_history_config ${table}: captured || '${JSON.stringify({ [column]: '<kind>' }).replaceAll("'", "''")}'::jsonb (or classify in flag_cols or omit_cols)`;
    }),
    ...compareDenominators(actual, denominator).map(({ kind, category, addLine, entry }) =>
      `isolation denominator ${category}: ${kind === 'missing' ? `add ${addLine}` : `remove ${formatEntry(category, entry)}`}`),
    ...findings.callable.map(({ name, signature, anonymous }) => anonymous
      ? `callable inventory: review anonymous EXECUTE on ${signature} before registering`
      : `callable inventory: add ${name}`),
    ...findings.stale.map((name) => `callable inventory: review missing, overloaded or inaccessible entry ${name}`),
  ];
}

function selfTest(inventory, denominator) {
  // Each catalog query runs in its own transaction, so this scratch DDL is always rolled back.
  const scratch = `
    alter table public.companies add column zz_registration_probe text;
    create function public.zz_registration_probe() returns void language plpgsql security definer
      set search_path = pg_catalog, pg_temp as $$
      begin
        insert into pg_temp.registration_probe_sink values (1);
      end;
      $$;
    revoke all on function public.zz_registration_probe() from public, anon, authenticated;
    grant execute on function public.zz_registration_probe() to authenticated;
  `;
  const gaps = check({ before: scratch, inventory, denominator });
  assert.deepEqual(gaps, [
    'record_history_config companies: captured || \'{"zz_registration_probe":"<kind>"}\'::jsonb (or classify in flag_cols or omit_cols)',
    'isolation denominator definer_functions: add "zz_registration_probe()"',
    'callable inventory: add zz_registration_probe',
  ]);
  gaps.forEach((gap) => console.log(gap));
  assert.deepEqual(check({
    before: scratch + `update public.record_history_config
      set captured = captured || '{"zz_registration_probe":"text"}'::jsonb where table_name = 'companies';`,
    inventory: [...inventory, 'zz_registration_probe'],
    denominator: {
      ...denominator, definer_functions: [...denominator.definer_functions, 'zz_registration_probe()'],
    },
  }), []);
  console.log('schema registration self-test: exactly three gaps, then clean');
}

const inventory = readInventory();
const denominator = readDenominator(DENOMINATOR_PATH);
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--self-test') {
  selfTest(inventory, denominator);
} else if (args.length === 0) {
  const findings = check({ inventory, denominator });
  if (findings.length) {
    findings.forEach((finding) => console.error(finding));
    process.exitCode = 1;
  } else {
    console.log('Schema registrations match the local database.');
  }
} else {
  console.error('Usage: scripts/check-schema-registrations.sh [--self-test]');
  process.exitCode = 2;
}
