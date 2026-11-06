#!/usr/bin/env bash
# Before/after EXPLAIN (ANALYZE, BUFFERS) of the largest per-row-policy tables at volume, as an authenticated user.
# LOCAL stack only. The DB must already be at this branch's head (so the migration is applied); the BEFORE state is
# made by applying the migration's rollback file inside the scratch transaction.
#   scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/perf/rls_once_per_query_explain.sh supabase/migrations/rollback/0696_rls_row_policies_once_per_query_down.sql'
# One scratch transaction: volume load, AFTER queries, the rollback file, BEFORE queries, ROLLBACK (nothing persists).
# Each query set runs twice: pass 1 is cold (backend catalog/relcache load), pass 2 is the warm number to compare.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
{
  echo 'begin;'
  cat "$here/rls_once_per_query_setup.sql"
  echo '\echo ######## AFTER'; cat "$here/rls_once_per_query_queries.sql" "$here/rls_once_per_query_queries.sql"
  if [ $# -gt 0 ]; then
    for m in "$@"; do grep -viE '^(begin|commit);$' "$m"; done
    echo '\echo ######## BEFORE'; cat "$here/rls_once_per_query_queries.sql" "$here/rls_once_per_query_queries.sql"
  fi
  echo 'rollback;'
} | docker exec -i supabase_db_pmo-portal psql -U postgres -v ON_ERROR_STOP=1
