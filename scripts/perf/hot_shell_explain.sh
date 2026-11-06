#!/usr/bin/env bash
# Before/after EXPLAIN (ANALYZE, BUFFERS) of the hot shell + list reads at volume, as an authenticated user.
# LOCAL stack only. The DB must already be at this branch's head (so the migration is applied); the BEFORE state is
# made by applying the migration's rollback file inside the scratch transaction.
#   scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/perf/hot_shell_explain.sh supabase/migrations/rollback/NNNN_x_down.sql'
# One scratch transaction: volume load, AFTER queries, the rollback file, BEFORE queries, ROLLBACK (nothing persists).
# Each query set runs twice: pass 1 is cold (backend catalog/relcache load), pass 2 is the warm number to compare.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
{
  echo 'begin;'
  cat "$here/hot_shell_setup.sql"
  echo '\echo ######## AFTER'; cat "$here/hot_shell_queries.sql" "$here/hot_shell_queries.sql"
  if [ $# -gt 0 ]; then
    for m in "$@"; do grep -viE '^(begin|commit);$' "$m"; done
    echo 'analyze public.profiles;'
    echo '\echo ######## BEFORE'; cat "$here/hot_shell_queries.sql" "$here/hot_shell_queries.sql"
  fi
  echo 'rollback;'
} | docker exec -i supabase_db_pmo-portal psql -U postgres -v ON_ERROR_STOP=1
