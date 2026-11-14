# Odoo stock transfers and project consumption (#1508)

**Owner-approved as written, 2026-11-14. Build is scheduled after the 0.40 release; it is not part of 0.40.** This supersedes the O5 journal-entry premise in the 2026-10-30 route: the 2026-11-10 comment on #1508 controls. Dependencies: #1504, #1512, the task 4 match seam, and a Director-scheduled reset and P0-free database slot. Whether this is a hard pre-14 December go-live promise remains an owner decision, not a prerequisite for reviewing this draft.

## Intent and boundaries

A keeper moves received material between warehouses or issues it to a project and its BoQ work item; Finance can trace the ERP movement and its valuation without a second project cost. PMO owns operational intent, authorization, work-item attribution and immutable audit identity. Odoo owns connected inventory quantity and valuation; its native project analytic cost is authoritative. Existing standalone history remains readable under ADR-0097's ownership epoch. No Odoo customization, client-calculated stock-out value, parallel project journal, or journal fallback is included in this draft.

**Director decision, 2026-11-14:** native path only. If `project_stock_account` is missing or the selected operation type has analytic costs disabled, refuse connected project issues before an ERP write and tell the administrator exactly which module to install or flag to enable. Refuse when required mappings or their verification are unavailable; do not guess on a verification error. Standalone PMO stock remains usable. No journal fallback is planned or built in this slice; consider a separate, reviewed slice only if an installation cannot enable the module. This narrows the fallback instruction in the #1508 comment.

## Observations

- **OBS-OSP-001.** The #1508 design comment and corrected #1484 finding identify Odoo Community 19/20 `project_stock_account` as the native project-cost route. The 20.0 [operation type source](https://github.com/odoo/odoo/blob/20.0/addons/project_stock_account/models/stock_picking_type.py) defines `analytic_costs`; the [move source](https://github.com/odoo/odoo/blob/20.0/addons/project_stock_account/models/stock_move.py) reads the picking project and filters analytic creation by that flag. A source read is not a bed proof of a specific installation or valuation configuration.
- **OBS-OSP-002.** ADR-0097 proposes an ownership swap at the stock posting seam, refuses employment with draft documents, and keeps ERP posting state in a side mirror. The existing inventory spec requires a project and same-project work item for issues, one-step transfers, and keeper authorization.
- **OBS-OSP-003.** ADR-0058/0059 require a durable command and safe uncertain-outcome recovery. An ERP stock operation's actual recovery identity and validation behavior must be proven on the supported bed before implementation can rely on them.

## Requirements

- **FR-OSP-001.** When an administrator prepares connected stock, the system shall verify that `project_stock_account` is installed and that the selected, company-scoped operation type has `analytic_costs` enabled; it shall also verify the mapped project and required mappings before an issue.
- **FR-OSP-002.** While a required capability or mapping is absent, ambiguous, stale or unreadable, when a user requests a project issue, the system shall refuse the write and identify the setup condition; it shall not issue a fallback journal.
- **FR-OSP-003.** When an authorized keeper posts a transfer, the system shall send one corresponding ERP movement between mapped locations and retain its ERP identity and actual state in the PMO side mirror.
- **FR-OSP-004.** When an authorized keeper posts an issue, the system shall retain the PMO project and same-project work item and submit the ERP transfer with the mapped `project_id` on the verified operation type; it shall not create another project-tagged journal for that consumption.
- **FR-OSP-005.** When Odoo confirms a movement, the system shall read its authoritative completed quantity and valuation and associate those with the PMO document and work item; it shall expose pending, held, failed and stale states rather than invent a value or report completion prematurely.
- **FR-OSP-006.** When a response is lost or a worker restarts, the system shall recover the same intent through the durable outbox, adopt only a uniquely proven corresponding ERP movement, and hold an ambiguous outcome without reissuing it.
- **FR-OSP-007.** When inventory ownership changes to connected, the system shall refuse the change if any stock document is draft and shall preserve prior standalone history and the new ERP-owned epoch.
- **FR-OSP-008.** When a user requests an issue or transfer, the system shall enforce existing keeper, organization, company, project and work-item checks server-side before writing; impersonation shall not confer write authority.
- **FR-OSP-009.** When reconciliation detects missing, duplicate, differing or incomplete ERP evidence, the system shall surface the exception with its source identity and shall not silently overwrite it as a successful posting.
- **NFR-OSP-001.** The command identity shall be stable per stock document, serialize concurrent attempts and remain auditable; a claim fence alone shall not be treated as proof that an external write did not occur.
- **NFR-OSP-002.** Data and service writes shall enforce the org and ERP-company seam; mirror data shall have RLS and restricted write grants, with indexed org/document lookups and a reversible migration.
- **NFR-OSP-003.** The whole-ledger comparison shall account for ERP-native analytic cost and any related accounting lines so the same issue contributes project cost once. A bed proof must establish the actual valuation and analytic basis; unsupported valuation configurations are held.

## Acceptance and owning proof

Each test owns its AC at the lowest layer that proves it; bed tests are required for real Odoo semantics.

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-OSP-001 | Given a missing module, disabled flag or failed capability read, when an issue is requested, then it is refused before any ERP write and setup explains the condition. | unit (adapter boundary) |
| AC-OSP-002 | Given a keeper and mapped stock, when a warehouse transfer completes, then its two locations, completed quantity and ERP identity reconcile in PMO. | Odoo bed integration |
| AC-OSP-003 | Given received stock and an enabled project operation type, when a keeper issues it to a mapped project and work item, then the completed ERP movement and native analytic cost reconcile to PMO and the whole-ledger comparison finds one project cost and no additional project journal. | Odoo bed integration |
| AC-OSP-004 | Given a lost response after an ERP write, when recovery runs concurrently or repeatedly, then one proven movement is adopted; ambiguous evidence holds without another write. | unit (recovery interleavings) |
| AC-OSP-005 | Given a draft stock document, when connected inventory is employed, then the ownership change is refused and existing history remains intact. | pgTAP |
| AC-OSP-006 | Given a non-keeper, foreign organization, foreign company or mismatched project/work item, when a stock write is attempted, then the server refuses it without an ERP command. | pgTAP |
| AC-OSP-007 | Given incomplete or differing ERP evidence, when reconciliation runs, then the document remains visibly pending or held with its exception, not falsely completed. | unit (mirror state) |

## Review and verification conditions

Before build, the Director must review the draft, verify the task 4 match seam contract, and obtain owner spec sign-off. The Director schedules the reset and P0-free database slot. The eventual money slice ships alone with spec, quality and security reviews, targeted pgTAP, mutation proof, real-bed verification and whole-ledger comparison. It must not proceed on an unproven recovery anchor or unsupported Odoo valuation/operation configuration. No production promotion is implied.
