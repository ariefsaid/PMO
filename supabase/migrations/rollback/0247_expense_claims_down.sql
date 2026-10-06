-- Rollback for 0247_expense_claims.sql (#775). Mirrors the REVERSE block in the migration header, in order.
-- Run manually, not via `db reset`; prod data may exist. Remove bucket objects through the Storage API first.
drop trigger if exists expense_claims_notify_transition_trg on public.expense_claims;
drop function if exists public.notify_expense_claim_transition();
drop function if exists public.get_expense_advance_aging();
drop function if exists public.record_expense_advance_return(uuid, numeric, text);
drop function if exists public.get_expense_claim_approval_routes(uuid[]);
-- §8: spend_approval_route restored to 0243 §5 (the migration's §8 text minus every `-- 0247` line).
create or replace function public.spend_approval_route(
  p_org_id       uuid,
  p_project_id   uuid,
  p_category     public.budget_category,
  p_amount       numeric,
  p_currency     text,
  p_requester_id uuid,
  p_decider_id   uuid        default null,
  p_submitted_at timestamptz default null
) returns table (route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_reason       text;
  v_budget       numeric;
  v_used         numeric;
  v_currency     text;
  v_foreign      boolean;
  v_rows         int;
  v_eligible     uuid[];
  v_version      uuid;
  v_activated_at timestamptz;
begin
  -- 1. Classify (DD-APR-2). A missing or negative amount can never be "within" (DD-APR-5).
  if p_project_id is null then
    v_reason := 'no_project';
  elsif p_category is null then
    v_reason := 'no_category';
  elsif p_amount is null or p_amount < 0 then
    v_reason := 'amount_invalid';
  else
    select v.id, v.currency, v.activated_at into v_version, v_currency, v_activated_at
      from public.budget_versions v
     where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active';
    if not found then
      v_reason := 'no_active_budget';
    else
      select coalesce(sum(li.budgeted_amount), 0) into v_budget
        from public.budget_line_items li
        join public.budget_versions v on v.id = li.budget_version_id
       where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active'
         and li.category = p_category;
      -- Reserved (ADR-0034) ∪ Committed (OD-BUDGET-2) on this line. The request being decided is
      -- 'Requested', so it is never in its own sum. DD-APR-5: each request counts at least zero, so a
      -- negative row that predates the CHECKs cannot make room on the line.
      select coalesce(sum(greatest(0, pr.total_value,
               coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = pr.id), 0))), 0),
             coalesce(bool_or(pr.currency is distinct from v_currency), false)
        into v_used, v_foreign
        from public.procurements pr
       where pr.org_id = p_org_id and pr.project_id = p_project_id and pr.budget_category = p_category
         and pr.status in ('Approved','Vendor Quoted','Quote Selected','Ordered','Received','Vendor Invoiced','Paid');
      -- Explicit `<=` for "within": anything not provably within (a NULL included) is not within.
      if p_currency is distinct from v_currency or v_foreign then
        v_reason := 'currency_mismatch';
      elsif v_used + p_amount <= v_budget then
        -- DD-APR-3: the budget the request fits must not have been set by the decider, or after submission.
        if (p_submitted_at is not null and v_activated_at > p_submitted_at)
           or (p_decider_id is not null and exists (
                 select 1 from public.audit_events a
                  where a.org_id = p_org_id and a.entity_id = v_version
                    and a.action = 'budget_version.update'
                    and a.detail->>'to_status' = 'Active'
                    and a.detail->>'from_status' is distinct from 'Active'
                    and a.actor_id = p_decider_id))
        then
          v_reason := 'budget_changed';
        else
          v_reason := 'within_budget';
        end if;
      else
        v_reason := 'exceeds_line';
      end if;
    end if;
  end if;

  -- 2. Within budget → the project's approvers (FR-APR-012/013/014).
  if v_reason = 'within_budget' then
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_rows, v_eligible
      from public.spend_approvers sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
    if v_rows = 0 then
      return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;  -- unconfigured
      return;
    elsif cardinality(v_eligible) > 0 then
      return query select 'project'::text, v_reason, v_eligible, v_budget, v_used;
      return;
    end if;
    -- configured, nobody eligible → escalate to the senior set (FR-APR-014)
  end if;

  -- 3. The senior set (FR-APR-012/015). DD-APR-4: the flat matrix applies only when no senior set is
  -- configured at all; a configured set with nobody eligible leaves the decision to an Admin.
  select count(*),
         coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_rows, v_eligible
    from public.spend_approvers sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id is null;
  if cardinality(v_eligible) > 0 then
    return query select 'org'::text, v_reason, v_eligible, v_budget, v_used;
    return;
  elsif v_rows > 0 then
    return query select 'admin'::text, v_reason, '{}'::uuid[], v_budget, v_used;
    return;
  end if;
  return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;
end; $$;
revoke all on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) to authenticated;

drop function if exists public.transition_expense_claim(uuid, public.expense_claim_status, text, text);
drop function if exists public.expense_advance_outstanding(uuid);
drop policy if exists storage_objects_expense_receipt_write on storage.objects;
drop policy if exists storage_objects_expense_receipt_read  on storage.objects;
delete from storage.buckets where id = 'expense-receipts';
drop table if exists public.expense_claim_files;
drop table if exists public.expense_claim_lines;
drop table if exists public.expense_claims;
drop function if exists public.sync_expense_claim_amount();
drop function if exists public.stamp_expense_claim_child_org();
drop function if exists public.check_expense_claim_advance_link();
drop function if exists public.assert_expense_claim_update();
drop function if exists public.assert_expense_claim_origination();
drop type if exists public.expense_type;
drop type if exists public.expense_kind;
drop type if exists public.expense_claim_status;
