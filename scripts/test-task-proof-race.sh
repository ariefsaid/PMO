#!/usr/bin/env bash
set -euo pipefail
container=supabase_db_pmo-portal
# Run under with-db-lock.sh after a local reset; both transactions exercise the shipped triggers.
cleanup() {
  docker exec "$container" psql -X -q -U postgres -d postgres -c "delete from public.tasks where id='09910000-0000-0000-0000-000000000109'; delete from storage.objects where bucket_id='task-proofs' and name like '%/09910000-0000-0000-0000-000000000109/%'; delete from public.projects where id='09910000-0000-0000-0000-0000000000d9';" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
insert into public.projects (id, org_id, code, name, status) values ('09910000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-000000000001', 'TWPRACE','Race','Ongoing Project');
insert into public.tasks (id, project_id, name, status, proof_required) values ('09910000-0000-0000-0000-000000000109','09910000-0000-0000-0000-0000000000d9','Race','In Progress',true);
insert into storage.objects (bucket_id,name) values ('task-proofs','00000000-0000-0000-0000-000000000001/09910000-0000-0000-0000-000000000109/09910000-0000-0000-0000-000000000509/site.jpg');
insert into public.task_proofs (id, task_id, file_path) values ('09910000-0000-0000-0000-000000000509','09910000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000000001/09910000-0000-0000-0000-000000000109/09910000-0000-0000-0000-000000000509/site.jpg');
SQL
docker exec "$container" rm -f /tmp/twop-race-ready
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres > /tmp/2531-race-a.log 2>&1 <<'SQL' &
begin;
update public.task_proofs set archived_at=now() where id='09910000-0000-0000-0000-000000000509';
\! touch /tmp/twop-race-ready
select pg_sleep(8);
commit;
SQL
first=$!
for attempt in $(seq 1 60); do
  if docker exec "$container" test -f /tmp/twop-race-ready; then break; fi
  if ! kill -0 "$first" 2>/dev/null; then cat /tmp/2531-race-a.log; wait "$first"; exit 1; fi
  sleep 0.1
done
docker exec "$container" test -f /tmp/twop-race-ready
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "update public.tasks set status='Done' where id='09910000-0000-0000-0000-000000000109'" > /tmp/2531-race-b.log 2>&1 &
second_pid=$!
sleep 1
if ! kill -0 "$second_pid" 2>/dev/null; then wait "$first"; echo 'race test FAILED: Done did not wait for removal'; exit 1; fi
set +e
wait "$second_pid"
second=$?
set -e
wait "$first"
if [ "$second" -eq 0 ] || ! grep -q 'proof of completion is required' /tmp/2531-race-b.log; then cat /tmp/2531-race-b.log; echo 'race test FAILED'; exit 1; fi
echo 'race test passed: concurrent Done rejected after removal'
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
insert into storage.objects (bucket_id,name) values ('task-proofs','00000000-0000-0000-0000-000000000001/09910000-0000-0000-0000-000000000109/09910000-0000-0000-0000-000000000510/site.jpg');
insert into public.task_proofs (id, task_id, file_path) values ('09910000-0000-0000-0000-000000000510','09910000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000000001/09910000-0000-0000-0000-000000000109/09910000-0000-0000-0000-000000000510/site.jpg');
SQL
docker exec "$container" rm -f /tmp/twop-race-ready
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres > /tmp/2531-race-a.log 2>&1 <<'SQL' &
begin;
update public.tasks set status='Done' where id='09910000-0000-0000-0000-000000000109';
\! touch /tmp/twop-race-ready
select pg_sleep(8);
commit;
SQL
first=$!
for attempt in $(seq 1 60); do
  if docker exec "$container" test -f /tmp/twop-race-ready; then break; fi
  if ! kill -0 "$first" 2>/dev/null; then cat /tmp/2531-race-a.log; wait "$first"; exit 1; fi
  sleep 0.1
done
docker exec "$container" test -f /tmp/twop-race-ready
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "update public.task_proofs set archived_at=now() where id='09910000-0000-0000-0000-000000000510'" > /tmp/2531-race-b.log 2>&1 &
second_pid=$!
sleep 1
if ! kill -0 "$second_pid" 2>/dev/null; then wait "$first"; echo 'race test FAILED: removal did not wait for Done'; exit 1; fi
set +e
wait "$second_pid"
second=$?
set -e
wait "$first"
if [ "$second" -eq 0 ] || ! grep -q 'proof of a completed task cannot be removed' /tmp/2531-race-b.log; then cat /tmp/2531-race-b.log; echo 'race test FAILED'; exit 1; fi
echo 'race test passed: concurrent removal rejected after Done'
