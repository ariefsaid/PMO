-- Rollback of 0517_tm_signoff.sql (#1514 T3). Refuses while any time_materials claim exists: its invoice path would lose its fence.
-- Replaced bodies are restored verbatim from 0250_progress_billing.sql (the newest definitions before 0517).
do $$
begin
  if exists (select 1 from public.progress_claims where kind = 'time_materials')
     or exists (select 1 from public.tm_claims where status = 'SignedOff') then
    raise exception '0517 rollback refused: time_materials claims exist';
  end if;
end $$;

drop trigger progress_claims_tm_follow_withdrawal on public.progress_claims;
drop function public.tm_claim_follow_withdrawal();

create or replace function public.assert_progress_claim_raisable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_withdrawn timestamptz; v_claim_org uuid;
begin
  if new.pmo_record_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return new;
  end if;
  select pc.withdrawn_at, pc.org_id into v_withdrawn, v_claim_org
    from public.progress_claims pc
   where pc.id = new.pmo_record_id::uuid
     for share;
  if not found then
    return new;   -- not a claim: an ordinary invoice or receipt
  end if;
  -- A money fence fails CLOSED: a claim id under another org is refused, never waved through as "not a claim".
  if v_claim_org is distinct from new.org_id then
    raise exception 'this progress claim belongs to another organisation' using errcode = '42501';
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if not exists (select 1 from public.progress_claim_evidence ev where ev.claim_id = new.pmo_record_id::uuid) then
    raise exception 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice'
      using errcode = '55000';
  end if;
  return new;
end; $$;

create or replace function public.append_progress_claim_author() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  select new.org_id, new.id, pc.created_by
    from public.progress_claims pc
   where pc.id = new.id and pc.org_id = new.org_id
  on conflict do nothing;
  return new;
end; $$;
revoke all on function public.assert_progress_claim_raisable() from public, anon, authenticated;
revoke all on function public.append_progress_claim_author() from public, anon, authenticated;

drop function public.prepare_tm_signoff(uuid, uuid, text);
drop function public.withdraw_tm_signoff(uuid);
drop function public.confirm_tm_signoff(uuid);

drop trigger tm_claim_sources_guard on public.tm_claim_sources;
drop trigger tm_claim_lines_guard on public.tm_claim_lines;
drop function public.tm_claim_child_guard();
drop trigger tm_claims_guard on public.tm_claims;
drop function public.tm_claims_guard();
drop function public.tm_claim_fingerprint(uuid);

drop index public.tm_claims_signoff_prepared_by_idx;
alter table public.tm_claims
  drop constraint tm_claims_signed_off_prepared,
  drop constraint tm_claims_note_len,
  drop column prepared_fingerprint,
  drop column signoff_prepared_at,
  drop column signoff_prepared_by;

alter table public.progress_claims drop constraint progress_claims_kind_shape;
alter table public.progress_claims add constraint progress_claims_kind_shape check (
  (kind = 'down_payment'
    and down_payment_amount > 0 and down_payment_amount < 'Infinity'::numeric
    and recovery_pct > 0 and recovery_pct <= 100
    and gross_amount = down_payment_amount and dp_recovery_amount = 0 and dp_item_code is not null)
  or (kind = 'progress'
    and down_payment_amount is null and recovery_pct is null
    and dp_recovery_amount <= gross_amount
    and (dp_recovery_amount = 0 or dp_item_code is not null)));
alter table public.progress_claims drop constraint progress_claims_kind_check;
alter table public.progress_claims add constraint progress_claims_kind_check check (kind in ('down_payment', 'progress'));
