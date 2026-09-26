# Enterprise UI coherence brief

**Audience and job.** A RIS organization Admin must be able to enter PMO, understand what is ready, connect the services their organization uses, and complete work without guessing which part of the app owns an action. Later members need the same predictable navigation and interaction rules in their own roles. This brief guides the current `dev` UX program; it does not claim that the work is shipped or that the RIS service handshakes have been proved.

## Design authority

- Preserve `DESIGN.md`'s calm, content-first visual system, type, tokens, and canonical list/record molecules. The improvement is structural and behavioral. Use the Impeccable and UI UX Pro Max principles for discoverability, accessible controls, task feedback, and responsive density. Apply Taste to remove generic clutter and motion, while the project's existing design tokens remain authoritative.
- Keep four locations distinct: **primary rail = work destinations**; **account menu = personal identity, preferences, theme, sign out**; **Administration = organization setup and governance**; **record pages = actions on that record**. A control appears in the place that owns its data and consequence.
- Preserve existing permission, entitlement, source-of-truth, and language behavior while improving where a user reaches it. A UI change is not a license to broaden access or to call a connection operational before a data-carrying live check.

## Work packages, in user order

1. **Account and preferences.** One responsive identity menu opens Profile & preferences, chooses Light/Dark, and signs out. Demo-only role preview is clearly separated from normal preferences. Remove the personal settings rail entry and redundant header actions. Keep the direct profile route and its language persistence.
2. **Administration information architecture.** Give Users, Organization integrations, Accounting setup, and Credits independent navigation within Administration. Retain each existing component and its current authorization. A RIS Admin can move between setup tasks without scrolling past unrelated tables.
3. **Integration ownership and readiness.** Label personal Microsoft 365 connection separately from organization connections. Each connection surface explains who acts, the current state, the next permitted action, and the result that would prove usable data. Show disconnected, connecting, connected, degraded/reconnect, and error states truthfully; do not use a generic success state as proof of a working sync.
4. **Mobile list tools.** On narrow screens, keep search, current view, and active filters available while grouping secondary filters and import/export actions behind a clear control. The list's first record should be reachable without traversing a full desktop toolbar. Fix blank or ambiguous filter choices.
5. **List-to-record journeys.** Verify the established `DESIGN.md` record-open rule across modules: a record has one canonical URL, a predictable Back/breadcrumb path, and a stable return to the list's filter and position. Actions remain at the record or row whose state they change.
6. **Personal locale completion.** The existing owner decision calls for language, number format, and timezone to follow organization defaults with personal overrides. Add only the missing personal UI after confirming repository and formatting behavior; changes must be reflected in labels, dates, and money together, with safe inherited values.
7. **Cross-route state and accessibility pass.** For the routes in this program, verify loading, empty, error, permission, pending, and success states; keyboard focus and Escape behavior; screen-reader names; English and Bahasa copy; light and dark contrast; desktop and 390px phone layout. Each confirmed finding graduates to an owning unit, pgTAP, or curated e2e test per `docs/qa-portfolio.md`.

## Enterprise interaction contracts to audit across the app

The seven packages above fix known friction. The following contracts make the result coherent across modules. The command palette, shared `ListPage`/`RecordHeader`, modal dirty-state handling, and many retry/empty states already exist; audit their coverage and behavior before filing new work. A failed user journey, not a stylistic preference, is the trigger for a code issue.

| Contract | User-visible proof | Priority for RIS |
|---|---|---|
| **Find and orient** | A user can tell which workspace, module, record, and tab they are in; the active rail item, heading, breadcrumb, browser URL, command-palette result, and Back destination agree. Direct links and refresh resolve to the same place, including when the role cannot act. | High |
| **Explore a list** | Search, filters, sort, view, count, and any selection are understandable together. A zero-item collection differs from zero matches. Opening a record and returning preserves the useful list context; a phone reaches records before secondary controls dominate the viewport. | High |
| **Finish or recover a task** | Required fields and consequences are clear before submit. Pending writes prevent accidental repeats; success names the changed record and next useful action. Validation and service failures stay beside the form with a retry or remedy, preserving entries. Leaving a dirty flow asks before discarding where supported. | High |
| **Trust connected data** | A connected account, an active integration, and a successful data transfer have distinct labels. Where the product has the evidence, show source, last successful update, pending/degraded state, and a specific next action; stale or unavailable data must never appear as a fresh empty result. | High |
| **Start with an empty RIS organization** | A new RIS Admin can see an ordered, task-based route from organization setup to first usable project. Each step links to its owning screen and derives completion from real state; the UI does not imply that inviting members or completing a legal flow is required for this internal Admin test. | High, after the underlying readiness signals are confirmed |
| **Work across roles and devices** | Admin, project manager, finance, approver, and read-only journeys expose only relevant actions and explain disabled or unavailable ones. Keyboard, screen reader, zoom, narrow phone, light/dark, and English/Bahasa users get equivalent task outcomes. | High for RIS Admin; expand by role before broad access |
| **Use one vocabulary** | Navigation, page titles, create/edit verbs, status labels, date and money formats, and integration ownership use the same terms across modules. Canonical nouns and status variants follow `DESIGN.md`; do not add a second visual language. | Continuous |

**Audit order.** Prove the RIS Admin setup, integration, project, and return journeys first. Then sample the same contracts on the other primary routes and roles. Record the route, role, viewport, state, expected outcome, observed outcome, and owning acceptance test for each confirmed finding. Prefer repairing the shared molecule when multiple routes fail the same contract. Avoid adding a new dashboard, guided tour, notification center, or global setting merely to satisfy this checklist; each needs its own demonstrated job and owner decision.

**Confirmed list-return finding.** Projects, Sales, Procurement, Companies, Contacts, and Meetings hold search/filter choices in local page state, while their detail return links go to a bare list URL. A user who narrows a list, opens a record, and returns loses the working set. The follow-up should establish one URL-backed search/filter contract and prove that journey on each adopting module. Preserve the canonical project record URL. Its structural breadcrumb can remain under Projects on desktop; a contextual return to Sales Pipeline should appear only when the user entered from Sales, carrying that list's state. The existing desktop breadcrumb can serve as the Back affordance, while the mobile BackBar remains explicit; reconcile the literal `DESIGN.md` wording when implementing this decision.

## Exit evidence

- Each work package has a focused spec, acceptance criteria, rendered desktop/phone review, and the project's code review and verification gates before its PR lands on `dev`.
- The RIS Admin walkthrough uses a real RIS sign-in and live Microsoft 365 and ERPNext data paths before calling those connections operational. Sample Admin rendering proves layout and navigation only.
- No production promotion is implied by this brief. The repository's per-instance production approval rule remains in force.
