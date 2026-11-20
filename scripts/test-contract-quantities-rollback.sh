#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/contract_quantities_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out=Path(sys.argv[1])
text=Path('scripts/contract-quantities-rollback.test.sql').read_text()
# 1047 / 1046 opening balances reference work_order_acceptances;
# 1040's dsr_progress_lines references work_order_lines; 1041 holds the functions over 1040's tables.
dependents=[
    'supabase/migrations/rollback/1047_cli_opening_balances_down.sql',
    'supabase/migrations/rollback/1046_opening_balances_down.sql',
    'supabase/migrations/rollback/1041_daily_site_report_rpcs_down.sql',
    'supabase/migrations/rollback/1040_daily_site_reports_down.sql',
]
text=text.replace('-- @DEPENDENTS_DOWN@', '\n'.join(Path(p).read_text() for p in dependents))
for marker, source in [
    ('-- @0337_DOWN@', 'supabase/migrations/rollback/0337_contract_quantities_down.sql'),
    ('-- @0337_UP@', 'supabase/migrations/0337_contract_quantities.sql'),
]:
    text=text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
