create temp view chg_gate_gaps as
with cfg as (
  select c.table_name, k.col, k.cls, k.kind
    from public.record_history_config c
    cross join lateral (
      select e.key as col, 'captured'::text as cls, e.value #>> '{}' as kind from jsonb_each(c.captured) e
      union all select unnest(c.flag_cols), 'flag', null
      union all select unnest(c.omit_cols), 'omit', null) k),
cols as (
  select c.relname::text as table_name, a.attname::text as col
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
     and c.relname in (select table_name from public.record_history_config)),
trg as (
  select t.tgrelid::regclass::text as rel, t.tgname::text as tgname, t.tgtype::int as tgtype
    from pg_trigger t
   where not t.tgisinternal and t.tgfoid = 'public.record_change_capture()'::regprocedure)
select cols.table_name || '.' || cols.col || ' unclassified' as gap
  from cols left join cfg using (table_name, col) where cfg.col is null
union all
select cfg.table_name || '.' || cfg.col || ' classified more than once'
  from cfg group by cfg.table_name, cfg.col having count(*) > 1
union all
select cfg.table_name || '.' || cfg.col || ' classified but does not exist'
  from cfg left join cols using (table_name, col) where cols.col is null
union all
select cfg.table_name || '.' || cfg.col || ' unknown kind ' || coalesce(cfg.kind, 'null')
  from cfg where cfg.cls = 'captured'
   and coalesce(cfg.kind, '') not in ('text', 'number', 'money', 'date', 'timestamp', 'enum', 'ref', 'bool')
union all
select cfg.table_name || '.' || cfg.col || ' captured but not SELECT-able by authenticated'
  from cfg join cols using (table_name, col)
 where cfg.cls = 'captured'
   and not has_column_privilege('authenticated', 'public.' || cfg.table_name, cfg.col, 'SELECT')
union all
select c.table_name || ' has no capture trigger'
  from public.record_history_config c
 where not exists (select 1 from trg where trg.rel = c.table_name)
union all
select trg.rel || '.' || trg.tgname || ' captures off-registry'
  from trg where trg.rel not in (select table_name from public.record_history_config)
union all
select trg.rel || '.' || trg.tgname || ' is not AFTER INSERT OR UPDATE FOR EACH ROW'
  from trg where trg.tgtype <> (1 | 4 | 16);   -- ROW | INSERT | UPDATE, not BEFORE, no DELETE
