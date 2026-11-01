# Odoo 20 Native Coverage of the EPC Prospect's Needs

**Date:** 2026-10-30  
**Context:** Research investigation for wayfinder ticket [#1484](https://github.com/ariefsaid/PMO/issues/1484) under parent map [#1481](https://github.com/ariefsaid/PMO/issues/1481).  
**Baseline Constraint:** Owner ruling (2026-10-30): PMO must work against **Odoo Community Edition (v20 / v18 baseline)** with **zero Odoo customisation** (stock JSON-RPC API only per [ADR-0055](file:///Users/ariefsaid/orca/workspaces/PMO/research-odoo20-native-coverage/docs/adr/0055-external-system-adapters-sot-enhancement.md) and [ADR-0059](file:///Users/ariefsaid/orca/workspaces/PMO/research-odoo20-native-coverage/docs/adr/0059-pmo-sot-with-external-side-mirror.md)). Odoo Enterprise features (such as Odoo Studio, proprietary apps, and advanced accounting) are treated as an optional commercial bonus, not a dependency.  
**Public Privacy Rule:** The prospect is strictly referred to as "the EPC prospect"; no individual names, prospect company identities, or credentials appear in this document.

---

## 1. Executive Summary & Coverage Matrix

The table below answers whether each operational need of the EPC prospect is covered natively in stock Odoo 20 Community (the required baseline), whether it requires Odoo 20 Enterprise, whether it depends on Odoo Studio or custom modules, and the recommended architectural ownership split between PMO and Odoo.

| Need / Domain | Odoo 20 Community (Baseline) | Odoo 20 Enterprise (Bonus) | Needs Odoo Studio? | Needs Custom / 3rd-Party Module? | Recommended Owner & Architecture |
|---|---|---|---|---|---|
| **1. Multi-warehouse stock & reorders** | ✅ **Native** (`stock.warehouse`, `stock.location`, `stock.warehouse.orderpoint`) | ✅ **Native** (same core + Barcode app) | No | No | **Odoo owns physical warehouse locations and replenishment rules.** |
| **1A. Per-project issue & consumption reporting** | ❌ **Not native** (no `analytic_distribution` on `stock.move`) | ⚠️ **Partial** (via BoM/MO or PO; no direct issue to analytic account) | No (Studio cannot inject valuation logic) | Yes (e.g. OCA `stock_analytic`) OR PMO-side | **PMO owns project issue & consumption reporting**; pushes consumption as financial journal/scrap. |
| **2. Fleet management** | ✅ **Native** (`fleet.vehicle`, `odometer`, `services`) | ✅ **Native** (same core) | No | No | **Odoo owns vehicle asset master, odometer, and service logs.** |
| **2A. Heavy equipment utilisation & trips** | ❌ **Not native** (no hourly engine logs, no trip dispatch sheets) | ❌ **Not native** (requires Field Service/Planning workarounds) | Possible for simple trip forms | Yes (e.g. OCA `fleet_trip` or equipment telematics module) | **PMO owns daily equipment run-sheets & trip dispatches**; mirrors costs/mileage to Odoo. |
| **2B. Equipment maintenance** | ✅ **Native** (`maintenance.equipment`, `maintenance.request`) | ✅ **Native** (integrated with Shop Floor / Work Centers) | No | No | **Odoo owns preventive/corrective maintenance records.** |
| **3. Indonesian localisation (PPN & Withholding)** | ✅ **Native** (`l10n_id`: standard COA, PPN 11%/12%, PPh 21/22/23/4(2)) | ✅ **Native** + dynamic `account_reports` | No | No | **Odoo owns fiscal tax codes & accounts; PMO references them.** |
| **3A. Indonesian e-Faktur & Coretax** | ✅ **Native** (`l10n_id_efaktur` CSV, `l10n_id_efaktur_coretax` XML) | ✅ **Native** (same core addons) | No | No | **Odoo generates DJP CSV / Coretax XML from customer invoices.** |
| **4. Indonesian payroll** | ❌ **None** (zero payroll in Community since v13) | ⚠️ **Partial** (`hr_payroll` engine exists; BPJS & PPh 21 TER require custom rules) | No | Yes (`hr_payroll_indonesia` or OCA payroll) | **External payroll module or PMO employee sync**; out of scope for stock Odoo Community. |
| **4A. Field attendance** | ⚠️ **Basic native** (`hr_attendance` web/kiosk; no GPS, online only) | ⚠️ **Native** (`hr_attendance` with mobile GPS; still online-only) | No | Yes (for offline field sync / biometric devices) | **PMO owns foreman site attendance & roll call**; syncs approved hours to Odoo. |
| **5. Timesheet-based invoicing** | ✅ **Native** (`sale_timesheet`, delivered quantity by timesheet) | ✅ **Native** (same core addons) | No | No | **Odoo owns sales invoice generation from timesheets.** |
| **6. Volume-based progress invoicing (BoQ / BAST)** | ❌ **Not native** (only milestone % or down payment) | ❌ **Not native** (only milestone % or down payment) | No (Studio cannot handle cumulative certified volume) | Yes (e.g. construction BoQ modules) | **PMO owns BoQ progress assessments, BAST, and cumulative retainage**; pushes standard invoice to Odoo. |
| **7. Multi-tier & spending approvals** | ⚠️ **Minimal** (only PO double-validation threshold & expense sign-off) | ✅ **Native** (`approvals` app + Studio button approval rules) | Yes (in Enterprise for button rules) | Yes (in Community for multi-tier workflows) | **PMO owns all operational, budget-backed, and tiered spending approvals**; writes approved docs to Odoo. |
| **8. Mobile / field entry** | ⚠️ **Mobile web only** (responsive PWA; no native app; online only) | ⚠️ **Native iOS/Android apps** + Barcode app (online only) | No | Yes (for offline field operation) | **PMO responsive web / installable app owns field entry**; syncs when connected. |
| **9. Google Workspace connector** | ✅ **Native** (`google_account`, `google_calendar`, Gmail OAuth) | ✅ **Native** + Google Spreadsheet sync | No | No | **Odoo handles Google Calendar/Gmail natively.** |
| **9A. Lark (Feishu) connector** | ❌ **None** (no native Lark integration) | ❌ **None** (no native Lark integration) | No | Yes (OdooHub Lark connector or custom webhooks) | **PMO owns Lark webhook / notification bot** (per #1492). |

---

## 2. Detailed Findings by Functional Need

### 2.1 Multi-Warehouse Stock, Per-Project Issue, Consumption Reporting, Reorder Rules

#### What Odoo Community v20 Does Natively
* **Multi-Warehouse & Multi-Location:** Odoo Community includes the core `stock` module (`addons/stock`). It natively supports an arbitrary number of warehouses (`stock.warehouse`), hierarchical storage locations (`stock.location`), and multi-step routing (receptions, internal transfers, delivery orders).
  * *Primary Source:* [Odoo Warehouses and Storage Documentation](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage.html)
  * *Codebase:* [odoo/odoo addons/stock](https://github.com/odoo/odoo/tree/18.0/addons/stock)
* **Automated Reordering Rules:** Community provides native replenishment orderpoints (`stock.warehouse.orderpoint`). Rules define minimum/maximum quantities per warehouse/location, trigger automated purchase orders or internal transfers between warehouses, and support reordering routes (Buy, Manufacture, Transfer).
  * *Primary Source:* [Odoo Minimum Stock Rules Documentation](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/management/replenishment_strategies/min_stock_rule_orderpoints.html)

#### The Gap: Per-Project Issue and Consumption Reporting
* **Standard Odoo Constraint:** In standard Odoo (both Community and Enterprise), stock pickings (`stock.picking`) and stock moves (`stock.move`) do **not** carry an `analytic_distribution` field out-of-the-box. When stock is transferred from a central warehouse to a site warehouse, or issued on-site, Odoo does not natively record project cost accounting against an Analytic Account on that stock move.
* **Valuation Propagation:** Analytic distribution exists on Purchase Order lines (`purchase.order.line`) and Vendor Bills (`account.move.line`). When goods are purchased directly for a project, Odoo can tag the cost. However, issuing materials from existing stock directly to a project requires:
  1. Transferring goods to a project-specific scrap/virtual location (which requires manual accounting adjustment to hit project expenses), OR
  2. Installing third-party modules such as OCA `stock_analytic` and `stock_picking_analytic`, which add `analytic_distribution` to `stock.move` and post to the valuation layer.
  * *Primary Source:* [Analytic Accounting — Odoo Documentation](https://www.odoo.com/documentation/20.0/applications/finance/accounting/reporting/analytic_accounting.html)
  * *Issue Reference:* [odoo/odoo Issue #267942: [18.0] purchase_stock: analytic distribution](https://github.com/odoo/odoo/issues/267942)
  * *OCA Reference:* [OCA/account-analytic: stock_analytic](https://github.com/OCA/account-analytic/tree/16.0/stock_analytic)
* **Architecture Alignment:** Because stock Odoo Community cannot be customized, **PMO must own project issue and consumption reporting**. PMO records the site material request, tracks project consumption against the project budget, and issues standard stock movements or inventory adjustments to Odoo via JSON-RPC.

---

### 2.2 Fleet + Maintenance (Utilisation, Fuel, Trips)

#### What Odoo Community v20 Does Natively
* **Fleet Management (`fleet`):** The `fleet` module is 100% open-source and included in Odoo Community. It provides:
  * Vehicle and equipment registry (`fleet.vehicle`), license plate, vehicle model, and driver assignment.
  * Odometer tracking (`fleet.vehicle.odometer`) with historical mileage logs and date stamps.
  * Service logs (`fleet.vehicle.log.services`) for routine maintenance, inspections, repairs, and vendor costs.
  * Recurring contracts and lease tracking.
  * Fuel tracking: In modern Odoo, fuel logs are managed directly as service records (`fleet.vehicle.log.services` with service type "Fuel") or linked vendor bills.
  * *Primary Source:* [Odoo Fleet Documentation](https://www.odoo.com/documentation/20.0/applications/human_resources/fleet.html)
  * *Primary Source:* [Odoo Fleet Services Documentation](https://www.odoo.com/documentation/20.0/applications/human_resources/fleet/services.html)
  * *Codebase:* [odoo/odoo addons/fleet](https://github.com/odoo/odoo/tree/18.0/addons/fleet)
* **Maintenance App (`maintenance`):** The `maintenance` module is also open-source in Odoo Community. It manages:
  * Internal equipment and tools (`maintenance.equipment`).
  * Preventive and corrective maintenance requests (`maintenance.request`).
  * Maintenance stages, teams, technicians, and mean-time-between-failure (MTBF) statistics.
  * *Primary Source:* [Odoo Maintenance Documentation](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/maintenance.html)
  * *Codebase:* [odoo/odoo addons/maintenance](https://github.com/odoo/odoo/tree/18.0/addons/maintenance)

#### The Gap: Equipment Utilisation & Trips
* **Trips / Journey Dispatch:** Odoo Fleet does **not** have a native "Trip" model (e.g. dispatch tickets, origin-destination waybills, passenger/cargo manifests, or driver trip approval). It only tracks cumulative odometer readings over time.
* **Heavy Equipment Hours:** EPC contractors track heavy equipment (cranes, excavators, diesel generators) by operating hours / engine hours, not kilometers. Odoo Fleet assumes distance (km/miles); tracking engine run-time hours requires custom fields or using Timesheets on equipment.
* **Architecture Alignment:** Odoo Community serves as the asset register for vehicles and maintenance work orders. PMO should handle daily equipment run-sheets and trip logs, updating odometer/hour counters and maintenance triggers in Odoo via API.

---

### 2.3 Indonesian Localisation (PPN e-Faktur, Withholding)

#### What Odoo Community v20 Does Natively
* **Indonesian Chart of Accounts & Taxes (`l10n_id`):** Resides in the open-source repository (`addons/l10n_id`) and is available in Community. It includes:
  * Standard Indonesian Chart of Accounts (COA) template.
  * Pre-configured Indonesian VAT (PPN 11% and statutory 12%).
  * Withholding tax definitions (PPh 21, PPh 22, PPh 23, and PPh 4(2) final tax).
  * *Primary Source:* [Odoo Indonesia Fiscal Localization Documentation](https://www.odoo.com/documentation/20.0/applications/finance/fiscal_localizations/indonesia.html)
  * *Codebase:* [odoo/odoo addons/l10n_id](https://github.com/odoo/odoo/tree/18.0/addons/l10n_id)
* **e-Faktur DJP Integration (`l10n_id_efaktur`):** Available in Community. Tracks assigned tax invoice serial numbers (Nomor Seri Faktur Pajak - NSFP) and generates CSV export files formatted for the DJP desktop e-Faktur application.
  * *Codebase:* [odoo/odoo addons/l10n_id_efaktur](https://github.com/odoo/odoo/tree/18.0/addons/l10n_id_efaktur)
* **Coretax XML Integration (`l10n_id_efaktur_coretax`):** Included in Odoo 18.0+ Community. Generates XML files formatted for direct bulk upload into the DJP Coretax administration system, supporting statutory transaction codes (`01` through `09`).
  * *Codebase:* [odoo/odoo addons/l10n_id_efaktur_coretax](https://github.com/odoo/odoo/tree/18.0/addons/l10n_id_efaktur_coretax)

#### Community vs Enterprise Difference
* **Invoicing vs Full Accounting:** Odoo Community includes the `account` module (Invoicing), which allows creating customer invoices, vendor bills, tax calculation, and e-Faktur generation.
* **Enterprise Only:** Dynamic financial reporting (`account_reports`: real-time P&L, Balance Sheet, General Ledger drill-down), automatic bank reconciliation feeds, and automated tax audit reports are strictly Enterprise.
* **Architecture Alignment:** Invoicing and DJP tax compliance work out-of-the-box on Odoo Community. PMO acts as the operational front-end, pushing customer invoices and vendor bills into Odoo via JSON-RPC.

---

### 2.4 Indonesian Payroll and Field Attendance

#### What Odoo Community v20 Does Natively
* **Payroll:** **Zero native capability in Community.** The `hr_payroll` module was made proprietary in Odoo 13 and is exclusive to Odoo Enterprise (`odoo/enterprise/hr_payroll`). In Odoo Community, there is no payroll calculation engine, no salary structure model, and no payslip generation.
  * *Primary Source:* [Odoo Editions Comparison](https://www.odoo.com/page/editions)
* **Indonesian Payroll Localization (`l10n_id_hr_payroll`):** Even in Odoo Enterprise, Indonesian statutory payroll rules (PPh 21 TER under PMK 168/2023, BPJS Kesehatan, BPJS Ketenagakerjaan JHT/JKK/JKM/JP caps, and DJP e-Bupot integration) are incomplete in standard Odoo and require custom salary rules or third-party modules (such as `hr_payroll_indonesia` from the Odoo App Store).
* **Attendance (`hr_attendance`):** The `hr_attendance` module is native in Community. Employees can check in/out via web browser or a shared site Kiosk (PIN or barcode badge).
  * *Primary Source:* [Odoo Attendances Documentation](https://www.odoo.com/documentation/20.0/applications/hr/attendances.html)
  * *Codebase:* [odoo/odoo addons/hr_attendance](https://github.com/odoo/odoo/tree/18.0/addons/hr_attendance)

#### Field Attendance Gaps
* **GPS & Geolocation:** In Community, geolocation is limited to browser-based location checks. Enterprise includes mobile GPS stamping.
* **Offline Site Attendance:** Standard `hr_attendance` requires an active server connection; it cannot cache attendance events locally on remote EPC job sites with intermittent network coverage.
* **Architecture Alignment:** Attendance collection on remote sites should be handled by PMO's mobile/web app, which records site muster rolls and pushes verified timesheets/attendances to Odoo.

---

### 2.5 Timesheet-Based Invoicing

#### What Odoo Community v20 Does Natively
* **Full Native Coverage:** Both `hr_timesheet` and `sale_timesheet` are open-source Community modules.
  * *Codebase:* [odoo/odoo addons/hr_timesheet](https://github.com/odoo/odoo/tree/18.0/addons/hr_timesheet)
  * *Codebase:* [odoo/odoo addons/sale_timesheet](https://github.com/odoo/odoo/tree/18.0/addons/sale_timesheet)
* **Delivered Quantities Invoicing Policy:** A service product can be set to "Delivered Quantities" with tracking set to "Timesheets on tasks".
* **Automated Sales Order Billing:** When employees record hours against project tasks, those hours directly populate the "Delivered" quantity column on the linked Sales Order line. Generating an invoice pulls approved delivered hours into a draft customer invoice, filterable by date range.
  * *Primary Source:* [Invoicing Based on Time and Materials — Odoo Documentation](https://www.odoo.com/documentation/20.0/applications/finance/accounting/customer_invoices/time_materials.html)
* **Architecture Alignment:** Fully supported in stock Odoo Community without any customisation.

---

### 2.6 Volume-Based Progress Invoicing (BoQ Progress Billing)

#### What Odoo Community v20 Does Natively
* **Milestone Invoicing (`sale_project`):** Community supports milestone invoicing on service products where fixed percentages or milestones are invoiced upon reaching project stages.
  * *Primary Source:* [Invoice Project Milestones — Odoo Documentation](https://www.odoo.com/documentation/20.0/applications/services/project/project_management/milestones.html)
* **Down Payments:** Community natively supports down payment invoices (percentage or fixed amount) deducted from subsequent invoices.

#### The Gap: EPC Cumulative Volume Billing & Retainage
* **Bill of Quantities (BoQ) Progress Billing:** Standard Odoo does **not** support EPC-style progress billing based on cumulative installed physical quantities:
  * Line-by-line contract quantity vs previously certified quantity vs current period quantity vs cumulative quantity.
  * Joint survey inspection / Berita Acara Kemajuan Pekerjaan (BAP) certification workflows.
  * Contractual retention deductions (e.g. 5% retention withheld until final completion/warranty BAST).
* **Studio Limitations:** While Odoo Enterprise Studio can add custom decimal fields to sale order lines, it cannot manage cumulative history across successive billing certificates without custom server actions. In Odoo Community, Studio does not exist at all.
* **Architecture Alignment:** **PMO must own Volume-Based Progress Invoicing.** PMO already provides native BoQ management, joint inspection/progress assessments, and Work Order Billing with BAST ([ADR-0080](file:///Users/ariefsaid/orca/workspaces/PMO/research-odoo20-native-coverage/docs/adr/0080-billing-by-work-order.md), [ADR-0091](file:///Users/ariefsaid/orca/workspaces/PMO/research-odoo20-native-coverage/docs/adr/0091-work-order-closing-value-and-bast.md)). Once certified in PMO, the resulting progress invoice amount is pushed as a standard customer invoice line to Odoo via JSON-RPC.

---

### 2.7 Approvals

#### What Odoo Community v20 Does Natively
* **Basic Out-of-the-Box Approvals:**
  * **Purchase Order Double Validation:** Purchase settings offer a threshold limit. Orders below the threshold can be confirmed by a purchase user; orders above require a Purchase Manager.
    * *Primary Source:* [Request Manager Approval for Expensive Orders — Odoo Documentation](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/purchase/manage_deals/approvals.html)
  * **Expense Sheets:** Submit to manager -> Approve -> Post.
  * **Leave/Time Off:** Manager / Time Off Officer approval.

#### What Community Lacks (Enterprise Only)
* **Approvals App (`approvals`):** The general Approvals application is Enterprise-only (`odoo/enterprise/approvals`). It allows defining custom approval request types (borrow items, travel requests, procurement requests) with multi-level approver sequences.
  * *Primary Source:* [Odoo Approvals Documentation](https://www.odoo.com/documentation/20.0/applications/productivity/approvals.html)
* **Studio Approval Rules:** Odoo Studio allows placing rule-based approvals directly on action buttons (e.g. requiring a specific security group to validate a button click). This is Enterprise-only.
  * *Primary Source:* [Approval Rules with Studio — Odoo Documentation](https://www.odoo.com/documentation/20.0/applications/productivity/studio/approval_rules.html)
* **Budget-Backed Approvals:** Neither Community nor Enterprise natively prevents an approver from signing off if an order exceeds the remaining project budget (standard Odoo does not enforce hard budget blocking on PO confirmations).
* **Architecture Alignment:** **PMO must own approvals.** PMO's native approval engine already supports multi-tier approval routing, budget-backed validation (preventing PM bypass per [ADR-0051](file:///Users/ariefsaid/orca/workspaces/PMO/research-odoo20-native-coverage/docs/adr/0051-conditional-approval-predicate.md) and [ADR-0075](file:///Users/ariefsaid/orca/workspaces/PMO/research-odoo20-native-coverage/docs/adr/0075-spend-approval-routing.md)), and role-based authority. Odoo only receives already-approved transactions.

---

### 2.8 Mobile / Field Entry

#### What Odoo Community v20 Does Natively
* **Responsive Web Interface:** Odoo Community's web client is fully responsive (built on Owl and Bootstrap 5) and operates cleanly on mobile and tablet web browsers.
* **Limitation:** The official Odoo Mobile apps for iOS and Android require an active Odoo Enterprise database code to authenticate; they do not officially support Community connections without custom mobile app wrappers.
* **Barcode App (`stock_barcode`):** The touch-friendly warehouse barcode scanner interface is an Enterprise-only module.
* **Field Service (`industry_fsm`):** Dedicated field service intervention worksheets and mobile sign-offs are Enterprise-only.
* **Offline Operation:** Neither Community nor Enterprise supports offline mobile form entry (only Point of Sale supports offline mode). Remote construction sites with no cellular signal cannot submit field forms in standard Odoo.
  * *Primary Source:* [Odoo Mobile Applications Documentation](https://www.odoo.com/documentation/20.0/applications/productivity/mobile.html)
* **Architecture Alignment:** **PMO owns mobile/field entry.** PMO provides a lightweight, responsive, installable web interface designed for foremen and Quantity Surveyors on phone screens, with local draft caching for intermittent connectivity.

---

### 2.9 Google Workspace and Lark Connectors

#### What Odoo Community v20 Does Natively
* **Google Workspace Integration:**
  * Base OAuth authentication: `google_account` is in Community.
  * Google Calendar synchronization: `google_calendar` is in Community, enabling bi-directional sync of calendar events and meetings.
  * Gmail integration: Standard SMTP/IMAP configuration and OAuth2 email sending.
  * *Primary Source:* [Google Calendar Integration — Odoo Documentation](https://www.odoo.com/documentation/20.0/applications/general/integrations/google_calendar.html)
  * *Codebase:* [odoo/odoo addons/google_account](https://github.com/odoo/odoo/tree/18.0/addons/google_account)
  * *Codebase:* [odoo/odoo addons/google_calendar](https://github.com/odoo/odoo/tree/18.0/addons/google_calendar)

#### The Gap: Lark (Feishu) Connector
* **No Native Lark Connector:** Neither Odoo Community nor Odoo Enterprise includes a native Lark (Feishu) connector.
* **Third-Party Ecosystem:** Connecting Odoo to Lark requires either third-party modules (such as OdooHub's Lark connector on the Odoo App Store) or custom webhook dispatchers.
* **Architecture Alignment:** **PMO owns the Lark connector.** Ticket [#1492](https://github.com/ariefsaid/PMO/issues/1492) investigates native PMO integration with Lark webhooks and bot notifications. This eliminates any need to touch or modify the Odoo server.

---

## 3. Odoo Community Baseline vs Enterprise: Implications for PMO

The prospect's requirement to operate on **Odoo Community with zero customisations** establishes clear operational boundaries:

1. **Hosting & External API Access:**
   * Odoo Community is always self-hosted (e.g. on an Ubuntu VM or Docker container).
   * External integration operates via Odoo's native XML-RPC / JSON-RPC endpoints (`/jsonrpc` and `/xmlrpc/2/object`).
   * Because it is self-hosted Community, there are **no SaaS rate limits**, no per-user subscription fees, and no restrictions on external API call volume.
2. **Zero Odoo Customisation Mandate ([ADR-0055](file:///Users/ariefsaid/orca/workspaces/PMO/research-odoo20-native-coverage/docs/adr/0055-external-system-adapters-sot-enhancement.md)):**
   * The PMO Odoo adapter communicates exclusively through stock JSON-RPC calls against vanilla Odoo Community models (`res.partner`, `product.product`, `purchase.order`, `account.move`, `stock.picking`, `hr.timesheet`).
   * No custom Python code, server actions, or third-party community modules need to be installed on the client's Odoo instance.
3. **Ledger Boundary & General Ledger:**
   * Odoo Community includes the Invoicing module (`account`), which holds the Chart of Accounts, Journal Entries, Customer Invoices, Vendor Bills, and Tax lines.
   * However, Community lacks Odoo's dynamic financial report viewer (`account_reports`). PMO's financial views and executive management packs ([ADR-0088](file:///Users/ariefsaid/orca/workspaces/PMO/research-odoo20-native-coverage/docs/adr/0088-financial-statements.md)) bridge this gap by aggregating GL account balances pulled over JSON-RPC.

---

## 4. Open Unknowns & Verification Gaps

1. **Odoo 20 JSON-RPC Authentication Format:** In Odoo 17+, Odoo introduced API keys for external authentication (`res.users.apikeys`) alongside traditional username/password authentication. Verification is required to ensure API keys function identically on self-hosted Odoo Community 20.
2. **e-Faktur Coretax XML Schema Stability:** The DJP Coretax XML format (`l10n_id_efaktur_coretax`) has undergone updates during 2025/2026 rollouts. While the Community module is present in Odoo source code, periodic DJP schema changes may require upstream git pulls of the localization module.
3. **Direct Stock Consumption Accounting Entry:** In Community stock accounting (`stock_account`), automated inventory valuation creates journal entries upon validating pickings. Confirming whether an internal transfer from a Central Warehouse to a Site Virtual Location can properly post an expense line without analytic accounts requires an integration test on the Odoo adapter test bench.

---

## 5. Primary Source Citations

* **Odoo Official Documentation:**
  * [Odoo Editions Comparison (Community vs Enterprise)](https://www.odoo.com/page/editions)
  * [Odoo Warehouses and Storage Management](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage.html)
  * [Odoo Reordering Rules and Orderpoints](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/management/replenishment_strategies/min_stock_rule_orderpoints.html)
  * [Odoo Fleet Services and Tracking](https://www.odoo.com/documentation/20.0/applications/human_resources/fleet/services.html)
  * [Odoo Maintenance Management](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/maintenance.html)
  * [Odoo Indonesia Fiscal Localization (PPN, e-Faktur, Coretax)](https://www.odoo.com/documentation/20.0/applications/finance/fiscal_localizations/indonesia.html)
  * [Odoo Time & Materials / Timesheet Invoicing](https://www.odoo.com/documentation/20.0/applications/finance/accounting/customer_invoices/time_materials.html)
  * [Odoo Milestone Invoicing](https://www.odoo.com/documentation/20.0/applications/services/project/project_management/milestones.html)
  * [Odoo Purchase Approvals](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/purchase/manage_deals/approvals.html)
  * [Odoo Google Calendar Integration](https://www.odoo.com/documentation/20.0/applications/general/integrations/google_calendar.html)
  * [Odoo Mobile Applications Documentation](https://www.odoo.com/documentation/20.0/applications/productivity/mobile.html)

* **Odoo Official GitHub Source Code (Community Repository):**
  * [`addons/stock`: Inventory and Multi-Warehouse](https://github.com/odoo/odoo/tree/18.0/addons/stock)
  * [`addons/fleet`: Vehicle and Odometer Management](https://github.com/odoo/odoo/tree/18.0/addons/fleet)
  * [`addons/maintenance`: Equipment and Preventive Maintenance](https://github.com/odoo/odoo/tree/18.0/addons/maintenance)
  * [`addons/l10n_id`: Indonesian Accounting and Tax Package](https://github.com/odoo/odoo/tree/18.0/addons/l10n_id)
  * [`addons/l10n_id_efaktur`: Indonesian e-Faktur Tax Invoices](https://github.com/odoo/odoo/tree/18.0/addons/l10n_id_efaktur)
  * [`addons/l10n_id_efaktur_coretax`: Indonesian DJP Coretax XML Integration](https://github.com/odoo/odoo/tree/18.0/addons/l10n_id_efaktur_coretax)
  * [`addons/hr_timesheet`: Timesheet Recording](https://github.com/odoo/odoo/tree/18.0/addons/hr_timesheet)
  * [`addons/sale_timesheet`: Timesheet-Based Invoicing](https://github.com/odoo/odoo/tree/18.0/addons/sale_timesheet)
  * [`addons/hr_attendance`: Attendance and Kiosk Mode](https://github.com/odoo/odoo/tree/18.0/addons/hr_attendance)
  * [`addons/google_account`: Google OAuth2 Authentication](https://github.com/odoo/odoo/tree/18.0/addons/google_account)
  * [`addons/google_calendar`: Google Calendar Synchronization](https://github.com/odoo/odoo/tree/18.0/addons/google_calendar)
