# Spec: Printable delivery note with signature blocks (#2687)

**Status:** accepted. IDs `FR-DNP-###`, `NFR-DNP-###`, `AC-DNP-###`. Plan: `docs/plans/2026-11-21-delivery-note-print.md`. Role contract: `.claude/agents/implementer.md` (UI parts: `ui-implementer.md`). Map #2516 (contractor field operations by 15 Dec 2026). Builds on material requests against a work order (#2524, migrations 1000/1001). Prepares the shared print helper for printable purchase orders (#2688).

## Job story

When approved material moves, I want a delivery note printed from the approved request, so the receiver can sign it on paper.

## Context and boundary

- An approved material request (`status in ('approved', 'fulfilled')`) creates or links to a stock transfer draft. Before, during, or after physical transit, field personnel require a physical paper delivery note (Surat Jalan) that travels with the cargo to be physically signed by the dispatcher, carrier, and receiver.
- This ticket delivers a browser-printable delivery note (rendering PMO's standard layout and producing a PDF / paper document via the browser's native print engine).
- **Not in this ticket**: Print layouts identical to a client's own proprietary stationery or legacy forms (OD-SCOPE-14: outside the proposal).
- **Settings the client controls**:
  1. The document's name, configured through PMO's organisation terminology system (`deliveryNote` term key, defaulting to "Delivery note" in English and "Surat jalan" in Bahasa Indonesia).
  2. The signature block labels (e.g. "Dispatched by", "Delivered by", "Received by"), configured in Material Request Settings.
  3. Feature enablement (`delivery_note_enabled`, default false), guaranteeing that existing organisations see no workflow changes unless explicitly enabled.
- **Print helper reuse**: The print engine components (`PrintDocument`, `PrintHeader`, `PrintTable`, `PrintSignatureBlocks`, `PrintActionBar`) are modular and generic, so the printable purchase order (#2688) reuses the exact same print foundation.

## Requirements (EARS)

### Document generation and print view
- **FR-DNP-001** Where delivery note printing is enabled for the organisation, the system shall provide an action to print a delivery note on material requests that are in `approved` or `fulfilled` status.
- **FR-DNP-002** While a material request is in `draft`, `pending`, `returned`, `rejected`, or `cancelled` status, the system shall not offer or permit delivery note printing.
- **FR-DNP-003** The printable delivery note shall display the organisation name, the document title (resolved from terminology), document number (the request number), request date, needed-by date, work order code and title, project code and name, destination/origin warehouse (if specified), requester name, and any request note.
- **FR-DNP-004** The printable delivery note shall display a line items table listing line number, stock item code, item name/description, approved quantity, unit of measure, and remarks/reasons (such as over-plan justifications).
- **FR-DNP-005** The printable delivery note shall render signature blocks at the bottom of the document with labels configured in the organisation's settings, providing dedicated space for physical signature, printed name, and date.
- **FR-DNP-006** When the user triggers print from the delivery note view, the system shall invoke `window.print()` using an optimized print stylesheet.

### Terminology
- **FR-DNP-007** The document name on the delivery note and associated action labels shall resolve through the organisation terminology system under key `deliveryNote`, defaulting to "Delivery note" / "Delivery notes" in English and "Surat jalan" / "Nota pengiriman" in Bahasa Indonesia.
- **FR-DNP-008** Where the organisation configures custom terminology for `deliveryNote` (e.g. "Goods Issue Note" or "Nota Pengiriman"), the system shall reflect the override in the document title, headers, and action labels.

### Settings and backwards compatibility
- **FR-DNP-009** The system shall maintain organisation settings in `material_request_settings`:
  - `delivery_note_enabled` (`boolean`, default `false`)
  - `delivery_note_signature_blocks` (`text[]`, default `array['Dispatched by', 'Delivered by', 'Received by']`)
- **FR-DNP-010** While `delivery_note_enabled` is `false`, existing organisations shall observe no changes or added action buttons in existing material request pages.
- **FR-DNP-011** The system shall allow only users with the `Admin` role to update delivery note settings via a security-definer RPC (`mrq_set_delivery_note_settings`). Non-Admins shall be refused.

### Print stylesheet and reusable helper
- **FR-DNP-012** The delivery note layout shall provide a browser print stylesheet (`@media print`) that suppresses navigation, rails, action bars, toasts, and buttons, formats pages cleanly for paper and PDF, and prevents table rows and signature blocks from breaking awkwardly across pages (`break-inside: avoid`).
- **FR-DNP-013** The print layout primitives (`PrintDocument`, `PrintHeader`, `PrintTable`, `PrintSignatureBlocks`, `PrintActionBar`) shall be built as reusable components ready for ticket #2688 (printable purchase order with an authorised-to-collect line).

## Non-functional requirements

- **NFR-DNP-001** Multi-tenant security: Tenant isolation enforced via database RLS and triggers (`org_id` never sent by client; `(select auth_org_id())` scoping).
- **NFR-DNP-002** Responsive UI: Usable on phone (320px) and desktop; cleanly formatted on print (A4 / Letter).
- **NFR-DNP-003** Accessibility: Semantic table headers, proper ARIA labels, keyboard accessible print trigger, WCAG AA compliance, and `DESIGN.md` tokens.
- **NFR-DNP-004** Localization: Complete English and Bahasa Indonesia catalogues for all settings, labels, and states.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-DNP-001 | Given an approved or fulfilled material request in an organisation with delivery notes enabled, when viewed in detail, then the "Print delivery note" action is available. | Unit |
| AC-DNP-002 | Given an organisation where delivery note printing is disabled (default), when viewing an approved material request, then no delivery note print action is displayed. | Unit |
| AC-DNP-003 | Given a material request in draft or pending status, when viewed, then no delivery note print action is shown even if the setting is enabled. | Unit |
| AC-DNP-004 | Given an organisation with custom `deliveryNote` terminology (e.g. "Goods Issue Note"), when viewing the delivery note, then the document title reflects the override. | Unit |
| AC-DNP-005 | Given an approved request, when the delivery note is rendered, then it displays organisation name, request number, dates, work order, project, item lines with quantities, and signature blocks. | Unit |
| AC-DNP-006 | Given an Admin updating delivery note settings, when they enable delivery notes and set custom signature labels, then the settings are saved in the database. | pgTAP + Unit |
| AC-DNP-007 | Given a non-Admin user, when calling `mrq_set_delivery_note_settings`, then the database RPC refuses with `MRQ_ADMIN_ONLY`. | pgTAP |
| AC-DNP-008 | Given the delivery note view, when print media is applied, then screen-only chrome is hidden and signature blocks avoid page-break splitting. | Unit |
| AC-DNP-009 | Given the print helper components, when consumed by another document view, then layout, headers, item tables, and signature blocks render reusably. | Unit |
| AC-DNP-010 | Given a user in another organisation, when attempting to read or update delivery note settings, then RLS and RPC boundaries refuse access. | pgTAP |
