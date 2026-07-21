# Spec: ERPNext adapter — PMO budget push + PMO projection (Issue P3c — ADR-0055 P3 phase, ADR-0059 Posture B)

> **Status:** **DRAFT — awaiting owner sign-off.** **REWRITTEN 2026-07-16** after the owner ruling reversed
> the direction (below). The prior draft specced an inbound ERP→PMO budget mirror; that is **withdrawn in
> full**. Five open questions need a ruling before build (§3) — **OQ-BUD-1** (the ERPNext v15 `Budget`
> **write** field map — a spike is running; do NOT guess), **OQ-BUD-2** (the activation **state stamp** — a
> genuine ADR-0059 §3.1 tension, new to the write direction), **OQ-BUD-3** (**multi-fiscal-year** projects —
> a real grain mismatch), **OQ-BUD-4** (where the category↔account map lives), **OQ-BUD-5** (two ADR-0055 §6
> clauses that contradict the ruling). Each states a proposed default; none is decided here.
>
> **⚑ THE RULING (binding, owner 2026-07-16) — direction: PMO → ERP.**
> **PMO authors the budget and pushes it into ERPNext. ADR-0055 §6 STANDS (no supersede.)**
> Reasoning the owner endorsed: *"in sync" has exactly one safe meaning — **one authority, one-way
> propagation**. Two-way budget sync is an unresolvable conflict problem.* **PMO is the authority** (it
> already is — `get_project_budget()` = Σ Active `budget_version` line items, **OD-BUDGET-1**). ERPNext
> receives the budget for GL/audit **and for its native overspend controls**
> (`action_if_annual_budget_exceeded` etc.) — **which is the main thing this issue buys.**
>
> **⚑ Posture: ADR-0059 Posture B (PMO-SoT with an external side-mirror) — P3c is its SECOND instance.**
> ADR-0059 §7 flagged Budgets as *"the most likely next Posture-B candidate… should be evaluated against
> §2's test when its issue is specced, not assumed either way."* **§2's test is applied in §1.1 and returns
> B unanimously (4/4).** P3c therefore aligns with ADR-0059 rather than inventing a parallel concept: the
> deterministic key (§4), never-adopt (§5), the durable-failure surface (§6), and the seven invariants (§3)
> apply **verbatim**. **P3a is the structural template for the command path** (dispatch route, `ErpDocKind`,
> ADR-0058 fenced outbox, authorization-before-ERP-write, cross-org pre-flight, kind↔domain enforcement,
> fail-closed refs) — **but there is NO RLS flip** (that is Posture A's mechanism; PMO remains SoT here).
>
> **⚑ Two different things are called "projection" — disambiguated permanently.** ADR-0055 §6 says a version
> is *"**projected into** the ERP's native object"* — that means **PUSHED**. This spec's **"PMO projection"**
> means PMO's **forward-looking derived view** (`pmo_etc` → EAC/variance/utilization). They are unrelated.
> **This spec never says "projection" for the push.** Vocabulary is fixed: **"the push"/"pushed"** = PMO → ERP
> propagation (§6's sense); **"the projection"** = PMO's forward view (§5.7), which is **PMO-only and is
> NEVER pushed** (FR-BUD-160).
>
> **Authority / grounds:** **ADR-0055** §§1–5 + **§6 (STANDS — the versioned-plan pattern is this issue's
> mandate**: *"exactly one active version is projected into the ERP's native object (ERPNext `Budget`, one
> per project × fiscal year)… Activating a version = synchronous command amending the ERP object"* — see §3
> OQ-BUD-5 on its two other clauses), **ADR-0059** (the binding posture: §§2–6 + the `neverReissue`
> corollary), **ADR-0058** (the fenced outbox — verbatim, with ADR-0059 §4's deterministic-key delta),
> **ADR-0048** (ERPNext = accounting engine; PMO never recomputes an ERP-computed figure), **ADR-0019**
> (server-enforced SoD), **ADR-0016** (RLS is the enforcement authority), **OD-BUDGET-1..5** (the shipped PMO
> budget authority this issue **preserves and propagates**), **OD-SAR-PMO-IS-THE-UI**, **OD-SAR-GATES**, the
> shipped **P2** adapter + **P3a** spec/plan (the command-path template), and the **P3b** spec/plan (the
> Posture-B sibling — **read them; P3c must look like P3b, not like a fresh invention**).
>
> **Surfaces this issue extends, never forks:** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts`
> (+ one additive `budget` kind), `doctypeBodies.ts` (+ `bodies/budget.ts`), `supabase/functions/
> adapter-dispatch/{index,readModelWriters,moneyOutboxDeps}.ts`, `_shared/erpnextFeedDeps.ts`,
> `erpnext-sweep/index.ts`, `refs.ts`, migration `0096` (outbox + `external_refs` + bindings), `0074`
> (`stamp_org_id()`) — and, **untouched but load-bearing**, `0001` (`budget_versions`/`budget_line_items`/
> `budget_category`) + `0005` (`activate_budget_version`/`clone_budget_version`/`get_project_budget`).
> House conventions as P2/P3a/P3b: EARS + `FR-BUD-`/`NFR-BUD-`/`AC-BUD-` ids; Given/When/Then; ADR-0010
> traceability (one owning test per AC at its lowest sufficient layer).

---

## 0. Job story

> **When a client employs ERPNext, the budget the PMO team approved in PMO must become the budget ERPNext
> enforces — automatically, the moment it is activated — so that ERP's native overspend controls stop a
> purchase order against a budget the team never approved, and the GL reports against the figure the team
> actually agreed; while PMO remains the single authority for what the budget *is*, and every client who
> does NOT employ ERPNext stays byte-for-byte the pre-P3c system.**

PMO owns the budget: authoring (`budget_line_items`), versioning (Draft → Active → Archived), and the
activation authority (`activate_budget_version`, the one-Active-per-project invariant, the OD-BUDGET-3 role
gate). **Activating a version is the trigger**: the approved figure is pushed synchronously into ERPNext's
native `Budget` object (ADR-0055 §6), where it powers the GL and the overspend controls. There is **exactly
one budget figure in the system — PMO's** — and ERP holds a **copy**. Nothing about the budget ever flows
back into PMO's authority. On top of that single figure PMO adds a **projection** (a forward-looking
estimate-to-complete → EAC/variance) which is **PMO-only** and is never pushed.

---

## 1. Overview and user value

P3c is the **third P3 issue** and the **second ADR-0059 Posture-B instance** (after P3b timesheets). It adds:

1. **The budget push** — a new `budget` domain + `ErpDocKind`, a `budgetToBody` mapper, a dispatch route,
   and the ADR-0058 fenced outbox, triggered by **budget-version activation**. ERPNext's `Budget` is
   created/updated per (Company × fiscal year × **project**).
2. **The category↔account map** — **the real work of this issue** (§5.4). PMO budgets per `budget_category`
   (a 7-value enum, OD-BUDGET-4); an ERP `Budget` line is per **account**. Org-scoped,
   Admin-administered, **fails closed** on an unmapped category.
3. **The side mirror** (`budget_version_erp_mirror`) — ADR-0059 §6's durable push state + operator surface.
   **No RLS flip; no PMO table is modified.**
4. **The PMO projection** — `pmo_etc` + derived EAC/variance/utilization over **PMO's own budget** (the SoT)
   and **P2's already-mirrored GL actuals**. PMO-only; never pushed.

User value: the client's ERP enforces the budget the client's team actually approved, without an accountant
re-keying it (and drifting). PMO keeps its versioning/approval product. The team gets a forward-looking view
the ERP cannot give. **One authority, one-way propagation** — no conflict-resolution layer exists or is
needed.

### 1.1 ADR-0059 §2 posture test — applied, and the result

| # | ADR-0059 §2 test | P3c answer | ⇒ |
|---|---|---|---|
| 1 | **Does PMO run an authorization step the external system cannot represent?** | **Yes.** `activate_budget_version` (mig `0005`) is a shipped, pgTAP-proven, security-definer authority: the **OD-BUDGET-3 role gate**, the **one-Active-per-project** partial-unique invariant, the Draft-guard on line items, and the **version lineage** (clone → edit → activate). ERPNext's `Budget` has **no** concept of a PMO budget *version*, a PMO role, or an Active-version invariant. Re-homing this into ERP's `docstatus` would **lose** authorization semantics. | **B** |
| 2 | **Would flipping the PMO table remove a feature users use daily?** | **Yes.** OD-BUDGET-1 made budget-versioning **MVP-load-bearing**. A flip would `42501` budget authoring the moment an org employs ERPNext — and would silently break `get_project_budget()`, and with it **margin, at-risk, `get_finance_budget_review`, `top_projects_spent`, and the S-curve**. | **B** |
| 3 | **Is a natively-created external document a legitimate PMO record?** | **No.** Adopting a Desk-created `Budget` would mint a budget figure that never passed PMO's version/activation authority — inverting OD-BUDGET-1 and the owner's one-authority ruling. | **B** |
| 4 | **Is the external document derivable from PMO state at a known moment?** | **Yes.** The Active version's line items, at activation. The ERP `Budget` accretes **no** truth PMO cannot derive (unlike an ERP-computed `outstanding_amount`) — it is a pure copy. | **B available** |

**Unanimous 4/4 → Posture B.** (Ties break to A; there is no tie.) ADR-0059 §7's ownership-map posture
column gains its Budgets row:

> | Budgets | **PMO owns the versioned plan + its activation; ERP records the approved figure** | **Posture B** — `budget_versions` / `activate_budget_version` are SoT; **activate ⇒ push the approved figure**; ERP runs GL + native overspend controls from it |

*(Recording that row in ADR-0055 §5 / ADR-0059 §7 is the Director's — this spec edits no ADR.)*

---

## 2. Scope

### In scope
- A new PMO domain **`budget`** owned by the `erpnext` tier **for push purposes only** — registered in the
  `adapter-dispatch` registry. **⚑ NOT added to `domain_externally_owned` (0087); there is NO RLS flip**:
  PMO remains SoT (ADR-0059 Posture B). *(§5.1 states this explicitly — the single most likely
  P3a-pattern-match error.)*
- One new `ErpDocKind` — **`budget`** (ERP `Budget`) — in `DOCTYPE_REGISTRY` + `DOCTYPE_BODIES`, additive.
- The **push command surface**: create + update (+ cancel/amend **iff** the spike proves update-after-submit
  is illegal — OQ-BUD-1 #4), riding the **ADR-0058 outbox verbatim** with **ADR-0059 §4's deterministic key**.
- **The category↔account map** (§5.4) — the crux: org-scoped, Admin-administered, **bijective**;
  **fail-closed** on an unmapped category with a **named** `action-required` surface.
- **`budget_against` = the PROJECT dimension** (`budget_against='Project'`, `project=<ERP project name>`),
  reusing P3a's ERP-project→PMO map (R9-P3a #5).
- The **side mirror** `budget_version_erp_mirror` (ADR-0059 §6): `push_state` / `push_error` / the
  server-resolved state-stamp witness / `erp_*` lifecycle. Machine-written; `(org_id, push_state)`-indexed;
  bounded per sweep tick.
- **The activation-consequence push path** + the **sweep backstop** (the two ADR-0059 originators) + the
  **deterministic key** that makes them collide safely.
- **Inbound: lifecycle-only, NEVER adopt** (ADR-0059 §5) + **never fight the operator** (an external cancel
  is not auto-re-pushed).
- **Overspend controls** — the point of the feature: the binding's configured
  `action_if_annual_budget_exceeded` + `applicable_on_*` flags on the pushed `Budget` (§5.6). **Default
  `Warn`, never `Stop`** without an explicit Admin opt-in.
- **The PMO projection** (§5.7): `budget_projections.pmo_etc` + derived EAC/variance/utilization over PMO's
  Active version + `erp_actuals_snapshot`. **PMO-only, never pushed** (FR-BUD-160).
- The **byte-for-byte invariant** (FR-BUD-004) and the **PMO-authority-preserved / no-flip invariant**
  (FR-BUD-006) — both structurally proven.

### Out of scope
- **Any ERP→PMO budget authority.** No inbound mirror of ERP budget *figures*; no adopt; no "capture as a
  new version" reconcile-up. **ADR-0055 §6's "ERP-side edits reconcile up… the ERP's figure wins
  unconditionally" is explicitly NOT built** — see OQ-BUD-5 (it contradicts the one-authority ruling; a
  recorded clarification is requested).
- **Any change to `budget_versions`, `budget_line_items`, `get_project_budget`, `clone_budget_version`,
  `projects.budget`, or any dashboard/margin/at-risk/S-curve/finance-review figure** — ADR-0059 §3.1 + §8.
  **The one candidate exception is OQ-BUD-2** (an additive `activated_at` column + one `set` in
  `activate_budget_version`), escalated rather than assumed.
- **`Monthly Distribution` / budget phasing** — ERP-native; deferred (FR-BUD-180).
- **Multi-fiscal-year fan-out** — deferred + **fail-closed** pending OQ-BUD-3 (FR-BUD-181). PMO shall
  **never invent a pro-rata split** across fiscal years (a PMO-authored accounting allocation — ADR-0048).
- **Commitments in the EAC** — deferred (FR-BUD-182); the prior ruling holds (out).
- **Cost-Center-dimension budgets** (`budget_against='Cost Center'`) — the project dimension is the mandate.
- **A PMO-native re-open of an Active version** to correct an already-pushed budget — ADR-0059 §8: its own
  issue. (The clone→activate path already covers revision.)
- Any helper-app requirement in ERPNext (ADR-0055 §2).

---

## 3. Proposed defaults and open questions

### OQ-BUD-1 — The ERPNext v15 `Budget` **write** field map — **OPEN — a spike is running**
**Do not write `bodies/budget.ts` from a hypothesis.** A **budget-write spike** is in flight; its output
lands at **`docs/spikes/2026-07-16-erpnext-budget-fields.md`** and is **binding** (the OQ-SAR-1/R9-P3a
precedent: the frozen map is the field truth; no body may diverge). Bed: the same stock
`frappe/erpnext:v15.94.3` @ `localhost:8080`, `PMO Smoke Co`, IDR, Standard COA.

**The spike must answer (WRITE path):**
1. **The minimal mandatory insert body** — expected `{company, fiscal_year, budget_against:'Project',
   project, accounts:[{account, budget_amount}]}`; what does ERP server-derive vs demand?
2. **Is `Budget` submittable?** If yes, the R9 two-step insert→submit applies; `docstatus` drives FR-BUD-120.
3. **Uniqueness:** does ERP **reject a second `Budget`** for the same (company, fiscal_year, project)? The
   exact error/classification. *(Expected yes — which is why the push is an **upsert**, FR-BUD-121.)*
4. **⚑ Update semantics — drives the whole re-activation design (FR-BUD-121).** Can
   `accounts[].budget_amount` be updated on an **already-submitted** `Budget` (an `allow_on_submit` field),
   or is update-after-submit illegal ⇒ revision must be **cancel + amend**? **The single highest-value
   answer.**
5. **⚑ The anchor field.** Does `Budget` carry **any** stock, REST-filterable free-text field surviving
   `validate`? *(Expected **no** — `Budget` has no `remarks`.)* **If no ⇒ `anchorField: null` ⇒ ADR-0059 §4's
   anchor-less corollary: `neverReissue: true`, held on inconclusive, never auto-reissued.** (FR-BUD-143.)
6. **The real Account values** on the bench COA — the fixtures for the map (§5.4).
7. **Project-dimension viability:** does `budget_against='Project'` + `project='PROJ-####'` actually enforce
   against a PO/GL entry carrying that project (R9-P3a #5 found both GL legs carry `project`)?
8. **⚑ The overspend-control options** — the point of the feature: the `action_if_annual_budget_exceeded`
   literals (expected `Stop|Warn|Ignore`), the `applicable_on_material_request` /
   `applicable_on_purchase_order` / `applicable_on_booking_actual_expenses` flags, and **what actually
   happens** on a PO that exceeds (observed, not assumed).
9. **Multi-FY:** confirm one `Budget` per fiscal year is genuinely required (drives OQ-BUD-3).

**Blocks:** slice 1 (the body) + slice 2 (the upsert/transition policy). **Non-blocking for** slices 0/5.

### OQ-BUD-2 — ⚑ The activation **state stamp** — **OPEN — NEW to the write direction; owner ruling needed**

ADR-0059 §4 requires a **deterministic** key `'<prefix>:' || <pmo_record_id> || ':' || <state_stamp>`, where
the stamp is *"the state stamp the gate read"* (P3b: `timesheets.approved_at`). **P3c has no such column:
`budget_versions` carries `(id, org_id, project_id, version, name, status, created_at)` — there is no
`activated_at`.** And the stamp genuinely matters:

- **`budget_version_id` alone is insufficient.** OD-BUDGET-5(A)'s revision path (clone → edit Draft →
  activate) mints a *new* version id per revision, so *most* activations are already distinct. **But
  `activate_budget_version` does not check the current status** — an **Archived version can be re-activated**
  (roll back v3 → re-activate v2). With a version-id-only key that re-activation collides (`23505`) with
  v2's original push and is **silently suppressed** — leaving ERP enforcing **v3's** figures while PMO says
  v2. **A silent, wrong-budget outcome — exactly what ADR-0059 §4 warns about.**
- **A content digest is also insufficient** — v2's content is unchanged, so the digest is unchanged, and the
  same suppression occurs.

**Options:**
- **(a) Add `budget_versions.activated_at timestamptz` (nullable), stamped by `activate_budget_version` —
  PROPOSED DEFAULT.** Key = `'bud:' || budget_version_id || ':' || activated_at`. Correct, trivially derivable
  by **both** originators from DB truth, mirrors P3b exactly. **⚑ But it modifies the transition's schema +
  RPC, which ADR-0059 §3.1 forbids and §8 says is "its own issue with its own spec and its own owner
  ruling."** Mitigation for ratifying it as a narrow exception: **additive and nullable**, adds **no** gate,
  changes **no** state-machine semantics, alters **no** existing row, touches **no** KPI
  (`get_project_budget` does not read it). It is a **witness, not a rule**. **Recommendation: the owner
  ratifies (a) as an explicitly-scoped exception, OR splits it into a 2-task pre-req issue.**
- **(b) A side-mirror-hosted `push_seq`.** The side-mirror row is shared state both originators read, so a
  monotonic `push_seq` bumped per activation is derivable. **Rejected:** something must bump it *on
  activation* — i.e. a trigger on `budget_versions`, which is **also** a schema change to the transition's
  table, with **more** hidden behavior than (a) and a worse failure mode (a trigger inside the transition's
  transaction).
- **(c) Accept version-id-only + forbid re-activating an Archived version.** **Rejected:** that is a **new
  gate** on the PMO state machine — a bigger ADR-0059 §8 violation than (a), and it removes a legitimate
  user action.

**Blocks sign-off** (it decides the key, which decides the outbox contract).

### OQ-BUD-3 — ⚑ Multi-fiscal-year projects — the grain mismatch — **✅ RULED (owner, 2026-07-21)**

> **⚑ THE RULING (binding, owner 2026-07-21): option (a) NOW, option (c) as the NEXT ISSUE.**
> Ship the fail-closed refusal below to close P3c, and **immediately file (c) — the fiscal-year /
> phasing dimension on `budget_line_items` — as its own issue**, so multi-FY projects are unblocked
> soon rather than indefinitely. Sizing measured this session: **8 of 54 seeded projects span
> calendar years**, including the flagship `2025-09-01 → 2026-06-30`.
>
> **⚑ SECOND RULING — how the fiscal year is DERIVED: resolve it from ERPNext's `Fiscal Year`
> doctype**, finding the FY whose range contains the project's `start_date`, and **fail closed if
> none matches**. NOT the calendar year of `start_date`.
> **This is currently an OPEN DEFECT:** `budgetGate.ts:resolveFiscalYearOrFailClosed()` ships
> calendar-year derivation, which is correct only for a Jan–Dec client and otherwise targets the
> **wrong ERP Budget object** — a wrong-year overspend control that looks like it worked.
> **It also changes which projects get refused:** the multi-FY *span* check must compare real FY
> ranges, not calendar years — under a Jul–Jun calendar the flagship project above is **single-FY**
> and must push normally. See `docs/handoffs/2026-07-21-p3bc-handoff.md` §1 for the implementation
> constraint (the gate is DB-only and has no ERP client; resolve in the adapter path or inject a
> resolver — never fall back to the calendar year).

**Original open question, retained for context:**

**PMO's `budget_versions` has NO fiscal-year dimension** (a version is per *project*; its line items are per
*category*, with no date). **ERP's `Budget` is per (company, fiscal_year, project)** — ADR-0055 §6 says so:
*"one per project × fiscal year — **multi-year projects project into one object per FY**."* So a PMO budget
for a project spanning FY2026–FY2027 must become **two** ERP `Budget` objects — and **PMO holds no
information about how to split it.**

**Options:**
- **(a) Single-FY push + fail closed on multi-FY — PROPOSED DEFAULT.** The push targets the fiscal year
  containing the project's `start_date`. A project spanning **more than one** fiscal year is **rejected
  before any ERP call** (`commit-rejected`/`budget-multi-fiscal-year`); the side mirror goes `failed`; an
  `action-required` surface names the project + the spanned years. **Rationale:** any automatic split
  (pro-rata by days, by milestones, front-loaded) is **PMO inventing an accounting allocation** — precisely
  what ADR-0048 forbids — and would silently produce wrong overspend controls in **both** years. **Honest
  refusal beats a plausible guess.**
- **(b) Push the whole budget into the start FY.** **Rejected:** ERP would enforce the *entire* multi-year
  budget as a *single-year* limit — the overspend control (the feature's point) would be **wrong and
  permissive** in year 1 and **absent** in year 2. Worse than refusing.
- **(c) Add a fiscal-year/phasing dimension to `budget_line_items`.** The *correct* long-term answer (and it
  pairs with `Monthly Distribution`, FR-BUD-180). **But it is a PMO product change** (schema + UI + the
  OD-BUDGET rulings) — ADR-0059 §8: its own issue.

**Accepted cost of (a):** multi-FY projects get **no** ERP budget until (c) ships. **The owner should size
that** — if most real projects span fiscal years, (a) makes the feature largely inert and **(c) is the real
issue**. **Blocks sign-off.**

### OQ-BUD-4 — Where the category↔account map lives — **PROPOSED DEFAULT (low-stakes)**

- **(a) A dedicated org-scoped table `budget_category_account_map` — PROPOSED DEFAULT.** It is **referential
  data with a fixed key domain** (the 7-value `budget_category` enum), so a table gives a real enum-typed
  column, the **bijective uniques** (FR-BUD-111) as DB constraints, RLS, an Admin CRUD surface, and
  pgTAP-able integrity — **none of which jsonb gives**. It is administered as an ongoing human task, not a
  connection detail.
- **(b) `external_org_bindings.config.category_account_map` (jsonb)** — the P3a `process_gates` precedent
  (OD-ENA-SHARED-BINDINGS: one shared per-org connection surface; data-not-schema, no migration).
  **Rejected because** `process_gates` is 3 booleans with no integrity requirement, whereas this is a keyed,
  constrained, admin-CRUD'd mapping whose **only** safety property is that it fails closed — and jsonb cannot
  express "exactly one account per category **and** exactly one category per account".

**Non-blocking** (either ruling changes one migration + one repository, not the design).

### OQ-BUD-5 — ADR-0055 §6's "ERP's figure wins" + "capture as new version" — **OPEN — a clarification, not a redesign**

ADR-0055 §6 (which **stands**) contains two clauses that **contradict the owner's one-authority ruling**:
> *"ERP-side edits **reconcile up into the active version** with a 'capture as new version' offer. **The
> ERP's figure wins unconditionally**; PMO versions record lineage."*

That is **two-way sync** — the exact thing the owner ruled out (*"two-way budget sync is an unresolvable
conflict problem"*). Under the ruling, **PMO's figure wins unconditionally** and a Desk edit to a pushed
`Budget` is an **operator concern**, not an auto-merge (ADR-0059 §8: *"External-side content edits to a
Posture-B document are an operator concern, not an auto-merge"*).

**Proposed reading (requested for ratification):** §6's **mechanism stands and is this issue's mandate**
(one Active version → one ERP object per project × FY; activation = the synchronous command); §6's
**reconcile-up / ERP-wins clauses are superseded by the 2026-07-16 owner ruling + ADR-0059 §8** and are
**not built**. A Desk edit to a pushed `Budget` is **detected and reported as divergence** (FR-BUD-152),
never merged. **This spec is written that way.** *(Recording it is the Director's — no ADR is edited here.)*

---

## 4. New storage (schema — reversible migrations, RLS on every table)

**⚑ Nothing existing is altered** (the one candidate exception is OQ-BUD-2's `activated_at`, escalated not
assumed). All new tables carry the `org_id` seam (`org_id uuid not null default
coalesce(public.auth_org_id(),'…0001')` + `stamp_org_id()`, the 0074 pattern). Migration numbers are
**`≥ 0108`** (`ls supabase/migrations | tail -1` = `0107` at spec time; **re-verify at build time** — P3b is
writing concurrently on this branch and will likely take `0108`).

**⚑ There is NO flip migration** — no `domain_externally_owned('budget')`, no `*_native_mirror_guard`, no
per-command RLS split. That is Posture A's mechanism. **PMO's budget tables keep exactly the RLS they ship
with today.**

### 4.1 `budget_version_erp_mirror` (the ADR-0059 §6 side mirror — external-side state ONLY)
Grain **(budget_version_id × fiscal_year)** — `fiscal_year` is in the key **for forward-compatibility with
OQ-BUD-3(c)**, at zero cost today (one row per version under 3(a)).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | org seam; `stamp_org_id()` |
| `budget_version_id` | uuid not null references `budget_versions(id)` on delete cascade | the PMO SoT record |
| `fiscal_year` | text not null | the ERP `Budget`'s FY (OQ-BUD-3(a): the project's start FY) |
| `push_state` | text not null default `'pending'` CHECK (`pending\|pushing\|pushed\|failed\|held`) | **ADR-0059 §6** — the operator surface **and** the sweep's work queue |
| `push_error` | text | the **classified**, client-safe reason (`budget-category-unmapped`, `budget-multi-fiscal-year`, `external-unreachable`, …) |
| `unmapped_categories` | text[] | **names the exact categories** blocking the push (§5.4) — an operator surface must be actionable, not just red |
| `activated_at_witness` | timestamptz | **ADR-0059 §6**: the **server-resolved** witness of the state stamp the push was keyed on — written from **DB truth, never a payload**. *(Depends on OQ-BUD-2.)* |
| `erp_budget_name` | text | ERP `Budget.name` (display + the update target) |
| `erp_docstatus` | smallint | feed column, day one |
| `erp_modified` | text | feed column (per-row source-mod cursor), day one |
| `erp_cancelled_at` | timestamptz | feed column (external cancel → tombstone, §5.8), day one |
| `pushed_at` | timestamptz | |
| `created_at` | timestamptz not null default now() | |
| | | `unique (org_id, budget_version_id, fiscal_year)`; **index `(org_id, push_state)`** (ADR-0059 §6: index-served + bounded per tick so one org's backlog cannot starve another's) |

**Reversibility (ADR-0059 §3.7):** `drop table budget_version_erp_mirror` ⇒ **zero PMO data loss** — it holds
only external-side state. Posture B's strongest property.

### 4.2 `budget_category_account_map` (⚑ THE CRUX — org-scoped, Admin-administered, **bijective**)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | org seam; `stamp_org_id()` |
| `category` | `budget_category` not null | **the shipped enum** (OD-BUDGET-4's 7 values) — a real enum column, not text |
| `erp_account` | text not null | the ERP Chart-of-Accounts account (values frozen by OQ-BUD-1 #6) |
| `updated_by` | uuid references `profiles(id)` | accountability for an accounting-relevant config change |
| `updated_at` | timestamptz not null default now() | |
| | | **`unique (org_id, category)`** AND **`unique (org_id, erp_account)`** — ⚑ the map is a **bijection** (FR-BUD-111 justifies why both) |

### 4.3 `budget_projections` (the PMO-only forward view — **never pushed**)
Grain **(project × fiscal_year × category)** — **PMO's grain** (category), not ERP's (account): PMO is SoT, so
the projection speaks PMO's vocabulary. *(Changed from the prior draft's account grain — a direct consequence
of the direction reversal.)*

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | org seam; `stamp_org_id()` |
| `project_id` | uuid not null references `projects(id)` on delete cascade | a real FK — a PMO table |
| `fiscal_year` | text not null | the actuals-join dimension |
| `category` | `budget_category` not null | PMO's grain |
| `pmo_etc` | numeric(14,2) not null default 0 | **PMO-owned, user-authored** estimate-to-complete — **never pushed** (FR-BUD-160) |
| `note` | text | |
| `updated_by` | uuid references `profiles(id)` | |
| `updated_at` / `created_at` | timestamptz | |
| | | `unique (org_id, project_id, fiscal_year, category)` — the upsert target |

### 4.4 Binding config extension (data, not schema)
`external_org_bindings.config` gains the **overspend-control** keys (§5.6) — `budget_overspend_action`
(**default `'Warn'`**) and `budget_applicable_on` (the `applicable_on_*` flags) — and reuses the shipped
`company` + the P3a ERP-project map. **No new binding table** (OD-ENA-SHARED-BINDINGS). Option literals are
frozen by OQ-BUD-1 #8.

### 4.5 Reused unchanged — no new table, no modification
- **`budget_versions` / `budget_line_items` / `budget_category` / `activate_budget_version` /
  `clone_budget_version` / `get_project_budget` (migs `0001`, `0005`)** — **the SoT. UNTOUCHED**
  (OQ-BUD-2's `activated_at` is the only escalated candidate).
- **`erp_actuals_snapshot` (0101)** — the projection's actuals input, **already shipped and fed** by P2's
  `refreshActuals`. **No change.**
- **`external_command_outbox` / `external_refs` / `external_ref_lineage` (0096, 0088)** — reused verbatim.

---

## 5. Functional requirements (EARS)

### 5.1 The invariants — byte-for-byte + PMO authority preserved

- **FR-BUD-004 (ubiquitous — THE INVARIANT)** — Where an org has **no activated `erpnext` binding** (the
  shipped default for every existing client), the system shall produce **byte-for-byte identical behavior**
  to the pre-P3c system: activating a budget version makes **no** ERP call, creates **no** outbox row and
  **no** side-mirror row; the new tables introduce no write path and no background work; and
  `get_project_budget()`, `budget_versions`, `budget_line_items`, `projects.budget`, and **every**
  dashboard/margin/at-risk/S-curve/finance-review figure are unchanged. P2's FR-ENA-004, P3a's FR-SAR-004 and
  P3b's invariant stay intact.
- **FR-BUD-005 (fail-closed routing)** — The push shall fire **only** for an org with an **activated
  `erpnext` binding** whose ownership map positively asserts `budget`→`erpnext`. An absent/not-yet-loaded map
  **defaults to no push** (the P2 FR-ENA-005 cold-start lifecycle). A `budget` command for a non-employing
  org is rejected at the repository/dispatch layer with **no** ERP call.
- **FR-BUD-006 (⚑ PMO AUTHORITY PRESERVED — there is NO RLS flip; structurally proven)** — While an org
  employs ERPNext for `budget`, PMO's `budget_versions`/`budget_line_items` shall remain **unflipped and
  fully user-writable** under their **shipped** RLS (the OD-BUDGET-3 gate), and `get_project_budget()` shall
  remain **the** budget authority (OD-BUDGET-1) for **every** KPI. Concretely and checkably: **(a)** no
  `domain_externally_owned` row for `'budget'` is ever created; **(b)** no policy on
  `budget_versions`/`budget_line_items` references `domain_externally_owned`; **(c)** no
  `*_native_mirror_guard` trigger exists on either; **(d)** the shipped budget pgTAP suite (`0008`–`0012`,
  `0060`, `0075`) passes **unchanged**. *(ADR-0059 Posture B. This FR **is** the owner's one-authority ruling
  made structural, and is owned by a structural + pgTAP proof, not reviewer vigilance.)*
- **FR-BUD-007 (the PMO transition is untouched — ADR-0059 §3.1)** — P3c shall **not** modify
  `activate_budget_version`'s authorization, semantics, state map, or the one-Active-per-project invariant.
  The push is a **consequence** added *after* the transition commits, **outside its transaction**. *(A DB
  function cannot call an edge function; "push from inside the RPC" is both impossible and wrong.)* **The one
  candidate change is OQ-BUD-2's additive `activated_at` witness** — escalated for an explicit ruling, never
  assumed.
- **FR-BUD-008 (activation never depends on ERP liveness — ADR-0059 §3.2)** — A push failure of **any** class
  shall never fail, block, roll back, or retry-loop `activate_budget_version`. **The user's activation always
  succeeds.** The failure becomes durable state + an operator surface (§5.5), never a blocked user.

### 5.2 The `budget` domain + kind (the P3a command-path template, minus the flip)

- **FR-BUD-010** — The `erpnext` adapter's `capabilityMap` shall grow additively to include **`budget`**; the
  `adapter-dispatch` registry accepts the new domain. **⚑ `domain_externally_owned` does NOT gain a `budget`
  row** (FR-BUD-006) — employment is asserted by the binding + the push route, not by a flip.
- **FR-BUD-011** — `DOCTYPE_REGISTRY` shall gain one additive entry — **`budget`** (`doctype:'Budget'`) —
  with `submittable` / `submitOnCreate` / `anchorField` / `anchorMutable` / **`neverReissue`** set from the
  OQ-BUD-1 spike. **Expected: `anchorField: null` ⇒ `neverReissue: true`** (FR-BUD-143). No existing entry is
  edited (the P3a merge-coordination discipline).
- **FR-BUD-012** — `DOCTYPE_BODIES` shall gain `bodies/budget.ts` (`budgetToBody`/`budgetFromDoc`), wired
  additively. `budgetToBody` builds `{company, fiscal_year, budget_against:'Project', project,
  accounts:[{account, budget_amount}], <overspend-control fields §5.6>}` — exact fields frozen by OQ-BUD-1.
- **FR-BUD-013 (kind↔domain enforcement + fail-closed refs — the P3a Luna findings, carried)** — The
  dispatch shall reject a command whose `erp_doc_kind` does not belong to its asserted `domain`
  (`commit-rejected`), and a reference that cannot be resolved server-side (the ERP project name, an account)
  shall **fail closed** — never a null, never a default, never a silent omission.
- **FR-BUD-014 (cross-org pre-flight — the P3a Luna finding, carried)** — Before any ERP call the dispatch
  shall assert that the `budget_version_id`, its `project_id`, and every resolved ref belong to the
  **caller's org**; a cross-org command is rejected before adapter selection.
- **FR-BUD-015 (error classification reuse)** — The shipped classifier (P2 FR-ENA-013) applies unchanged.
  `budget-category-unmapped` / `budget-multi-fiscal-year` / `budget-duplicate` are **non-retryable**
  `commit-rejected` buckets — **never blind-retried** (FR-ENA-042 carried).

### 5.3 Authorization + the server-side precondition (ADR-0059 §3.3 — the forged-payload guard)

- **FR-BUD-100 (⚑ the precondition is re-asserted server-side, from the DB, before any ERP call)** — Before
  adapter selection, before the outbox, and before any external call, the dispatch shall **re-read the budget
  version's state from the database under the caller's own JWT** and reject anything whose `status` is not
  **`Active`**. **The command payload is NEVER trusted to assert the precondition.** *(ADR-0059 §3.3: the
  gate either reads the required state from the DB or it throws — **there is no null/absent branch to fall
  into.** The Luna P3a audit found exactly this class of hole.)*
- **FR-BUD-101 (authorization before the ERP write)** — The push shall additionally require the caller to
  hold the **OD-BUDGET-3** role set (Admin/Executive/PM/Finance) — the same authority that may activate —
  re-checked **server-side** on the **real JWT role** (impersonation is view-only). `can()`/`<CanWrite>` is
  **UX-only**; the dispatch + RLS are the enforcement authority (NFR-BUD-SEC-003).
- **FR-BUD-102 (the sweep re-asserts the SAME gate — ADR-0059 §6)** — The sweep backstop has no user JWT. It
  shall take the **same server-resolved route** as the foreground path and **re-assert the same
  precondition** (the version is still `Active`) from DB truth — **never "trust itself" because it is the
  sweep**, and never finalize with a NULL actor. *(The Luna P3a audit found a sweep silently no-op'ing an SoD
  with a NULL actor. Same trap, named.)*

### 5.4 ⚑ THE CRUX — the category↔account mapping

PMO budgets a **`budget_category`** (7 values, OD-BUDGET-4: `Labor, Materials, Subcontractors, Equipment,
Permits & Fees, Overheads, Contingency`). An ERP `Budget` line is per **account** (the Chart of Accounts).
**Translating between them is the real work of this issue**, and a wrong translation silently mis-configures
the client's GL controls — the feature's entire point.

- **FR-BUD-110 (the map — location + shape)** — The system shall hold an **org-scoped**
  `budget_category_account_map` (`category` → `erp_account`) — **OQ-BUD-4(a): a dedicated table**, because the
  mapping needs an enum-typed key, DB-enforced uniqueness, RLS, an admin CRUD surface, and pgTAP integrity
  that a jsonb blob cannot give.
- **FR-BUD-111 (⚑ the map is a BIJECTION — both uniques are required)** — The map shall enforce **`unique
  (org_id, category)`** *and* **`unique (org_id, erp_account)`**. **Why both:**
  - `unique (org_id, category)` makes the **push** well-defined (one category → exactly one account; a
    category cannot fan out).
  - **`unique (org_id, erp_account)` makes the PROJECTION well-defined** (§5.7): the projection joins ERP
    **account**-grained actuals (`erp_actuals_snapshot`) back onto PMO **category**-grained budget lines, so
    it needs the **inverse** map. If two categories shared one account, actuals on that account could **not**
    be attributed back to a category without PMO **inventing a split** — an ADR-0048 violation. **The
    bijection is what makes the round-trip honest.**
  - **Accepted cost:** an org that wants two categories in one GL account cannot express it. A deliberate
    refusal — the alternative is a fabricated actuals split. Such an org merges the categories or splits the
    account. *(Surfaced in the admin UI as a validation error naming the conflicting category/account.)*
- **FR-BUD-112 (who administers)** — Map rows shall be writable **only** by **Admin**
  (`can('manage_external_bindings', …)` — the privileged, audited config gate P3a's `process_gates` flip
  uses), org-scoped, stamping `updated_by`/`updated_at`. It is a per-org accounting-configuration change, not
  a per-budget toggle. **RLS is the enforcement authority.**
- **FR-BUD-113 (⚑ UNMAPPED CATEGORY ⇒ FAIL CLOSED — never a default account)** — Where the Active version
  contains a line item whose `category` has **no** map row for the org, the push shall be **rejected at the
  dispatch boundary BEFORE any ERP call** (`commit-rejected` / `budget-category-unmapped`); the side mirror
  shall record `push_state='failed'`, `push_error='budget-category-unmapped'`, and **`unmapped_categories` =
  the exact list**; and an **`action-required`** operator surface shall name them. **The system shall NEVER
  substitute a default/fallback/suspense account and shall NEVER silently drop the line.** *(A
  silently-defaulted budget line means ERP enforces overspend controls against the wrong account — the
  feature actively misleading the client. Refusal is the only safe behavior. The activation itself still
  succeeds — FR-BUD-008.)*
- **FR-BUD-114 (the mapped body)** — `budgetToBody` shall emit one `accounts[]` row per **mapped category
  with a non-zero budgeted amount**, `budget_amount` = the Active version's Σ `budgeted_amount` for that
  category as a **decimal-string**. A **zero-amount** category emits **no** row (ERP has no meaning for a
  zero budget line); a category with no line items emits no row — **neither is an error** (only an *unmapped,
  non-zero* category is, FR-BUD-113).
- **FR-BUD-115 (`budget_against` = the PROJECT dimension)** — The pushed `Budget` shall carry
  `budget_against='Project'` and `project` = the ERP `Project` name resolved from the binding's
  ERP-project→PMO map (the R9-P3a #5 join key: ERP Projects use a `PROJ-#####` series and both GL legs carry
  `project`). An unresolvable ERP project **fails closed** (FR-BUD-013) — never a Cost-Center fallback, never
  an unattributed budget.

### 5.5 The push: trigger, upsert, lifecycle, durable failure

- **FR-BUD-120 (the trigger = activation; the push is its consequence — ADR-0055 §6)** — **Activating a
  budget version** (`activate_budget_version` committing a version to `Active`) shall trigger a synchronous
  push of that version's figure into the org's ERP `Budget` for (company × the project's fiscal year ×
  project). Per ADR-0059 §3.2 the push runs **after** the transition commits, outside its transaction. The
  two originators are the **foreground consequence path** and the **sweep backstop** (FR-BUD-141).
- **FR-BUD-121 (⚑ re-activation/revision = UPSERT the SAME ERP object — never a duplicate)** — Because ERP
  enforces **at most one `Budget` per (company, fiscal_year, project)** (OQ-BUD-1 #3), the push is an
  **upsert**: the **first** activation for a (project × FY) **creates**; every **subsequent** activation (a
  clone→activate revision, or a roll-back re-activation) **updates the SAME ERP `Budget`**, resolved via
  `external_refs` (domain `'budget'` → the ERP `name`) — **never** creating a second object. The **update
  mechanism is frozen by OQ-BUD-1 #4**: if `budget_amount` is updatable on a submitted `Budget`, the push is
  a `PUT`; **if update-after-submit is illegal, the push is cancel + amend** (the shipped P3a
  transition/lineage contract, FR-SAR-050..053, applies verbatim — repoint `external_refs`, stamp
  `erp_amended_from`, write lineage). **Do not design past the spike: this FR pins the *contract* (one ERP
  object per project×FY, upserted, never duplicated); the spike fills the *mechanism*.**
- **FR-BUD-122 (the ERP object always reflects the CURRENT Active version)** — After a successful push the
  ERP `Budget` for (project × FY) shall equal the org's **current Active** version. Archiving the Active
  version with **no successor** (OD-BUDGET-5(B) permits it, with a warning → project budget 0) shall surface
  `action-required` — **PMO shall not silently leave ERP enforcing a budget PMO no longer holds**, and shall
  **not** auto-delete the ERP object (a destructive ERP act with GL consequences is an operator decision).
  *(Deferred alternative: push a zeroed budget — FR-BUD-183.)*
- **FR-BUD-123 (⚑ push failure ⇒ durable, visible, honest about the ERP-side consequence — ADR-0059 §6)** —
  Because the activation already succeeded (FR-BUD-008), **nothing else will ever surface a failed push**:
  the user has moved on and PMO looks fine. Therefore the side mirror shall carry an explicit `push_state` +
  the classified `push_error` + (where relevant) `unmapped_categories`, index-served on `(org_id,
  push_state)` and **bounded per sweep tick** so one org's backlog cannot starve another's. The
  `action-required` surface shall state the **operational consequence in plain words** — **"ERPNext is still
  enforcing the previous budget (or none) for this project"** — because that, not a red badge, is what a
  finance user needs to know. `held` is terminal until an operator acts; `pushed` and `held` are never
  re-driven.
- **FR-BUD-124 (multi-FY ⇒ fail closed — OQ-BUD-3(a))** — Where the project's `start_date`/`end_date` span
  **more than one** fiscal year, the push shall be **rejected before any ERP call**
  (`commit-rejected`/`budget-multi-fiscal-year`), recorded `failed`, and surfaced `action-required`. **PMO
  shall NEVER invent a pro-rata or phased split across fiscal years** (a PMO-authored accounting allocation —
  ADR-0048).

### 5.6 Overspend controls (the point of the feature)

- **FR-BUD-130 (the pushed controls)** — The pushed `Budget` shall carry the org's configured overspend
  controls — `action_if_annual_budget_exceeded` + the `applicable_on_*` flags (literals frozen by OQ-BUD-1
  #8) — resolved from `external_org_bindings.config` (§4.4). This is **why the budget is pushed at all**; a
  `Budget` pushed without them is inert in ERP.
- **FR-BUD-131 (⚑ default `Warn`, NEVER `Stop` without an explicit org opt-in)** — `budget_overspend_action`
  shall default to **`'Warn'`**. **Rationale:** `'Stop'` makes ERP **block** a Purchase Order that exceeds the
  budget — the first push would silently start **rejecting a client's procurement, org-wide**, as a side
  effect of an integration. **A change of that blast radius must be a deliberate, Admin, audited opt-in**,
  never a default. Flipping to `'Stop'` requires Admin (the FR-BUD-112 gate) and is audited.

### 5.7 The PMO projection (PMO-only — **never pushed**)

- **FR-BUD-150 (the PMO-owned ETC)** — The system shall let an OD-BUDGET-3 user record, per **(project ×
  fiscal_year × category)**, a **PMO-owned** `pmo_etc` (estimate-to-complete). It is **additive-only**:
  ERPNext's `Budget` carries no ETC field, and PMO's own `budget_line_items` carries no forward estimate — it
  duplicates nothing.
- **FR-BUD-151 (the projection formula — derived on read, never stored, never pushed)** — For each
  (project × fiscal_year × category) cell:

  | Output | Formula | Provenance |
  |---|---|---|
  | `pmo_budget_amount` | `Σ budget_line_items.budgeted_amount` of the project's **Active** version for the category | **PMO SoT** (OD-BUDGET-1) — *not* an ERP read-back: PMO is the authority (the direction reversal's simplification) |
  | `actuals_to_date` | `Σ erp_actuals_snapshot.net` for the **mapped account** (via the FR-BUD-111 bijection's inverse) | **ERP truth** — P2's shipped sum of mirrored GL rows |
  | `pmo_etc` | `budget_projections.pmo_etc` (absent ⇒ `0`) | **PMO-owned, authored** |
  | **`projected_final_cost`** (EAC) | **`actuals_to_date + pmo_etc`** | derived |
  | **`projected_variance`** | **`pmo_budget_amount − projected_final_cost`** (positive ⇒ under budget) | derived |
  | **`projected_utilization`** | **`projected_final_cost ÷ pmo_budget_amount`**, **`NULL` when the budget is 0/NULL** (never `0`, never `Infinity`) | derived |

  Every derived value is **display-only**: computed on read, never persisted, **never pushed** (FR-BUD-160).
  PMO **sums** mirrored ERP rows (permitted — the `refreshActuals` precedent) and adds a PMO-authored ETC; it
  **never re-derives an accounting figure** (ADR-0048).
- **FR-BUD-152 (divergence is reported, never merged — ADR-0059 §8)** — Where the side mirror indicates the
  ERP object no longer matches PMO's Active version (a Desk edit, an external cancel, a `failed` push), the
  surface shall **report the divergence** — **PMO's figure remains authoritative and displayed**. PMO shall
  **never** merge an ERP-side budget edit into a version, and shall never let an ERP figure override
  `get_project_budget()`. *(The operative resolution of OQ-BUD-5.)*
- **FR-BUD-153 (the read RPC)** — `get_budget_projection(p_project_id uuid, p_fiscal_year text)`, **SECURITY
  INVOKER** (the `get_project_budget` idiom, mig `0005`: org isolation comes from the underlying tables'
  RLS — no hand-rolled org filter, no security-definer), returning per-**category** inputs + derived outputs +
  the push-state/divergence provenance. Reads serve from **Supabase only** — no UI/read path may
  synchronously query ERPNext.
- **FR-BUD-160 (⚑ the projection is NEVER pushed — structurally)** — There shall be **no code path** by which
  `pmo_etc` or any derived projection value reaches ERPNext: `budgetToBody` shall emit **only** the Active
  version's `budgeted_amount` per mapped category — **never** `pmo_etc`, **never** an EAC. Owned by a
  **structural test** (AC-BUD-054). *(The projection is PMO's forecast; pushing it would put a PMO estimate
  into the client's GL controls.)*

### 5.8 Inbound: lifecycle-only — **NEVER adopt** (ADR-0059 §5)

- **FR-BUD-140 (⚑ never adopt — the SoT-inversion guard)** — An inbound ERP `Budget` event with **no**
  `external_refs` mapping (created natively in the Desk) shall be **ack-and-skipped** and surfaced
  `action-required`. It shall **NEVER** be adopted into `budget_versions`. *(ADR-0059 §5. The deliberate
  **inverse** of P3a's FR-SAR-085 adopt rule — there ERP is SoT; here adoption would mint a budget that never
  passed PMO's activation authority, inverting the owner's one-authority ruling.)* Inbound for
  **PMO-originated** budgets is **lifecycle-only**: stamp `erp_docstatus`/`erp_modified`, tombstone on an
  external cancel, guard on `erp_modified` monotonicity — and **never write a PMO SoT table**.
- **FR-BUD-141 (the sweep backstop = the second originator)** — The `erpnext-sweep` shall reconcile the side
  mirror's work queue: rows in `pending`/`failed` (and `pushing` past its lease) whose version is **still
  Active** (re-asserted per FR-BUD-102) are re-driven through the **same** dispatch path — one algorithm,
  shared with the foreground (the shipped `reconcileOrgOutbox` discipline). Bounded per tick; one org's
  failure never aborts another's (the shipped resilience contract).
- **FR-BUD-142 (⚑ never fight the operator — ADR-0059 §5 corollary)** — An **external cancel** of a pushed
  `Budget` shall **NOT** be auto-re-pushed by the sweep (the backstop would instantly re-create what a human
  just cancelled — an infinite fight). It shall tombstone the side mirror (`erp_cancelled_at`,
  `erp_docstatus=2`), set `push_state='failed'`, and surface `action-required`. **The PMO version stays
  `Active`: PMO's budget is not ERP's to revoke.**
- **FR-BUD-143 (⚑ anchor-less ⇒ never reissue — ADR-0059 §4 corollary)** — Where OQ-BUD-1 #5 confirms
  `Budget` has **no** stock anchor field surviving `validate`, the `budget` kind ships `anchorField: null` +
  **`neverReissue: true`**, so `reissueOnInconclusiveAbsence = !(anchorMutable || neverReissue)` ⇒ **false**:
  a post-window inconclusive recovery is **`held`**, terminal until an operator — **never auto-reissued**.
  *(Today a `null` anchor means "skip the probe → fresh claim+POST" = reissue-capable; for a Posture-B budget
  that is a silently duplicated ERP object. The `neverReissue` flag is **additive and default-absent** —
  introduced by P3b; **P3c reuses it and must not re-invent it**. If P3b has not landed it when P3c builds,
  P3c adds it with the same one-line semantics.)*
- **FR-BUD-144 (master data is still Posture A — ADR-0059 §5 exception)** — Resolving the ERP `Project` (and
  any account master) uses the **shipped adopt/read paths unchanged**: PMO is not their SoT and no PMO process
  is bypassed. **The never-adopt rule applies to the domain's process document (`Budget`), not to the masters
  it references.**

---

## 6. Non-functional requirements

- **NFR-BUD-SEC-001** — No ERP custom app; stock ERPNext/Frappe APIs only (ADR-0055 §2). The `Budget` body
  uses only stock fields.
- **NFR-BUD-SEC-002** — Per-org ERP credentials are **server-only**, resolved **only** through the shipped
  `erpnext/credentials.ts` seam (OD-ENA-VAULT-SEAM). Never in browser code, never in a mirror, never logged.
- **NFR-BUD-SEC-003** — **RLS is the enforcement authority** (ADR-0016) for `budget_projections`,
  `budget_category_account_map`, and the side mirror; `can()`/`<CanWrite>` is UX-only. The dispatch's
  server-side re-read (FR-BUD-100/101) is the push's authority — **the payload is never trusted**.
- **NFR-BUD-SEC-004** — The push shall preserve the `org_id` seam and ship pgTAP proofs for org isolation, the
  Admin-only map gate, the OD-BUDGET-3 ETC gate, machine-only side-mirror writes, **and the no-flip proof**
  (FR-BUD-006).
- **NFR-BUD-IDEM-001** — The ADR-0058 contract + ADR-0059 §4's **deterministic key** shall make a duplicate
  ERP `Budget` **impossible** under retry-after-timeout / 429 / mirror-finalization-failure / **the two
  originators racing** / lease-expiry overlap — proven at the **real served boundary** with the
  `after-commit-before-mirror` fault seam. The anchor-less `held` (FR-BUD-143) is the duplicate guard.
- **NFR-BUD-MONEY-001** — Every budget amount crosses as a **decimal-string** end-to-end; **no monetary value
  passes through JS float math**. The projection's arithmetic is SQL `numeric`.
- **NFR-BUD-PERF-001** — The push is per-activation (rare — a budget is activated a handful of times per
  project per year); the sweep backstop is **index-served on `(org_id, push_state)` and bounded per tick**.
  Interactive commands keep priority over the sweep. *(Scale note: the cheapest of the three P3 write paths —
  activation is a low-frequency human act, so there is no batching or fan-out risk.)*
- **NFR-BUD-CONTRACT-001** — Frappe vocabulary (`Budget`, `budget_against`, `budget_amount`, `fiscal_year`,
  `action_if_annual_budget_exceeded`, `/api/resource`, `docstatus`) lives **solely** under
  `pmo-portal/src/lib/adapterSeam/erpnext/**` + the ERPNext edge fns. The PMO-side verbs that cross the
  contract are the `budget` domain + the `budget` kind (PMO words, never Frappe names). **`budget_category` is
  a PMO word and never crosses into ERP** — the map (§5.4) is the boundary.
- **NFR-BUD-REV-001** — Every P3c migration is reversible. **`drop table budget_version_erp_mirror` + `drop
  table budget_category_account_map` + `drop table budget_projections` ⇒ ZERO PMO data loss** (ADR-0059
  §3.7) — PMO's budget module is untouched and remains fully functional. The strongest reversibility posture
  PMO has, and a real de-risker for the first ERPNext client.
- **NFR-BUD-TEST-001** — Each AC has exactly one owning test at its lowest sufficient layer. **Every push e2e
  uses the real served `adapter-dispatch` boundary + the named server-side fault seams — never `page.route`**
  (P2 Finding 13). Files: `pmo-portal/e2e/serial/AC-BUD-*.spec.ts`, under `scripts/with-db-lock.sh` + the
  shared ERPNext-stack lock.
- **NFR-BUD-DEVBED-001** — The canonical bed is the same stock Docker ERPNext v15 stack P2/P3a/P3b use.

---

## 7. Per-table enumeration (the RLS observables table)

**⚑ There is NO flip row here** — that is the point. P3c's table is the **inverse** of P3a's §7: PMO's tables
stay exactly as shipped, and the new tables are either machine-written (the side mirror) or PMO-owned (the
map, the projection).

| Table | Write policy | Trigger handling | pgTAP proof |
|---|---|---|---|
| **`budget_versions` / `budget_line_items`** (**existing — UNTOUCHED**) | **Unchanged.** The shipped OD-BUDGET-3 gate; **no flip**, no `domain_externally_owned`, no `*_native_mirror_guard`. | unchanged | **FR-BUD-006's no-flip proof** + the shipped budget suite (`0008`–`0012`, `0060`, `0075`) passing **unchanged** |
| **`budget_version_erp_mirror`** (new) | **Machine-only** (the 0101 idiom): `SELECT` = org + active member; **no** INSERT/UPDATE/DELETE policy ⇒ user-JWT write `42501`. Dispatch/sweep service role only. | `stamp_org_id()` (0074); no `GENERATED` column, no derived trigger ⇒ **no service-role bypass needed** (stated, not assumed) | user write denied `42501`; service write ok; org-isolated; `push_state` CHECK domain; `(org_id, push_state)` index exists |
| **`budget_category_account_map`** (new) | **Admin-only, org-scoped.** `SELECT` = org + active member; write = org + active member + **Admin** (FR-BUD-112). | `stamp_org_id()` | org isolation; **Finance/PM/Exec write denied `42501`** (Admin-only — deliberately stricter than OD-BUDGET-3); **both uniques enforced** (the bijection); cross-org denied |
| **`budget_projections`** (new — PMO-owned) | **User-writable, role-gated:** org + active member + `auth_role()` ∈ (Admin, Executive, Project Manager, Finance) — **OD-BUDGET-3 reused verbatim**, consistent with `budget_versions_write`. Never flip-gated. | `stamp_org_id()` | org isolation; Engineer denied `42501`; the four roles ok; cross-org `project_id` denied; unique-cell upsert |

pgTAP files: `supabase/tests/budget_erp_mirror_rls.test.sql`, `budget_category_account_map_rls.test.sql`,
`budget_projections_rls.test.sql`, **`budget_no_flip_invariant.test.sql`** (FR-BUD-006).

---

## 8. Acceptance criteria (Given/When/Then)

> The **byte-for-byte / no-flip invariants** (AC-BUD-001..003), the **mapping crux** (AC-BUD-010..012), and
> the **two-originator idempotency** (AC-BUD-021) are the heart of P3c. Flip/RLS/org ACs are **pgTAP**;
> mapping-logic, gate, key, formula and lifecycle ACs are **Vitest**; cross-stack push flows are **served-fn
> e2e**. One owning test per AC at its lowest sufficient layer (ADR-0010).

### The invariants

- **AC-BUD-001** — A non-employing org: activation makes no ERP call. **[unit]**
  **Given** an org with no activated `erpnext` binding (the shipped default),
  **When** a budget version is activated,
  **Then** no ERP call is made, no outbox row and no side-mirror row is created, the activation succeeds, and
  `get_project_budget()` + every KPI are identical to pre-P3c. (FR-BUD-004, FR-BUD-005)
- **AC-BUD-002** — The P2/P3a/P3b suites + the shipped budget suite remain green. **[cross-layer regression gate]**
  **Given** the `budget` domain + kind + the three new tables are installed and no org employs `budget`,
  **When** the P2/P3a/P3b suites **and the shipped budget pgTAP suite (`0008`–`0012`, `0060`, `0075`)** run
  unchanged, **Then** every previously-passing test still passes. (FR-BUD-004, FR-BUD-006) *(Meta-AC.)*
- **AC-BUD-003** — ⚑ **PMO's budget tables are NOT flipped and PMO remains the authority.** **[pgTAP]**
  **Given** org A **employs** `budget`→`erpnext` and org B does not,
  **When** a Finance user in **each** org writes a `budget_line_item`, activates a version, and reads
  `get_project_budget()`,
  **Then** **both succeed identically**; **no** `domain_externally_owned` row for `'budget'` exists; **no**
  policy on `budget_versions`/`budget_line_items` references `domain_externally_owned`; **no**
  `*_native_mirror_guard` trigger exists on either; and `get_project_budget()` returns **Σ the Active
  version's line items** in both orgs. (FR-BUD-006, FR-BUD-007) *(The owner's one-authority ruling, made
  structural.)*

### ⚑ The mapping crux

- **AC-BUD-010** — The map is org-isolated, **Admin-only**, and **bijective**. **[pgTAP]**
  **Given** orgs A and B and users of each role,
  **When** each attempts to write `budget_category_account_map`, and a second row is written for an
  already-mapped **category**, and separately for an already-mapped **account**,
  **Then** **Admin** succeeds in its own org; **Finance / PM / Executive / Engineer are denied `42501`**
  (Admin-only — deliberately stricter than OD-BUDGET-3); cross-org is denied; org B cannot read org A's map;
  and **both** duplicate writes are rejected by their unique constraints (the bijection). (FR-BUD-110..112)
- **AC-BUD-011** — ⚑ **An unmapped category fails closed with the categories named — no ERP call, no default
  account.** **[unit]**
  **Given** an employing org whose Active version has non-zero line items in `Materials` (mapped) and
  `Contingency` + `Overheads` (**unmapped**),
  **When** the version is activated and the push runs,
  **Then** the push is rejected **before any ERP call** (`commit-rejected`/`budget-category-unmapped`), the
  side mirror records `push_state='failed'` + `unmapped_categories = ['Contingency','Overheads']` (**the exact
  list**), an `action-required` surface names them, **no** default/fallback/suspense account is substituted,
  **no** line is silently dropped, and **the activation itself still succeeded**. (FR-BUD-113, FR-BUD-008)
- **AC-BUD-012** — The body maps categories→accounts, uses the **project** dimension, and omits zero rows.
  **[unit]**
  **Given** an Active version with `Labor=50000.00`, `Materials=25000.00`, `Equipment=0.00`, a complete map,
  and a resolved ERP project,
  **When** `budgetToBody` runs,
  **Then** the body carries `budget_against='Project'`, `project=<the ERP PROJ-name>`, the configured
  overspend controls, and exactly **two** `accounts[]` rows (Labor→its account `'50000.00'`, Materials→its
  account `'25000.00'`) as **decimal-strings** — the **zero** Equipment row is **omitted**, and **no**
  `pmo_etc`/EAC value appears anywhere. (FR-BUD-114, FR-BUD-115, FR-BUD-130, FR-BUD-160)

### The gate + idempotency (ADR-0059 §§3–4)

- **AC-BUD-020** — ⚑ The precondition is re-read from the DB; the payload is never trusted. **[unit]**
  **Given** a budget version whose real DB `status` is **`Draft`**, and a command payload that **falsely
  claims** it is `Active` (a forged payload),
  **When** the dispatch runs,
  **Then** it re-reads the status under the caller's JWT, rejects (`commit-rejected`) **before** adapter
  selection / the outbox / any ERP call, and **no** branch treats an absent/null status as permission.
  (FR-BUD-100)
- **AC-BUD-021** — ⚑ **Two originators cannot create two ERP Budgets.** **[unit]**
  **Given** the deterministic key (OQ-BUD-2's stamp) and the foreground path and the sweep backstop both
  driving the **same** activation concurrently,
  **When** both attempt the push,
  **Then** both derive the **identical** key, the second `INSERT` fails atomically on `unique (org_id, domain,
  pmo_record_id, idempotency_key)` (`23505`), the loser **reconciles to the winner's result**, and exactly
  **one** ERP `Budget` exists. (FR-BUD-141, ADR-0059 §4, NFR-BUD-IDEM-001)
- **AC-BUD-022** — ⚑ An anchor-less budget push is **held**, never reissued. **[unit]**
  **Given** a `budget` outbox row past its `reconcile_after` window whose kind has `anchorField: null` +
  `neverReissue: true`,
  **When** the recovery path runs and the probe is inconclusive,
  **Then** `reissueOnInconclusiveAbsence` is **false**, the row transitions to **`held`** (terminal, excluded
  from `outbox_reconcile_candidates`), a retry surfaces the non-retryable `command-held`, and **no second ERP
  `Budget` is ever created**; **every shipped kind's reissue behavior is byte-for-byte unchanged**.
  (FR-BUD-143, ADR-0059 §4 corollary)
- **AC-BUD-023** — The sweep re-asserts the same gate and never acts with a NULL actor. **[unit]**
  **Given** a side-mirror row `pending` whose budget version has since been **Archived** (no longer Active),
  **When** the sweep backstop runs,
  **Then** it re-reads the version's state from DB truth, does **not** push, and does **not** finalize
  anything with a NULL actor. (FR-BUD-102)

### The push (real boundary)

- **AC-BUD-030** — Activation pushes the mapped budget with its overspend controls. **[served-fn e2e]**
  **Given** the OQ-BUD-1 spike frozen, an employing org, a complete map, a single-FY project, and an Active
  version,
  **When** the user activates the version through the served boundary,
  **Then** ERPNext holds one `Budget` for (company, FY, project) with `budget_against='Project'`, one
  `accounts[]` row per mapped non-zero category at the exact amounts, the configured
  `action_if_annual_budget_exceeded`, the `external_refs` (`'budget'`) mapping recorded, the side mirror
  `push_state='pushed'` — and **no `page.route`** is used. (FR-BUD-120, FR-BUD-114, FR-BUD-130)
- **AC-BUD-031** — ⚑ **Re-activation upserts the SAME ERP Budget — never a duplicate.** **[served-fn e2e]**
  **Given** a pushed budget, then a clone → edit → activate revision, and separately a roll-back
  re-activation of the earlier version,
  **When** each activation pushes,
  **Then** ERPNext holds **exactly one** `Budget` for (company, FY, project) after each — updated (or
  cancel+amended per the spike) to the **current Active** version's figures — **never a second object**;
  `external_refs` resolves to the same/repointed ERP `name`; and the roll-back re-activation is **NOT silently
  suppressed** (the OQ-BUD-2 stamp makes it a distinct command). (FR-BUD-121, FR-BUD-122, OQ-BUD-2)
- **AC-BUD-032** — ⚑ A push failure never blocks activation; the surface states the ERP consequence. **[unit]**
  **Given** an employing org whose ERP is unreachable,
  **When** a user activates a budget version,
  **Then** **the activation succeeds** (the version is Active, `get_project_budget()` reflects it, the user
  sees success), the side mirror records `push_state='failed'` + `push_error='external-unreachable'`, an
  `action-required` surface states **"ERPNext is still enforcing the previous budget"**, and the sweep
  backstop re-drives it. (FR-BUD-008, FR-BUD-123)
- **AC-BUD-033** — A multi-fiscal-year project fails closed; no split is invented. **[unit]**
  **Given** a project whose `start_date`/`end_date` span FY2026 and FY2027,
  **When** its budget version is activated,
  **Then** the push is rejected **before any ERP call** (`budget-multi-fiscal-year`), recorded `failed`,
  surfaced `action-required` naming the spanned years, and **no** pro-rata/phased split is computed and **no**
  partial budget is pushed. (FR-BUD-124)

### Inbound (ADR-0059 §5)

- **AC-BUD-040** — ⚑ A Desk-created Budget is **never** adopted. **[unit]**
  **Given** an ERP `Budget` created natively in the Desk (no `external_refs` mapping) and an inbound
  webhook/sweep event,
  **When** the feed applies it,
  **Then** it is **ack-and-skipped** and surfaced `action-required`; **no** `budget_versions` or
  `budget_line_items` row is minted or modified; and `get_project_budget()` is unchanged. (FR-BUD-140)
- **AC-BUD-041** — ⚑ An external cancel is **never** auto-re-pushed. **[unit]**
  **Given** a pushed `Budget` that an operator cancels in the Desk (`docstatus 2`),
  **When** the feed applies the cancel and the sweep backstop then runs,
  **Then** the side mirror is tombstoned (`erp_cancelled_at`, `erp_docstatus=2`), `push_state='failed'`,
  `action-required` is surfaced, **the sweep does NOT re-push**, and **the PMO version stays `Active`** (PMO's
  budget is not ERP's to revoke). (FR-BUD-142)

### The projection (PMO-only)

- **AC-BUD-050** — The formula is exact over PMO's budget + ERP actuals. **[unit]**
  **Given** a category cell with `pmo_budget_amount = 100000.00` (PMO's Active version),
  `actuals_to_date = 40000.00` (the mapped account's ERP GL actuals), `pmo_etc = 35000.00`,
  **When** the projection is derived,
  **Then** `projected_final_cost = 75000.00`, `projected_variance = 25000.00`,
  `projected_utilization = 0.75`. (FR-BUD-151)
- **AC-BUD-051** — Degenerate inputs are honest. **[unit]**
  **Given** (i) a zero and (ii) a null `pmo_budget_amount`, (iii) an absent ETC row, and (iv) an
  over-`numeric(14,2)` value,
  **When** each is derived,
  **Then** (i)+(ii) yield `projected_utilization = NULL` (never `0`, never `Infinity`, never a throw);
  (iii) treats `pmo_etc` as `0` ⇒ `EAC = actuals`; (iv) is classified, not truncated. (FR-BUD-151)
- **AC-BUD-052** — `budget_projections` RLS: org-isolated + OD-BUDGET-3 gated. **[pgTAP]**
  **Given** orgs A and B and users of each role,
  **When** each writes a `budget_projections` row,
  **Then** Admin/Executive/PM/Finance succeed in their own org; **Engineer is denied `42501`**; cross-org
  `project_id` is denied; org B cannot read org A's; and the unique cell is an upsert target. (FR-BUD-150)
- **AC-BUD-053** — The RPC is org-scoped under the caller's RLS and matches the unit oracle. **[pgTAP]**
  **Given** Active-version line items, mapped-account actuals, and ETC rows in orgs A and B,
  **When** an org-A member calls `get_budget_projection(projectA, fy)` then `(projectB, fy)`,
  **Then** the first returns org A's per-**category** cells whose derived values equal the unit oracle
  exactly, plus the push-state/divergence provenance; the second returns **zero rows** (RLS, not a hand-rolled
  filter). (FR-BUD-153)
- **AC-BUD-054** — ⚑ **The projection is never pushed to ERP.** **[unit — structural]**
  **Given** an Active version, a complete map, and a `pmo_etc` of `35000.00`,
  **When** `budgetToBody` runs and every request the adapter issues is captured,
  **Then** the body contains **only** the Active version's `budgeted_amount` per mapped category; **no**
  `pmo_etc`, EAC, variance, or utilization value appears in any field of any request; and no dispatch route
  accepts a projection record. (FR-BUD-160)

---

## 9. Deferred FRs (flagged, explicitly NOT built)

- **FR-BUD-180 (deferred)** — `Monthly Distribution` / budget phasing (→ a phased S-curve-shaped budget).
- **FR-BUD-181 (deferred)** — **Multi-fiscal-year fan-out** — requires a FY/phasing dimension on
  `budget_line_items` (a **PMO product change**, its own issue — OQ-BUD-3(c)). Until then FR-BUD-124 fails
  closed.
- **FR-BUD-182 (deferred)** — A commitments-aware EAC (`actuals + open_commitments + etc`) — the prior ruling
  holds (out); would source ERP's own commitment figure, never recompute one (ADR-0048).
- **FR-BUD-183 (deferred)** — Pushing a **zeroed** budget when the Active version is archived with no
  successor (FR-BUD-122 surfaces `action-required` instead — zeroing/deleting an ERP object with GL
  consequences is an operator decision).
- **FR-BUD-184 (deferred)** — Cost-Center-dimension budgets (`budget_against='Cost Center'`).
- **FR-BUD-185 (deferred)** — A PMO-native re-open of an Active version (ADR-0059 §8: its own issue).

---

## 10. Open questions for the Director / owner (summary)

1. **OQ-BUD-2 — ⚑ the activation state stamp. NEW; the sharpest question the write direction surfaces.
   Blocks sign-off.** ADR-0059 §4 demands a deterministic key `<prefix>:<pmo_id>:<state_stamp>`, but
   **`budget_versions` has no `activated_at`** — and a version-id-only (or content-digest) key **silently
   suppresses a roll-back re-activation**, leaving ERP enforcing the wrong budget. Proposed: **(a) add an
   additive, nullable `budget_versions.activated_at` stamped by `activate_budget_version`** — which **ADR-0059
   §3.1/§8 forbids** (it touches the transition's schema + RPC). **The owner should either ratify (a) as a
   narrow, explicitly-scoped exception (it is a *witness*, not a rule: no gate, no semantic change, no KPI
   touched) or split it into a 2-task pre-req issue.**
2. **OQ-BUD-3 — ⚑ multi-fiscal-year projects. Blocks sign-off.** PMO's budget has **no FY dimension**; ERP's
   `Budget` is per FY (ADR-0055 §6: multi-year projects need one object per FY). Proposed: **(a) push the
   start FY, fail closed on multi-FY** — never invent a split (ADR-0048). **The owner should size the accepted
   cost:** if most real projects span fiscal years, the feature is largely inert until (c) (a FY/phasing
   dimension on `budget_line_items` — a PMO product change, its own issue).
3. **OQ-BUD-1 — the `Budget` write field map. Blocks slices 1–2.** The spike is running →
   `docs/spikes/2026-07-16-erpnext-budget-fields.md` (binding). Highest-value answers: **#4** (is
   update-after-submit legal, or is revision cancel+amend?) and **#5** (is there an anchor field? expected
   **no** ⇒ `neverReissue`).
4. **OQ-BUD-4 — where the map lives. Non-blocking.** Proposed **(a) a dedicated table** (enum key + the
   bijective uniques + RLS + admin CRUD + pgTAP integrity — none of which jsonb gives) over **(b)** the
   `process_gates`/OD-ENA-SHARED-BINDINGS jsonb precedent.
5. **OQ-BUD-5 — ADR-0055 §6's "ERP's figure wins unconditionally" + "capture as new version". Needs a
   recorded clarification.** Those two clauses are **two-way sync** and contradict the owner's one-authority
   ruling + ADR-0059 §8. Proposed reading: §6's **mechanism stands** (one Active version → one ERP object per
   project×FY; activation = the command); its **reconcile-up/ERP-wins clauses are superseded by the
   2026-07-16 ruling** and are not built — a Desk edit is **reported as divergence**, never merged
   (FR-BUD-152). **This spec is written that way; the Director records it** (no ADR is edited here).
6. **Also for the Director:** ADR-0059 §7's ownership-map **posture column gains a Budgets row** (§1.1's
   wording is ready to lift), and ADR-0055 §5's Budgets row ("ERP object + PMO versions") should be read
   **with Posture B** so a future builder does not pattern-match it into a flip.
