-- 1491_org_term_keys_registry.sql — the overridable term keys become a seeded key table (#2744, C1).
--
-- 1230 widened the term_key CHECK from six values to sixteen, and 1450 had to restate the whole list again
-- after 1420 re-added its own shorter one — the same concern carried three times because the accepted set lived
-- inside a constraint body. It now lives in one table: a new nameable term is one inserted key, and the
-- constraint never changes again.
--
-- The key table is code-owned reference data, not tenant data: RLS on, no policy, no client grant — a foreign
-- key check bypasses row security by design, so a client inserting a known key needs no privilege on it, and no
-- client can read the set. The refusal for an unknown key moves from 23514 (check violation) to 23503 (foreign
-- key violation): same refusal, same layer, proven by 0975/1230/mrq_delivery_note_settings and by the 1491 test.
-- Reversal: supabase/migrations/rollback/1491_org_term_keys_registry_down.sql

create table public.org_term_keys (
  term_key text primary key
);
alter table public.org_term_keys enable row level security;
alter table public.org_term_keys force row level security;
-- No policy and no client grant: the foreign-key check is the only reader.

insert into public.org_term_keys (term_key) values
  ('workOrder'), ('project'), ('clientSuppliedStock'), ('purchaseRequest'), ('discipline'), ('materialRequest'),
  ('billOfQuantities'), ('contractItem'), ('dailyRevenue'), ('acceptedQuantity'), ('costVariation'), ('deliveryNote'),
  ('stockCount'), ('imprest'), ('standIn'), ('progressClaim');

-- MUTATION: no constraint at all (the FK is removed)

-- Closing self-assertion: the seed and the shipped overrides must agree, so a deploy that lands half of this
-- migration fails here rather than at the next Admin save.
do $$
declare v_bad text;
begin
  if (select count(*) from public.org_term_keys) <> 16 then
    raise exception '1491: org_term_keys must carry the 16 accepted terms';
  end if;
  select string_agg(t.term_key, ', ' order by t.term_key) into v_bad
    from public.org_terminology t
   where not exists (select 1 from public.org_term_keys k where k.term_key = t.term_key);
  if v_bad is not null then
    raise exception '1491: existing term overrides name unseeded keys: %', v_bad;
  end if;
end $$;
