"""Unit tests for scripts/lib/owner-material-workbook.py (AC-002, Contract v2).

All fixtures are synthetic workbooks generated in temporary directories using
invented sheet names and column headings supplied via the mapping file.
No real client names, item codes, or workbook rows appear here.

Run:
  /tmp/owner-material-loader-venv/bin/python -I scripts/owner-material-workbook.test.py
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import openpyxl

SCRIPT_PATH = Path(__file__).resolve().parent / "lib" / "owner-material-workbook.py"


def load_parser_module():
    spec = importlib.util.spec_from_file_location("owner_material_workbook", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_base_mapping(**overrides):
    mapping = {
        "source_key": "synthetic-source-v2",
        "as_of": "2026-01-31",
        "owner_warehouses": {
            "WH NORTH": {"code": "WH-N", "name": "North Owner Warehouse"},
            "WH SOUTH": {"code": "WH-S", "name": "South Owner Warehouse"},
            "WH EAST": {"code": "WH-E", "name": "East Owner Warehouse"},
        },
        "policy": {
            "closing_conflict": "refuse",
        },
        "workbook": {
            "item_list_sheet": {
                "name": "ITEM_CATALOG",
                "header_contains": ["ITEM_CODE"],
                "columns": {
                    "item_code": "ITEM_CODE",
                    "description": "ITEM_DESC",
                    "unit": "UNIT",
                    "category_code": "CAT_CODE",
                    "category_name": "CAT_NAME",
                    "reconciliation_step": "RECON_STAGE",
                    "reconciliation_pct": "RECON_PCT",
                },
            },
            "reconciliation_sheet": {
                "name": "RECON_LOG",
                "header_contains": ["SITE_KEY", "RECON_STAGE"],
                "columns": {
                    "location_key": "SITE_KEY",
                    "reconciliation_step": "RECON_STAGE",
                },
            },
            "rollup_sheet": {
                "name": "ROLLUP_VIEW",
                "header_contains": ["ORDER_REF", "SITE_KEY"],
                "columns": {
                    "order_number": ["ORDER_REF"],
                    "location_key": ["SITE_KEY"],
                    "title": ["PACKAGE_TITLE"],
                },
            },
            "validation_only_sheets": ["AUX_CHECK"],
            "excluded_sheets": ["OUT_OF_SCOPE"],
            "template_sheets": ["BLANK_TEMPLATE"],
            "location_sheet": {
                "header_contains": ["PART_NO", "PART_DESC"],
                "two_row_marker": "HOLD_GROUP",
                "title_cell": {"row": 2, "column": 3},
                "excluded_columns": ["ENGINEER_NAME", "VENDOR_NAME"],
                "warehouse_band": {
                    "two_row_start_header": "HOLD_GROUP",
                    "single_row_after_fields": ["reservation_date", "request_date"],
                    "end_field": "total_set_aside",
                },
                "columns": {
                    "item_code": ["PART_NO"],
                    "description": ["PART_DESC"],
                    "unit": ["UNIT"],
                    "planned": ["PLAN_QTY"],
                    "category_code": ["CAT_CODE"],
                    "order_number": ["ORDER_NO"],
                    "cost_code": ["COST_CODE"],
                    "total_set_aside": ["HOLD_TOTAL"],
                    "received_direct": ["RECV_DIRECT"],
                    "received_transfer_in": ["RECV_XFER"],
                    "total_received": ["RECV_TOTAL"],
                    "issued": ["ISSUE_QTY", "ISSUE_QTY_ALT"],
                    "returned": ["RET_QTY"],
                    "transfer_out": ["XFER_OUT_QTY"],
                    "owner_return": ["OWNER_RET_QTY"],
                    "closing": ["END_BAL"],
                },
                "sub_header_columns": {
                    "received_direct": ["RECV_DIRECT"],
                    "received_transfer_in": ["RECV_XFER"],
                    "total_received": ["RECV_TOTAL"],
                },
                "evidence_columns": {
                    "request_reference": ["REQ_REF"],
                    "request_date": ["REQ_DATE"],
                    "reservation_date": ["HOLD_DATE"],
                    "reservation_reference": ["HOLD_REF"],
                    "plant_location": ["SITE_AREA"],
                    "received_date": ["RECV_DATE"],
                    "issue_reference": ["ISSUE_REF", "ISSUE_REF_ALT"],
                    "issued_date": ["ISSUE_DATE", "ISSUE_DATE_ALT"],
                    "returned_date": ["RET_DATE", "RET_DATE_TYPO"],
                    "transfer_out_date": ["XFER_OUT_DATE"],
                    "owner_return_date": ["OWNER_RET_DATE"],
                },
            },
        },
        "sheets": {},
    }
    mapping.update(overrides)
    return mapping


def add_standard_location_sheet(
    wb,
    name,
    rows,
    *,
    two_row_header=False,
    include_owner_return=True,
    typo_return=False,
    alt_issued=False,
    extra_warehouse=None,
    title="Synthetic Location Work",
):
    ws = wb.create_sheet(title=name)
    # Row 2 banner with Excel errors in A2/D2 (must be ignored because above header row)
    ws["A2"] = "#VALUE!"
    ws["C2"] = title
    ws["D2"] = "#VALUE!"

    warehouses = ["WH NORTH", "WH SOUTH"]
    if extra_warehouse:
        warehouses.append(extra_warehouse)

    if not two_row_header:
        headers = [
            "LINE_NO", "PART_NO", "PART_DESC", "UNIT", "PLAN_QTY", "CAT_CODE",
            "ORDER_NO", "COST_CODE", "ENGINEER_NAME", "VENDOR_NAME", "REQ_REF",
            "REQ_DATE", "HOLD_DATE",
            *warehouses,
            "HOLD_TOTAL", "STATE", "PCT_1", "HOLD_REF", "SITE_AREA",
            "RECV_DATE", "RECV_DIRECT", "RECV_XFER", "RECV_TOTAL", "PCT_2",
            "REM_QTY", "NOTES",
        ]
        if alt_issued:
            headers += ["ISSUE_REF_ALT", "ISSUE_REF", "RECV_GROUP", "ISSUE_DATE_ALT", "ISSUE_QTY_ALT", "ISSUE_DATE", "ISSUE_QTY"]
        else:
            headers += ["ISSUE_REF", "RECV_GROUP", "ISSUE_DATE", "ISSUE_QTY"]
        headers += [
            "PCT_3",
            "RET_DATE_TYPO" if typo_return else "RET_DATE",
            "RET_QTY",
            "XFER_OUT_DATE",
            "XFER_OUT_QTY",
        ]
        if include_owner_return:
            headers += ["OWNER_RET_DATE", "OWNER_RET_QTY"]
        headers += ["END_BAL", "PCT_4", "SITE_NOTES"]

        for c_idx, h in enumerate(headers, 1):
            ws.cell(7, c_idx, h)
        col_map = {h: idx + 1 for idx, h in enumerate(headers)}
        start_row = 8
    else:
        row6 = [
            "LINE_NO", "PART_NO", "PART_DESC", "UNIT", "PLAN_QTY", "CAT_CODE",
            "ORDER_NO", "COST_CODE", "ENGINEER_NAME", "VENDOR_NAME", "REQ_REF",
            "REQ_DATE", "HOLD_DATE", "HOLD_GROUP",
            *[None] * (len(warehouses) - 1),
            "HOLD_TOTAL", "STATE", "PCT_1", "HOLD_REF", "SITE_AREA",
            "RECV_DATE", "RECV_GROUP", None, None, "PCT_2",
            "REM_QTY", "NOTES",
            "ISSUE_REF", "ISSUE_DATE", "ISSUE_QTY",
            "RET_DATE_TYPO" if typo_return else "RET_DATE", "RET_QTY",
            "XFER_OUT_DATE", "XFER_OUT_QTY",
            "END_BAL", "PCT_4", "SITE_NOTES",
        ]
        for c_idx, h in enumerate(row6, 1):
            if h is not None:
                ws.cell(6, c_idx, h)
        col_map = {}
        for idx, h in enumerate(row6):
            if h is not None and h not in col_map:
                col_map[h] = idx + 1
        rsv_col = col_map["HOLD_GROUP"]
        for offset, wh in enumerate(warehouses):
            ws.cell(7, rsv_col + offset, wh)
            col_map[wh] = rsv_col + offset
        rec_col = col_map["RECV_GROUP"]
        ws.cell(7, rec_col, "RECV_DIRECT")
        ws.cell(7, rec_col + 1, "RECV_XFER")
        ws.cell(7, rec_col + 2, "RECV_TOTAL")
        col_map["RECV_DIRECT"] = rec_col
        col_map["RECV_XFER"] = rec_col + 1
        col_map["RECV_TOTAL"] = rec_col + 2
        start_row = 9

    for r_offset, row_data in enumerate(rows):
        r_idx = start_row + r_offset
        for key, val in row_data.items():
            if key in col_map:
                ws.cell(r_idx, col_map[key], val)
    return ws


class TestOwnerMaterialWorkbook(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.mod = load_parser_module()

    def _save(self, wb, filename="test.xlsx"):
        path = Path(self.tmpdir.name) / filename
        wb.save(path)
        return str(path)

    def test_ac002_parses_opening_totals_verbatim_evidence_and_preserves_leading_zeros(self):
        wb = openpyxl.Workbook()
        ws_cat = wb.active
        ws_cat.title = "ITEM_CATALOG"
        ws_cat.append([])
        ws_cat.append([])
        ws_cat.append([])
        ws_cat.append(["LINE_NO", "ITEM_CODE", "ITEM_DESC", "UNIT", None, "CAT_CODE", "CAT_NAME", None, "RECON_STAGE", "RECON_PCT"])
        ws_cat.append([1, "00123456", "Synthetic Pipe 4in", "PCS ", None, "CAT-A", "Category Alpha", None, "Prepared", 0.2])
        ws_cat.append([2, "00999888", "Synthetic Valve 2in", "EA", None, "CAT-B", "Category Beta", None, "Closed", 1.0])

        ws_recon = wb.create_sheet("RECON_LOG")
        for _ in range(5):
            ws_recon.append([])
        ws_recon.append(["LINE_NO", "SITE_KEY", "ORDER_REF", "REF_DATE", "RECON_STAGE", "RECON_PCT"])
        ws_recon.append([1, "LOC_ALPHA", "WO-SYN-001", "-", "Prepared", 0.2])

        add_standard_location_sheet(
            wb,
            "LOC_ALPHA",
            [
                {
                    "LINE_NO": 1,
                    "PART_NO": "00123456",
                    "PART_DESC": "Synthetic Pipe 4in",
                    "UNIT": "PCS ",
                    "PLAN_QTY": 10,
                    "CAT_CODE": "CAT-A",
                    "ORDER_NO": "WO-SYN-001",
                    "COST_CODE": "CC-01",
                    "ENGINEER_NAME": "Should Be Excluded",
                    "VENDOR_NAME": "Also Excluded",
                    "REQ_REF": "REQ-001",
                    "REQ_DATE": datetime(2026, 1, 5),
                    "HOLD_DATE": "06/01/2026\n08/01/2026",
                    "WH NORTH": 6,
                    "WH SOUTH": 4,
                    "HOLD_TOTAL": 10,
                    "HOLD_REF": "DOC-100\nDOC-101",
                    "RECV_DATE": "10/01/2026\n12/01/2026",
                    "RECV_DIRECT": 10,
                    "RECV_XFER": 0,
                    "RECV_TOTAL": 10,
                    "ISSUE_REF": "SLIP-1\nSLIP-2",
                    "ISSUE_DATE": "15/01/2026\n16/01/2026",
                    "ISSUE_QTY": 6,
                    "RET_DATE": datetime(2026, 1, 16),
                    "RET_QTY": 1,
                    "XFER_OUT_DATE": datetime(2026, 1, 17),
                    "XFER_OUT_QTY": 0,
                    "OWNER_RET_DATE": datetime(2026, 1, 17),
                    "OWNER_RET_QTY": 2,
                    "END_BAL": 3,
                }
            ],
            include_owner_return=True,
        )

        add_standard_location_sheet(
            wb,
            "LOC_BETA",
            [
                {
                    "LINE_NO": 1,
                    "PART_NO": "00999888",
                    "PART_DESC": "Synthetic Valve 2in",
                    "UNIT": "EA",
                    "PLAN_QTY": 5,
                    "CAT_CODE": "CAT-B",
                    "ORDER_NO": "WO-SYN-001",
                    "COST_CODE": "CC-02",
                    "REQ_REF": "REQ-002",
                    "REQ_DATE": datetime(2026, 1, 5),
                    "HOLD_DATE": datetime(2026, 1, 6),
                    "WH NORTH": 5,
                    "WH SOUTH": 0,
                    "HOLD_TOTAL": 5,
                    "HOLD_REF": "DOC-200",
                    "RECV_DATE": datetime(2026, 1, 12),
                    "RECV_DIRECT": 5,
                    "RECV_XFER": 0,
                    "RECV_TOTAL": 5,
                    "RET_DATE_TYPO": None,
                    "RET_QTY": 0,
                    "END_BAL": 5,
                }
            ],
            two_row_header=True,
            typo_return=True,
            include_owner_return=False,
        )

        path = self._save(wb)
        result = self.mod.parse_workbook(path, build_base_mapping())
        self.assertEqual(result["refused_sections"], [])
        self.assertEqual(len(result["accepted_sections"]), 2)

        alpha = next(s for s in result["accepted_sections"] if s["sheet"] == "LOC_ALPHA")
        self.assertEqual(alpha["owner_order_number"], "WO-SYN-001")
        self.assertEqual(alpha["owner_cost_code"], "CC-01")
        self.assertEqual(alpha["as_of"], "2026-01-31")
        self.assertEqual(alpha["reconciliation_step"], "Prepared")
        line = alpha["lines"][0]
        self.assertEqual(line["item_code"], "00123456")
        self.assertEqual(line["unit"], "PCS")
        self.assertEqual(line["planned"], "10")
        self.assertEqual(line["opening"], {
            "requested": "10",
            "set_aside": "10",
            "received": "10",
            "issued": "6",
            "returned": "1",
            "transfer_in": "0",
            "transfer_out": "0",
            "owner_return": "2",
        })
        self.assertEqual(line["expected"]["closing"], "3")
        # Multi-value dates & document numbers are kept verbatim in evidence, never refused
        self.assertEqual(line["evidence"]["reservation_date"], "06/01/2026\n08/01/2026")
        self.assertEqual(line["evidence"]["reservation_reference"], "DOC-100\nDOC-101")
        self.assertEqual(line["evidence"]["issue_reference"], "SLIP-1\nSLIP-2")
        self.assertEqual(line["evidence"]["owner_warehouses"], {"WH-N": "6", "WH-S": "4"})

        # Person/contractor columns must never leak into output
        raw_json = json.dumps(result)
        self.assertNotIn("Should Be Excluded", raw_json)
        self.assertNotIn("Also Excluded", raw_json)

        beta = next(s for s in result["accepted_sections"] if s["sheet"] == "LOC_BETA")
        self.assertEqual(beta["lines"][0]["item_code"], "00999888")
        self.assertEqual(beta["lines"][0]["expected"]["closing"], "5")

    def test_ac002_refuses_excel_error_check_closing_conflict_negative_closing_and_unknown_warehouse(self):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        add_standard_location_sheet(
            wb,
            "LOC_ERR",
            [
                {
                    "LINE_NO": 1, "PART_NO": "100001", "PART_DESC": "Item A", "UNIT": "PCS",
                    "PLAN_QTY": "#REF!", "ORDER_NO": "WO-1", "COST_CODE": "CC-1",
                    "WH NORTH": 0, "WH SOUTH": 0, "HOLD_TOTAL": 0,
                    "RECV_DIRECT": "Check", "RECV_XFER": 0, "RECV_TOTAL": 0, "END_BAL": 0,
                }
            ],
        )

        add_standard_location_sheet(
            wb,
            "LOC_CLOSING",
            [
                {
                    "LINE_NO": 1, "PART_NO": "100003", "PART_DESC": "Item C", "UNIT": "PCS",
                    "PLAN_QTY": 10, "ORDER_NO": "WO-3", "COST_CODE": "CC-3",
                    "WH NORTH": 10, "WH SOUTH": 0, "HOLD_TOTAL": 10,
                    "RECV_DIRECT": 10, "RECV_XFER": 0, "RECV_TOTAL": 10,
                    "END_BAL": 0,
                }
            ],
        )

        add_standard_location_sheet(
            wb,
            "LOC_NEG",
            [
                {
                    "LINE_NO": 1, "PART_NO": "100004", "PART_DESC": "Item D", "UNIT": "PCS",
                    "PLAN_QTY": 10, "ORDER_NO": "WO-4", "COST_CODE": "CC-4",
                    "WH NORTH": 5, "WH SOUTH": 0, "HOLD_TOTAL": 5,
                    "RECV_DIRECT": 5, "RECV_XFER": 0, "RECV_TOTAL": 5,
                    "ISSUE_QTY": 8,
                    "END_BAL": -3,
                }
            ],
        )

        add_standard_location_sheet(
            wb,
            "LOC_UNKNOWN_WH",
            [
                {
                    "LINE_NO": 1, "PART_NO": "100005", "PART_DESC": "Item E", "UNIT": "PCS",
                    "PLAN_QTY": 5, "ORDER_NO": "WO-5", "COST_CODE": "CC-5",
                    "WH NORTH": 5, "WH SOUTH": 0, "WH MYSTERY": 0, "HOLD_TOTAL": 5,
                    "END_BAL": 0,
                }
            ],
            extra_warehouse="WH MYSTERY",
        )

        path = self._save(wb)
        result = self.mod.parse_workbook(path, build_base_mapping())
        self.assertEqual(result["accepted_sections"], [])
        by_sheet = {s["sheet"]: s for s in result["refused_sections"]}
        self.assertEqual(set(by_sheet.keys()), {"LOC_ERR", "LOC_CLOSING", "LOC_NEG", "LOC_UNKNOWN_WH"})

        err_classes = {r["class"] for r in by_sheet["LOC_ERR"]["refusals"]}
        self.assertIn("excel_error", err_classes)
        self.assertIn("check_cell", err_classes)
        for r in by_sheet["LOC_ERR"]["refusals"]:
            self.assertEqual(r["sheet"], "LOC_ERR")
            self.assertEqual(r["row"], 8)
            self.assertTrue(r["column"])

        self.assertIn("closing_stock_conflict", {r["class"] for r in by_sheet["LOC_CLOSING"]["refusals"]})
        self.assertIn("negative_closing_stock", {r["class"] for r in by_sheet["LOC_NEG"]["refusals"]})
        self.assertIn("unknown_owner_warehouse_header", {r["class"] for r in by_sheet["LOC_UNKNOWN_WH"]["refusals"]})

    def test_ac002_movements_win_accepts_and_flags_closing_conflict_and_negative_closing(self):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        add_standard_location_sheet(
            wb,
            "LOC_POLICY",
            [
                {
                    "LINE_NO": 1, "PART_NO": "200001", "PART_DESC": "Policy Item", "UNIT": "PCS",
                    "PLAN_QTY": 10, "ORDER_NO": "WO-POL-1", "COST_CODE": "CC-P",
                    "WH NORTH": 10, "WH SOUTH": 0, "HOLD_TOTAL": 10,
                    "RECV_DIRECT": 10, "RECV_XFER": 0, "RECV_TOTAL": 10,
                    "ISSUE_QTY": 4,
                    "END_BAL": 0,  # workbook says 0, computed is 6
                },
                {
                    "LINE_NO": 2, "PART_NO": "200002", "PART_DESC": "Neg Policy Item", "UNIT": "PCS",
                    "PLAN_QTY": 10, "ORDER_NO": "WO-POL-1", "COST_CODE": "CC-P",
                    "WH NORTH": 5, "WH SOUTH": 0, "HOLD_TOTAL": 5,
                    "RECV_DIRECT": 5, "RECV_XFER": 0, "RECV_TOTAL": 5,
                    "ISSUE_QTY": 8,
                    "END_BAL": -3,
                },
            ],
        )

        path = self._save(wb)
        mapping = build_base_mapping(policy={"closing_conflict": "movements_win"})
        result = self.mod.parse_workbook(path, mapping)
        self.assertEqual(result["refused_sections"], [])
        self.assertEqual(len(result["accepted_sections"]), 1)
        sec = result["accepted_sections"][0]
        self.assertEqual(sec["closing_conflict"], "movements_win")
        self.assertEqual(sec["lines"][0]["expected"]["closing"], "6")
        self.assertEqual(sec["lines"][1]["expected"]["closing"], "-3")
        self.assertEqual(len(sec["policy_flags"]["closing_conflicts"]), 1)
        self.assertEqual(len(sec["policy_flags"]["negative_closings"]), 1)

    def test_ac002_refuses_missing_formula_cache_and_conflicting_total_cache(self):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        add_standard_location_sheet(
            wb,
            "LOC_FORMULA",
            [
                {
                    "LINE_NO": 1, "PART_NO": "300001", "PART_DESC": "Formula Item", "UNIT": "PCS",
                    "PLAN_QTY": 10, "ORDER_NO": "WO-F", "COST_CODE": "CC-F",
                    "WH NORTH": 6, "WH SOUTH": 2, "HOLD_TOTAL": "=N8+O8",
                    "RECV_DIRECT": 8, "RECV_XFER": 0, "RECV_TOTAL": 9,
                    "END_BAL": 9,
                }
            ],
        )
        path = self._save(wb)
        result = self.mod.parse_workbook(path, build_base_mapping())
        self.assertEqual(len(result["refused_sections"]), 1)
        classes = {r["class"] for r in result["refused_sections"][0]["refusals"]}
        self.assertIn("missing_formula_cache", classes)
        self.assertIn("conflicting_cache", classes)

    def test_ac002_cli_entrypoint_outputs_valid_json(self):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        add_standard_location_sheet(
            wb,
            "LOC_CLI",
            [
                {
                    "LINE_NO": 1, "PART_NO": "500001", "PART_DESC": "CLI Item", "UNIT": "PCS",
                    "PLAN_QTY": 4, "ORDER_NO": "WO-CLI", "COST_CODE": "CC-CLI",
                    "WH NORTH": 4, "WH SOUTH": 0, "HOLD_TOTAL": 4,
                    "RECV_DIRECT": 4, "RECV_XFER": 0, "RECV_TOTAL": 4,
                    "END_BAL": 4,
                }
            ],
        )
        wb_path = self._save(wb)
        map_path = Path(self.tmpdir.name) / "map.json"
        map_path.write_text(json.dumps(build_base_mapping()), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, "-I", str(SCRIPT_PATH), wb_path, str(map_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = json.loads(proc.stdout)
        self.assertEqual(len(payload["accepted_sections"]), 1)
        self.assertEqual(payload["accepted_sections"][0]["sheet"], "LOC_CLI")


if __name__ == "__main__":
    unittest.main()
