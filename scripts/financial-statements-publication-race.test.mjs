import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const container = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_pmo-portal';
const org = '03170100-0000-0000-0000-000000000001';
const binding = '03170100-0000-0000-0000-000000000002';
const holder = '03170100-0000-0000-0000-000000000003';
const reader = '03170100-0000-0000-0000-000000000008';
const readerEmail = 'statement-race-reader@example.test';
const otherHolder = '03170100-0000-0000-0000-000000000007';
const company = 'Synthetic race company';
const activatedAt = '2026-10-18T08:00:00Z';
const dates = ['2026-10-18T09:00:00Z', '2026-10-18T09:01:00Z', '2026-10-18T09:02:00Z'];
const calendar = [{ name: 'FY25-26', start: '2025-07-01', end: '2026-06-30' }];
const metadata = {
  erpVersion: '16.33.0',
  frappeVersion: '16.31.0',
  currency: 'IDR',
  defaultFinanceBook: null,
  hasFinanceBooks: false,
  calendar,
  currencyPrecision: 2,
  floatPrecision: 2,
  bsOpeningPrecision: 2,
  roundingMethod: 'Commercial Rounding',
  fractionUnits: 100,
  ignoreOpeningCheck: false,
  ignoreAccountClosingBalance: false,
};
const context = {
  binding: { id: binding, activatedAt, versionMajor: 16 },
  company,
  profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' },
  calendar,
  projectMap: {},
  language: 'en',
  presentation: {
    metadata,
    context: {
      requestLanguage: 'en',
      currencyPrecisionBranch: 'db_default',
      floatPrecisionBranch: 'db_default',
      bsOpeningPrecisionBranch: 'db_default',
      numberFormatBranch: 'native_default',
      raw: {},
    },
  },
  filterProfile: 'erpnext-v16-standard-statements-v1',
};

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function prepareBatchSql() {
  return `select public.b3_prepare_native_batch(${sqlLiteral(org)}::uuid,${sqlLiteral(holder)}::uuid,${sqlLiteral(JSON.stringify(context))}::jsonb);`;
}

function publisherSql(batchId, holderId = holder, barrier = false) {
  return `begin; set local role service_role; ${barrier ? "set local app.b3_native_gate='on';" : ''}
select public.publish_erp_financial_statements(${sqlLiteral(org)}::uuid,${sqlLiteral(holderId)}::uuid,${sqlLiteral(batchId)}::uuid);
commit;`;
}

function psqlSync(sql) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function startPsql(sql, leaveOpen = false) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, output }));
  });
  child.stdin.write(sql);
  if (!leaveOpen) child.stdin.end();
  return { child, done, get output() { return output; } };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(description, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function waitEventSql(needle) {
  const result = psqlSync(`select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike ${sqlLiteral(`%${needle}%`)};`);
  assert.equal(result.status, 0, result.output);
  return Number(result.output.trim().split('\n').at(-1));
}

async function waitForActivity(needle, count = 1) {
  await until(`${count} ${needle} lock wait(s)`, () => waitEventSql(needle) >= count);
}

function readRpcEnvelopes() {
  const claims = JSON.stringify({ sub: reader, role: 'authenticated' });
  const result = psqlSync(`begin; set local role authenticated; set local request.jwt.claims=${sqlLiteral(claims)};
select jsonb_build_object(
  'catalogue',public.get_financial_statement_catalogue(),
  'statement',public.get_financial_statement('month','2025-08-01','profit_and_loss')
)::text; commit;`);
  assert.equal(result.status, 0, result.output);
  return JSON.parse(result.output.trim().split('\n').at(-1));
}

function withoutDelayed(envelopes) {
  const strip = (generation) => generation === null ? null : { ...generation, delayed: null };
  return {
    catalogue: { ...envelopes.catalogue, generation: strip(envelopes.catalogue.generation) },
    statement: { ...envelopes.statement, generation: strip(envelopes.statement.generation) },
  };
}

function readGeneration() {
  const result = psqlSync(`select jsonb_build_object(
    'count',count(*),'distinctSnapshots',count(distinct snapshot_id),
    'distinctGenerations',count(distinct source_generation),'snapshot',min(snapshot_id::text),
    'generation',min(source_generation::text),'asOf',max(as_of)::text,
    'captureStartedAt',min(capture_started_at)::text,'captureCompletedAt',max(capture_completed_at)::text
  )::text from public.erp_financial_statement_snapshot where org_id=${sqlLiteral(org)}::uuid and company=${sqlLiteral(company)};`);
  assert.equal(result.status, 0, result.output);
  return JSON.parse(result.output.trim().split('\n').at(-1));
}

function cleanupSql() {
  return `begin;
    drop trigger if exists b3_native_publication_gate on public.erp_financial_statement_snapshot;
    drop function if exists public.b3_native_publication_gate_fn();
    drop table if exists public.b3_native_publication_gate_seen;
    drop table if exists public.b3_native_publication_gate;
    drop function if exists public.b3_prepare_native_batch(uuid,uuid,jsonb);
    delete from public.erp_financial_statement_report_batch where org_id=${sqlLiteral(org)}::uuid;
    delete from public.erp_financial_statement_snapshot where org_id=${sqlLiteral(org)}::uuid;
    delete from public.erp_sweep_lock where org_id=${sqlLiteral(org)}::uuid;
    delete from public.external_org_bindings where org_id=${sqlLiteral(org)}::uuid;
    delete from public.profiles where id=${sqlLiteral(reader)}::uuid;
    delete from auth.users where id=${sqlLiteral(reader)}::uuid;
    delete from public.organizations where id=${sqlLiteral(org)}::uuid;
    commit;`;
}

function stageHelperSql() {
  return `create function public.b3_prepare_native_batch(p_org uuid,p_holder uuid,p_context jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_open jsonb;
  v_batch uuid;
  v_pending record;
  v_selection jsonb;
  v_pair jsonb;
  v_current jsonb;
  v_prior jsonb;
  v_period jsonb;
  v_report jsonb;
  v_columns jsonb;
  v_raw text:='{"fixture":"native race response"}';
  v_hash text;
  v_acquired text;
  v_fy text;
begin
  v_open:=public.open_erp_statement_report_batch(p_org,p_holder,p_context);
  v_batch:=(v_open->>'batchId')::uuid;
  v_hash:=encode(extensions.digest(convert_to(v_raw,'UTF8'),'sha256'),'hex');
  for v_pending in select * from public.erp_financial_statement_report_pending
    where org_id=p_org and batch_id=v_batch order by ordinal loop
    v_selection:=jsonb_build_object('statement',v_pending.statement,'projectId',v_pending.project_id,
      'periodKind',v_pending.period_kind,'currentStart',v_pending.current_start::text,
      'currentEnd',v_pending.current_end::text,'priorStart',v_pending.prior_start::text,
      'priorEnd',v_pending.prior_end::text,'side',v_pending.side);
    select fy->>'name' into v_fy from jsonb_array_elements(p_context->'calendar') fy
      where (fy->>'start')::date<=case when v_pending.side='current' then v_pending.current_start else v_pending.prior_start end
        and (fy->>'end')::date>=case when v_pending.side='current' then v_pending.current_start else v_pending.prior_start end;
    v_current:=jsonb_build_object('fromDate',v_pending.current_start::text,'toDate',v_pending.current_end::text,
      'fromFiscalYear',(select fy->>'name' from jsonb_array_elements(p_context->'calendar') fy
        where (fy->>'start')::date<=v_pending.current_start and (fy->>'end')::date>=v_pending.current_start),
      'toFiscalYear',(select fy->>'name' from jsonb_array_elements(p_context->'calendar') fy
        where (fy->>'start')::date<=v_pending.current_end and (fy->>'end')::date>=v_pending.current_end),
      'kind',case when v_pending.period_kind='fiscal_year' then 'year' else v_pending.period_kind end);
    v_prior:=jsonb_build_object('fromDate',v_pending.prior_start::text,'toDate',v_pending.prior_end::text,
      'fromFiscalYear',(select fy->>'name' from jsonb_array_elements(p_context->'calendar') fy
        where (fy->>'start')::date<=v_pending.prior_start and (fy->>'end')::date>=v_pending.prior_start),
      'toFiscalYear',(select fy->>'name' from jsonb_array_elements(p_context->'calendar') fy
        where (fy->>'start')::date<=v_pending.prior_end and (fy->>'end')::date>=v_pending.prior_end),
      'kind',case when v_pending.period_kind='fiscal_year' then 'year' else v_pending.period_kind end);
    v_pair:=jsonb_build_object('current',v_current,'prior',v_prior);
    v_period:=v_pair->v_pending.side;
    if v_pending.statement='trial_balance' then
      v_columns:=jsonb_build_array(
        jsonb_build_object('fieldname','account','label','Account','type','text'),
        jsonb_build_object('fieldname','opening_debit','label','Opening debit','type','currency'),
        jsonb_build_object('fieldname','opening_credit','label','Opening credit','type','currency'),
        jsonb_build_object('fieldname','debit','label','Debit','type','currency'),
        jsonb_build_object('fieldname','credit','label','Credit','type','currency'),
        jsonb_build_object('fieldname','closing_debit','label','Closing debit','type','currency'),
        jsonb_build_object('fieldname','closing_credit','label','Closing credit','type','currency'));
    else
      v_columns:=jsonb_build_array(jsonb_build_object('fieldname','amount','label','Amount','type','currency'));
    end if;
    v_acquired:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_report:=jsonb_build_object('reportName',case v_pending.statement when 'trial_balance' then 'Trial Balance'
        when 'profit_and_loss' then 'Profit and Loss Statement' else 'Balance Sheet' end,
      'company',p_context->>'company','side',v_pending.side,'period',v_period,'periodPair',v_pair,
      'project','null'::jsonb,'language',p_context->>'language','profile',p_context->'profile',
      'columns',v_columns,'rows','[]'::jsonb,'summary',null,
      'provenance',jsonb_build_object('endpoint','/api/method/frappe.desk.query_report.run','method','GET',
        'ignorePreparedReport',1,'rawSha256',v_hash,'acquiredAt',v_acquired,
        'filters',public._erp_statement_report_filters(p_context,v_selection)));
    perform public.stage_erp_statement_report(p_org,p_holder,v_batch,
      jsonb_build_object('selection',v_selection,'report',v_report,'rawText',v_raw));
  end loop;
  return v_batch;
end $$;
revoke all on function public.b3_prepare_native_batch(uuid,uuid,jsonb) from public,anon,authenticated,service_role;`;
}

function setupSql() {
  return `begin;
    insert into public.organizations(id,name,default_currency,default_timezone) values (${sqlLiteral(org)}::uuid,'Synthetic publication race org','IDR','UTC');
    insert into auth.users(id,email) values (${sqlLiteral(reader)}::uuid,${sqlLiteral(readerEmail)});
    insert into public.profiles(id,org_id,full_name,email,role,status)
      values (${sqlLiteral(reader)}::uuid,${sqlLiteral(org)}::uuid,'Synthetic race Finance',${sqlLiteral(readerEmail)},'Finance','active');
    insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,
      statement_full_ledger_replay_needed,statement_update_delayed,statement_last_attempt_at,statement_calendar)
      values (${sqlLiteral(binding)}::uuid,${sqlLiteral(org)}::uuid,'erpnext','https://example.invalid','race-test-only',16,
        ${sqlLiteral(JSON.stringify({ company }))}::jsonb,${sqlLiteral(activatedAt)}::timestamptz,false,false,
        ${sqlLiteral(dates[0])}::timestamptz,null);
    insert into public.erp_sweep_lock(org_id,locked_until,holder)
      values (${sqlLiteral(org)}::uuid,'2099-12-31T23:59:59Z'::timestamptz,${sqlLiteral(holder)}::uuid);
    ${stageHelperSql()}
    create table public.b3_native_publication_gate(id integer primary key);
    insert into public.b3_native_publication_gate values(1);
    create table public.b3_native_publication_gate_seen(pid integer primary key);
    create function public.b3_native_publication_gate_fn() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
    begin
      if new.org_id=${sqlLiteral(org)}::uuid and current_setting('app.b3_native_gate',true)='on' then
        insert into public.b3_native_publication_gate_seen(pid) values(pg_backend_pid()) on conflict do nothing;
        perform 1 from public.b3_native_publication_gate where id=1 for update;
      end if;
      return new;
    end $$;
    create trigger b3_native_publication_gate before insert on public.erp_financial_statement_snapshot
      for each row execute function public.b3_native_publication_gate_fn();
    grant select,insert,update,delete on public.b3_native_publication_gate,public.b3_native_publication_gate_seen to service_role;
    create temporary table b3_first_batch(batch uuid) on commit drop;
    insert into b3_first_batch select public.b3_prepare_native_batch(${sqlLiteral(org)}::uuid,${sqlLiteral(holder)}::uuid,${sqlLiteral(JSON.stringify(context))}::jsonb);
    select public.publish_erp_financial_statements(${sqlLiteral(org)}::uuid,${sqlLiteral(holder)}::uuid,(select batch from b3_first_batch));
    commit;`;
}

function updateSourceSql(asOf, expiry = "'2099-12-31T23:59:59Z'::timestamptz") {
  return `begin;
    update public.external_org_bindings set statement_last_attempt_at=${sqlLiteral(asOf)},statement_update_delayed=true where id=${sqlLiteral(binding)}::uuid;
    update public.erp_sweep_lock set locked_until=${expiry},holder=${sqlLiteral(holder)}::uuid where org_id=${sqlLiteral(org)}::uuid;
    commit;`;
}

function prepareBatch() {
  const result = psqlSync(prepareBatchSql());
  assert.equal(result.status, 0, result.output);
  return result.output.trim().split('\n').at(-1);
}

async function setupFixture() {
  const inspected = spawnSync('docker', ['inspect', '--format', '{{.Name}}', container], { encoding: 'utf8' });
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(inspected.stdout.trim(), `/${container}`, 'race proof must use the exact local Supabase database container');
  const cleaned = psqlSync(cleanupSql());
  assert.equal(cleaned.status, 0, cleaned.output);
  const setup = psqlSync(setupSql());
  assert.equal(setup.status, 0, setup.output);
}

async function cleanupFixture() {
  const cleanup = psqlSync(cleanupSql());
  assert.equal(cleanup.status, 0, `owned synthetic fixture cleanup failed: ${cleanup.output}`);
  const remains = psqlSync(`select (select count(*) from public.erp_financial_statement_snapshot where org_id=${sqlLiteral(org)}::uuid)+(select count(*) from public.erp_financial_statement_report_pending where org_id=${sqlLiteral(org)}::uuid)+(select count(*) from public.erp_financial_statement_report_batch where org_id=${sqlLiteral(org)}::uuid)+(select count(*) from public.erp_sweep_lock where org_id=${sqlLiteral(org)}::uuid)+(select count(*) from public.external_org_bindings where org_id=${sqlLiteral(org)}::uuid)+(select count(*) from public.profiles where id=${sqlLiteral(reader)}::uuid)+(select count(*) from auth.users where id=${sqlLiteral(reader)}::uuid);`);
  assert.equal(remains.status, 0, remains.output);
  assert.equal(remains.output.trim().split('\n').at(-1), '0', 'only the owned synthetic fixture is removed');
}

test('0319 AC-006 authenticated readers see the complete old or new native generation around commit', { timeout: 60_000 }, async () => {
  await setupFixture();
  let blocker;
  let publisher;
  try {
    const before = readRpcEnvelopes();
    assert.equal(before.catalogue.state, 'complete');
    assert.equal(before.statement.state, 'complete');
    assert.equal(before.catalogue.generation.sourceGeneration, readGeneration().generation);
    assert.equal(before.catalogue.generation.delayed, false);
    assert.equal(before.statement.result.period.currentStart, '2025-08-01');
    assert.equal(before.statement.result.period.priorStart, '2025-07-01');
    const beforeRows = readGeneration();
    assert.equal(beforeRows.count, 42);
    assert.equal(beforeRows.distinctSnapshots, 1);
    assert.equal(beforeRows.distinctGenerations, 1);

    const batch = prepareBatch();
    assert.equal(psqlSync(updateSourceSql(dates[1])).status, 0);
    blocker = startPsql(`begin; select id from public.b3_native_publication_gate where id=1 for update; select 'BARRIER_LOCKED';\n`, true);
    await until('native publication barrier row lock acquisition', () => blocker.output.includes('BARRIER_LOCKED'));
    publisher = startPsql(publisherSql(batch, holder, true));
    await waitForActivity('publish_erp_financial_statements', 1);

    const during = readRpcEnvelopes();
    assert.deepEqual(withoutDelayed(during), withoutDelayed(before), 'authenticated reads observe the complete prior snapshot while replacement is uncommitted');
    assert.equal(during.catalogue.generation.delayed, true);
    assert.equal(during.statement.generation.asOf, before.statement.generation.asOf);

    blocker.child.stdin.write('commit;\n');
    blocker.child.stdin.end();
    const released = await Promise.race([blocker.done, sleep(5_000).then(() => null)]);
    assert.ok(released, `publication barrier did not release: ${blocker.output}`);
    assert.equal(released.status, 0, released.output);
    blocker = null;
    const committed = await Promise.race([publisher.done, sleep(20_000).then(() => null)]);
    assert.ok(committed, `native publisher timed out: ${publisher.output}`);
    assert.equal(committed.status, 0, committed.output);
    publisher = null;

    const after = readRpcEnvelopes();
    const afterRows = readGeneration();
    assert.equal(after.catalogue.state, 'complete');
    assert.equal(after.statement.state, 'complete');
    assert.equal(after.catalogue.generation.sourceGeneration, batch);
    assert.equal(after.catalogue.generation.delayed, false);
    assert.notEqual(after.catalogue.generation.snapshotId, before.catalogue.generation.snapshotId);
    assert.equal(after.statement.result.period.currentStart, '2025-08-01');
    assert.equal(after.statement.result.period.priorStart, '2025-07-01');
    assert.equal(afterRows.count, 42);
    assert.equal(afterRows.distinctSnapshots, 1);
    assert.equal(afterRows.distinctGenerations, 1);
    assert.notEqual(afterRows.snapshot, beforeRows.snapshot);
    assert.equal(afterRows.generation, batch);
  } finally {
    if (blocker && blocker.child.exitCode === null) {
      blocker.child.stdin.write('rollback;\n');
      blocker.child.stdin.end();
    }
    if (publisher && publisher.child.exitCode === null) publisher.child.kill('SIGTERM');
    if (blocker) await Promise.race([blocker.done.catch(() => null), sleep(2_000)]);
    if (publisher) await Promise.race([publisher.done.catch(() => null), sleep(2_000)]);
    await cleanupFixture();
  }
});

test('0319 AC-006 concurrent native publishers serialize on lease and expired-in-work publication rolls back', { timeout: 60_000 }, async () => {
  await setupFixture();
  let blocker;
  let active = [];
  try {
    const initial = readGeneration();
    assert.equal(initial.count, 42);
    assert.equal(initial.distinctSnapshots, 1);
    assert.equal(initial.distinctGenerations, 1);

    const lockBarrier = () => {
      const child = startPsql(`begin; select id from public.b3_native_publication_gate where id=1 for update; select 'BARRIER_LOCKED';\n`, true);
      active.push(child);
      return child;
    };
    const releaseBarrier = async (session) => {
      if (!session || session.child.exitCode !== null) return;
      session.child.stdin.write('commit;\n');
      session.child.stdin.end();
      const done = await Promise.race([session.done, sleep(5_000).then(() => null)]);
      assert.ok(done, `barrier session did not finish: ${session.output}`);
      assert.equal(done.status, 0, done.output);
    };

    const batch2 = prepareBatch();
    assert.equal(psqlSync(updateSourceSql(dates[1])).status, 0);
    blocker = lockBarrier();
    await until('native publication barrier acquisition', () => blocker.output.includes('BARRIER_LOCKED'));
    const publisher = startPsql(publisherSql(batch2, holder, true));
    active.push(publisher);
    await waitForActivity('publish_erp_financial_statements', 1);
    assert.equal(readGeneration().snapshot, initial.snapshot, 'uncommitted native replacement leaves the old snapshot visible');

    const competing = startPsql(publisherSql(batch2, otherHolder));
    const reclaim = startPsql(`begin; set local role service_role; select public.claim_erp_sweep_lock(${sqlLiteral(org)}::uuid,${sqlLiteral(otherHolder)}::uuid,interval '15 minutes'); commit;`);
    active.push(competing, reclaim);
    await waitForActivity('publish_erp_financial_statements', 2);
    await waitForActivity('claim_erp_sweep_lock', 1);
    assert.deepEqual(readGeneration(), initial, 'independent reader sees exactly the prior complete generation');
    await releaseBarrier(blocker);
    blocker = null;

    const published = await Promise.race([publisher.done, sleep(20_000).then(() => null)]);
    assert.ok(published, `native publisher timed out: ${publisher.output}`);
    assert.equal(published.status, 0, published.output);
    const loser = await Promise.race([competing.done, sleep(10_000).then(() => null)]);
    assert.ok(loser, `competing native publisher timed out: ${competing.output}`);
    assert.notEqual(loser.status, 0, 'competing wrong-holder publication must fail after lease serialization');
    assert.match(loser.output, /statement lease is not current/);
    const reclaimed = await Promise.race([reclaim.done, sleep(10_000).then(() => null)]);
    assert.ok(reclaimed, `competing lease claim timed out: ${reclaim.output}`);
    assert.equal(reclaimed.status, 0, reclaimed.output);
    assert.equal(reclaimed.output.trim().split('\n').at(-1), 'f', 'unexpired lease remains owned by the active publisher');

    const after = readGeneration();
    assert.equal(after.count, 42);
    assert.equal(after.distinctSnapshots, 1);
    assert.equal(after.distinctGenerations, 1);
    assert.notEqual(after.snapshot, initial.snapshot);
    assert.equal(after.generation, batch2);

    const batch3 = prepareBatch();
    assert.equal(psqlSync(updateSourceSql(dates[2], "clock_timestamp()+interval '3 seconds'")).status, 0);
    blocker = lockBarrier();
    await until('expiring native publication barrier acquisition', () => blocker.output.includes('BARRIER_LOCKED'));
    const expiring = startPsql(publisherSql(batch3, holder, true));
    active.push(expiring);
    await waitForActivity('publish_erp_financial_statements', 1);
    assert.deepEqual(readGeneration(), after, 'reader sees the committed generation while the next replacement is blocked');
    await until('actual lease expiry during native publication', () => {
      const result = psqlSync(`select locked_until<=clock_timestamp() from public.erp_sweep_lock where org_id=${sqlLiteral(org)}::uuid;`);
      assert.equal(result.status, 0, result.output);
      return result.output.trim().split('\n').at(-1) === 't';
    }, 10_000);
    await releaseBarrier(blocker);
    blocker = null;
    const expired = await Promise.race([expiring.done, sleep(15_000).then(() => null)]);
    assert.ok(expired, `expiring native publisher timed out: ${expiring.output}`);
    assert.notEqual(expired.status, 0, 'lease expiry during native replacement must abort the publication');
    assert.match(expired.output, /statement lease expired during publication/);
    assert.deepEqual(readGeneration(), after, 'expiry rollback preserves all previous rows, generation and capture window');
  } finally {
    if (blocker && blocker.child.exitCode === null) {
      blocker.child.stdin.write('rollback;\n');
      blocker.child.stdin.end();
    }
    for (const session of active) {
      if (session.child.exitCode === null) session.child.kill('SIGTERM');
    }
    await Promise.all(active.map((session) => Promise.race([session.done.catch(() => null), sleep(2_000)])));
    await cleanupFixture();
  }
});
