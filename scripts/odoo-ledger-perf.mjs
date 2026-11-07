#!/usr/bin/env node
/**
 * odoo-ledger-perf — NFR-ODA-004 / AC-ODA-023 (#1507 S5-T6). Recorded numbers, not a CI gate.
 * Seeds 130,000 synthetic Odoo mirror rows into the LOCAL database, times the three statements, and times the
 * read leg of refreshActuals (keyset pages of 1,000 over PostgREST + the client sum), then removes the seed.
 * Run only under the DB lock:  scripts/with-db-lock.sh node scripts/odoo-ledger-perf.mjs
 */
import { execFileSync } from 'node:child_process';

if (!process.env.PMO_DB_LOCK_HELD) { console.error('run under scripts/with-db-lock.sh'); process.exit(2); }
const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ROWS = Number(process.env.ODOO_PERF_ROWS ?? 130_000);
const ORG = 'a7460000-0000-0000-0000-0000000000f0';
const USER = 'a7460000-0000-0000-0000-0000000000f1';
const psql = (sql, extra = []) => execFileSync('psql', [URL, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At', ...extra, '-c', sql], { encoding: 'utf8', maxBuffer: 1 << 28 });
const cleanup = () => psql(`delete from profiles where id='${USER}'; delete from organizations where id='${ORG}'; delete from auth.users where id='${USER}';`);

cleanup();
try {
  psql(`
    insert into organizations (id, name) values ('${ORG}', 'Perf');
    insert into auth.users (id, email) values ('${USER}', 'perf-fin@example.test');
    insert into profiles (id, org_id, full_name, email, role, status) values ('${USER}', '${ORG}', 'Perf Finance', 'perf-fin@example.test', 'Finance', 'active');
    insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values ('${ORG}', 'odoo', 'https://odoo.example.test', 'perf', 'active', '{}', now());
    insert into external_master_records (org_id, external_tier, kind, external_id, code, name, attrs, source_write_date)
      select '${ORG}', 'odoo', 'account', g::text, (1000 + g * 10)::text, 'Account ' || g,
             jsonb_build_object('account_type', case g % 5 when 0 then 'asset_cash' when 1 then 'liability_payable' when 2 then 'equity' when 3 then 'income' else 'expense' end),
             '2026-01-01 00:00:00' from generate_series(1, 60) g;
    insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified)
      select '${ORG}', 'odoo:' || g || ':' || case when g % 4 = 0 then '-' else (100 + g % 25)::text end,
             (1000 + (1 + g % 60) * 10)::text, case when g % 4 = 0 then null else (100 + g % 25)::text end, 'account.move', 'MOVE/' || (g / 2),
             date '2025-01-01' + (g % 700), case when g % 2 = 0 then (g % 997) + 0.37 else 0 end, case when g % 2 = 1 then (g % 997) + 0.37 else 0 end,
             g % 50 = 0, 1, '2026-01-01 00:00:00'
        from generate_series(1, ${ROWS}) g;
    analyze erp_gl_entry_mirror;`);
  const claims = `{"sub":"${USER}","role":"authenticated"}`;
  const results = {};
  for (const [label, kind, p] of [['trial_balance', 'trial_balance', '2026-06-01'], ['profit_and_loss', 'profit_and_loss', '2026-06-01'], ['balance_sheet', 'balance_sheet', '2026-06-01']]) {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = process.hrtime.bigint();
      execFileSync('psql', [URL, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At', '-c',
        `begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); select length(get_odoo_statement('${kind}', '{"kind":"month","start":"${p}"}')::text); rollback;`], { encoding: 'utf8' });
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    results[label] = times.map((t) => Math.round(t));
  }
  // The psql start-up (~25 ms) is inside each figure; subtract nothing, report as measured.
  // refreshActuals read leg: keyset pages of 1,000 over the service-role REST endpoint + the client sum.
  const env = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
  const base = env.API_URL, key = env.SERVICE_ROLE_KEY;
  if (base && key) {
    const t0 = process.hrtime.bigint();
    let after = null, n = 0; const sums = new Map();
    for (;;) {
      const q = `${base}/rest/v1/erp_gl_entry_mirror?select=id,account,project,debit,credit&org_id=eq.${ORG}&is_cancelled=eq.false&order=id.asc&limit=1000${after ? `&id=gt.${after}` : ''}`;
      const rows = await (await fetch(q, { headers: { apikey: key, authorization: `Bearer ${key}` } })).json();
      if (!Array.isArray(rows)) throw new Error(`page failed: ${JSON.stringify(rows)}`);
      for (const r of rows) { const k = `${r.project ?? ''}|${r.account}`; sums.set(k, (sums.get(k) ?? 0) + Math.round(Number(r.debit ?? 0) * 100) - Math.round(Number(r.credit ?? 0) * 100)); }
      n += rows.length;
      if (rows.length < 1000) break;
      after = rows[rows.length - 1].id;
    }
    results.refreshActuals_read_ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
    results.refreshActuals_rows = n; results.refreshActuals_groups = sums.size;
  }
  console.log(JSON.stringify({ rows: ROWS, ms_each_of_3_runs: results }, null, 2));
} finally {
  cleanup();
}
