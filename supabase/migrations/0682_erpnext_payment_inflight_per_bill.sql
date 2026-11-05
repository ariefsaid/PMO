-- 0682 — per-bill in-flight serialization for ERPNext vendor payments.
-- Reversible: rollback/0682_erpnext_payment_inflight_per_bill_down.sql.
--
-- A Payment Entry may allocate across several Purchase Invoices (`pi_names` is an array), so one
-- expression-index key cannot represent every bill. Keep one transaction-maintained reservation per
-- (org, bill) and let its unique constraint arbitrate each bill. This is ERPNext procurement payment
-- only; Odoo and other ERPNext outbox commands do not enter this table.
--
-- A bill is never kept reserved by a payment that cannot reach ERPNext. A `pending` payment that was never
-- claimed (claim_generation 0) has not written anything: the ERPNext write follows the claim. When a NEW payment
-- hits a bill held by such a row older than 15 minutes (the claim itself is a 60 s lease; the sweep normally claims
-- a pending row within a tick, so an older one was not being driven), the trigger marks that row `failed` and the new
-- payment takes the bill. committing / committed / quarantined / held rows and any row that was ever claimed have an
-- unknown outcome and are never released this way.
--
-- A payment freed from its bill is not retried automatically: the release (and fail_refused_payment_claim, for a
-- claim the purchase rules refuse) sets attempt_count to the automatic budget, so neither the sweep's candidate
-- list nor the pending-retry list holds it. Otherwise it would post later, after the newer payment settles. A
-- person's same-key retry still works: it is a decision, gated by this bill lock and the remarks-key probe.
--
-- Backfill chooses one deterministic reservation per org/bill. DISTINCT ON makes this safe when
-- existing in-flight rows already overlap; when the chosen row settles, the trigger hands the
-- reservation to another still-in-flight row before releasing the bill.

create table public.erpnext_payment_inflight_bills (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  bill_name   text not null check (bill_name <> ''),
  outbox_id   uuid not null references public.external_command_outbox(id) on delete cascade,
  constraint external_command_outbox_one_inflight_erpnext_payment_per_bill unique (org_id, bill_name)
);

create index erpnext_payment_inflight_bills_outbox_id_idx
  on public.erpnext_payment_inflight_bills (outbox_id);

alter table public.erpnext_payment_inflight_bills enable row level security;
alter table public.erpnext_payment_inflight_bills force row level security;
revoke all on table public.erpnext_payment_inflight_bills from public, anon, authenticated;
grant all on table public.erpnext_payment_inflight_bills to service_role;

create or replace function public.sync_erpnext_payment_inflight_bills()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old_inflight       boolean := false;
  v_new_inflight       boolean := false;
  v_old_org_id         uuid;
  v_new_org_id         uuid;
  v_old_outbox_id      uuid;
  v_new_outbox_id      uuid;
  v_old_bill_names     text[] := array[]::text[];
  v_new_bill_names     text[] := array[]::text[];
  v_bill_name          text;
  v_lock_id            bigint;
  v_replacement_id     uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_org_id := old.org_id;
    v_old_outbox_id := old.id;
    v_old_inflight := old.external_tier = 'erpnext'
      and old.domain = 'procurement'
      and old.payload->>'erp_doc_kind' = 'payment'
      and old.state in ('pending','committing','committed','quarantined','held');
    if v_old_inflight then
      select coalesce(array_agg(distinct bills.bill_name order by bills.bill_name), array[]::text[])
        into v_old_bill_names
        from jsonb_array_elements_text(
          case when jsonb_typeof(old.payload->'pi_names') = 'array' then old.payload->'pi_names' else '[]'::jsonb end
        ) as bills(bill_name)
       where bills.bill_name is not null and bills.bill_name <> '';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    v_new_org_id := new.org_id;
    v_new_outbox_id := new.id;
    v_new_inflight := new.external_tier = 'erpnext'
      and new.domain = 'procurement'
      and new.payload->>'erp_doc_kind' = 'payment'
      and new.state in ('pending','committing','committed','quarantined','held');
    if v_new_inflight then
      select coalesce(array_agg(distinct bills.bill_name order by bills.bill_name), array[]::text[])
        into v_new_bill_names
        from jsonb_array_elements_text(
          case when jsonb_typeof(new.payload->'pi_names') = 'array' then new.payload->'pi_names' else '[]'::jsonb end
        ) as bills(bill_name)
       where bills.bill_name is not null and bills.bill_name <> '';
    end if;
  else
    v_new_outbox_id := old.id;
  end if;

  -- Not a payment in flight before or after (every budget, timesheet, invoice and Odoo write): nothing to do.
  if not v_old_inflight and not v_new_inflight then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Same org, same bills, in flight before and after (state progressing): the reservation is unchanged.
  if tg_op = 'UPDATE' and v_old_inflight and v_new_inflight
     and v_old_org_id = v_new_org_id and v_old_bill_names = v_new_bill_names then
    return new;
  end if;

  -- Stable lock order lets a command that names multiple bills reserve or release them atomically.
  -- The hash only selects a transaction lock; the unique (org, bill) constraint remains exact.
  for v_lock_id in
    select distinct pg_catalog.hashtextextended(lock_keys.org_id::text || ':' || lock_keys.bill_name, 682)
      from (
        select v_old_org_id as org_id, unnest(v_old_bill_names) as bill_name where v_old_inflight
        union all
        select v_new_org_id as org_id, unnest(v_new_bill_names) as bill_name where v_new_inflight
      ) as lock_keys
     where lock_keys.org_id is not null and lock_keys.bill_name is not null
     order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(v_lock_id);
  end loop;

  -- The current reservation owner may be one of several rows that pre-date this migration. Pass the
  -- unique reservation to another live row for the same bill before releasing it. (The upsert covers a
  -- DELETE, where the foreign key has already removed the owner's reservation.)
  if v_old_inflight then
    foreach v_bill_name in array v_old_bill_names loop
      if not (v_new_inflight and v_new_org_id = v_old_org_id and v_bill_name = any(v_new_bill_names)) then
        v_replacement_id := null;
        select o.id into v_replacement_id
          from public.external_command_outbox o
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(o.payload->'pi_names') = 'array' then o.payload->'pi_names' else '[]'::jsonb end
          ) as bills(bill_name)
         where o.id <> v_new_outbox_id
           and o.org_id = v_old_org_id
           and o.external_tier = 'erpnext'
           and o.domain = 'procurement'
           and o.payload->>'erp_doc_kind' = 'payment'
           and o.state in ('pending','committing','committed','quarantined','held')
           and bills.bill_name = v_bill_name
         order by o.created_at, o.id
         limit 1;

        if v_replacement_id is null then
          delete from public.erpnext_payment_inflight_bills
           where org_id = v_old_org_id and bill_name = v_bill_name and outbox_id = v_old_outbox_id;
        else
          insert into public.erpnext_payment_inflight_bills (org_id, bill_name, outbox_id)
          values (v_old_org_id, v_bill_name, v_replacement_id)
          on conflict (org_id, bill_name) do update set outbox_id = excluded.outbox_id
          where public.erpnext_payment_inflight_bills.outbox_id = v_old_outbox_id;
        end if;
      end if;
    end loop;
  end if;

  -- Reserve only bills newly entering this row's in-flight set. An unchanged legacy row can progress
  -- through recovery even if it was one of several rows already present when the migration ran.
  if v_new_inflight then
    foreach v_bill_name in array v_new_bill_names loop
      if not (v_old_inflight and v_new_org_id = v_old_org_id and v_bill_name = any(v_old_bill_names)) then
        -- Release a holder that can no longer reach ERPNext: pending, never claimed, older than 15 minutes.
        -- Its own trigger run then drops its reservations (the advisory locks are already held).
        update public.external_command_outbox o
           set state = 'failed',
               last_error = 'payment-intent-expired-before-claim',
               attempt_count = greatest(o.attempt_count, public.outbox_max_auto_attempts()),
               updated_at = now()
          from public.erpnext_payment_inflight_bills r
         where r.org_id = v_new_org_id and r.bill_name = v_bill_name
           and r.outbox_id = o.id and o.id <> v_new_outbox_id
           and o.state = 'pending' and o.claim_generation = 0
           and o.created_at < now() - interval '15 minutes';
        -- The release above can hand the bill straight to this row (it is already visible as in flight).
        if not exists (select 1 from public.erpnext_payment_inflight_bills r
                        where r.org_id = v_new_org_id and r.bill_name = v_bill_name and r.outbox_id = v_new_outbox_id) then
          insert into public.erpnext_payment_inflight_bills (org_id, bill_name, outbox_id)
          values (v_new_org_id, v_bill_name, v_new_outbox_id);
        end if;
      end if;
    end loop;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.sync_erpnext_payment_inflight_bills() from public, anon, authenticated;
grant execute on function public.sync_erpnext_payment_inflight_bills() to service_role;

-- The dispatcher's write for a claim the purchase rules refused: the never-claimed pending payment becomes failed,
-- frees its bill and is left to a person (see the header). Fenced to pending / never claimed, so a payment that was
-- ever claimed is untouched.
create or replace function public.fail_refused_payment_claim(p_id uuid, p_error text)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.external_command_outbox
     set state = 'failed',
         last_error = p_error,
         attempt_count = greatest(attempt_count, public.outbox_max_auto_attempts()),
         updated_at = now()
   where id = p_id and state = 'pending' and claim_generation = 0;
$$;

revoke all on function public.fail_refused_payment_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_refused_payment_claim(uuid, text) to service_role;

create trigger external_command_outbox_zz_erpnext_payment_inflight_guard
  after insert or update or delete on public.external_command_outbox
  for each row execute function public.sync_erpnext_payment_inflight_bills();

insert into public.erpnext_payment_inflight_bills (org_id, bill_name, outbox_id)
select selected.org_id, selected.bill_name, selected.outbox_id
  from (
    select distinct on (o.org_id, bills.bill_name) o.org_id, bills.bill_name, o.id as outbox_id
      from public.external_command_outbox o
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(o.payload->'pi_names') = 'array' then o.payload->'pi_names' else '[]'::jsonb end
      ) as bills(bill_name)
     where o.external_tier = 'erpnext'
       and o.domain = 'procurement'
       and o.payload->>'erp_doc_kind' = 'payment'
       and o.state in ('pending','committing','committed','quarantined','held')
       and bills.bill_name is not null and bills.bill_name <> ''
     order by o.org_id, bills.bill_name, o.created_at, o.id
  ) as selected;
