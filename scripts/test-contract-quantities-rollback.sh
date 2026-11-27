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
# Later migrations that reference 0337's objects are reverted first (newest first), as a real rollback would.
# 1321's dsr_stock_posting_lines holds a key to 1041's dsr_consumables; 1280's org_non_working_dates policy calls
# 1275's revenue_plan_enabled; 1275's work_order_revenue_plan policy calls 1041's dsr_may_see_revenue; 1186's
# procurement_invoices certificate link and 1185's subcontract certificate claims hold keys to 0337's
# work_order_lines; 1163's csr_lock_line returns 1162's client_requisition_lines row type, whose lines hold a key
# to work_order_lines; 1047 / 1046 opening balances reference work_order_acceptances; 1040's dsr_progress_lines
# references work_order_lines; 1041 holds the functions over 1040's tables.
dependents=[
    # Owner-material views (2791) read 1321's dsr_stock_postings; 2790's tables and columns sit on 1162's requisitions.
    'supabase/migrations/rollback/2793_owner_material_closed_reconciliation_down.sql',
    'supabase/migrations/rollback/2791_owner_material_rpcs_down.sql',
    'supabase/migrations/rollback/2790_owner_material_schema_down.sql',
    # Area-rate policy and report RPCs depend on the daily report functions reverted below.
    'supabase/migrations/rollback/2132_areas_and_area_rates_down.sql',
    'supabase/migrations/rollback/2130_site_report_crew_link_down.sql',
    # 1670 adds an AFTER INSERT trigger on organizations that writes the seven switch-settings rows. A real rollback
    # reverts that trigger first; 1275's rollback then drops org_revenue_plan_settings, which the trigger writes.
    'supabase/migrations/rollback/1670_features_on_by_default_down.sql',
    'supabase/migrations/rollback/1321_dsr_stock_postings_down.sql',
    'supabase/migrations/rollback/1280_non_working_dates_down.sql',
    'supabase/migrations/rollback/1275_work_order_revenue_plan_down.sql',
    'supabase/migrations/rollback/1186_certificate_approval_and_bill_down.sql',
    'supabase/migrations/rollback/1185_subcontract_certificates_down.sql',
    'supabase/migrations/rollback/1163_client_requisition_rpcs_down.sql',
    'supabase/migrations/rollback/1162_client_requisitions_down.sql',
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
supabase test db --local "$test_file"
