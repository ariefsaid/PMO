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

test('denominator declares new source table and lock RPCs', () => {
  const denominator = JSON.parse(fs.readFileSync(path.join(root, 'scripts/isolation-probe-denominator.json'), 'utf8'));
  assert.ok(denominator.tables.some((entry) => entry.table === 'erp_account_mirror'));
  assert.ok(denominator.tables.some((entry) => entry.table === 'erp_sweep_lock'));
  assert.ok(denominator.definer_functions.some((entry) => entry.startsWith('claim_erp_sweep_lock(')));
  assert.ok(denominator.definer_functions.some((entry) => entry.startsWith('release_erp_sweep_lock(')));
});
