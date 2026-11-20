#!/usr/bin/env bash
# Prove the shipped rollback refuses an unresolved, confirmed fiscal-year intent.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/fiscal-year-rollback.XXXXXX")"
test_file="$test_dir/rollback.test.sql"
trap 'rm -rf "$test_dir"' EXIT
python3 - "$root" "$test_file" <<'PY'
from pathlib import Path
import sys
root, output = map(Path, sys.argv[1:])
test = (root / 'supabase/tests/erp_fiscal_year_ensure.test.sql').read_text()
rollback = (root / 'supabase/migrations/rollback/1147_erp_fiscal_year_ensure_down.sql').read_text()
test = test.replace('select plan(49);', 'select plan(50);', 1)
assertion = "reset role;\nselect throws_ok($rollback$\n" + rollback + "\n$rollback$, 'P0001', null, 'rollback refuses a confirmed held canonical intent');\n"
assert 'select plan(50);' in test and 'select * from finish();' in test
test = test.replace('select * from finish();', assertion + 'select * from finish();', 1)
output.write_text(test)
PY
"$root/scripts/with-db-lock.sh" supabase test db "$test_file"
