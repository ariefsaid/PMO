# Spec: Printable purchase order with authorised-to-collect line (#2688)

**Status:** accepted. IDs `FR-POP-###`, `NFR-POP-###`, `AC-POP-###`. Plan: `docs/plans/2026-11-21-purchase-order-print.md`. Role contract: `.claude/agents/implementer.md` (UI parts: `ui-implementer.md`). Map #2516 (contractor field operations by 15 Dec 2026). Builds on printable delivery note (#2687, migration 1420) and procurement record tables (#0035, #0015). Reuses the shared print helper components (`pmo-portal/src/components/print/*`).

## Job story

When a purchase is made, I want a printed order naming who may collect, so the vendor releases goods to the right person.

## Context and boundary

- In contract- and project-based field operations, when a purchase order is issued to a vendor or supplier, physical collection at the supplier's warehouse or depot requires proof of authorisation. Vendors will not release goods without a signed order naming who is authorised to collect on behalf of the organisation.
- This ticket delivers a browser-printable purchase order view that renders PMO's standard printable document layout, produces a physical paper document or PDF via the browser's native print engine, and includes an explicit **authorised-to-collect** line.
- **Generic for contract-based organisations**: Every item is a setting or data the client fills in; no hard-coded client names or bespoke client processes.
- **Fences**:
  - Reuses the shared print components added by the delivery note (`PrintDocument`, `PrintHeader`, `PrintTable`, `PrintSignatureBlocks`, `PrintActionBar`) without breaking or altering delivery note behavior.
  - Terminology: Does not touch `org_terminology` term-key check constraint unless a new term is strictly needed (none needed; standard "Purchase order" terms exist).
  - Existing organisations must observe zero changes unless the client explicitly enables the setting (`print_enabled` default `false`).
  - Client-entered lists (named collectors and signature blocks) are strictly bounded in count and length in the database.

## Settings the client controls

1. **Feature enablement** (`print_enabled`, boolean, default `false`): Guarantees existing organisations see no workflow changes unless explicitly enabled.
2. **List of named collectors** (`authorised_collectors`, text array, default empty): The organisation's authorised personnel who may collect goods from suppliers. Bounded to a maximum of 50 entries, each 1–100 characters.
3. **Signature blocks** (`signature_blocks`, text array, default `['Prepared by', 'Approved by', 'Vendor acceptance']`): The signing blocks printed at the bottom of the order. Bounded to a maximum of 10 entries, each 1–80 characters.

## Requirements (EARS)

### Document generation and print view
- **FR-POP-001** Where purchase order printing is enabled for the organisation, the system shall provide an action to print a purchase order for any purchase order row in the procurement ledger.
- **FR-POP-002** While purchase order printing is disabled (the default), the system shall not display print purchase order actions in procurement views.
- **FR-POP-003** While purchase order printing is disabled, any direct navigation to the purchase order print route shall display a clear notice that purchase order printing is not enabled.
- **FR-POP-004** The printable purchase order shall display:
  - Organisation name
  - Document title ("Purchase Order" / "Pesanan Pembelian")
  - Document number (the PO number, e.g. `PO-2026-001`)
  - Order date and procurement reference code
  - Vendor / supplier company name
  - Project name and code
  - Work order attribution (if attributed)
  - Currency and financial amounts
- **FR-POP-005** The printable purchase order shall display a prominent **Authorised to collect** line:
  - Where the organisation has configured named collectors in settings, the line shall display the authorised collector names.
  - The print view shall allow the user to select a specific collector from the client's configured named list or display all configured collectors.
  - Where no named collectors are configured, the line shall provide an open underline for manual wet-ink entry on paper.
- **FR-POP-006** The printable purchase order shall render a line items table listing line number, item description, quantity, unit rate, total amount, and currency, followed by an order total summary.
- **FR-POP-007** The printable purchase order shall render physical signature blocks at the foot of the document (configured via organisation settings), providing dedicated boxes for signature, printed name, and date.
- **FR-POP-008** When the user triggers print from the action bar, the system shall invoke `window.print()` with `@media print` stylesheets that suppress screen chrome, action bars, and avoid page-break splitting across line items and signature blocks.

### Settings and client controls
- **FR-POP-009** The system shall store organisation-level purchase order print settings in `public.purchase_order_settings`:
  - `org_id` (`uuid primary key`, references `organizations(id)`)
  - `print_enabled` (`boolean not null default false`)
  - `authorised_collectors` (`text[] not null default array[]::text[]`)
  - `signature_blocks` (`text[] not null default array['Prepared by', 'Approved by', 'Vendor acceptance']`)
  - `updated_by` (`uuid references profiles(id)`)
  - `updated_at` (`timestamptz not null default now()`)
- **FR-POP-010** The database shall enforce bounds on client-entered lists:
  - `authorised_collectors`: At most 50 elements; each non-empty string between 1 and 100 characters.
  - `signature_blocks`: At most 10 elements; each non-empty string between 1 and 80 characters.
- **FR-POP-011** The system shall allow only users with the `Admin` role to update purchase order print settings via a security-definer RPC `po_set_print_settings`. Non-Admins shall be refused with `PO_ADMIN_ONLY`.
- **FR-POP-012** The system shall record an audit log entry on every change to purchase order settings.

## Non-functional requirements

- **NFR-POP-001** Multi-tenant security: Tenant isolation enforced via RLS and triggers (`org_id` never sent by client; `(select auth_org_id())` scoping).
- **NFR-POP-002** Responsive UI: Usable on phone (320px) and desktop; cleanly formatted on print (A4 / Letter).
- **NFR-POP-003** Accessibility: Semantic table headers, proper ARIA labels, keyboard accessible print trigger, WCAG AA compliance, and `DESIGN.md` tokens.
- **NFR-POP-004** Localization: Complete English and Bahasa Indonesia catalogues for all settings, labels, and states.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-POP-001 | Given an organisation with purchase order printing enabled, when viewing a purchase order in the procurement ledger or detail, then the "Print purchase order" action is available. | Unit |
| AC-POP-002 | Given an organisation where purchase order printing is disabled (default), when viewing procurement details, then no print purchase order action is displayed. | Unit |
| AC-POP-003 | Given an organisation with purchase order printing disabled, when navigating to the print view, then a disabled state notice is rendered with a back action. | Unit |
| AC-POP-004 | Given an organisation with configured named collectors, when the printable purchase order is rendered, then the "Authorised to collect" line displays the named collectors. | Unit |
| AC-POP-005 | Given the purchase order print view with configured collectors, when selecting a specific collector from the list, then the "Authorised to collect" line updates to display that collector. | Unit |
| AC-POP-006 | Given an organisation with no named collectors configured, when viewing the printable purchase order, then the "Authorised to collect" line displays an open entry line. | Unit |
| AC-POP-007 | Given a purchase order with items, vendor, project, and attribution, when rendered in the print view, then header metadata, line items table, order total, and signature blocks are displayed. | Unit |
| AC-POP-008 | Given the print view, when print media is applied, then screen-only chrome is suppressed and signature blocks avoid page-break splitting. | Unit |
| AC-POP-009 | Given an Admin updating purchase order print settings via `po_set_print_settings`, when valid parameters are passed, then settings are saved and audit-logged in the database. | pgTAP |
| AC-POP-010 | Given a non-Admin user calling `po_set_print_settings`, then the database RPC refuses with `PO_ADMIN_ONLY` (42501). | pgTAP |
| AC-POP-011 | Given an attempt to save more than 50 collectors or an entry exceeding 100 characters, then the database constraint refuses with invalid parameter error. | pgTAP |
| AC-POP-012 | Given a user in another organisation, when attempting to read or update `purchase_order_settings`, then RLS policies strictly isolate and refuse cross-org access. | pgTAP |
| AC-POP-013 | Given English and Bahasa Indonesia language preferences, when viewing the purchase order print view and settings, then all strings are localized in both languages. | Unit |
