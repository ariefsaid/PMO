import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = (file) => fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
const rollback = (file) => fs.readFileSync(path.join(root, 'supabase/migrations/rollback', file), 'utf8');

test('0294 statement account source is reversible and carries its chart/lock surfaces', () => {
  const up = migration('0294_statement_account_source.sql');
  const down = rollback('0294_statement_account_source_down.sql');
  assert.match(up, /create table public\.erp_sweep_lock/);
  assert.match(up, /create table public\.erp_account_mirror/);
  assert.match(up, /statement_full_ledger_replay_needed boolean not null default true/);
  assert.match(up, /erp_account_mirror_org_company_lft_idx/);
  assert.match(up, /stamp_org_id\(\)/);
  assert.doesNotMatch(up, /\b(begin|commit);/i);
  assert.match(down, /drop table if exists public\.erp_account_mirror/);
  assert.match(down, /drop table if exists public\.erp_sweep_lock/);
  assert.match(down, /drop column if exists statement_calendar/);
});

test('0295 statement ledger source preserves nullable legacy context and guards narrowing on rollback', () => {
  const up = migration('0295_statement_ledger_source.sql');
  const down = rollback('0295_statement_ledger_source_down.sql');
  assert.match(up, /add column company text/);
  assert.match(up, /add column is_opening text check/);
  assert.match(up, /add column finance_book text/);
  assert.match(up, /alter column debit type numeric using/);
  assert.match(up, /alter column credit type numeric using/);
  assert.match(up, /erp_gl_entry_mirror_org_company_date_account_idx/);
  assert.doesNotMatch(up, /\b(begin|commit);/i);
  assert.match(down, /debit <> trunc\(debit, 2\)/);
  assert.match(down, /abs\(credit\) > 999999999999\.99/);
  assert.match(down, /alter column debit type numeric\(14,2\)/);
});

test('0316 financial statement publication schema is reversible and limited to the signed snapshot table', () => {
  const up = migration('0316_financial_statement_publication.sql');
  const down = rollback('0316_financial_statement_publication_down.sql');
  assert.match(up, /create table public\.erp_financial_statement_snapshot/);
  assert.match(up, /unique nulls not distinct/);
  assert.match(up, /erp_financial_statement_snapshot_lookup_idx/);
  assert.match(up, /display_precision integer not null check \(display_precision between 0 and 9\)/);
  assert.match(up, /'Banker''s Rounding \(legacy\)'/);
  assert.match(up, /'Commercial Rounding'/);
  assert.match(up, /enable row level security/);
  assert.match(up, /force row level security/);
  assert.match(up, /to authenticated[\s\S]*using/);
  assert.match(up, /p\.id = erp_financial_statement_snapshot\.project_id/);
  assert.match(up, /p\.org_id = public\.auth_org_id\(\)/);
  assert.match(up, /revoke all on public\.erp_financial_statement_snapshot from public, anon, authenticated/);
  assert.match(up, /grant select on public\.erp_financial_statement_snapshot to authenticated/);
  assert.doesNotMatch(up, /create\s+(or replace\s+)?function|create\s+(or replace\s+)?view/i);
  assert.doesNotMatch(up, /\b(begin|commit);/i);
  assert.match(down, /drop table if exists public\.erp_financial_statement_snapshot/);
  assert.doesNotMatch(down, /erp_account_mirror|erp_gl_entry_mirror|erp_payment_ledger_mirror/);
});

test('0319 native report batch is reversible, exact, fenced and service-only', () => {
  const up = migration('0319_financial_statement_native_reports.sql');
  const down = rollback('0319_financial_statement_native_reports_down.sql');
  const openBatch = up.match(/create function public\.open_erp_statement_report_batch\([\s\S]*?(?=create function public\.stage_erp_statement_report)/i)?.[0];
  assert.ok(openBatch, 'open batch RPC body is present');
  const rpcSignatures = [
    'open_erp_statement_report_batch(uuid,uuid,jsonb)',
    'stage_erp_statement_report(uuid,uuid,uuid,jsonb)',
    'publish_erp_financial_statements(uuid,uuid,uuid)',
  ];
  for (const signature of rpcSignatures) {
    assert.match(up, new RegExp(`create function public\\.${signature.split('(')[0]}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = public, pg_temp`, 'i'));
    assert.match(up, new RegExp(`revoke all on function public\\.${signature.replaceAll('(', '\\(').replaceAll(')', '\\)')} from public,anon,authenticated`));
    assert.match(up, new RegExp(`grant execute on function public\\.${signature.replaceAll('(', '\\(').replaceAll(')', '\\)')} to service_role`));
  }
  assert.match(up, /drop function public\.publish_erp_financial_statements\(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb\)/i);
  assert.match(up, /create table public\.erp_financial_statement_report_batch/);
  assert.match(up, /create table public\.erp_financial_statement_report_pending/);
  assert.match(up, /force row level security/);
  assert.match(up, /foreign key \(org_id,batch_id\)[\s\S]*?references public\.erp_financial_statement_report_batch\(org_id,batch_id\)/i);
  assert.match(up, /create index erp_financial_statement_report_pending_next_idx[\s\S]*?where normalized_report is null/i);
  assert.match(up, /primary key \(org_id,batch_id,ordinal\)/i, 'pending rows support indexed org/batch existence probes');
  assert.match(openBatch, /if not exists\s*\(\s*select 1 from public\.erp_financial_statement_report_pending\s+where org_id=p_org_id and batch_id=v_batch_id\s*\)/i,
    'resume rejects a missing plan with an indexed existence probe');
  assert.doesNotMatch(openBatch, /select count\(\*\)[\s\S]*?from public\.erp_financial_statement_report_pending/i,
    'resume does not rescan the complete pending plan to establish existence');
  assert.match(up, /erp_statement_report_plan/);
  assert.match(up, /statement_update_delayed=false,statement_calendar=v_safe_calendar/);
  assert.match(up, /capture_started_at,capture_completed_at/);
  assert.match(up, /raw_reports/);
  assert.match(up, /statement_full_ledger_replay_needed = true/);
  assert.doesNotMatch(up, /statement_report_batch jsonb|statement_report_batch=|statement_report_batch null/i);
  assert.doesNotMatch(up, /sum\s*\(|::numeric/);
  assert.doesNotMatch(up, /\b(begin|commit);/i);
  assert.match(down, /native.*data|capture_started_at|raw_reports/i);
  assert.match(down, /erp_financial_statement_report_batch/);
  assert.match(down, /mark_erp_statement_replay_for_missing_accounts/);
  assert.doesNotMatch(down, /external_org_bindings.*statement_report_batch/i);
  const denominator = JSON.parse(fs.readFileSync(path.join(root, 'scripts/isolation-probe-denominator.json'), 'utf8'));
  for (const table of ['erp_financial_statement_report_batch', 'erp_financial_statement_report_pending']) {
    assert.ok(denominator.tables.some((entry) => entry.table === table));
  }
  for (const signature of [
    'open_erp_statement_report_batch(uuid,uuid,jsonb)',
    'stage_erp_statement_report(uuid,uuid,uuid,jsonb)',
    'publish_erp_financial_statements(uuid,uuid,uuid)',
  ]) assert.ok(denominator.definer_functions.includes(signature));
  assert.ok(!denominator.definer_functions.includes('publish_erp_financial_statements(uuid,text,uuid,uuid,timestamp with time zone,jsonb,jsonb)'));
});

test('0318 financial statement read surfaces are exact, invoker-only and reversible', () => {
  const up = migration('0318_financial_statement_reads.sql');
  const down = rollback('0318_financial_statement_reads_down.sql');
  assert.match(up, /create view public\.erp_financial_statement_availability\s+with \(security_barrier = true\)/i);
  for (const column of ['company_label', 'calendar', 'last_success_at', 'delayed']) {
    assert.match(up, new RegExp(`\\bas ${column}\\b`, 'i'));
  }
  assert.match(up, /latest\.snapshot_id,/i);
  assert.match(up, /latest\.source_generation,/i);
  assert.match(up, /alter view public\.erp_financial_statement_availability owner to postgres/i);
  assert.match(up, /revoke all on public\.erp_financial_statement_availability from public, anon, authenticated, service_role/i);
  assert.match(up, /grant select on public\.erp_financial_statement_availability to authenticated/i);
  assert.match(up, /create function public\.get_financial_statement_catalogue\(p_project_id uuid default null\)[\s\S]*?stable\s+security invoker\s+set search_path = public, pg_temp/i);
  assert.match(up, /create function public\.get_financial_statement\([\s\S]*?p_period_kind text,[\s\S]*?p_period_start date,[\s\S]*?p_statement text,[\s\S]*?p_project_id uuid default null,[\s\S]*?p_view_kind text default 'account_breakdown',[\s\S]*?p_unassigned boolean default false\s*\) returns jsonb[\s\S]*?stable\s+security invoker\s+set search_path = public, pg_temp/i);
  assert.match(up, /revoke all on function public\.get_financial_statement_catalogue\(uuid\) from public, anon, authenticated/i);
  assert.match(up, /grant execute on function public\.get_financial_statement_catalogue\(uuid\) to authenticated/i);
  assert.match(up, /grant execute on function public\.get_financial_statement\(text, date, text, uuid, text, boolean\) to authenticated/i);
  assert.match(up, /not coalesce\(public\.is_active_member\(\), false\)/);
  assert.match(up, /candidate\.snapshot_id = availability\.snapshot_id/);
  assert.match(up, /candidate\.source_generation is distinct from availability\.source_generation/);
  assert.match(up, /candidate\.as_of is distinct from availability\.last_success_at/);
  assert.equal((up.match(/'delayed', \(select availability\.delayed from availability limit 1\)/g) ?? []).length, 2);
  assert.match(up, /case when selected\.view_kind = 'account_breakdown'[\s\S]*?else '\{\}'::jsonb end/);
  assert.doesNotMatch(up, /security definer/i);
  assert.doesNotMatch(up, /create\s+(or replace\s+)?function public\.[^(]+\([^)]*jsonb/i);
  assert.ok(down.indexOf('drop function if exists public.get_financial_statement_catalogue(uuid)') < down.indexOf('drop view if exists public.erp_financial_statement_availability'));
  assert.ok(down.indexOf('drop function if exists public.get_financial_statement(text, date, text, uuid, text, boolean)') < down.indexOf('drop view if exists public.erp_financial_statement_availability'));
  assert.match(down, /drop view if exists public\.erp_financial_statement_availability/);
  assert.doesNotMatch(down, /erp_financial_statement_snapshot|external_org_bindings|erp_account_mirror|erp_gl_entry_mirror/i);
  assert.doesNotMatch(up, /\b(begin|commit);/i);
});

test('denominator declares new source table and lock RPCs', () => {
  const denominator = JSON.parse(fs.readFileSync(path.join(root, 'scripts/isolation-probe-denominator.json'), 'utf8'));
  assert.ok(denominator.tables.some((entry) => entry.table === 'erp_account_mirror'));
  assert.ok(denominator.tables.some((entry) => entry.table === 'erp_sweep_lock'));
  assert.ok(denominator.tables.some((entry) => entry.table === 'erp_financial_statement_snapshot'));
  assert.ok(denominator.definer_functions.some((entry) => entry.startsWith('claim_erp_sweep_lock(')));
  assert.ok(denominator.definer_functions.some((entry) => entry.startsWith('release_erp_sweep_lock(')));
});
