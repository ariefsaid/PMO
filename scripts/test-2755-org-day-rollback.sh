#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_file="$(mktemp supabase/tests/2755_roundtrip.XXXXXX.test.sql)"
trap 'rm -f "$test_file"' EXIT
python3 scripts/2755-org-day-rollback.py "$test_file"
npx -y supabase@2.122.1 test db "$test_file"
