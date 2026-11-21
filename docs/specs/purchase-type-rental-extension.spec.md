# Spec: Purchase type and a guided rental extension (#2697)

**Status:** draft for Director review. IDs `FR-PTR-###`, `NFR-PTR-###`, `AC-PTR-###`, `OQ-PTR-###`. Plan: `docs/plans/2026-11-21-purchase-type-rental-extension.md`. Map #2516, target 15 December 2026, size S. Rulings that bind this spec: OD-SCOPE-2 (no client process in code; lists are data), OD-SCOPE-12 (rental extension step pulled forward). Stacked-on by #2700 (monthly equipment and service plan turned into rental orders).

## Job story

When I raise a request, I want to say goods, service or rental, and to extend a rental with its own order, so each follows the right path.

## Context and boundary

- A purchase is a **procurement case** (`procurements`, ADR-0033). It already carries `is_subcontract` (0449), a flag set at creation and never changed; the purchase type follows the same shape.
- **The purchase types are a list the organisation owns** (OD-SCOPE-2). PMO ships no fixed type in code. When an Admin turns the feature on, three general starter rows (goods, service, rental) are written as the organisation's own data; the Admin renames, adds, retires or re-flags them. Code never compares a type's name: behaviour hangs off a property of the type row, `is_rental` ("the purchase covers a rental period").
- Money and approval do not change. A rental extension is an ordinary new purchase (Draft) that goes through the normal request, approval and spend-routing path; nothing is auto-approved and no amount on the original changes.
- A purchase with no type behaves exactly as today. With the feature off, no screen, field or rule differs.

## Settings (every one is organisation data)

| Setting | Where | Default |
|---|---|---|
| Purchase types turned on | `org_purchase_type_settings.enabled` | off |
| The purchase types: name (English, Bahasa Indonesia), `is_rental`, order, active | `purchase_types` rows | none until turned on; then three starter rows (goods, service, rental) the Admin may edit |

## Default-off statement

An existing organisation has no `org_purchase_type_settings` row and no `purchase_types` rows. Its create form shows no type field, its purchase screen shows no type chip and no "Extend rental" action, and every existing RPC treats a missing type as today. New columns on `procurements` are nullable and unset for every existing row. No existing test is edited.

## Requirements (EARS)

**Types as data**
- FR-PTR-001 The system shall store an organisation's purchase types as rows with a name per language, an `is_rental` flag, a position and an active flag; the code shall never branch on a type's name.
- FR-PTR-002 While purchase types are off for an organisation, the system shall refuse every write that sets a type, rental period or extension link, and shall show no type affordance.
- FR-PTR-003 When an Admin turns purchase types on and the organisation has no types, the system shall create the three starter rows in the same transaction; turning it off keeps the rows and hides the feature. Only an Admin may change the setting or the rows (server-enforced).
- FR-PTR-004 A type that purchases use shall be retired (inactive), never deleted; an inactive type cannot be chosen for a new purchase and still shows on old ones. Names are unique per organisation, case-insensitive, 1 to 60 characters.

**Raising a purchase with a type**
- FR-PTR-005 Where purchase types are on, the create form shall offer the active types; choosing none is allowed and behaves as today.
- FR-PTR-006 When the chosen type is rental, the form shall require a rental period (from and to dates, to not before from). A purchase of a non-rental type or no type shall carry no rental period (server-enforced).
- FR-PTR-007 The type and rental period are set when the purchase is created through `create_procurement_with_items` (the single creation path; #2700 uses it) and change only through the extension step; a direct update of them is refused for every role including Admin.
- FR-PTR-008 The purchase screen shall show the type and, for rental, the period. **Shipped.**
- FR-PTR-008b The purchase list shall filter by type, and the Procurement list shall link an Admin to `/purchase-types/settings`. **Deferred, not in this branch:** the ticket's "What ships" (a purchase type and a guided rental extension) does not require them. The settings screen is reached at `/purchase-types/settings`; the Administration area is a set of tabs, not a list of settings screens, so no link was added there.

**Guided rental extension**
- FR-PTR-009 Where a purchase is of a rental type and is not Cancelled or Rejected, the system shall offer a guided "Extend rental" step: new period (defaulting to the day after the current end, one period long), vendor, project, budget category and lines carried over and editable.
- FR-PTR-010 When the step is confirmed, the system shall in one transaction create a NEW purchase in Draft, of the same type, requested by the caller, linked to the original, carrying the new period. Exactly one purchase is created per confirmation and the call is idempotent on the client-generated id.
- FR-PTR-011 The new purchase shall take the ordinary request, approval and spend-routing path; no status, approval or amount is copied from the original, and the original is not changed.
- FR-PTR-012 The system shall refuse an extension whose period starts on or before the original's end, or overlaps another extension of the same original (server-enforced). Extending an extension is allowed and chains from that extension's own period.
- FR-PTR-013 The new purchase and the original shall each show the link to the other (original shows its extensions; extension shows what it extends), with periods.
- FR-PTR-014 Only a user who can create purchases and see the original may extend it; the original and new purchase share the organisation and the caller's org is never taken from the client.
- FR-PTR-015 The extension and its type/period/link changes shall appear in the record history.

**For plan-approval callers (#2700)**
- FR-PTR-016 The system shall expose one server path to create a purchase of a rental type with a period (`create_procurement_with_items` with `purchase_type_id`, `rental_from`, `rental_to`) and one to extend (`extend_rental_procurement`), both resolving the rental type by its `is_rental` flag so a caller supplies a type id it read from the organisation's list, never a name.

## Non-functional requirements
- NFR-PTR-001 `org_id` seam, RLS and FORCE RLS on every new table, `org_id` stamped by the server; RLS helpers wrapped in `(select ...)`.
- NFR-PTR-002 No client role holds write grants on the new tables; writes go through security-definer RPCs (ADR-0019).
- NFR-PTR-003 Phone (390 px) and desktop usable, `DESIGN.md` tokens, shared form primitives, English and Bahasa Indonesia strings for every new label.
- NFR-PTR-004 Reversible migrations with rollback files; rollback refused while typed purchases exist.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-PTR-001 | Given an organisation with the feature off, when any role sets a type, period or link through the RPC, then refused; and a plain create without them is unchanged. | pgTAP |
| AC-PTR-002 | Given an Admin turns the feature on in an organisation with no types, then three starter rows exist, flagged by data (one `is_rental`); a second turn-on adds none. | pgTAP |
| AC-PTR-003 | Given a non-Admin, when they change the setting or a type row, then refused; another organisation's Admin likewise (mutation check: drop the role test, go red). | pgTAP |
| AC-PTR-004 | Given a type renamed to any word, when a purchase of it is created with a period, then rental rules still apply because the flag, not the name, decides (a renamed non-rental type named like the starter gets no rental rules). | pgTAP |
| AC-PTR-005 | Given a rental type, when a purchase is created without a period, or with to before from, then refused; given a non-rental type or none, when a period is supplied, then refused. | pgTAP |
| AC-PTR-006 | Given a typed purchase, when any role including Admin updates its type, period or link directly, then refused. | pgTAP |
| AC-PTR-007 | Given an inactive type, when used for a new purchase, then refused; old purchases keep it. A type in another organisation is refused. | pgTAP |
| AC-PTR-008 | Given a rental purchase, when extended with a later period, then exactly one new Draft purchase exists, same type, requester = caller, linked, original unchanged; retrying the same id creates no second. | pgTAP |
| AC-PTR-009 | Given the original's end date, when the extension starts on or before it, or overlaps a sibling extension, then refused (mutation check: remove the order rule, go red); extending an extension from its own end is accepted. | pgTAP |
| AC-PTR-010 | Given a Cancelled or Rejected rental, or a non-rental purchase, when extended, then refused. | pgTAP |
| AC-PTR-011 | Given a new extension, when it advances, then it needs the normal approval and spend routing; no approval or amount is copied (an extension over the approval threshold cannot skip routing). | pgTAP |
| AC-PTR-012 | Given a user in another organisation, when they read types or extend the original, then nothing visible and refused. | pgTAP |
| AC-PTR-013 | Given the feature off, when a user opens create and a purchase, then no type field, chip, filter or Extend action appears. | Unit |
| AC-PTR-014 | Given the feature on, when the user picks a rental type, then the period fields appear and are required; a non-rental type hides them. | Unit |
| AC-PTR-015 | Given a rental purchase, when the user opens Extend rental, then the new period defaults to the day after the end, lines carry over and a refusal from the server shows on the form. | Unit |
| AC-PTR-016 | Given an Admin on the purchase types screen, when they rename, add, flag rental, retire or reorder, then the list updates; a non-Admin does not see the screen. English and Bahasa Indonesia strings exist. | Unit |
| AC-PTR-017 | Given a requester on a phone, when they raise a rental purchase and extend it, then the new purchase is a separate Draft linked both ways. | E2E (one journey) |

## Mutation checks (to be run by the Director on the integration branch; written, not run by the builder)
Each breaks one rule in the database, runs the named pgTAP file, and must turn red; restoring the rule must turn it green again.
| ID | Break | File that must go red |
|---|---|---|
| AC-PTR-003 | Remove the `auth_role() is distinct from 'Admin'` refusal from `set_purchase_types_enabled`, `upsert_purchase_type` and `set_purchase_type_active` | `supabase/tests/purchase_types.test.sql` (the two non-Admin refusals) |
| AC-PTR-004 | In `guard_procurement_purchase_type`, replace `coalesce(v_type.is_rental, false)` with `coalesce(lower(v_type.name) = 'rental', false)` | `supabase/tests/procurement_purchase_type.test.sql` (the two AC-PTR-004 cases and the period cases) |
| AC-PTR-009 | Delete the `if new.rental_from <= v_parent.rental_to` refusal in `guard_procurement_purchase_type` | `supabase/tests/rental_extension.test.sql` (the PTYPE_EXT_ORDER case) |

## Errors
| Condition | Result |
|---|---|
| Feature off | Refused: purchase types are not turned on |
| Rental without period / period on non-rental | Field error on the period |
| Extension not after original end, or overlapping | Refused naming the earliest allowed start |
| Original cancelled, rejected, or not rental | Refused: only a live rental can be extended |
| Retired or foreign type | Refused: type not available |

## Open questions (defaults taken; Director may overrule)
| ID | Default | If wrong, what breaks |
|---|---|---|
| OQ-PTR-1 | Type and period are fixed at creation; correcting a wrong type means a new purchase (matches `is_subcontract`). | A requester who picked the wrong type in Draft must re-raise it. |
| OQ-PTR-2 | An extension starts strictly after the original's end and may not overlap siblings. | A client that renews with an overlap day cannot record it. |
| OQ-PTR-3 | One rental period per purchase (single from/to), not per line. | A purchase renting different items for different periods needs separate purchases. |
| OQ-PTR-4 | Extension lines default to a copy of the original's lines and are editable; amount comes from the new lines only. | Users re-key lines if they differ. |

## Delivery checklist
- [ ] Glossary: purchase type, rental purchase, rental extension.
- [ ] Server slice with pgTAP and mutation checks, then UI, then one e2e journey.
