#!/usr/bin/env bash
# Applies the shipped FX rollback through the local Supabase API, then verifies its
# schema effects with pgTAP. Run under scripts/with-db-lock.sh after migration 0291
# is applied; callers must reset the database after this intentionally destructive test.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

python3 - <<'PY'
from pathlib import Path
import re
import subprocess

path = Path('supabase/migrations/rollback/0291_fx_rates_jisdor_down.sql')
source = path.read_text()
source = re.sub(r'(?im)^\s*(?:begin|commit)\s*;\s*$', '', source)
statements = [statement.strip() for statement in source.split(';') if statement.strip()]
if not statements:
    raise SystemExit(f'rollback migration has no executable statements: {path}')

for statement in statements:
    subprocess.run(['supabase', 'db', 'query', '--local', statement], check=True)
PY

supabase test db scripts/fx-rates-rollback.test.sql
