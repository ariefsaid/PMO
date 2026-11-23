-- 1569_invoice_approval_route.sql — fix-waiting item 3 (FR-WAIT-006): the customer-invoice screen names who a
-- PMO-native Draft invoice waits for, from the database's own decision route, instead of a static role label.
--
-- ONE READ for ONE visible customer invoice, bound to its single current approval step (Draft -> Unpaid):
--   get_invoice_approval_route(invoice) -> {approvers:[{id,name,role}], route_kind}
-- with route_kind one of
--   named          the active, non-field Finance/Admin people the transition would let approve this invoice now
--   nobody         a governed route with nobody left after the author exclusions (an honest empty)
--   missing_author no recorded body author, so the route cannot be established (no approver is invented)
--   unavailable    not visible / not PMO-native / not Draft / absent (one non-leaking empty shape)
--
-- The authority is the shipped transition, not a second rule:
--   * transition_native_sales_invoice (0275:316, restated 0534:306) gates the decision on role in ('Admin','Finance')
--     and, per 1530, refuses a field (light) account;
--   * assert_sales_invoice_approver (0275:139) refuses the primary author and EVERY body author recorded in
--     sales_invoice_authors (0132), and refuses an invoice with no recorded author at all.
-- This read mirrors those eligibility facts for the account states the screen supports; it does not add, widen or
-- change any write, approval or SoD rule. The transition remains authoritative: a named person can still be refused
-- by a later state change, and this is a display projection, never a promise.
--
-- SECURITY INVOKER: the invoice and its author set are read through their existing RLS policies (sales_invoices_select
-- 0128/0646, the 0350 revenue-role read scope, sales_invoice_authors_select 0132/0646) and the candidate profiles
-- through profiles_select (0655). No client organisation argument: the organisation comes from the visible invoice row.
-- An invoice of another organisation, one this account may not read, a non-PMO-native row, a row that is not Draft and
-- an absent id all return the SAME empty shape, so the read is not an existence oracle. No helper is created or granted.
--
-- REVERSE: supabase/migrations/rollback/1569_invoice_approval_route_down.sql

create function public.get_invoice_approval_route(p_invoice_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_uid      uuid := auth.uid();
  v_org      uuid;
  v_author   uuid;
  v_status   text;
  v_native   boolean;
  v_authors  uuid[];
  v_people   jsonb;
  v_kind     text;
begin
  -- Active-caller assert before any read: a disabled/absent session gets the same refusal the write surface gives it,
  -- never a row-shaped answer.
  if v_uid is null or not coalesce(public.is_active_member(), false) then
    raise exception 'your account is not an active member of this organisation, so it cannot read an approval route'
      using errcode = '42501';
  end if;

  -- The write transition refuses a field (light) account (1530). The read applies the same account-state gate.
  if public.actor_is_light() then
    raise exception 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this' using errcode = '42501';
  end if;

  -- Existing RLS decides whether this invoice is visible at all. A hidden / foreign / nonexistent id leaves
  -- v_org null and returns the SAME empty shape as a visible row that is not a PMO-native Draft.
  select si.org_id, si.author_user_id, si.status, si.pmo_native
    into v_org, v_author, v_status, v_native
    from public.sales_invoices si
   where si.id = p_invoice_id;

  if v_org is null or not coalesce(v_native, false) or v_status is distinct from 'Draft' then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  -- Every body writer, from the append-only author set (0132), plus the legacy scalar below. This is the SoD oracle
  -- assert_sales_invoice_approver applies: nobody in this set may approve the invoice.
  select coalesce(array_agg(distinct a.user_id), '{}'::uuid[])
    into v_authors
    from public.sales_invoice_authors a
   where a.sales_invoice_id = p_invoice_id;

  -- No provenance at all: the transition refuses this invoice for every role (0275 `sod-author-missing`), so no
  -- approver may be named. This is a distinct, honest state, never `nobody` and never a fabricated person.
  if v_author is null and cardinality(v_authors) = 0 then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'missing_author');
  end if;

  -- Eligible deciders: the transition's role gate (Admin/Finance), an active profile and, per 1530, not a field
  -- (light) account — minus the primary author and every recorded co-author. The names are organisation-visible
  -- profiles read through profiles_select; no name is invented, and the list is the actual eligible set.
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role::text)
                            order by p.full_name, p.id), '[]'::jsonb)
    into v_people
    from public.profiles p
   where p.org_id = v_org
     and p.status = 'active'
     and p.role in ('Admin', 'Finance')
     and not public.is_light_role_key(p.built_in_role)
     and p.id is distinct from v_author
     and p.id <> all(v_authors);

  if jsonb_array_length(v_people) = 0 then
    v_kind := 'nobody';
    v_people := '[]'::jsonb;
  else
    v_kind := 'named';
  end if;

  return jsonb_build_object('approvers', v_people, 'route_kind', v_kind);
end $$;

revoke all on function public.get_invoice_approval_route(uuid) from public, anon;
grant execute on function public.get_invoice_approval_route(uuid) to authenticated;

comment on function public.get_invoice_approval_route(uuid) is
  'fix-waiting item 3 (FR-WAIT-006): the people ONE visible PMO-native Draft customer invoice waits for, on its '
  'single current approval step (Draft -> Unpaid), projected from the shipped decision authority '
  '(transition_native_sales_invoice 0275/0534 + the 1530 field-account guard) and the SoD helper '
  'assert_sales_invoice_approver (0275): role in (Admin,Finance), an active non-field profile, minus the primary '
  'author and every sales_invoice_authors body writer. No recorded author is reported as missing_author and never '
  'invents an approver. SECURITY INVOKER so the invoice and author-set RLS policies are the visibility boundary; no '
  'organisation argument. Returns '
  '{"approvers":[{"id","name","role"}],"route_kind":"named"|"nobody"|"missing_author"|"unavailable"}.';
