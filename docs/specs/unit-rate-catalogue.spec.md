# Unit-rate catalogue (#2520, map #2516)

A per-contract catalogue of priced work items. Category → class → item; each item has a code, description, unit, work
method and test type, and one rate per **location variant** (names set per contract, e.g. Remote / Non-remote). Rates are
effective-dated. A contract (BOQ) line can be priced from the catalogue at its location's variant rate.

## Requirements (EARS)
- **FR-RC-1** The system shall keep, per project, a set of location variant names that Admin and Finance can add to and nobody can rename or remove.
- **FR-RC-2** The system shall store catalogue items per project with category, class, item code (unique per project), description, unit, work method and test type.
- **FR-RC-3** The system shall store each rate as an append-only row (item, variant, rate, effective-from); the rate in force on a date is the latest row not after it.
- **FR-RC-4** When an amendment is saved with a later effective-from, the system shall add a new rate row and leave every earlier row and every contract line already priced unchanged.
- **FR-RC-5** If an amendment is dated before, or on the same date but with a different figure than, an existing rate for that item and variant, the system shall refuse it.
- **FR-RC-6** Where an item has stage weights, the system shall store them effective-dated, as a set that adds to 100.
- **FR-RC-7** When a contract line is priced from the catalogue, the system shall copy the variant's rate in force on the chosen date into the line's rate and record the item, variant and date.
- **FR-RC-8** The system shall let Admin and Finance import catalogue items from a sheet through the shared import wizard, with one rate column per variant, up to 5,000 rows, and let the person download the rows that were not imported with the reason on each.
- **FR-RC-9** The system shall make the catalogue readable to Admin, Finance, Executive and the contract's Project Manager of the same organization, and writable only through server functions by Admin and Finance.

## Acceptance criteria
- **AC-RC-1** Given Finance on a contract, when they add variants Remote and Non-remote, then both exist, and adding "remote" again adds nothing.  *(pgTAP)*
- **AC-RC-2** Given the variants, when an item is saved with a rate per variant, then one rate row per variant exists; an unknown variant name is refused.  *(pgTAP; unit for sheet validation)*
- **AC-RC-3** Given a catalogue item with Remote = 120, when a contract line is priced at Remote as of a date, then the line's rate is 120.  *(pgTAP)*
- **AC-RC-4** Given a line priced at 120, when Remote is amended to 150 from a later date, then the line still shows 120, the rate on earlier dates reads 120, and an amendment dated before an existing rate is refused. Rates cannot be written outside the server function.  *(pgTAP; unit for `rateAt`)*
- **AC-RC-5** Given stage weights 10/80/10, then they store; weights adding to anything other than 100 are refused.  *(pgTAP; unit)*
- **AC-RC-6** Given a non-Finance role or another organization, when it calls a catalogue write, then it is refused.  *(pgTAP)*
- **AC-RC-7** Given a sheet of 2,000 valid items, when imported, then the preview accepts all and every row is written.  *(unit on the descriptor; the repository call is the same per-row server function pgTAP proves)*
- **AC-RC-8** Given rows refused at preview or failed at write, when the import finishes, then a file of exactly those rows with a reason column can be downloaded.  *(unit)*

## Not in this slice
Staged-progress credit that reads the stage weights.

## Director decision — screen and pricing scope
The catalogue lives in the project's Billing area and lists items, location rates and effective dates. Finance and Admin can import and set a project default location variant; other permitted readers have read-only access. The screen provides loading, empty, error with retry and list states. The BOQ form offers a catalogue item, a location variant defaulted from the project setting but overridable per line, and a pricing date defaulting to today; it previews the rate before saving. Catalogue pricing and line saving commit atomically; a failed attempt keeps the form open so the person can retry without a partially saved line. The ticket's 2,000-item import and location-priced BOQ line remain the done condition.
