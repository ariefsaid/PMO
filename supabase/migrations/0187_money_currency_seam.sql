-- 0187_money_currency_seam.sql — OD-CR-5 / DD-XING-4(1) / #478 part A: `currency` on every PMO-owned
-- money table, trigger-defaulted the same way `org_id` is (0074 stamp_org_id).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- OD-CR-5 (2026-07-22) ruled "single currency per org in v1, architected for multi-currency:
-- `currency` column on every money table (trigger-defaulted like org_id), formatting keyed off the
-- record's currency never a global constant". It was never built: before this migration the ONLY
-- `currency` columns in the schema were on the two machine-written ERP snapshot read-models
-- (0101_erp_accounting_snapshots, 0150_replace_erp_snapshot) — no PMO-owned money table had one.
-- DD-OPS-3 additionally blocks the ERPNext Connect on it (Connect pins org currency == ERPNext
-- company currency and there was no PMO-side column to pin against), and DD-IMP-1 blocks #495's
-- budget-import descriptor on it ("the ticket instructs the descriptor to set `currency` explicitly.
-- There is no `currency` column to set").
--
-- ── SCOPE: which tables ("money table" = a PMO-owned DOCUMENT carrying an org-money amount) ──────
-- Enumerated from the live schema (every `numeric` column in `public`), not from a list:
--   projects · procurements · procurement_quotations · budget_versions · budget_projections ·
--   purchase_requests · rfqs · purchase_orders · payments · procurement_invoices ·
--   sales_invoices · incoming_payments                                        (12 tables)
--
-- DELIBERATELY EXCLUDED, each for a stated reason — do not "complete" this list without reading them:
--   • `procurement_items`, `budget_line_items` — CHILD LINE tables. Currency belongs to the document
--     header (`procurements` / `budget_versions`), exactly as ERPNext models it: a per-line currency
--     column that nothing keeps equal to its parent's INVENTS an ambiguity (a USD line under an IDR
--     document) that does not exist today, which is the opposite of this migration's purpose.
--   • `agent_usage.cost` / `agent_usage.provider_cost_usd` / `credits.amount` /
--     `credit_reservations.amount` — PLATFORM AI billing, denominated in the platform's own billing
--     unit (USD), never an org operating figure and never an ERPNext document. Stamping the org's
--     currency onto them would silently RE-DENOMINATE a USD credit grant as (e.g.) IDR.
--   • `erp_actuals_snapshot`, `erp_ap_aging_snapshot`, `erp_ar_aging_snapshot`, `erp_gl_entry_mirror`,
--     `erp_payment_ledger_mirror`, `timesheet_erp_mirror` — machine-written ERP read-models. The two
--     aging snapshots already carry the ERP doc's own `currency` (0101/0150); the ledger is the
--     oracle (ADR-0048) and PMO must not stamp its own value over ERP's.
--   • `timesheet_entries.hours`, `project_milestones.weight`/`input_pct`,
--     `pipeline_stage_config.win_probability`, `agent_runs.progress` — not money.
--
-- ── HOW: the default ────────────────────────────────────────────────────────────────────────────
-- `organizations.default_currency` (new, NOT NULL) is the org's single v1 currency; a BEFORE INSERT
-- trigger `stamp_currency()` copies it onto any money row inserted without one — the 0074 org_id
-- idiom. `default_currency` DEFAULTs to 'USD' because that is byte-for-byte what the app already
-- formats with (`src/lib/format.ts`), so this migration changes no rendered figure. An org whose real
-- currency is not USD (RIS = IDR) has it set at onboarding / ERPNext Connect; organizations carries a
-- SELECT policy ONLY (verified: `organizations_select` is its sole policy), so its INSERT/UPDATE
-- grants are inert under RLS and only service_role / the table owner can change it. That is the
-- correct posture: the org's currency is an operator setting, not a user field.
--
-- ⚑ TRIGGER FIRING ORDER IS LOAD-BEARING. Postgres fires BEFORE-row triggers in ALPHABETICAL ORDER
-- of trigger name. `stamp_currency` must run AFTER `<tbl>_stamp_org_id`, because it resolves the
-- default from `new.org_id` and stamp_org_id is what puts the caller's real org there (for a
-- non-seed-org authenticated user the column default is the SEED org). Hence the deliberately ugly
-- `<tbl>_zz_stamp_currency` name: `zz` sorts after `stamp_org_id`. `money_currency_seam.test.sql`
-- pins this with a non-seed-org insert — renaming the trigger to something that sorts earlier turns
-- that test red.
--
-- ── GRANTS (⚑ read before touching) ─────────────────────────────────────────────────────────────
-- A column-level REVOKE cannot subtract from a table-level GRANT (silent no-op), and the inverse trap
-- applies here: on a table whose INSERT grant is COLUMN-LEVEL, a newly added column is NOT insertable
-- unless it is granted explicitly. `currency` is granted INSERT (never UPDATE) on exactly the tables
-- that already hold a column-level INSERT grant for `authenticated`
-- (projects, procurements, budget_versions, sales_invoices, incoming_payments), so a client MAY state
-- a currency on create — DD-IMP-1 requires the import descriptor to set it explicitly — and may NEVER
-- re-denominate an existing money row by updating it. The remaining tables' writes route through
-- SECURITY DEFINER RPCs and get no new grant. SELECT needs no grant: every one of these tables holds
-- a TABLE-level SELECT grant, which covers new columns automatically (verified against
-- information_schema before writing this).
--
-- ── Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse block
--    (forward-only if promoted), in this order:
--   do $$ declare t text; begin
--     foreach t in array array['projects','procurements','procurement_quotations','budget_versions',
--       'budget_projections','purchase_requests','rfqs','purchase_orders','payments',
--       'procurement_invoices','sales_invoices','incoming_payments'] loop
--       execute format('drop trigger if exists %I on public.%I', t||'_zz_stamp_currency', t);
--       execute format('alter table public.%I drop column if exists currency', t);
--     end loop; end $$;
--   drop function if exists public.stamp_currency();
--   alter table public.organizations drop column if exists default_currency;

-- ============================================================================
-- §1 — organizations.default_currency (the org's single v1 currency)
-- ============================================================================
alter table public.organizations
  add column if not exists default_currency text not null default 'USD';
alter table public.organizations
  add constraint organizations_default_currency_iso4217
  check (default_currency ~ '^[A-Z]{3}$');
comment on column public.organizations.default_currency is
  'OD-CR-5: the org''s single operating currency in v1 (ISO-4217 alpha-3). Source of the trigger '
  'default for every PMO-owned money row. Pinned to the ERPNext company currency at Connect '
  '(DD-OPS-3). Operator-set: organizations has a SELECT policy only.';

-- ============================================================================
-- §2 — stamp_currency(): the 0074 stamp_org_id idiom for currency
-- SECURITY DEFINER + pinned search_path: `organizations` FORCEs RLS and carries a SELECT policy
-- scoped to the caller's own org, which the seed-org / cross-org insert paths cannot satisfy from
-- inside a trigger. Matches stamp_org_id()'s own definer posture.
-- ⚑ 0185 revoked EXECUTE from anon/authenticated on every SECURITY DEFINER *writer* in `public`;
-- this function writes nothing and is reachable only as a trigger, but it is revoked anyway so the
-- default-privilege posture stays uniform and a direct call is never a surface.
-- ============================================================================
create or replace function public.stamp_currency() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Only fill an UNSTATED currency — NULL, or still the 'XXX' column-default sentinel. An
  -- explicitly-supplied real currency is left alone (the multi-currency seam OD-CR-5 asks to
  -- architect for, and what DD-IMP-1's import descriptor sets). This is 0074's narrow rule verbatim
  -- ("stamp only when the caller relied on the column default"), with 'XXX' playing the part the
  -- seed-org literal plays there.
  if new.currency is null or new.currency = 'XXX' then
    select o.default_currency into new.currency
      from public.organizations o where o.id = new.org_id;
  end if;
  return new;
end $$;
revoke all     on function public.stamp_currency() from public;
revoke execute on function public.stamp_currency() from anon, authenticated;

-- ============================================================================
-- §3 — the column + backfill + NOT NULL + trigger, on each of the 12 tables.
--
-- ⚑ THE 'XXX' SENTINEL, and why the column carries a DEFAULT at all. This copies 0074's org_id shape
-- exactly: a constant column DEFAULT that the trigger treats as "the caller stated nothing" and
-- overrides. It is not decoration —
--   • Without a DEFAULT, Supabase typegen marks a NOT NULL column as REQUIRED on every `Insert`, so
--     every DAL write path (projects, procurements, budget_versions, budget_projections, …) would
--     have to hand-carry a currency. That is precisely the "formatting/derivation keyed off a value
--     threaded through the client" that OD-CR-5's trigger exists to prevent, and it is the same
--     reason `org_id` is never sent from the client.
--   • The sentinel is 'XXX' — ISO-4217's own code for "no currency" — rather than a plausible
--     'USD'. Nobody ever *means* XXX, so overriding it can never surprise a caller who deliberately
--     stated a currency (0074's seed-org literal has the same property). And if the trigger were ever
--     dropped, the row would carry a visibly-absent currency instead of a plausible-but-wrong one.
--   • The CHECK forbids 'XXX' surviving. Column CHECKs run AFTER BEFORE-row triggers, so the only way
--     to land one is a trigger that could not resolve the org — which then fails LOUDLY (23514)
--     instead of silently storing a currency-less money row.
-- ============================================================================
do $$
declare
  t text;
  tbls text[] := array[
    'projects','procurements','procurement_quotations','budget_versions','budget_projections',
    'purchase_requests','rfqs','purchase_orders','payments','procurement_invoices',
    'sales_invoices','incoming_payments'
  ];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I add column if not exists currency text default ''XXX''', t);
    execute format(
      'update public.%I r set currency = o.default_currency
         from public.organizations o where o.id = r.org_id and (r.currency is null or r.currency = ''XXX'')', t);
    execute format('alter table public.%I alter column currency set not null', t);
    execute format(
      'alter table public.%I add constraint %I check (currency ~ ''^[A-Z]{3}$'' and currency <> ''XXX'')',
      t, t||'_currency_iso4217');
    -- ⚑ `zz` so this BEFORE trigger sorts AFTER `<tbl>_stamp_org_id` (see header).
    execute format('drop trigger if exists %I on public.%I', t||'_zz_stamp_currency', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.stamp_currency()',
      t||'_zz_stamp_currency', t);
    execute format(
      'comment on column public.%I.currency is %L', t,
      'OD-CR-5: ISO-4217 currency this row''s money columns are denominated in. Trigger-defaulted '
      'from organizations.default_currency; never a global constant.');
  end loop;
end $$;

-- ============================================================================
-- §4 — INSERT grant on `currency` for the tables whose INSERT grant is COLUMN-LEVEL (see header).
-- No UPDATE grant is issued: re-denominating an existing money row is not a client operation.
-- ⚑ ONE HONEST EXCEPTION, stated rather than papered over: `budget_projections` holds TABLE-level
-- INSERT and UPDATE for `authenticated` (0137), so its new `currency` column is client-updatable
-- whether we like it or not — a column-level REVOKE cannot subtract from a table-level grant (silent
-- no-op), and the only real fix is to revoke the table grant and re-grant the column list minus
-- `currency` (the DD-WO-3 mechanic). That surgery is deliberately NOT done here: budget_projections
-- is a PMO-authored forward estimate that mints no ERP document, so a currency edit there is a data-
-- quality wrinkle, not a money-path hole, and rewriting a shipped table grant is a bigger risk than
-- the one it removes. Recorded so the next reader does not mistake it for an oversight.
-- ============================================================================
grant insert (currency) on public.projects          to authenticated;
grant insert (currency) on public.procurements      to authenticated;
grant insert (currency) on public.budget_versions   to authenticated;
grant insert (currency) on public.sales_invoices    to authenticated;
grant insert (currency) on public.incoming_payments to authenticated;
