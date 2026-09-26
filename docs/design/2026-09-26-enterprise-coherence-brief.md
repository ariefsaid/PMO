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

## Exit evidence

- Each work package has a focused spec, acceptance criteria, rendered desktop/phone review, and the project's code review and verification gates before its PR lands on `dev`.
- The RIS Admin walkthrough uses a real RIS sign-in and live Microsoft 365 and ERPNext data paths before calling those connections operational. Sample Admin rendering proves layout and navigation only.
- No production promotion is implied by this brief. The repository's per-instance production approval rule remains in force.
