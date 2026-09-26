# List working set and record return — spec (#679)

**Status:** proposed for the enterprise UX program, 2026-09-27. **Authority:** `DESIGN.md` Record-Open Rule and ListPage shell; `docs/design/2026-09-26-enterprise-coherence-brief.md`; `docs/decisions.md` OD-W5-C3-B and the shell navigation plan's AC-NAV-006/007.

## Job story and observed failure

When I narrow a work list and open a record, I want to return to the same working set and nearby position so I can continue reviewing records without rebuilding my search and filters. Today Projects, Sales Pipeline, Procurement, Companies, Contacts, and Meetings hold active list controls in component state. Their detail return controls navigate to a bare list route. A filtered list therefore resets when the record is closed. The shell also resets its scroll container on a route change.

## Design decisions

1. **The list URL owns the working set.** Each adopting page reads supported search, filters, and view values from its query string and writes user changes back with history replacement. Unknown values fall back safely. A copied list URL and a refresh reproduce the same results and selected controls. Existing dashboard drill links using `?filter=` or `?status=` keep their meaning. A view stored in session storage is a fallback when no explicit URL view exists; a nondefault effective view is materialized into the URL so a copied link describes what is visible.
2. **The record path stays canonical.** Opening a row, card, board item, calendar item, or inline record link navigates to its existing `/module/:id` route. An in-app navigation carries a validated list return path and scroll position in router history state, not in the record URL. A copied/direct record URL has no assumed list context and uses its owning module index as the fallback. A page refresh may retain the current entry's history state; if it does not, the same safe fallback applies.
3. **Back destinations follow the entry.** Browser Back reaches the prior list URL. The detail's mobile BackBar and desktop parent breadcrumb use a captured return path only when it belongs to that record's owning list. The project breadcrumb remains structurally under Projects. When a project was opened from Sales, its existing quiet Sales Pipeline wayfinding link remains in the Next-actions area per OD-W5-C3-B and targets the captured Sales URL; without that context it continues to target bare `/sales`. This preserves the owner decision without introducing a second Sales return control. A project opened from Projects returns to Projects.
4. **Position is best effort.** Capture the scroll position of the shell's actual `main-scroll` container before opening a record, and restore it after the list's content is ready on a Back return. A missing, stale, or out-of-range position falls back to the top. A direct list URL does not inherit an unrelated prior position. Never scroll a list before its rows have rendered.
5. **Only existing controls are serialized.** There is no user sort control on these six pages, so this issue does not add one or invent a sort query parameter. If a list later exposes sort, its URL state must include sort and direction. Companies and Contacts retain their existing fixed name order; Meetings retain newest-first; Procurement retains newest-first; Projects and Sales retain their current order.
6. **Current role and data boundaries remain.** A URL parameter may choose a view/filter but may not broaden the rows or actions available to the signed-in role. An unavailable referenced filter choice is visible as a zero-match/invalid-choice state with a way to clear it, rather than silently selecting another entity.

### Supported list URL vocabulary

| List | Query keys to round-trip | Existing default / constraint |
|---|---|---|
| Projects | `filter`, `client`, `pm`, `q`, `view` | `filter` keeps the Engineer's My Projects default and dashboard drill-link tokens; `view` accepts the four existing body layouts. |
| Sales Pipeline | `scope`, `status`, `q`, `view` | `status` remains the funnel/dashboard stage token; an active open stage and Lost scope cannot coexist, so stage selection uses Open scope. The record destination remains `/projects/:id`. |
| Procurement | `status`, `q`, `view` | `status` keeps the existing finance dashboard drill-link token; `view` accepts table or board. |
| Companies | `type`, `q` | The current `ViewToggle` chooses the company type, so it is serialized as a filter, not a body view. |
| Contacts | `company`, `q` | `company` is the existing company selector's stable ID. |
| Meetings | `project`, `q` | `project` is the existing project selector's stable ID; search remains deferred before the existing server query. |

Omit default/empty values where that does not erase an intentional dashboard drill filter. Preserve unrelated query keys when updating a supported key. A supported key with an invalid enum value uses the page's role-appropriate default; an unavailable but syntactically valid referenced ID stays visible as an active choice that can be cleared. Search input is encoded as a URL value and never interpolated into a path.

## Functional requirements (EARS)

- **FR-LRC-001:** When a user changes a supported list search, filter, or view on any adopting page, the application shall update the list URL and visible control together without adding one browser-history entry per change.
- **FR-LRC-002:** When a user opens an adopting list URL or refreshes it, the application shall derive the selected controls and results from its supported query parameters, preserving dashboard drill-link semantics and role-scoped defaults.
- **FR-LRC-003:** When a user opens a record from an adopting list, the application shall preserve the source list URL and current scroll position as in-app return context while keeping the record path canonical.
- **FR-LRC-004:** When a user activates the record's BackBar or parent breadcrumb, the application shall navigate to a validated source list URL if one exists for that record; otherwise it shall navigate to the owning list index.
- **FR-LRC-005:** When a user returns by browser Back or an explicit return control, the application shall restore the useful list position after its content is ready where the prior position is available.
- **FR-LRC-006:** While a project is viewed through its pipeline lens, the existing Sales Pipeline wayfinding link shall use the captured Sales list URL when the project was opened from Sales and bare `/sales` otherwise; the project's structural breadcrumb shall stay under Projects.
- **FR-LRC-007:** When a list contains records but the current search or filter matches none, the application shall identify the zero-match state and offer a clear-filter action; when the collection itself is empty, it shall identify that distinct state.
- **FR-LRC-008:** While the app is used at 390px or in English or Bahasa Indonesia, the adopting list controls and return actions shall remain discoverable, correctly named, and usable.

## Acceptance criteria and owning proof

| ID | Given / When / Then | Owning layer |
|---|---|---|
| **AC-LRC-001** | Given each of Projects, Sales, Procurement, Companies, Contacts, and Meetings, when its supported search/filter/view changes, then the URL and selected controls agree; refresh and a copied URL reproduce the working set. | Component integration, one route case per module |
| **AC-LRC-002** | Given an existing dashboard `?filter=` or `?status=` drill link, when the destination settles, then the intended subset remains selected and later control changes do not revert to the initial query. | Component integration |
| **AC-LRC-003** | Given a narrowed Projects list, when a project is opened and its Back control is used, then the original search/filter/view and nearby position return. | Browser journey |
| **AC-LRC-004** | Given a narrowed Sales Pipeline, when a project is opened and the Sales link is used, then the original search/scope/stage/view and nearby position return while the record path and Projects breadcrumb stay canonical. | Browser journey |
| **AC-LRC-005** | Given a narrowed Procurement list, when a request is opened and its Back control is used, then the original search/status/view and nearby position return. | Browser journey |
| **AC-LRC-006** | Given a narrowed Companies list, when a company is opened and its Back control is used, then the original search/type and nearby position return. | Browser journey |
| **AC-LRC-007** | Given a narrowed Contacts list, when a contact is opened and its Back control is used, then the original search/company and nearby position return. | Browser journey |
| **AC-LRC-008** | Given a narrowed Meetings list, when a meeting is opened and its Back control is used, then the original search/project and nearby position return. | Browser journey |
| **AC-LRC-009** | Given a narrowed list, when a record is opened and browser Back is used, then the prior URL and useful position return without an intermediate entry for every keystroke. | Browser journey |
| **AC-LRC-010** | Given a direct or copied record URL without valid return context, when the record loads or is refreshed and Back is used, then the owning index opens; no external or unrelated path is used. | Unit/component navigation contract |
| **AC-LRC-011** | Given a direct project link, when the pipeline lens renders, then its persistent Sales link uses bare `/sales` and the breadcrumb stays under Projects. | Component integration |
| **AC-LRC-012** | Given zero records in the collection versus records excluded by active controls, when an adopting list renders, then the copy and available clear action distinguish those cases. | Component state test |
| **AC-LRC-013** | Given English and Bahasa Indonesia and a 390px viewport, when a user narrows a list, opens a record, and returns, then accessible names and controls remain usable and the working set returns. | Rendered browser matrix |

## Boundaries

No new sort feature, pagination, access rule, record route, server query, or production configuration is introduced. Existing tests for AC-NAV-006/007 still prove canonical record navigation and owning-index fallback; update their route steps only where the deliberate contextual-return behavior requires it, without weakening the goal oracle. Keep one owning proof per AC at the lowest sufficient layer.
