# Cleared-for-site checklist per person — #2707 (map #2516, OD-SCOPE-12)

**Job story.** When someone is being mobilised, I want a checklist of what they still need, so only cleared people go to site.
**Success:** a records keeper opens a person, sees each item the organisation requires with its date done, expiry and state, and sees one cleared / not cleared answer that the database computes. Sourcing and interviewing stay outside (OD-SCOPE-14).

## Scope and decisions
- **Person** = the existing `people` register (0970, 1042). No parallel entity. Archived people are excluded.
- **Items are organisation data** (OD-SCOPE-2). The organisation defines its own list: name, required yes/no, order. PMO ships no item names; the empty state gives generic guidance only.
- **Per-person state** is one row per (person, item): date done, optional expiry date, optional short note. No row = not done.
- **Cleared** = the organisation has at least one live required item, and for every live required item the person has a row with a date done and either no expiry or an expiry on or after today. Computed in the database by one function; the roster and other features read it. An organisation with no required items has nobody cleared (nobody is "cleared" by an empty list).
- **Dates** use the organisation's today (`field_org_today`, 1110), not the browser date.
- **Access** (today's roles; HR roles arrive with #2709 and extend it later). Read: Admin, Project Manager, Finance, Executive. Write person state: Admin, Project Manager. Define items: Admin. Medical-type items get no special handling beyond this; item notes are short free text and the UI states they are not for medical detail. RLS is the authority; `can()` is UX only.
- **Roster blocking is left out.** No existing screen or rule changes; nothing blocks an uncleared person. A later ticket can read the function behind a setting.
- **Setting added: `organizations.clearance_checklist_enabled`, default false** (owner ruling, #2707 brief). An Admin turns it on in Administration > People (existing org settings area, en + id label). Off: Administration shows no Clearance tab, the person record shows no link, and both routes show a not-enabled state. On: the tab, the routes and the person-record link appear (for roles that may read). The item list itself is organisation data.
- **New surfaces:** an Administration section "Clearance" (route `/administration/clearance`: items and a people-by-state list) and a per-person checklist (`/administration/clearance/:personId`), both behind the setting.
- **Archive, not delete** (ADR-0018): items archive; a removed done-state is cleared by deleting its row (state, not a record of record).

## Requirements (EARS)
- **FR-CLR-001** When an Admin adds an item with a name, the system shall create it in their organisation, required by default, with a unique live name (case-insensitive).
- **FR-CLR-002** When an Admin edits, reorders or archives an item, the system shall apply it; an archived item leaves every checklist and the cleared computation.
- **FR-CLR-003** When an Admin or Project Manager records a done date (and optional expiry or note) for a person and item, the system shall save one row per person and item, replacing an earlier one.
- **FR-CLR-004** If the expiry is before the done date, the system shall refuse it.
- **FR-CLR-005** The database shall compute cleared per person by the rule above, and a per-item state of `done`, `expiring` (expires within the organisation's smallest document warning day count, 0970), `expired`, or `missing`.
- **FR-CLR-006** While an item is not required, it shall show on the checklist but not affect cleared.
- **FR-CLR-007** Where the user may not write, the system shall hide the edit controls and the server shall refuse the write.
- **FR-CLR-008** The system shall never return another organisation's items, states or people, and shall refuse a person or item from another organisation.
- **FR-CLR-009** While no items exist, the screen shall explain how to start (generic words), with no hard-coded item names.
- **FR-CLR-011** While the setting is off, the system shall show no Clearance tab or person-record link and the routes shall show a not-enabled state; only an Admin can change the setting.
- **FR-CLR-010** The screens shall work on phone and desktop, in English and Bahasa Indonesia.

## Acceptance criteria
- **AC-CLR-001** Admin adds an item; a duplicate live name is refused (23505); Engineer's insert is denied; Project Manager's item insert is denied. *(pgTAP)*
- **AC-CLR-002** Admin and Project Manager upsert a person's state; Finance and Executive read but their write is denied; Engineer reads nothing. *(pgTAP)*
- **AC-CLR-003** Given two required items, then cleared is false with one done, true with both done and unexpired, false once one expiry passes, false with no required items. A non-required item never changes it. An archived required item is ignored. *(pgTAP)*
- **AC-CLR-004** Given an expiry inside the warning window, the item state is `expiring`; past, `expired`; no row, `missing`. *(pgTAP)*
- **AC-CLR-005** Expiry before done date is refused. *(pgTAP)*
- **AC-CLR-006** A second organisation's items, states and people are invisible and unwritable; a cross-organisation person or item id is refused. *(pgTAP)*
- **AC-CLR-007** Mutation check: break the cleared rule (ignore expiry) and the write-role rule (allow Engineer); AC-CLR-002/003 go red; restore. *(pgTAP + recorded lines)*
- **AC-CLR-008** The repository sends no `org_id`; `can()` on `clearanceItem` and `personClearance` matches the roles above and is view-only under view-as. *(Vitest)*
- **AC-CLR-009** The checklist screen lists items with state, saves a done date, shows the cleared badge, hides edits for a read-only role, shows the generic empty state with no items. *(Vitest/RTL)*
- **AC-CLR-010** No English-only strings in Bahasa Indonesia. *(Vitest)*
- **AC-CLR-011** An Admin defines an item, opens a person, marks it done, and sees Cleared. *(Playwright, one journey)*
- **AC-CLR-013** The setting defaults to off; an Admin turns it on; a non-Admin cannot; off, the routes show not-enabled and fetch no checklist. *(pgTAP for default and write role; Vitest for the screens)*
- **AC-CLR-012** Existing screens, routes and `can()` kinds are unchanged; existing tests pass untouched. *(CI regression; touched-file vitest)*

## Review
Owner rulings applied: gated tab and routes by the setting; no required items means nobody is cleared; Project Manager records state, only Admin defines items.
