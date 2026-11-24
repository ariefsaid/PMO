#!/usr/bin/env bash
# Inline the shipped down files because the test container mounts only the test directory.
set -euo pipefail
cd "$(dirname "$0")/.."
test_file="$(mktemp supabase/tests/2450_receiving_rollback.XXXXXX.test.sql)"
trap 'rm -f "$test_file"' EXIT
python3 -c 'from pathlib import Path; import sys
sql = Path("scripts/2450-receiving-rollback.test.sql").read_text()
for name in ["2450_receiving_contracts_down.sql", "2224_order_receiving_waiting_down.sql"]:
    sql = sql.replace("\\ir ../migrations/rollback/" + name, Path("supabase/migrations/rollback", name).read_text())
Path(sys.argv[1]).write_text(sql)
' "$test_file"
npx -y supabase@2.122.1 test db "$test_file"
