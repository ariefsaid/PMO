# Equipment manager's day — spec

Fix lane from a first-time-person walk of the released build (phone first, organisation language Bahasa Indonesia). One owner for
the whole path: the equipment screen, the machine register, the hours log, status with proof, expiring documents, the rental
invoice check and the availability figures. Reuses the shipped surfaces; adds no new table and no new concept.

Related: `equipment-usage.spec.md` (hours log), `equipment-availability.spec.md` (status, proof, rental check),
`equipment-target-settings.spec.md` (targets), `monthly-equipment-service-plan.spec.md` (plan).

## Requirements (EARS)

- **FR-EQM-001** When a person opens Equipment, the system shall show the list of machines with today's status for each, with the
  hours log, availability, the monthly plan (when on), expiring documents and the register one tap away. The hours log's own deep
  links (week, tab, asset) still open the log.
- **FR-EQM-002** Where the role is Admin or Project Manager (the equipment manager), the system shall let the person add a machine
  (owned or rented) from the Equipment screen, with vendor, rate, basis, currency, start and end on the same form for a rented
  machine, edit a machine's code, name and unit from the register row, and open its rental terms. The database shall allow rental
  terms (add, change rate, end), working hours per day, the availability and use targets and the escalation limit to Admin and
  Project Manager (rental terms also stay with Finance). Costing assignment and stating a reason to include unproven days stay with
  Admin and Finance; the equipment manager reads the invoice check result and its downtime deduction.
- **FR-EQM-003** If a person saves hours for a machine, project and day that another person already holds, the system shall say in the
  reader's language whose entry exists (or that someone else's does, when it is not visible), link to it when the reader may open it,
  and keep what was typed in the cell.
- **FR-EQM-004** When a status is chosen, the system shall take its note and a photo or document (camera first on a phone) in the same
  form and save all of them on one save. After "broken" the page shall say who is told and when. A machine marked down shall be
  marked in the hours picker and logging against it shall ask for confirmation.
- **FR-EQM-005** The hours row shall show its work order and discipline; saving a cell shall confirm it; the submit-week action shall
  sit below the hours and say what happens next and who approves.
- **FR-EQM-006** When the monthly plan is on, the Equipment screen shall link to it; when it is off an Admin shall be shown the plan
  settings by name.
- **FR-EQM-007** Each expiring document shall open its record and offer a renew action (a new, later expiry date and an optional new
  file) to a person who may edit it; dates read in one style; date fields are date pickers.
- **FR-EQM-008** The rental invoice check shall say "Over-billed by …" or "Under-billed by …" (or that the invoice matches) and one
  line on how unrecorded days are counted.
- **FR-EQM-009** The metrics table shall fit a 390 px screen; days before the organisation's first day shall not count as "not
  recorded"; the vendor response time shall use a 24-hour control; each status shall have one line saying what it does to planning.

## Acceptance criteria

| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-EQM-001 | Given machines, when a person opens `/equipment`, then the machine list with today's status shows, and "Hours log" opens the log | Vitest `EquipmentHome.test.tsx`; e2e `JOB-CF-EQ-1` |
| AC-EQM-002 | Given a Project Manager, when they add a rented machine with vendor and rate on one form, then it is saved in one step; when they edit a row, code/name/unit are saved | Vitest `AssetFormModal.test.tsx`; policy `policy.test.ts`; e2e `JOB-E1` |
| AC-EQM-002 | Given a Project Manager, when they call the rental-term functions, then they succeed; an Engineer, an Executive and another organisation's manager are refused | pgTAP `1600_equipment_manager_asset_writes.test.sql` (mutation-checked) |
| AC-EQM-003 (DB) | Given a Project Manager, working hours and targets are accepted; Finance and Engineer are refused | pgTAP `1600_…` |
| AC-EQM-003 | Given another person's entry for the day, when a second person saves, then a sentence names whose entry, links to it, and the typed hours stay | Vitest `EquipmentUsage.test.tsx`; e2e `JOB-CF-EQ-4` |
| AC-EQM-004 | Given a status draft of "broken", when note and photo are added and saved, then status, note and proof are stored and the page says who is told | Vitest `EquipmentHome.test.tsx`; e2e `JOB-CF-EQ-1` |
| AC-EQM-004 | Given a broken machine, when added to the hours log, then it is marked and asks first | Vitest `EquipmentUsage.test.tsx`; e2e `JOB-CF-EQ-4` |
| AC-EQM-005 | Given hours with a work order, the row shows it; submit-week is below the grid with the approver; a saved cell is confirmed | Vitest `EquipmentUsage.test.tsx`; e2e `JOB-CF-EQ-4` |
| AC-EQM-005 (DB) | Given a Project Manager, the invoice check result is readable; stating a reason is refused and stores nothing | pgTAP `1600_…`; Vitest `RentalInvoiceCheck.test.tsx`; e2e `JOB-E4` |
| AC-EQM-006 | Given the plan on or off, the plan or its settings link shows by role | Vitest `EquipmentHome.test.tsx`; e2e `JOB-CF-EQ-6` |
| AC-EQM-007 | Given an expiring document, the row opens its record and offers renew; the date reads in the app style | Vitest `ExpiringDocuments.test.tsx`; e2e `JOB-E8` |
| AC-EQM-008 | Given a check with an invoice, the result says over- or under-billed in words and how unrecorded days count | Vitest `RentalInvoiceCheck.test.tsx`; e2e `JOB-E4` |
| AC-EQM-009 | Given an organisation created on the 10th, days before it are not unrecorded | pgTAP `1601_equipment_metrics_before_org_existed.test.sql` |
| AC-EQM-009 | The response time control offers hours 00–23; each status shows its planning line | Vitest `DateTime24Field.test.tsx`, `EquipmentHome.test.tsx`; e2e `JOB-CF-EQ-1` (390 px) |
