# Whole-app coherence audit — "it doesn't feel like the same app"

**Date:** 2026-06-14 · **Method:** dual-substrate 3-lens design review — **Opus ×3** (visual / IxD / IA) + **gpt-5.4 via pi ×3**, same briefs, both rendering the running app at desktop 1440 and mobile 390, graded against Nielsen's 10 heuristics + ERP/PSA/CRM conventions. Raw lens reports: `review/whole-app-audit/{opus,gpt}-lens-{a,b,c}.md`.

**Why this audit:** the app was built across ~14 features by many independent agents (Waves 0–3). The owner felt a "disconnect — like it's not from the same app" and "unnatural IxD/UX flow," but couldn't pinpoint why.

---

## 1. The diagnosis (both substrates agree)

**It is PATTERN / BEHAVIOURAL drift, NOT token drift.** The visual *atoms* — one blue, Inter, 32px controls, 8px radius, borders-first — are shared and disciplined. The owner's instinct ("it's not the colours") is correct. The rupture is one level up:

> **The five core interaction verbs of a business app — NAME a record · CREATE one · OPEN one · ADVANCE/APPROVE one · GET BACK — were each implemented per-feature instead of once.** Every module looks related but behaves by its own rulebook, so the user never builds one muscle-memory. (Opus-B)

Equivalent framings the two models reached independently:
- *"Visual atoms are shared; visual molecules are not — painted by one hand, built by six."* (Opus-A)
- *"Pattern drift, not token drift — each feature invents its own page anatomy, toolbar grammar, status semantics, and viz style, so moving between modules feels like moving between mini-apps."* (gpt-A)
- *"Two incompatible IA contracts split by entity class — transactional records are navigable (URL/breadcrumb/back/⌘K); master-data are URL-less drawers."* (Opus-C)
- *"One visual skin, four different IA grammars."* (gpt-C)

The cross-substrate agreement is the validation: Opus and gpt-5.4, rendering independently, name the **same** root cause.

## 2. Consensus problem set (ranked — agreed by both substrates)

| # | Problem | Evidence (both substrates) | Heuristic |
|---|---|---|---|
| **P1** | **No canonical record-page contract** — "open a record" has 2–4 paradigms: Project/Procurement = routed `/x/:id` page; Company/Contact = URL-less right drawer; Incident = inert row (dead-end). 3 different record-header layouts. | Opus-C C-CRIT-1, Opus-A C2/C3, Opus-B #2, gpt-A, gpt-C | N#4, N#6 |
| **P2** | **Action-placement drift / "action hunting"** — the advance/approve verb has no stable home (header vs mid-page vs page-bottom vs inline row); `/approvals` stacks two approval models on one page. | Opus-B #3, gpt-B, Opus-C C-IMP-4 | N#4, N#7 |
| **P3** | **Terminology drift** — one entity carries 4 names (project / deal / opportunity) in one flow; 4 create-verbs (New / Raise / File / Add) with no scheme. | Opus-B #1, gpt-B, Opus-C C-IMP-2 | N#2, N#4 |
| **P4** | **Status-colour is local, not global** — same colour = two meanings; the reserved action-blue is spent as a status tint (One-Blue Rule broken). DOM-measured: `/incidents` "Medium" severity == "Open" status == action-blue; Companies colours "Client" blue. | Opus-A I1, gpt-A | N#4 |
| **P5** | **Duplicate "molecule" components for one concept** — two steppers (Delivery = bars, Procurement = numbered circles; DESIGN.md defines only bars), 3 KPI-tile treatments, 3–4 "project card" vocabularies, per-module kanban. | Opus-A C4/I2/I3, gpt-A | N#4 |
| **P6** | **List-page shell grammar varies per module** — toolbar/filter/view arrangement differs; view-switch labels drift ("Kanban" vs "By-stage Board"); default view differs for the same entity. | gpt-A, Opus-C, Opus-B #6 | N#4 |
| **P7** | **Approvals fragmented** across `/approvals` + Timesheets tab + Procurement filter + Dashboard card; rail "Approvals" ≠ H1 "Needs my approval". | Opus-C C-IMP-4, gpt-B, Opus-B #3 | N#4 |

**Per-role naturalness (gpt-B):** Executive 2.5 · PM 2–3 · Engineer 2.5 · Admin 1.5–2.5 (avg ~2.4/5).

## 3. Concrete bugs surfaced (fix regardless of the coherence track)

- **`NaN% / $NaN`** states visible on Projects + **ISO-vs-human date mixing** (gpt-A).
- **Incidents is a dead-end** — rows don't open; an Engineer can File but cannot track/close (Opus-B #4). *Functional gap, not just IxD.*
- **Exec dashboard is a different design + copy on mobile vs desktop**, not a reflow (a side-effect of the Wave-0 S1 mobile condensation) (Opus-A C1).
- **⌘K omits Companies & Contacts** — looks global, is partial (Opus-C C-CRIT-2).
- **Same `/projects/:id` URL renders a different default tab by role** (Overview for PM/Admin, Tasks for Engineer) (gpt-C).
- **A pipeline-stage record renders the full delivery shell** (S-curve, phase stepper) while the breadcrumb says "Sales Pipeline" (Opus-C C-IMP-1).
- **Eager validation forks per modal** — red "fix 1 field" on untouched forms; submit stays enabled on Projects but disabled elsewhere (Opus-B #5).
- **Admin "Add user" is disabled** (dashboard headline action dead) (Opus-B).

## 4. Already coherent — keep (don't churn)

Single app-shell + rail + top bar + ⌘K + breadcrumb placement; disciplined base tokens (no palette explosion, no AI-slop/gradients, borders-first, compact controls); rail grouping mirrored exactly in the mobile drawer + role-scoped rail with matching ⌘K filter; the Model-B canonical project URL with stage-aware breadcrumb + `Back to X` BackBar on transactional details; the shared `EntityFormModal`, `DataTable`, and `Delivery` stepper + "ready to advance" banner. **The divergence is shallow** (labels / validation / open-mode / action-placement / duplicated molecules) — normalizing ~5 patterns fixes it **without touching the visual system**.

## 5. Remediation — a dedicated "Coherence" wave (pattern-normalization, NOT more features)

Ordered by coherence-per-effort. Each is a cross-cutting PR; several are owner-collaborative (the noun/taxonomy choices are product decisions).

1. **Terminology + create-verb normalization** *(string-level; biggest payoff/effort)* — one canonical noun per entity, one create-verb scheme. **Owner decision needed:** the project↔opportunity↔deal naming (is "deal/opportunity" an intentional pipeline-stage label or just drift?). Fix the "New deal" modal first.
2. **One status/severity colour map** — a single source-of-truth `StatusPill` mapping across all modules; **free the action-blue** (no status may use it). Kills P4.
3. **Shared "molecule" primitives** — one `RecordHeader`, one `KpiTile`/metric-strip, one stepper (retire the procurement circle-nodes → the DESIGN.md bar stepper), one kanban, one project card. Kills P5 + the 3-header problem.
4. **One record-open paradigm** — routable detail pages for ALL primary entities: Company, Contact, Incident get real `/x/:id` pages with breadcrumb + Back + ⌘K indexing. Retire drawers-as-records; **give Incidents a real detail view** (also fixes the dead-end bug). Kills P1.
5. **One list-page shell** — a shared `ListPage` (title + toolbar order Search·Filter·Export·Import + one named view-switcher with consistent labels/defaults). Kills P6.
6. **Record-action contract** — one consistently-placed advance/approve zone (sticky, never below the fold), Edit/Archive in every record header, and **`/approvals` unified to one approval model** with per-module deep-link tabs. Kills P2 + P7.
7. **Quick-win bug sweep** *(parallel, cheap)* — NaN/$NaN + date formatting; ⌘K index Companies/Contacts; role-invariant URL default; reconcile exec dashboard mobile/desktop; eager-validation consistency; Admin "Add user".

**Sequencing note:** 1–2–7 are cheap and high-impact (do first). 3–4 are the structural core (shared primitives + one record paradigm) and benefit from a **single composing hand** rather than parallel agents — this is the work that *caused* the drift, so it should not be re-fragmented. 5–6 follow once the primitives exist. Consider running this as a focused, partly owner-collaborative "Wave C — Coherence" rather than another parallel feature burst.

---

*Owner: this is the answer to "make it flow naturally" — a normalization track, not features. The Director maintains this doc; the terminology + record-paradigm decisions (steps 1, 4) want an owner sign-off before build.*
