alter table public.progress_claim_lines drop constraint progress_claim_lines_claim_id_fkey;
alter table public.progress_claim_lines add constraint progress_claim_lines_claim_id_fkey
  foreign key (claim_id) references public.progress_claims(id);

create or replace function public.lock_expense_claim_line_edit() returns trigger
  language plpgsql set search_path=public as $$
declare
  v_claim uuid := case when tg_op='DELETE' then old.claim_id else new.claim_id end;
  v_status text;
  v_kind text;
begin
  select c.status,c.kind into v_status,v_kind from public.expense_claims c where c.id=v_claim for update;
  if not found or v_kind <> 'claim' then
    raise exception 'expense claim not found' using errcode='P0002';
  end if;
  if v_status not in ('Draft','Rejected') then
    raise exception 'expense claim content is frozen after submission' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.sync_expense_claim_amount() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid := coalesce(new.claim_id, old.claim_id);
  v_status text;
begin
  select c.status into v_status from public.expense_claims c where c.id=v_claim for update;
  if not found then
    raise exception 'expense claim not found' using errcode='P0002';
  end if;
  if v_status not in ('Draft','Rejected') then
    raise exception 'expense claim content is frozen after submission' using errcode='42501';
  end if;
  update public.expense_claims c
     set amount = coalesce((select sum(l.amount) from public.expense_claim_lines l where l.claim_id = v_claim), 0)
   where c.id = v_claim and c.kind = 'claim';
  return null;
end; $$;
