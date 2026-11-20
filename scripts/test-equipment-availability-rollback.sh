#!/usr/bin/env bash
# Exercise the actual rollback scripts inside a transaction while the database lock is held.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
test_sql="$root/supabase/tests/.equipment-availability-rollback-$$.test.sql"
trap 'rm -f "$test_sql"' EXIT
cat > "$test_sql" <<'SQL'
begin;
create extension if not exists pgtap;
select plan(2);
insert into storage.objects (bucket_id, name) values ('equipment-proof', 'rollback-test/evidence.jpg');
drop function if exists public.equipment_rental_check(uuid, date, date, numeric, text);
drop function if exists public.equipment_rental_day_rates(uuid, uuid, date, date);
drop table if exists public.equipment_rental_checks;
SQL
cat "$root/supabase/migrations/rollback/0986_equipment_availability_reads_down.sql" >> "$test_sql"
cat "$root/supabase/migrations/rollback/1032_equipment_availability_down.sql" >> "$test_sql"
cat >> "$test_sql" <<'SQL'
select ok(exists(select 1 from storage.buckets where id = 'equipment-proof'), 'rollback preserves the private evidence bucket');
select ok(exists(select 1 from storage.objects where bucket_id = 'equipment-proof' and name = 'rollback-test/evidence.jpg'), 'rollback preserves evidence objects for Storage API handling');
select * from finish();
rollback;
SQL
supabase test db "$test_sql"
