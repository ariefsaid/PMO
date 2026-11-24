#!/usr/bin/env bash
# Apply the shipped 2260 rollback and run the existing 2042 HR rights proof against it.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$root" != "/opt/pmo-runner/PMO" ]]; then
  echo "This rollback proof must run on the spare database runner." >&2
  exit 2
fi

test_dir="$(mktemp -d "$root/supabase/tests/.2260-leave-rollback.XXXXXX")"
test_file="$test_dir/2260_leave_rollback.test.sql"
cleanup() {
  [[ ! -f "$test_file" ]] || unlink "$test_file"
  [[ ! -d "$test_dir" ]] || rmdir "$test_dir"
}
trap cleanup EXIT

cat "$root/supabase/migrations/rollback/2260_leave_person_manager_routing_down.sql" \
    "$root/supabase/tests/2042_people_team_role_rights.test.sql" > "$test_file"

npx -y supabase@2.122.1 db reset
npx -y supabase@2.122.1 test db "$test_file"
