-- 0207_org_default_tax_treatment.sql — the org-wide tax-treatment default (#548, OD-TAX-1).
-- Proven by supabase/tests/0207_org_default_tax_treatment.test.sql (AC-TAX-201..208).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- `OD-TAX-1` (owner, 2026-08-21, resolving #518): the owner declined to pick a single basis —
-- **the system caters to either**, because there is no one Indonesian convention to encode.
-- Commercial contracts, quotations and vendor agreements are normally quoted EXCLUSIVE of PPN
-- ("harga belum termasuk PPN"); government/SOE tender contracts are normally INCLUSIVE, the
-- contract value being the all-in ceiling with PPN carved out of it. A contractor working both
-- sides needs both, and needs the common case pre-selected so the uncommon one is a visible choice.
--
-- ── ⛔ THE ONE RULE THIS COLUMN MUST NEVER BREAK ────────────────────────────────────────────────
-- **It PRE-SELECTS ONLY. It is never consulted at read time.** The stored per-row `tax_treatment`
-- is authoritative; a row whose treatment is NULL means "no value to interpret" (the CHECKs pair it
-- with a zero/absent amount), NEVER "fall back to the org default". That inference is exactly the
-- ambiguity #478 established cannot be recovered after the fact: a stored money figure whose
-- inclusive/exclusive status is unrecorded is undecidable later, and reading a *current* org default
-- onto an *old* row silently re-interprets history every time an admin flips the setting.
--
-- ⚑ So this is deliberately NOT a column default on the money tables, and NOT a trigger. It is a
-- form-time hint the FE reads when composing a NEW row. Enforcement of that stays in review; the
-- gate here is the comment plus AC-TAX-206, which asserts existing rows are untouched by a flip.
-- ================================================================================================

alter table public.organizations
  add column default_tax_treatment text not null default 'exclusive';

alter table public.organizations
  add constraint organizations_default_tax_treatment_check
  check (default_tax_treatment in ('inclusive','exclusive'));

comment on column public.organizations.default_tax_treatment is
  'Pre-selects the tax treatment in NEW money forms (OD-TAX-1). ⛔ NEVER read at display time and '
  'never used to interpret a stored row: the per-row tax_treatment is authoritative, and a NULL '
  'treatment means "no value to interpret", not "inherit this". Seeded ''exclusive'' — the common '
  'Indonesian B2B quoting shape — so government/SOE inclusive contracts are a visible choice.';

-- ⚑ Admin-only write, matching how the other org-level accounting configuration is gated
-- (budget_category_account_map, 0137): the person who flips a tax posture is exercising an
-- accounting judgement. Every member READS it — the form needs it to pre-select.
-- organizations_select already exists (org floor); this adds only the narrow write path.
drop policy if exists organizations_update_tax_default on public.organizations;
create policy organizations_update_tax_default on public.organizations for update
  using (id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin')
  with check (id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin');

-- The column is the only thing this policy is meant to permit. Postgres has no per-column UPDATE
-- policy, so the grant carries that half: `authenticated` may update THIS column and no other.
-- ⚑ A column-level grant CANNOT subtract from a table-level UPDATE grant (2026-07-30 lesson), so
-- this is only meaningful because `authenticated` holds no table-wide UPDATE on organizations —
-- asserted by AC-TAX-208 rather than assumed.
grant update (default_tax_treatment) on public.organizations to authenticated;
