-- Read-only: pairs of PMO companies in one org with the same type and the same name (case, spacing
-- ignored). One row per pair; shows each side's ERP link so a human can pick the one to keep.
--   scripts/prod-read.sh -f scripts/list-duplicate-companies.sql      (production, read-only path)
--   psql "$LOCAL_DB_URL" -f scripts/list-duplicate-companies.sql      (local)
-- SELECT only. Nothing here merges, archives or writes.
select a.org_id,
       a.type,
       a.name                                                  as name_a,
       b.name                                                  as name_b,
       a.id                                                    as id_a,
       b.id                                                    as id_b,
       (select string_agg(r.external_record_id, ', ') from public.external_refs r
         where r.org_id = a.org_id and r.domain = 'companies' and r.pmo_record_id = a.id::text) as erp_link_a,
       (select string_agg(r.external_record_id, ', ') from public.external_refs r
         where r.org_id = b.org_id and r.domain = 'companies' and r.pmo_record_id = b.id::text) as erp_link_b,
       a.archived_at is not null                               as archived_a,
       b.archived_at is not null                               as archived_b,
       a.created_at                                            as created_a,
       b.created_at                                            as created_b
  from public.companies a
  join public.companies b
    on b.org_id = a.org_id
   and b.type = a.type
   and b.id > a.id
   and lower(regexp_replace(btrim(b.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(a.name), '\s+', ' ', 'g'))
 order by a.org_id, a.type, lower(a.name), a.created_at;
