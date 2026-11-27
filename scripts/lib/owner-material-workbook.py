#!/usr/bin/env python3
"""Isolated XLSX parser for owner-supplied material tracking (#3010, Contract v2).

Reads an untrusted workbook with openpyxl (read_only=True) without ever executing
formulas, macros, or external links. Emits deterministic JSON on stdout.

All workbook-specific sheet names, header markers, column headings, aliases,
excluded columns, and owner-warehouse headers are supplied by the private
mapping file (`workbook` and `owner_warehouses` sections). No customer-specific
terms are hardcoded here.

Contract v2:
- History loads as opening stage totals per planned-material line (`opening` + `evidence`).
- Dates, document numbers, reservation numbers, and per-warehouse quantities are stored
  verbatim in `evidence` (bounded display text); multi-value date/document cells are
  evidence, not refusals.
- Non-numeric stage quantities ("Check", Excel errors, >3 decimals, negative quantities,
  missing formula caches), missing units, and zero-planned lines with activity are
  refused at the LINE level (skipped with exact coordinates; section flagged partial).
  Whole sections are refused only when section identity/header/warehouse mapping fails
  or when zero valid lines remain.
- Owner-warehouse columns are discovered dynamically in the mapped warehouse band;
  unknown headers are refused and never guessed.
- `closing_conflict`: 'refuse' (default) or 'movements_win' (column values win over
  stale closing/set-aside/received totals and negative computed closing is accepted,
  flagging every affected row).
- `duplicate_items`: 'refuse' (default) or 'sum' (consolidates repeated item rows within
  a location into one line with summed quantities, agreed category or None, and all
  source rows preserved verbatim in `evidence.rows`, flagged in the report).

Usage:
  <venv-python> -I scripts/lib/owner-material-workbook.py <workbook.xlsx> <mapping.json>
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.formula import ArrayFormula

EXCEL_ERRORS = frozenset({
    "#VALUE!", "#REF!", "#DIV/0!", "#N/A", "#NAME?", "#NUM!", "#NULL!", "#GETTING_DATA",
})

ZERO = Decimal("0")
TOLERANCE = Decimal("0.0005")
MAX_EVIDENCE_TEXT = 500
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

OPENING_KEYS = (
    "requested",
    "set_aside",
    "received",
    "issued",
    "returned",
    "transfer_in",
    "transfer_out",
    "owner_return",
)


def norm_header(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip().upper()


def _as_header_list(spec: Any) -> list[str]:
    if spec is None:
        return []
    if isinstance(spec, str):
        nh = norm_header(spec)
        return [nh] if nh else []
    if isinstance(spec, list):
        out: list[str] = []
        for item in spec:
            nh = norm_header(item)
            if nh:
                out.append(nh)
        return out
    return []


def _find_col(headers: list[str], aliases: list[str], excluded: set[str] | None = None) -> int | None:
    """Return the first column matching the highest-priority alias."""
    excl = excluded or set()
    for alias in aliases:
        if alias in excl:
            continue
        for i, h in enumerate(headers):
            if h == alias:
                return i
    return None


def _find_sheet_by_name(sheetnames: list[str], target: str | None) -> str | None:
    if not target:
        return None
    if target in sheetnames:
        return target
    t_norm = target.strip().upper()
    for s in sheetnames:
        if s.strip().upper() == t_norm:
            return s
    return None


def is_formula(val: Any) -> bool:
    if isinstance(val, ArrayFormula):
        return True
    return isinstance(val, str) and val.startswith("=")


def is_excel_error(val: Any) -> bool:
    return isinstance(val, str) and val.strip().upper() in EXCEL_ERRORS


def is_check_cell(val: Any) -> bool:
    return isinstance(val, str) and bool(re.match(r"^check\b", val.strip(), re.IGNORECASE))


def format_decimal(d: Decimal) -> str:
    q = d.normalize()
    s = format(q, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def parse_decimal(val: Any) -> tuple[Decimal | None, str | None]:
    """Return (Decimal, error_class). Blank/None/'-' returns (None, None)."""
    if val is None or isinstance(val, bool):
        return None, None
    if is_excel_error(val):
        return None, "excel_error"
    if is_check_cell(val):
        return None, "check_cell"
    if isinstance(val, (int, float)):
        s = f"{val:.9f}".rstrip("0").rstrip(".") if isinstance(val, float) else str(val)
        try:
            d = Decimal(s)
        except InvalidOperation:
            return None, "invalid_numeric"
    elif isinstance(val, str):
        t = val.strip()
        if not t or t == "-":
            return None, None
        t = t.replace(",", "")
        try:
            d = Decimal(t)
        except InvalidOperation:
            return None, "invalid_numeric"
    else:
        return None, "invalid_numeric"

    if d < ZERO:
        return d, "negative_quantity"
    norm = d.normalize()
    if norm.as_tuple().exponent < -3:
        return None, "invalid_numeric_precision"
    return d, None


def parse_decimal_allow_negative(val: Any) -> tuple[Decimal | None, str | None]:
    """Like parse_decimal, allowing negative values (for reading workbook closing balance)."""
    if val is None or isinstance(val, bool):
        return None, None
    if is_excel_error(val):
        return None, "excel_error"
    if is_check_cell(val):
        return None, "check_cell"
    if isinstance(val, (int, float)):
        s = f"{val:.9f}".rstrip("0").rstrip(".") if isinstance(val, float) else str(val)
        try:
            d = Decimal(s)
        except InvalidOperation:
            return None, "invalid_numeric"
    elif isinstance(val, str):
        t = val.strip()
        if not t or t == "-":
            return None, None
        t = t.replace(",", "")
        try:
            d = Decimal(t)
        except InvalidOperation:
            return None, "invalid_numeric"
    else:
        return None, "invalid_numeric"

    norm = d.normalize()
    if norm.as_tuple().exponent < -3:
        return None, "invalid_numeric_precision"
    return d, None


def format_code(val: Any) -> str:
    if val is None or isinstance(val, bool):
        return ""
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        if val.is_integer():
            return str(int(val))
        return format_decimal(Decimal(str(val)))
    return str(val).strip()


def format_evidence_text(val: Any) -> str | None:
    """Convert any cell value into bounded verbatim display text for `evidence`."""
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, datetime):
        return val.date().isoformat()
    if isinstance(val, date):
        return val.isoformat()
    if isinstance(val, (int, float)):
        if val == 0:
            return None
        s = str(int(val)) if isinstance(val, float) and val.is_integer() else str(val)
    else:
        s = str(val).strip()
    if not s or s == "-":
        return None
    if len(s) > MAX_EVIDENCE_TEXT:
        return s[: MAX_EVIDENCE_TEXT - 3] + "..."
    return s


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_item_list_sheet(
    ws, cfg: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    items: list[dict[str, Any]] = []
    categories: list[dict[str, Any]] = []
    scale_raw: list[tuple[str, Decimal]] = []
    seen_items: set[str] = set()
    seen_cats: set[str] = set()
    seen_steps: set[str] = set()

    max_scan = int(cfg.get("max_header_scan_rows") or 12)
    markers = _as_header_list(cfg.get("header_contains"))
    col_cfg = cfg.get("columns") or {}

    rows = list(ws.iter_rows(max_col=20, values_only=True))
    hdr_idx = None
    for idx, r in enumerate(rows[:max_scan]):
        norm = [norm_header(c) for c in r]
        if markers and all(m in norm for m in markers):
            hdr_idx = idx
            break
    if hdr_idx is None:
        return items, categories, []

    norm = [norm_header(c) for c in rows[hdr_idx]]
    i_code = _find_col(norm, _as_header_list(col_cfg.get("item_code")))
    i_desc = _find_col(norm, _as_header_list(col_cfg.get("description")))
    i_uom = _find_col(norm, _as_header_list(col_cfg.get("unit")))
    i_ccode = _find_col(norm, _as_header_list(col_cfg.get("category_code")))
    i_cname = _find_col(norm, _as_header_list(col_cfg.get("category_name")))
    i_step = _find_col(norm, _as_header_list(col_cfg.get("reconciliation_step")))
    i_pct = _find_col(norm, _as_header_list(col_cfg.get("reconciliation_pct")))

    for r in rows[hdr_idx + 1 :]:
        if i_code is not None and i_code < len(r) and r[i_code] is not None:
            code = format_code(r[i_code])
            if code and code != "-" and code not in seen_items:
                desc = str(r[i_desc]).strip() if (i_desc is not None and i_desc < len(r) and r[i_desc] is not None) else ""
                uom = str(r[i_uom]).strip() if (i_uom is not None and i_uom < len(r) and r[i_uom] is not None) else ""
                if desc and not is_excel_error(desc):
                    seen_items.add(code)
                    items.append({"code": code, "name": desc, "unit": uom})
        if i_ccode is not None and i_ccode < len(r) and r[i_ccode] is not None:
            ccode = format_code(r[i_ccode])
            cname = str(r[i_cname]).strip() if (i_cname is not None and i_cname < len(r) and r[i_cname] is not None) else ccode
            if ccode and ccode != "-" and ccode not in seen_cats:
                seen_cats.add(ccode)
                categories.append({"code": ccode, "name": cname})
        if i_step is not None and i_step < len(r) and r[i_step] is not None:
            sname = str(r[i_step]).strip()
            pct_val = r[i_pct] if (i_pct is not None and i_pct < len(r)) else None
            if sname and sname != "-" and sname.lower() not in seen_steps and isinstance(pct_val, (int, float)):
                pct = Decimal(str(round(pct_val * 100, 4))) if pct_val <= 1 else Decimal(str(round(pct_val, 4)))
                seen_steps.add(sname.lower())
                scale_raw.append((sname, pct))

    scale_raw.sort(key=lambda pair: pair[1])
    scale = [
        {"name": name, "position": pos, "percentage": int(pct) if pct == int(pct) else float(pct)}
        for pos, (name, pct) in enumerate(scale_raw, 1)
    ]
    return items, categories, scale


def parse_reconciliation_sheet(ws, cfg: dict[str, Any]) -> dict[str, str]:
    """Return lower(location_key) -> reconciliation step name."""
    out: dict[str, str] = {}
    max_scan = int(cfg.get("max_header_scan_rows") or 12)
    markers = _as_header_list(cfg.get("header_contains"))
    col_cfg = cfg.get("columns") or {}

    rows = list(ws.iter_rows(max_col=20, values_only=True))
    hdr_idx = None
    for idx, r in enumerate(rows[:max_scan]):
        norm = [norm_header(c) for c in r]
        if markers and all(m in norm for m in markers):
            hdr_idx = idx
            break
    if hdr_idx is None:
        return out
    norm = [norm_header(c) for c in rows[hdr_idx]]
    i_loc = _find_col(norm, _as_header_list(col_cfg.get("location_key")))
    i_step = _find_col(norm, _as_header_list(col_cfg.get("reconciliation_step")))
    if i_loc is None or i_step is None:
        return out
    for r in rows[hdr_idx + 1 :]:
        if i_loc < len(r) and r[i_loc] is not None and i_step < len(r) and r[i_step] is not None:
            loc = str(r[i_loc]).strip()
            st = str(r[i_step]).strip()
            if loc and st and st != "-":
                out[loc.lower()] = st
    return out


def parse_rollup_titles(ws, cfg: dict[str, Any]) -> dict[str, str]:
    """Extract location/order titles from the configured rollup sheet."""
    titles: dict[str, str] = {}
    max_scan = int(cfg.get("max_header_scan_rows") or 12)
    markers = _as_header_list(cfg.get("header_contains"))
    col_cfg = cfg.get("columns") or {}

    rows = list(ws.iter_rows(max_col=20, values_only=True))
    hdr_idx = None
    for idx, r in enumerate(rows[:max_scan]):
        norm = [norm_header(c) for c in r]
        if markers and all(m in norm for m in markers):
            hdr_idx = idx
            break
    if hdr_idx is None:
        return titles
    norm = [norm_header(c) for c in rows[hdr_idx]]
    i_order = _find_col(norm, _as_header_list(col_cfg.get("order_number")))
    i_title = _find_col(norm, _as_header_list(col_cfg.get("title")))
    i_loc = _find_col(norm, _as_header_list(col_cfg.get("location_key")))
    if i_title is None:
        return titles
    for r in rows[hdr_idx + 1 :]:
        title = str(r[i_title]).strip() if (i_title < len(r) and r[i_title] is not None) else ""
        if not title or title == "-":
            continue
        if i_loc is not None and i_loc < len(r) and r[i_loc] is not None:
            loc = str(r[i_loc]).strip()
            if loc:
                titles[loc.lower()] = title
        if i_order is not None and i_order < len(r) and r[i_order] is not None:
            order = str(r[i_order]).strip()
            if order and order.lower() not in titles:
                titles[order.lower()] = title
    return titles


def detect_location_layout(rows: list[tuple[Any, ...]], loc_cfg: dict[str, Any]) -> dict[str, Any] | None:
    max_scan = int(loc_cfg.get("max_header_scan_rows") or 12)
    markers = _as_header_list(loc_cfg.get("header_contains"))
    if not markers:
        return None

    hdr_idx = None
    for idx, r in enumerate(rows[:max_scan]):
        norm = [norm_header(c) for c in r]
        if all(m in norm for m in markers):
            hdr_idx = idx
            break
    if hdr_idx is None:
        return None

    main_hdr = [norm_header(c) for c in rows[hdr_idx]]
    excluded_cols = set(_as_header_list(loc_cfg.get("excluded_columns")))
    two_row_marker = norm_header(loc_cfg.get("two_row_marker"))
    two_row = bool(two_row_marker) and two_row_marker in main_hdr
    sub_hdr = [norm_header(c) for c in rows[hdr_idx + 1]] if (two_row and hdr_idx + 1 < len(rows)) else []
    data_start = hdr_idx + 2 if two_row else hdr_idx + 1

    cols: dict[str, int] = {}
    for field, alias_spec in (loc_cfg.get("columns") or {}).items():
        idx = _find_col(main_hdr, _as_header_list(alias_spec), excluded_cols)
        if idx is not None:
            cols[field] = idx

    evidence_cols: dict[str, int] = {}
    for ev_key, alias_spec in (loc_cfg.get("evidence_columns") or {}).items():
        idx = _find_col(main_hdr, _as_header_list(alias_spec), excluded_cols)
        if idx is not None:
            evidence_cols[ev_key] = idx

    if two_row and sub_hdr:
        for field, alias_spec in (loc_cfg.get("sub_header_columns") or {}).items():
            idx = _find_col(sub_hdr, _as_header_list(alias_spec), excluded_cols)
            if idx is not None:
                cols[field] = idx

    # Discover owner-warehouse columns dynamically in the configured warehouse band
    warehouses: list[tuple[int, str, int]] = []
    band_cfg = loc_cfg.get("warehouse_band") or {}
    end_field = band_cfg.get("end_field", "total_set_aside")
    end_idx = cols.get(end_field)
    if end_idx is not None:
        two_row_start_hdr = norm_header(band_cfg.get("two_row_start_header")) or two_row_marker
        if two_row and two_row_start_hdr and two_row_start_hdr in main_hdr:
            start_wh = main_hdr.index(two_row_start_hdr)
            for i in range(start_wh, end_idx):
                h = sub_hdr[i] if i < len(sub_hdr) else ""
                if h and h not in excluded_cols:
                    warehouses.append((i, h, hdr_idx + 2))
        else:
            start_wh = None
            for after_field in band_cfg.get("single_row_after_fields") or []:
                if after_field in cols:
                    start_wh = cols[after_field] + 1
                    break
                if after_field in evidence_cols:
                    start_wh = evidence_cols[after_field] + 1
                    break
            if start_wh is not None:
                for i in range(start_wh, end_idx):
                    h = main_hdr[i] if i < len(main_hdr) else ""
                    if h and h not in excluded_cols:
                        warehouses.append((i, h, hdr_idx + 1))

    sheet_title = None
    title_cell = loc_cfg.get("title_cell") or {}
    t_row = title_cell.get("row")
    t_col = title_cell.get("column")
    if isinstance(t_row, int) and isinstance(t_col, int) and t_row >= 1 and t_col >= 1:
        if len(rows) >= t_row and len(rows[t_row - 1]) >= t_col and rows[t_row - 1][t_col - 1] is not None:
            t = str(rows[t_row - 1][t_col - 1]).strip()
            if t and not is_excel_error(t):
                sheet_title = t

    return {
        "header_row": hdr_idx + 1,
        "two_row": two_row,
        "data_start": data_start,
        "cols": cols,
        "evidence_cols": evidence_cols,
        "warehouses": warehouses,
        "sheet_title": sheet_title,
        "item_code_headers": set(_as_header_list((loc_cfg.get("columns") or {}).get("item_code"))),
        "order_number_headers": set(_as_header_list((loc_cfg.get("columns") or {}).get("order_number"))),
    }


def _resolve_warehouse_map(raw_map: dict[str, Any]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for k, v in (raw_map or {}).items():
        nk = norm_header(k)
        if isinstance(v, str):
            out[nk] = {"code": v.strip(), "name": v.strip()}
        elif isinstance(v, dict) and v.get("code"):
            out[nk] = {"code": str(v["code"]).strip(), "name": str(v.get("name") or v["code"]).strip()}
    return out


def parse_workbook(workbook_path: str, mapping: dict[str, Any]) -> dict[str, Any]:
    wb_val = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    wb_f = openpyxl.load_workbook(workbook_path, read_only=True, data_only=False)

    policy_cfg = mapping.get("policy") or {}
    closing_policy = policy_cfg.get("closing_conflict", "refuse")
    if closing_policy not in ("refuse", "movements_win"):
        raise ValueError(f"Unsupported closing_conflict policy: {closing_policy}")
    duplicate_policy = policy_cfg.get("duplicate_items", "refuse")
    if duplicate_policy not in ("refuse", "sum"):
        raise ValueError(f"Unsupported duplicate_items policy: {duplicate_policy}")

    wb_cfg = mapping.get("workbook") or {}
    loc_cfg = wb_cfg.get("location_sheet") or {}
    if not loc_cfg or not loc_cfg.get("header_contains") or not (loc_cfg.get("columns") or {}).get("item_code"):
        raise ValueError("Mapping requires workbook.location_sheet with header_contains and columns.item_code.")

    default_as_of = mapping.get("as_of")
    wh_map = _resolve_warehouse_map(mapping.get("owner_warehouses") or {})
    sheets_cfg: dict[str, Any] = mapping.get("sheets") or {}
    consolidations: dict[str, Any] = mapping.get("consolidations") or {}

    catalogue_items: list[dict[str, Any]] = []
    catalogue_categories: list[dict[str, Any]] = []
    reconciliation_scale: list[dict[str, Any]] = []
    recon_status: dict[str, str] = {}
    rollup_titles: dict[str, str] = {}

    special_validation_names: set[str] = set()

    item_list_cfg = wb_cfg.get("item_list_sheet")
    if isinstance(item_list_cfg, dict) and item_list_cfg.get("name"):
        matched = _find_sheet_by_name(wb_val.sheetnames, item_list_cfg["name"])
        if matched:
            special_validation_names.add(matched.strip().upper())
            catalogue_items, catalogue_categories, reconciliation_scale = parse_item_list_sheet(
                wb_val[matched], item_list_cfg
            )

    recon_cfg = wb_cfg.get("reconciliation_sheet")
    if isinstance(recon_cfg, dict) and recon_cfg.get("name"):
        matched = _find_sheet_by_name(wb_val.sheetnames, recon_cfg["name"])
        if matched:
            special_validation_names.add(matched.strip().upper())
            recon_status = parse_reconciliation_sheet(wb_val[matched], recon_cfg)

    rollup_cfg = wb_cfg.get("rollup_sheet")
    if isinstance(rollup_cfg, dict) and rollup_cfg.get("name"):
        matched = _find_sheet_by_name(wb_val.sheetnames, rollup_cfg["name"])
        if matched:
            special_validation_names.add(matched.strip().upper())
            rollup_titles = parse_rollup_titles(wb_val[matched], rollup_cfg)

    validation_only_set = {norm_header(s) for s in (wb_cfg.get("validation_only_sheets") or []) if norm_header(s)}
    excluded_set = {norm_header(s) for s in (wb_cfg.get("excluded_sheets") or []) if norm_header(s)}
    template_set = {norm_header(s) for s in (wb_cfg.get("template_sheets") or []) if norm_header(s)}

    accepted_sections: list[dict[str, Any]] = []
    refused_sections: list[dict[str, Any]] = []
    validation_sheets: list[str] = []
    excluded_sheets: list[str] = []
    unmapped_sheets: list[str] = []
    discovered_warehouses: dict[str, dict[str, str]] = {}

    for sname in wb_val.sheetnames:
        trimmed = sname.strip().upper()
        scfg = sheets_cfg.get(sname) or sheets_cfg.get(sname.strip()) or {}

        if trimmed in special_validation_names or trimmed in validation_only_set:
            validation_sheets.append(sname)
            continue
        if trimmed in excluded_set:
            excluded_sheets.append(sname)
            continue
        if trimmed in template_set and not scfg:
            excluded_sheets.append(sname)
            continue
        if scfg.get("ignore") is True:
            excluded_sheets.append(sname)
            continue

        ws_v = wb_val[sname]
        ws_f = wb_f[sname]
        v_rows = list(ws_v.iter_rows(max_col=60, values_only=True))
        f_rows = list(ws_f.iter_rows(max_col=60, values_only=True))

        layout = detect_location_layout(v_rows, loc_cfg)
        if layout is None:
            unmapped_sheets.append(sname)
            refused_sections.append({
                "sheet": sname,
                "refusals": [{
                    "sheet": sname,
                    "row": 1,
                    "column": "A",
                    "class": "unmapped_non_template_sheet",
                    "reason": "Sheet has no recognized location material headers and is not excluded.",
                }],
            })
            continue

        cols = layout["cols"]
        ev_cols = layout["evidence_cols"]
        section_refusals: list[dict[str, Any]] = []
        skipped_lines: list[dict[str, Any]] = []
        empty_lines: list[dict[str, Any]] = []
        policy_flags: dict[str, list[dict[str, Any]]] = {
            "closing_conflicts": [],
            "negative_closings": [],
            "set_aside_conflicts": [],
            "received_conflicts": [],
            "consolidated_items": [],
        }

        def make_refusal(
            row_num: int, col_idx: int, cls: str, reason: str, item_code: str | None = None
        ) -> dict[str, Any]:
            rec: dict[str, Any] = {
                "sheet": sname,
                "row": row_num,
                "column": get_column_letter(col_idx + 1),
                "class": cls,
                "reason": reason,
            }
            if item_code:
                rec["item_code"] = item_code
            return rec

        section_as_of = scfg.get("as_of") or default_as_of
        if not section_as_of or not ISO_DATE_RE.match(str(section_as_of)):
            section_refusals.append(
                make_refusal(
                    layout["header_row"],
                    0,
                    "missing_as_of_date",
                    f"Section '{sname}' has no valid ISO as_of date in mapping.",
                )
            )

        # Validate discovered owner-warehouse headers
        resolved_whs: list[tuple[int, str, dict[str, str]]] = []
        for col_idx, wh_header, hdr_row_1b in layout["warehouses"]:
            if wh_header not in wh_map:
                section_refusals.append(
                    make_refusal(
                        hdr_row_1b,
                        col_idx,
                        "unknown_owner_warehouse_header",
                        f"Owner-warehouse header '{wh_header}' is not mapped in owner_warehouses.",
                    )
                )
            else:
                info = wh_map[wh_header]
                resolved_whs.append((col_idx, wh_header, info))
                discovered_warehouses[info["code"]] = info

        def cell_v(row_tuple: tuple[Any, ...], idx: int | None) -> Any:
            if idx is None or idx >= len(row_tuple):
                return None
            return row_tuple[idx]

        def cell_f(row_idx_0: int, idx: int | None) -> Any:
            if idx is None or row_idx_0 >= len(f_rows):
                return None
            rf = f_rows[row_idx_0]
            return rf[idx] if idx < len(rf) else None

        candidate_rows: list[dict[str, Any]] = []
        orders_seen: list[str] = []
        cost_codes_seen: list[str] = []

        item_col = cols.get("item_code")
        order_col = cols.get("order_number")

        for row_idx_0 in range(layout["data_start"], len(v_rows)):
            rv = v_rows[row_idx_0]
            row_num = row_idx_0 + 1
            raw_item = cell_v(rv, item_col)
            if raw_item is None:
                if item_col is not None and is_formula(cell_f(row_idx_0, item_col)):
                    skipped_lines.append(
                        make_refusal(row_num, item_col, "missing_formula_cache", "Item code formula has no cached value.")
                    )
                continue
            if is_excel_error(raw_item):
                skipped_lines.append(
                    make_refusal(row_num, item_col, "excel_error", f"Excel error in item code: {raw_item}")
                )
                continue
            if is_check_cell(raw_item):
                skipped_lines.append(
                    make_refusal(row_num, item_col, "check_cell", f"Check marker in item code: {raw_item}")
                )
                continue

            item_code = format_code(raw_item)
            if not item_code or item_code == "-" or norm_header(item_code) in layout["item_code_headers"]:
                continue

            raw_order = cell_v(rv, order_col)
            if raw_order is not None and norm_header(raw_order) in layout["order_number_headers"]:
                continue

            row_refusals: list[dict[str, Any]] = []
            row_flags: dict[str, list[dict[str, Any]]] = {
                "closing_conflicts": [],
                "set_aside_conflicts": [],
                "received_conflicts": [],
            }

            def add_row_refusal(col_idx: int, cls: str, reason: str) -> None:
                row_refusals.append(make_refusal(row_num, col_idx, cls, reason, item_code=item_code))

            def check_row_formula_cache(col_idx: int | None, val: Any, label: str) -> bool:
                if col_idx is None:
                    return True
                fv = cell_f(row_idx_0, col_idx)
                if is_formula(fv) and val is None:
                    add_row_refusal(col_idx, "missing_formula_cache", f"Formula in {label} has no cached value.")
                    return False
                return True

            if raw_order is not None:
                if is_excel_error(raw_order):
                    add_row_refusal(order_col, "excel_error", f"Excel error in order number: {raw_order}")
                else:
                    order_s = str(raw_order).strip()
                    if order_s and order_s != "-" and order_s not in orders_seen:
                        orders_seen.append(order_s)

            raw_cost = cell_v(rv, cols.get("cost_code"))
            if raw_cost is not None and not is_excel_error(raw_cost):
                cost_s = str(raw_cost).strip()
                if cost_s and cost_s != "-" and cost_s not in cost_codes_seen:
                    cost_codes_seen.append(cost_s)

            raw_desc = cell_v(rv, cols.get("description"))
            check_row_formula_cache(cols.get("description"), raw_desc, "description")
            if is_excel_error(raw_desc):
                add_row_refusal(cols["description"], "excel_error", f"Excel error in description: {raw_desc}")
            item_name = str(raw_desc).strip() if raw_desc is not None else ""

            raw_uom = cell_v(rv, cols.get("unit"))
            check_row_formula_cache(cols.get("unit"), raw_uom, "unit")
            if is_excel_error(raw_uom):
                add_row_refusal(cols["unit"], "excel_error", f"Excel error in unit: {raw_uom}")
            unit = str(raw_uom).strip() if raw_uom is not None else ""
            if not unit or unit == "-":
                add_row_refusal(cols.get("unit", 3), "missing_unit", f"Missing unit for item '{item_code}'.")

            raw_cat = cell_v(rv, cols.get("category_code"))
            if is_excel_error(raw_cat):
                add_row_refusal(cols["category_code"], "excel_error", f"Excel error in category code: {raw_cat}")
            category_code = str(raw_cat).strip() if (raw_cat is not None and str(raw_cat).strip() not in ("", "-")) else None

            # Planned quantity
            raw_planned = cell_v(rv, cols.get("planned"))
            check_row_formula_cache(cols.get("planned"), raw_planned, "planned quantity")
            planned, err = parse_decimal(raw_planned)
            if err:
                add_row_refusal(cols["planned"], err, f"Invalid planned quantity ({raw_planned}).")
                planned = ZERO
            planned = planned if planned is not None else ZERO

            # Owner warehouse quantities -> set_aside + verbatim warehouse breakdown in evidence
            wh_sum = ZERO
            wh_evidence: dict[str, str] = {}
            for wh_col_idx, wh_header, wh_info in resolved_whs:
                raw_wh = cell_v(rv, wh_col_idx)
                check_row_formula_cache(wh_col_idx, raw_wh, wh_header)
                qty, q_err = parse_decimal(raw_wh)
                if q_err:
                    add_row_refusal(wh_col_idx, q_err, f"Invalid set-aside qty in {wh_header}: {raw_wh}")
                    continue
                if qty is not None and qty > ZERO:
                    wh_sum += qty
                    wh_code = wh_info["code"]
                    if wh_code in wh_evidence:
                        wh_evidence[wh_code] = format_decimal(Decimal(wh_evidence[wh_code]) + qty)
                    else:
                        wh_evidence[wh_code] = format_decimal(qty)

            raw_total_set_aside = cell_v(rv, cols.get("total_set_aside"))
            if check_row_formula_cache(cols.get("total_set_aside"), raw_total_set_aside, "total set-aside"):
                total_sa, tr_err = parse_decimal(raw_total_set_aside)
                if tr_err:
                    add_row_refusal(cols["total_set_aside"], tr_err, f"Invalid total set-aside: {raw_total_set_aside}")
                    set_aside_qty = wh_sum
                elif total_sa is not None and abs(total_sa - wh_sum) > TOLERANCE:
                    if closing_policy == "movements_win":
                        set_aside_qty = wh_sum
                        row_flags["set_aside_conflicts"].append({
                            "sheet": sname,
                            "row": row_num,
                            "column": get_column_letter(cols["total_set_aside"] + 1),
                            "item_code": item_code,
                            "workbook_total": format_decimal(total_sa),
                            "computed_total": format_decimal(wh_sum),
                        })
                    else:
                        add_row_refusal(
                            cols["total_set_aside"],
                            "conflicting_cache",
                            f"Total set-aside cached ({format_decimal(total_sa)}) != sum of warehouse columns ({format_decimal(wh_sum)}).",
                        )
                        set_aside_qty = total_sa
                else:
                    set_aside_qty = total_sa if total_sa is not None else wh_sum
            else:
                set_aside_qty = wh_sum

            # Received: direct + transfer_in vs total_received
            raw_recd = cell_v(rv, cols.get("received_direct"))
            raw_tri = cell_v(rv, cols.get("received_transfer_in"))
            raw_total_recd = cell_v(rv, cols.get("total_received"))
            check_row_formula_cache(cols.get("received_direct"), raw_recd, "received direct")
            check_row_formula_cache(cols.get("received_transfer_in"), raw_tri, "received transfer-in")
            check_row_formula_cache(cols.get("total_received"), raw_total_recd, "total received")

            q_recd, e_recd = parse_decimal(raw_recd)
            if e_recd:
                add_row_refusal(cols["received_direct"], e_recd, f"Invalid received quantity: {raw_recd}")
                q_recd = ZERO
            q_tri, e_tri = parse_decimal(raw_tri)
            if e_tri:
                add_row_refusal(cols["received_transfer_in"], e_tri, f"Invalid transfer-in quantity: {raw_tri}")
                q_tri = ZERO
            q_total_recd, e_tot_r = parse_decimal(raw_total_recd)
            if e_tot_r:
                add_row_refusal(cols["total_received"], e_tot_r, f"Invalid total received: {raw_total_recd}")
                q_total_recd = None

            part_sum = (q_recd or ZERO) + (q_tri or ZERO)
            if q_total_recd is not None and (cols.get("received_direct") is not None or cols.get("received_transfer_in") is not None):
                if abs(q_total_recd - part_sum) > TOLERANCE:
                    if closing_policy == "movements_win":
                        received_qty = part_sum
                        row_flags["received_conflicts"].append({
                            "sheet": sname,
                            "row": row_num,
                            "column": get_column_letter(cols["total_received"] + 1),
                            "item_code": item_code,
                            "workbook_total": format_decimal(q_total_recd),
                            "computed_total": format_decimal(part_sum),
                        })
                    else:
                        add_row_refusal(
                            cols["total_received"],
                            "conflicting_cache",
                            f"Total received cached ({format_decimal(q_total_recd)}) != component sum ({format_decimal(part_sum)}).",
                        )
                        received_qty = q_total_recd
                else:
                    received_qty = q_total_recd
            elif q_total_recd is not None:
                received_qty = q_total_recd
            else:
                received_qty = part_sum

            # Issued, Returned, Transfer out, Owner return
            raw_issued = cell_v(rv, cols.get("issued"))
            check_row_formula_cache(cols.get("issued"), raw_issued, "issued quantity")
            issued_qty, e_iss = parse_decimal(raw_issued)
            if e_iss:
                add_row_refusal(cols["issued"], e_iss, f"Invalid issued quantity: {raw_issued}")
                issued_qty = ZERO
            issued_qty = issued_qty or ZERO

            raw_ret = cell_v(rv, cols.get("returned"))
            check_row_formula_cache(cols.get("returned"), raw_ret, "returned quantity")
            returned_qty, e_ret = parse_decimal(raw_ret)
            if e_ret:
                add_row_refusal(cols["returned"], e_ret, f"Invalid returned quantity: {raw_ret}")
                returned_qty = ZERO
            returned_qty = returned_qty or ZERO

            raw_tro = cell_v(rv, cols.get("transfer_out"))
            check_row_formula_cache(cols.get("transfer_out"), raw_tro, "transfer-out quantity")
            tro_qty, e_tro = parse_decimal(raw_tro)
            if e_tro:
                add_row_refusal(cols["transfer_out"], e_tro, f"Invalid transfer-out quantity: {raw_tro}")
                tro_qty = ZERO
            tro_qty = tro_qty or ZERO

            raw_or = cell_v(rv, cols.get("owner_return"))
            check_row_formula_cache(cols.get("owner_return"), raw_or, "owner-return quantity")
            or_qty, e_or = parse_decimal(raw_or)
            if e_or:
                add_row_refusal(cols["owner_return"], e_or, f"Invalid owner-return quantity: {raw_or}")
                or_qty = ZERO
            or_qty = or_qty or ZERO

            computed_closing = received_qty - issued_qty + returned_qty - tro_qty - or_qty

            raw_closing = cell_v(rv, cols.get("closing"))
            if check_row_formula_cache(cols.get("closing"), raw_closing, "closing stock"):
                wb_closing, c_err = parse_decimal_allow_negative(raw_closing)
                if c_err:
                    add_row_refusal(cols["closing"], c_err, f"Invalid closing stock: {raw_closing}")
                elif wb_closing is not None and abs(wb_closing - computed_closing) > TOLERANCE:
                    if closing_policy == "movements_win":
                        row_flags["closing_conflicts"].append({
                            "sheet": sname,
                            "row": row_num,
                            "column": get_column_letter(cols["closing"] + 1),
                            "item_code": item_code,
                            "workbook_closing": format_decimal(wb_closing),
                            "computed_closing": format_decimal(computed_closing),
                        })
                    else:
                        add_row_refusal(
                            cols["closing"],
                            "closing_stock_conflict",
                            f"Workbook closing stock ({format_decimal(wb_closing)}) != computed closing ({format_decimal(computed_closing)}).",
                        )

            if row_refusals:
                skipped_lines.extend(row_refusals)
                continue

            # Evidence (verbatim bounded display strings; never computed on)
            evidence: dict[str, Any] = {}
            for ev_key, ev_idx in ev_cols.items():
                txt = format_evidence_text(cell_v(rv, ev_idx))
                if txt is not None:
                    evidence[ev_key] = txt
            if wh_evidence:
                evidence["owner_warehouses"] = wh_evidence

            candidate_rows.append({
                "row": row_num,
                "item_code": item_code,
                "item_name": item_name,
                "unit": unit,
                "category_code": category_code,
                "planned_d": planned,
                "opening_d": {
                    "requested": planned,
                    "set_aside": set_aside_qty,
                    "received": received_qty,
                    "issued": issued_qty,
                    "returned": returned_qty,
                    "transfer_in": ZERO,
                    "transfer_out": tro_qty,
                    "owner_return": or_qty,
                },
                "evidence": evidence,
                "row_flags": row_flags,
            })

        # Group/deduplicate candidate rows per `duplicate_items` policy
        grouped_order: list[str] = []
        grouped: dict[str, list[dict[str, Any]]] = {}
        for rec in candidate_rows:
            ic = rec["item_code"]
            if ic not in grouped:
                grouped_order.append(ic)
                grouped[ic] = [rec]
            else:
                consol_key = f"{sname}:{ic}"
                if duplicate_policy == "sum" or consol_key in consolidations:
                    first_unit = grouped[ic][0]["unit"].strip().upper()
                    this_unit = rec["unit"].strip().upper()
                    if first_unit and this_unit and first_unit != this_unit:
                        skipped_lines.append(
                            make_refusal(
                                rec["row"],
                                cols.get("unit", item_col),
                                "conflicting_duplicate_unit",
                                f"Duplicate item '{ic}' has unit '{rec['unit']}' disagreeing with first row unit '{grouped[ic][0]['unit']}'.",
                                item_code=ic,
                            )
                        )
                        continue
                    grouped[ic].append(rec)
                else:
                    skipped_lines.append(
                        make_refusal(
                            rec["row"],
                            item_col,
                            "duplicate_section_item",
                            f"Item '{ic}' repeated in sheet '{sname}' (first at row {grouped[ic][0]['row']}) without consolidation mapping.",
                            item_code=ic,
                        )
                    )

        lines: list[dict[str, Any]] = []
        for ic in grouped_order:
            group = grouped[ic]
            first = group[0]
            total_planned = sum((r["planned_d"] for r in group), ZERO)
            summed_opening = {
                k: sum((r["opening_d"][k] for r in group), ZERO)
                for k in OPENING_KEYS
            }
            computed_closing = (
                summed_opening["received"]
                + summed_opening["transfer_in"]
                - summed_opening["issued"]
                + summed_opening["returned"]
                - summed_opening["transfer_out"]
                - summed_opening["owner_return"]
            )

            # Check zero planned quantity (FR-004 & Contract v2.2 3c)
            has_any_activity = any(
                summed_opening[k] > ZERO
                for k in ("set_aside", "received", "issued", "returned", "transfer_in", "transfer_out", "owner_return")
            )
            if total_planned == ZERO:
                if has_any_activity:
                    skipped_lines.append(
                        make_refusal(
                            first["row"],
                            cols.get("planned", item_col),
                            "zero_planned_with_movements",
                            f"Item '{ic}' has planned quantity 0 with positive stage quantities.",
                            item_code=ic,
                        )
                    )
                else:
                    empty_lines.append({
                        "sheet": sname,
                        "row": first["row"],
                        "item_code": ic,
                        "class": "empty_line",
                    })
                continue

            # Check negative closing stock on the resulting line (Contract v2)
            if computed_closing < ZERO:
                if closing_policy == "movements_win":
                    policy_flags["negative_closings"].append({
                        "sheet": sname,
                        "row": first["row"],
                        "column": get_column_letter(cols.get("closing", item_col) + 1),
                        "item_code": ic,
                        "computed_closing": format_decimal(computed_closing),
                    })
                else:
                    skipped_lines.append(
                        make_refusal(
                            first["row"],
                            cols.get("closing", item_col),
                            "negative_closing_stock",
                            f"Computed closing stock is negative ({format_decimal(computed_closing)}).",
                            item_code=ic,
                        )
                    )
                    continue

            # Commit per-row policy flags for accepted group rows
            for r in group:
                for fk in ("closing_conflicts", "set_aside_conflicts", "received_conflicts"):
                    policy_flags[fk].extend(r["row_flags"][fk])

            if len(group) == 1:
                category_code = first["category_code"]
                evidence = first["evidence"]
            else:
                cats = {r["category_code"] for r in group}
                category_code = next(iter(cats)) if len(cats) == 1 else None
                evidence = {
                    "rows": [
                        {
                            "row": r["row"],
                            "planned": format_decimal(r["planned_d"]),
                            "category_code": r["category_code"],
                            "opening": {k: format_decimal(r["opening_d"][k]) for k in OPENING_KEYS},
                            "texts": r["evidence"],
                        }
                        for r in group
                    ]
                }
                policy_flags["consolidated_items"].append({
                    "sheet": sname,
                    "row": first["row"],
                    "rows": [r["row"] for r in group],
                    "item_code": ic,
                    "row_count": len(group),
                    "category_agreed": len(cats) == 1,
                    "category_code": category_code,
                    "planned": format_decimal(total_planned),
                })

            lines.append({
                "row": first["row"],
                "item_code": ic,
                "item_name": next((r["item_name"] for r in group if r["item_name"]), ""),
                "unit": first["unit"],
                "category_code": category_code,
                "planned": format_decimal(total_planned),
                "opening": {k: format_decimal(summed_opening[k]) for k in OPENING_KEYS},
                "evidence": evidence,
                "expected": {
                    "closing": format_decimal(computed_closing),
                },
            })

        # Resolve owner_order_number for this sheet (section-level identity)
        mapped_order = scfg.get("owner_order_number")
        if mapped_order:
            owner_order_number = str(mapped_order).strip()
        elif len(orders_seen) == 1:
            owner_order_number = orders_seen[0]
        elif len(orders_seen) > 1:
            owner_order_number = None
            section_refusals.append(
                make_refusal(
                    layout["data_start"] + 1,
                    order_col if order_col is not None else 0,
                    "ambiguous_owner_order_number",
                    f"Multiple order numbers in sheet '{sname}': {', '.join(orders_seen)}. Specify sheets['{sname}'].owner_order_number.",
                )
            )
        else:
            owner_order_number = None
            if lines or skipped_lines:
                section_refusals.append(
                    make_refusal(
                        layout["data_start"] + 1,
                        order_col if order_col is not None else 0,
                        "missing_owner_order_number",
                        f"No order number found in sheet '{sname}'.",
                    )
                )

        if not lines and not section_refusals and not skipped_lines:
            excluded_sheets.append(sname)
            continue

        owner_cost_code = scfg.get("owner_cost_code") or (cost_codes_seen[0] if cost_codes_seen else None)
        location_name = str(scfg.get("location_name") or sname.strip())
        reconciliation_step = scfg.get("reconciliation_step") or recon_status.get(sname.strip().lower())
        title = (
            scfg.get("title")
            or rollup_titles.get(sname.strip().lower())
            or (rollup_titles.get(owner_order_number.lower()) if owner_order_number else None)
            or layout["sheet_title"]
            or location_name
        )

        if section_refusals:
            refused_sections.append({
                "sheet": sname,
                "owner_order_number": owner_order_number,
                "location_name": location_name,
                "item_row_count": len(lines),
                "refusals": section_refusals + skipped_lines,
            })
        elif not lines and skipped_lines:
            refused_sections.append({
                "sheet": sname,
                "owner_order_number": owner_order_number,
                "location_name": location_name,
                "item_row_count": 0,
                "refusals": skipped_lines,
            })
        else:
            accepted_sections.append({
                "sheet": sname,
                "header_row": layout["header_row"],
                "owner_order_number": owner_order_number,
                "location_name": location_name,
                "owner_cost_code": owner_cost_code,
                "title": title,
                "as_of": section_as_of,
                "closing_conflict": closing_policy,
                "reconciliation_step": reconciliation_step,
                "partial": len(skipped_lines) > 0,
                "skipped_lines": skipped_lines,
                "empty_lines": empty_lines,
                "lines": lines,
                "policy_flags": policy_flags,
            })

    wb_val.close()
    wb_f.close()

    return {
        "source_digest": file_sha256(workbook_path),
        "policy": {
            "closing_conflict": closing_policy,
            "duplicate_items": duplicate_policy,
        },
        "catalogue": {
            "items": catalogue_items,
            "categories": catalogue_categories,
            "owner_warehouses": sorted(discovered_warehouses.values(), key=lambda w: w["code"]),
        },
        "reconciliation_scale": reconciliation_scale,
        "accepted_sections": accepted_sections,
        "refused_sections": refused_sections,
        "validation_sheets": validation_sheets,
        "excluded_sheets": excluded_sheets,
        "unmapped_sheets": unmapped_sheets,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        sys.stderr.write("usage: owner-material-workbook.py <workbook.xlsx> <mapping.json>\n")
        return 2
    wb_path, map_path = argv[1], argv[2]
    if not Path(wb_path).is_file():
        sys.stderr.write(f"Workbook not found: {wb_path}\n")
        return 2
    if not Path(map_path).is_file():
        sys.stderr.write(f"Mapping file not found: {map_path}\n")
        return 2
    with open(map_path, "r", encoding="utf-8") as f:
        mapping = json.load(f)
    result = parse_workbook(wb_path, mapping)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
