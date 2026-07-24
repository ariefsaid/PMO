# `release_outbox_hold` — the two-lane reconciliation (SETTLED 2026-07-24)

**Status: not a design question. The reconciled definition is below — the second lane to merge pastes it
as its final migration. Mechanical.**

## Does it exist today? Yes.
`public.release_outbox_hold(p_outbox_id uuid, p_reason text)` — shipped on `dev`, defined in
`0137_budget_push_seam.sql`. Admin-only, reason-required, audited. It: locks the outbox row, re-asserts
org+Admin+active-membership, refuses anything not `held`, moves the row `held → failed` (so the recovery
backstop re-queues it) and bumps `claim_generation` (fencing any late claimant). **It touches only the
outbox row.**

## The two lanes change DIFFERENT parts of it — they do not conflict in logic, only in text:
- **FU-2 (`feat/budget-fiscal-year`, mig `0156`)** — SIGNATURE: adds optional `p_expected_domain text
  default null` + a top guard (`if p_expected_domain is not null and v_domain is distinct from
  p_expected_domain then raise 42501`). `null` ⇒ byte-identical to shipped. Also `drop function if exists
  public.release_outbox_hold(uuid, text)` first (else 2-arg calls go ambiguous, `42725`).
- **FU-1a (`feat/timesheet-reopen`, mig `0152`)** — BODY: after the outbox update, if `v_domain =
  'timesheets'`, also CAS the matching `timesheet_erp_mirror` `held → failed` (scoped by domain + org +
  this command's own `pmo_record_id`), so a timesheet release restores the mirror to a backstop-queueable
  state. A budget/revenue release touches no mirror.

## The reconciled function = the UNION (FU-2's signature+guard AND FU-1a's mirror CAS):
```sql
drop function if exists public.release_outbox_hold(uuid, text);
create or replace function public.release_outbox_hold(
  p_outbox_id uuid, p_reason text, p_expected_domain text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_state text; v_domain text; v_record text; v_sheet uuid;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select o.org_id, o.state, o.domain, o.pmo_record_id
    into v_org, v_state, v_domain, v_record
    from public.external_command_outbox o where o.id = p_outbox_id for update;
  if v_org is null then raise exception 'outbox command not found' using errcode='P0002'; end if;
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() is distinct from 'Admin'
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode='42501'; end if;
  -- FU-2: optional expected-domain guard (null ⇒ no assertion)
  if p_expected_domain is not null and v_domain is distinct from p_expected_domain then
    raise exception 'outbox command is domain % — the caller expected %', v_domain, p_expected_domain
      using errcode='42501'; end if;
  if v_state is distinct from 'held' then
    raise exception 'outbox command is % — only a held command can be released', v_state
      using errcode='P0001'; end if;
  update public.external_command_outbox
     set state='failed', claim_generation = claim_generation + 1, updated_at = now()
   where id = p_outbox_id;
  -- FU-1a: the timesheet mirror's half of the hold (held → failed ONLY; a pushed row is a real ERP doc)
  if v_domain = 'timesheets' then
    begin v_sheet := v_record::uuid; exception when others then v_sheet := null; end;
    if v_sheet is not null then
      update public.timesheet_erp_mirror
         set push_state = case when push_state = 'held' then 'failed' else push_state end
       where org_id = v_org and timesheet_id = v_sheet and push_state = 'held';
    end if;
  end if;
  -- <audit insert exactly as 0137 has it — unchanged by either lane>
end $$;
revoke all on function public.release_outbox_hold(uuid, text, text) from public, anon;
grant execute on function public.release_outbox_hold(uuid, text, text) to authenticated;
```

## Merge procedure
1. First lane merges normally (its own 0152 or 0156 wins; no conflict yet — the other isn't on dev).
2. **Second lane:** delete its own `release_outbox_hold` redefinition from its migration, and add ONE new
   migration (next free number) containing the reconciled function above.
3. Prove both survive with pgTAP: a `timesheets` release still frees the mirror (`held → failed`) AND a
   `p_expected_domain='budget'` mismatch is refused (`42501`) AND a 2-arg-shaped call resolves (no `42725`).
4. `scripts/check-migration-collisions.sh` must pass.

**Both lanes' own reviews are unaffected — neither is re-opened. This is purely the merge-time union.**
