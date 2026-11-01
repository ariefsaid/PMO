-- 0424_imprest_position_down.sql — reverse of 0424 (#1515 site imprest S3), reverse dependency order.
-- 1. notify_expense_claim_transition back to its 0247 §10 text (verbatim; the 0247 trigger stays bound).
create or replace function public.notify_expense_claim_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r       record;
  v_route record;
  v_noun  text := case new.kind when 'advance' then 'Cash advance' else 'Expense claim' end;
  v_label text := coalesce(new.claim_number, new.title);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'Draft' and new.status = 'Submitted' then
    select * into v_route
      from public.spend_approval_route(new.org_id, new.project_id, new.budget_category, new.amount, new.currency,
                                       new.claimant_id, null, new.submitted_at);
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.id is distinct from new.claimant_id
                and case coalesce(v_route.route, 'admin')
                      when 'flat'  then public.holds_spend_approval_authority(p.role)
                      when 'admin' then p.role = 'Admin'
                      else p.id = any (v_route.approver_ids)
                    end
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' awaiting your approval',
        new.title, 'info', 'expense_claim', new.id, v_label);
    end loop;
  elsif old.status = 'Submitted' and new.status = 'Approved' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was approved',
      coalesce(nullif(btrim(new.approval_notes), ''), new.title), 'info', 'expense_claim', new.id, v_label);
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id and p.role = 'Finance'
                and p.id is distinct from new.claimant_id and p.id is distinct from new.approved_by_id
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' ready to pay',
        new.title, 'info', 'expense_claim', new.id, v_label);
    end loop;
  elsif old.status = 'Submitted' and new.status = 'Rejected' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was rejected',
      coalesce(nullif(btrim(new.rejection_notes), ''), new.title), 'warning', 'expense_claim', new.id, v_label);
  elsif old.status = 'Approved' and new.status = 'Paid' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was paid',
      new.title, 'info', 'expense_claim', new.id, v_label);
  end if;
  return new;
end; $$;
revoke execute on function public.notify_expense_claim_transition() from public, anon, authenticated;

-- 2. the imprest notification triggers and their functions.
drop trigger if exists imprest_replenishments_notify_trg on public.imprest_replenishments;
drop trigger if exists imprest_plans_notify_trg on public.imprest_plans;
drop function if exists public.notify_imprest_replenishment();
drop function if exists public.notify_imprest_plan_transition();
-- 3. the reads and the count writer.
drop function if exists public.imprest_float_choices(uuid, public.budget_category);
drop function if exists public.get_imprest_position(uuid);
drop function if exists public.get_imprest_plan_usage(uuid, date);
drop function if exists public.record_imprest_count(uuid, numeric, text);
-- 4. the counts table (its append-only trigger goes with it), then the trigger function.
drop table if exists public.imprest_cash_counts;
drop function if exists public.refuse_imprest_count_change();
