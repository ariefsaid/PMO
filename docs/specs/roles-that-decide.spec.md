# Roles that decide: approval steps and purchase orders read job roles

Lane gap-material, item roles-that-decide (map #902). Status: draft for Director review (phase 1). Rulings read: OD-SCOPE-2,
OD-SCOPE-3, ADR-0016, ADR-0019, ADR-0070, `builtin-role-set.spec.md` (§5 names this seam), `material-requests.spec.md`.
Built on `feat/role-capabilities-one-gate`, merged at ebaf4808 (its parent of the tip): the tip commit 411577dc adds a temporary
mutation migration (`1540_mut_temporary.sql`) that deliberately breaks two gates for a mutation run, so it is not merged; the branch
removes it in its next commit. Its principles hold here: one gate per right, a consumer sweep, no right declared that nothing reads.
Phase 1 approved by the Director 2026-11-22 with the recommended answers to §7 Q1-Q4.

**Job story.** When an Admin sets who approves a step, owns a step or may view a document type, I want to pick a job role, and the
rule to hold in the database.

"Job role" below is the glossary's **built-in role** (`profiles.built_in_role`, one of the 28 catalogue keys). "Access level" is the
**base access level** (`profiles.role`, five values).

## 1. Today (verified at head of this branch)

| Area | What the code does | Where |
|---|---|---|
| Job roles stored | `profiles.built_in_role text` (nullable, FK to the catalogue); a trigger keeps `profiles.role = built_in_role_base(key)` while a key is held; assignment refused while `organizations.built_in_roles_enabled` is false | 1200 `built_in_role_base`, 1201, 1202 |
| Role seam | `actor_built_in_role()`, `actor_has_role_capability(cap)`, `actor_sees_prices()` | 1203 |
| Merged branch | `actor_holds_built_in_role(key)` was declared for "approval steps, notifications and document categories" and **dropped** because nothing read it; capabilities pruned to five, each read by one gate; sweep `2716` | 1539:15, `supabase/tests/2716` |
| MR chain | `approval_chain_steps(position 1..10, role user_role not null, label, only_over_plan)`: an ordered chain of 0 to 10 steps the Admin sets (`mrq_set_chain`, Admin only). The number of steps is the organisation's data; nothing fixes three. | 1000:35-44, 1001:157-180 |
| MR who decides | `mrq_step_authority`: the decider's `profiles.role = step.role` exactly (no rank), or an in-window one-hop stand-in for someone who does; a project pin narrows to one named person | 1045:73-96 |
| MR order and SoD | the open step only (`MRQ_OUT_OF_ORDER`), never the author (`MRQ_SOD_AUTHOR`), one person one step across rounds; a step is "the same" when `(position, role, label)` match | 1045:98-141 |
| MR queue and notices | `mrq_waiting_for_me`, `mrq_step_recipients` call `mrq_step_authority`; recipients prefilter `p.role = s.role` | 1045:170-195, 1336:15-43 |
| Pins | `approval_step_pins(project, position, role, approver)`; the pinned person must hold the step's level; the pin lapses when the level at that position changes | 1045:12-71 |
| Daily cut-off | **exists**: `material_request_settings.cutoff_time` (null = none), `mrq_set_cutoff` (Admin), enforced in `mrq_submit` via `mrq_cutoff_earliest`, refusal `MRQ_CUTOFF`; settings screen `MaterialRequestSettings.tsx` `CutoffEditor`; proven in `supabase/tests/mrq_submit_transfer.test.sql:62-86` | 1000:30, 1001:52-61, 1001:182-193, 1001:334 |
| Raise a PO | `create_purchase_order`: level in Admin, Executive, Project Manager, Finance | 0712 (+ guard line from 1530) |
| Send a PO | `transition_procurement` to `Ordered` mints the order as `Issued`: Project Manager or Finance (Admin bypasses); `purchase_orders_insert` / `_update` policies: the same four levels as raise | 1017:145, 1017:184-186, 0646:2578-2600 |
| Who reads purchases | outside Admin, Executive, Project Manager, Finance a member reads only purchases they raised and the records under them | 0350 §1-§3 |
| Buyer | catalogue key `buyer`, officer, base Engineer, sees prices. **A Buyer cannot raise or send a PO and reads only their own purchases.** | 1200, 0350, 0712 |
| Billing step owner | `billing_stage_templates.owner_role`, `claim_billing_stages.owner_role` are `user_role`; needs-you reads `s.owner_role = v_role` | 1365:8-20, 1368:26, 1369:22 |
| Document viewers | `document_category_roles(category, role user_role)`; `document_category_visible` reads `auth_role()` | 1164:23-27, 1166:8-13 |
| Billing lane | `feat/gap-billing-billing-steps` exists at `fc42e1a0`, the same commit as this lane's base: no spec pushed. Part (c) stops at exposing the function. | `git ls-remote`, 2026-11-22 |

## 2. Design

One deciding function, `holds_job_role`. Each consumer stores a job-role key (FK to `built_in_roles(key)`) where it stores a level
today, and calls the function where it compares levels today. A consumer row with **no job role** keeps today's rule exactly; that is
how an organisation already using the older behaviour keeps it. No per-feature switch is added; naming a job role is offered only while
the organisation's existing `built_in_roles_enabled` setting is on.

### 2.1 The deciding function (contract)

```
public.holds_job_role(p_profile uuid, p_job_role text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
```

True exactly when all hold:
1. `p_job_role` is a catalogue key (`built_in_role_base(p_job_role)` is not null);
2. the profile is an active member (`is_active_member(p_profile)`);
3. either **(holds)** `profiles.built_in_role = p_job_role`, or **(an access level that includes it)** `profiles.built_in_role is null`
   and `profiles.role = built_in_role_base(p_job_role)`.

"Includes" is read from the one existing mapping, `built_in_role_base`: an access level includes every job role built on it, for a
person who has not been given a job role. A person who holds a job role is judged by it alone, so a Storekeeper does not count as a
Material Coordinator although both sit on Engineer. Null or unknown key: false. It does not check the organisation; every consumer
already compares `org_id`. Because it takes any profile id, it is executable only by `service_role` and by the definer bodies
that call it (they run as the owner); a signed-in caller never gets a "does this id hold that role" answer about another person.
Policies reach it through the actor-scoped gate `actor_may_order_purchases()` (§2.3).

Frontend mirror: `holdsJobRole({ builtInRoleKey, role, active }, key)` in `pmo-portal/src/auth/builtInRoles.ts`, same rule, tested
against the same cases. `can()` reads it; the database is the authority.

### 2.2 Consumer (a): material-request approval steps

- `approval_chain_steps.job_role text null references built_in_roles(key)`; when set, `role` is set to `built_in_role_base(job_role)`
  in the same statement (so the level column, the open-step index and every existing reader stay true).
- `material_request_steps.job_role` (snapshot at submit, FR-MRQ-006) and `approval_step_pins.job_role` (the pin lapses when
  `(role, job_role)` at the position changes).
- `mrq_step_authority` gains `p_job_role`: the decider, and the delegator a stand-in acts for, fill the step when
  `case when p_job_role is null then p.role = p_role else holds_job_role(p.id, p_job_role) end`. Order, never-the-author, one person
  one step, stand-in window and pins are unchanged; the step identity for "one person one step" becomes `(position, role, job_role, label)`.
- Callers restated: `mrq_decide_step`, `mrq_waiting_for_me` (returns `job_role` too), `mrq_step_recipients`, `mrq_pinned_to`,
  `mrq_set_step_pin` (the pinned person must fill the step), `mrq_submit` (copies `job_role`), `mrq_set_chain` (accepts `job_role`).
- The cut-off is not rebuilt; it gets one acceptance line pointing at its existing proof.

### 2.3 Consumer (b): a Buyer raises and sends a purchase order

- `purchase_order_settings.order_job_roles text[] not null default '{}'`: the job roles that may raise and send purchase orders in
  addition to today's levels. Each entry must be a catalogue key. Empty (the default, every existing organisation) = today.
  Written through `po_set_order_job_roles(text[])` (Admin only, beside the existing Admin-only `po_set_print_settings`); a BEFORE
  trigger on the column holds the rules on every write path (the RPC and the existing Admin table policy): catalogue keys only, no
  field role, and a non-empty list only while built-in roles are on.
- One gate, `actor_may_order_purchases() returns boolean`: true when the real signed-in person (never the view-as role) holds
  one of their organisation's `order_job_roles` by `holds_job_role`. Granted to `authenticated` (the read-scope policies call it,
  wrapped `(select ...)`); a scalar helper for the field-account sweep (`2711`). Every channel calls it, ORed with the existing level rule, never replacing it:
  `create_purchase_order` (on an Approved, Vendor Quoted, Quote Selected or Ordered purchase), `transition_procurement` from `Approved`
  or `Quote Selected` to `Ordered` (a job-role orderer never skips approval: from `Draft` it is refused), `purchase_orders_insert` /
  `_update` (on the same approved states), and the 0350 restrictive read
  scopes for purchases and their order-side records (items, quotations, status events, documents, purchase requests, RFQs, purchase
  orders, and their file rows). Vendor bills, payments and client billing stay with today's four levels.
- Refusals a person can meet: ordering without the right raises `PO_ORDER_FORBIDDEN` (from `create_purchase_order`, and from
  `transition_procurement` to Ordered for a non-Admin outside the levels and the ordering job roles), ordering an unapproved purchase
  as a job-role orderer raises `PO_ORDER_NOT_APPROVED`, a step decided by someone without its job role raises `MRQ_NOT_APPROVER` (new
  sentence naming the job role route), and the settings raise `MRQ_JOB_ROLE_OFF`, `PO_JOB_ROLE_OFF`, `PO_ORDER_ROLE_INVALID`,
  `PO_ADMIN_ONLY`. Each has an English and a Bahasa Indonesia sentence saying what to do next.

### 2.4 Consumer (c): billing step owner and viewers (the billing lane builds it)

Not built here. The billing lane's spec (`docs/specs/billing-steps.spec.md` on `feat/gap-billing-billing-steps`, spec and plan only)
adds `owner_role_key` beside `owner_role` on steps, the project list and template steps, an organisation setting of step actor roles
(`org_billing_step_settings.actor_role_keys`) and a per-step hidden list. The contract above fits it unchanged; the exact calls are:

- **Holders of a step's owner role key** (FR-WBS-030, waiting list and notices; called inside their security-definer reads, which run
  as the owner): `public.holds_job_role(p.id, s.owner_role_key)` for a step with `owner_role_key` set; a step with only `owner_role`
  keeps today's base-level rule. Under the approved Q1 answer this also counts a person with no job role whose access level is the job
  role's base level, the same rule as material-request steps. Their FR-WBS-030 wording "the active holders of its owner role key" should
  read "the people who fill its owner role key (`holds_job_role`)"; if billing needs key holders only, that is a ruling for the whole
  product, not a second function.
- **Acting on an owned step** (FR-WBS-021): `p.built_in_role = any(v_actor_role_keys) and public.holds_job_role(p.id, s.owner_role_key)`.
  The actor-roles membership test stays theirs and already requires a held key, so a person with no job role never acts through it.
- **Reads and hidden steps** (FR-WBS-022/023): these test key membership (`built_in_role = any(...)`), not "fills a job role", so they do
  not call `holds_job_role`. A restrictive policy must not call `holds_job_role` directly (it is not granted to signed-in callers); if one
  ever needs it, the billing lane adds one actor-scoped gate (as `actor_may_order_purchases` does here), one gate per right.

Document-type viewers (`document_category_roles`) follow the same shape when ruled; nothing is built for them.

### 2.5 Not built: a per-work-order approver

A work-order "responsible person" column is built by the usage-warning lane (migration 1860 on `feat/gap-material-usage-warning`). An
approval step that resolves to that person is optional and is not built here; it can be added later as a step kind beside the job role,
reading that column, once that branch lands.

## 3. Requirements (EARS)

- **FR-RTD-001** The system shall decide "this person fills job role X" through one function, `holds_job_role(profile, X)`, as in §2.1.
- **FR-RTD-002** While a profile holds a job role, the system shall judge it by that job role alone.
- **FR-RTD-003** While a profile holds no job role, the system shall treat it as holding every job role built on its access level.
- **FR-RTD-004** Where an Admin names a job role on an approval step, the system shall let only people who fill that job role
  (FR-RTD-001), or an in-window stand-in for one of them, decide it; the level of the step is the job role's base level.
- **FR-RTD-005** While a step has no job role, the system shall decide who acts on it exactly as today (level equality).
- **FR-RTD-006** When a request is submitted, the system shall snapshot each step's job role; later chain edits leave it alone.
- **FR-RTD-007** When a pin is set on a job-role step, the system shall accept only a person who fills the job role; the pin lapses
  when the job role at that position changes.
- **FR-RTD-008** While `built_in_roles_enabled` is off, the system shall refuse naming a job role on a step or in the ordering setting
  (`MRQ_JOB_ROLE_OFF`, `PO_JOB_ROLE_OFF`); clearing one is always allowed; steps already naming one keep deciding by FR-RTD-001.
- **FR-RTD-009** Where an organisation names job roles that may order, the system shall let a person who fills one raise a purchase
  order, move an approved purchase to Ordered, mark its order issued, and read purchases and their order-side records.
- **FR-RTD-010** The ordering setting shall never narrow today's levels and never let a job-role orderer skip approval, read vendor
  bills or payments, or approve a purchase.
- **FR-RTD-011** An Admin shall pick job roles on the approval-chain settings and the purchase-order settings in English or Bahasa
  Indonesia names, grouped by tier, at 390px and 1440px; the pin picker offers only people who fill the step.
- **FR-RTD-012** Every new refusal shall have an English and a Bahasa Indonesia sentence saying what to do next.
- **NFR-RTD-001** Existing MR, pin, inbox, notification, purchasing and read-scope tests stay untouched and green.

## 4. Acceptance criteria and owning layer

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-RTD-001 | Given each of the 28 keys and people (holder, other key same level, no key same level, no key other level, inactive holder), `holds_job_role` is true for the holder and the no-key same-level person only; null and unknown keys are false. | pgTAP |
| AC-RTD-002 | Given the SQL function and the TS mirror, then the same case table gives the same answers. | vitest |
| AC-RTD-003 | Given a three-step chain naming three job roles, when three different holders decide in order, then the request is approved and each step records its decider; a decision out of order is refused (`MRQ_OUT_OF_ORDER`). | pgTAP |
| AC-RTD-004 | Given a job-role step, when a person at the same level holding a different job role decides, then refused (`MRQ_NOT_APPROVER`) and the step stays open; a no-key person at the base level is accepted. | pgTAP |
| AC-RTD-005 | Given a step with no job role, then who decides, the queue and the notified set are exactly today's (existing `mrq_approval`, `mrq_step_pin`, `mrq_approver_inbox` tests unchanged). | pgTAP |
| AC-RTD-006 | Given a job-role step, then `mrq_waiting_for_me` and `mrq_step_recipients` list the same people `mrq_decide_step` accepts, and a stand-in acts only for a holder. | pgTAP |
| AC-RTD-007 | Given a pin on a job-role step, then a non-filler is refused (`MRQ_PIN_INVALID`); after the chain changes the job role at that position, the pin no longer applies. | pgTAP |
| AC-RTD-008 | Given a submitted request, when the Admin changes a step's job role, then the in-flight step keeps the snapshot. | pgTAP |
| AC-RTD-009 | Given the setting off, naming a job role on a step or in `order_job_roles` is refused and nothing persists; clearing is accepted. Given a non-Admin, both writes are refused. | pgTAP |
| AC-RTD-010 | Given the daily cut-off (already built), a next-day request after the cut-off is refused with the earliest date. | pgTAP, existing `mrq_submit_transfer.test.sql:62-86` |
| AC-RTD-011 | Given `order_job_roles = {buyer}`, a Buyer raises a purchase order, moves an Approved purchase to Ordered and marks the order Issued; persisted rows read back. | pgTAP |
| AC-RTD-012 | Given `order_job_roles = {buyer}`, a Buyer moving a Draft purchase straight to Ordered, approving a request, or reading a vendor bill or payment is refused / reads nothing; a Storekeeper and a no-key Engineer read only their own purchases (unchanged when the setting is empty). | pgTAP |
| AC-RTD-013 | Given `order_job_roles` empty, every level's purchasing outcome is today's (existing 0350 and procurement tests unchanged). | pgTAP |
| AC-RTD-014 | Given the chain editor with built-in roles on, an Admin picks a job role per step, sees its access level read-only, saves through the repository; with the setting off, the editor is today's. | vitest |
| AC-RTD-015 | Given the purchase-order settings with built-in roles on, an Admin picks ordering job roles; a non-Admin sees them read-only. `can()` offers Order and the purchase list to a person who fills one. | vitest |
| AC-RTD-016 | Given each new refusal code, then `refusals.json` has an English and a Bahasa Indonesia sentence (the refusal-code gate). | vitest / guard |
| AC-RTD-017 | Given an Admin in the browser with built-in roles on, when a step is set to a job role and a holder approves a request in order, then the request is approved. | E2E (serial lane, `e2e/serial/AC-RTD-017-job-role-approval-step.spec.ts`) |

### Mutation checks (each turns the named AC red, then is restored)

Drop the "no key" condition from FR-RTD-003 (AC-RTD-001, -004); compare level instead of key for a holder (AC-RTD-004); skip
`job_role` in the submit snapshot (AC-RTD-008); compare `(position, role, label)` without `job_role` in the SoD identity (AC-RTD-003
twice case); drop the stand-in's delegator check (AC-RTD-006); accept a non-filler pin (AC-RTD-007); drop the setting gate (AC-RTD-009);
let a job-role orderer move from Draft (AC-RTD-012); widen the bill or payment read scope (AC-RTD-012).

## 5. Existing tests whose steps change

None of the existing journeys change steps: a step with no job role and an empty ordering setting are today's paths. What grows:
- `2711` (the field-account sweep) lists `actor_may_order_purchases` as a scalar helper; `holds_job_role` and `mrq_fills_step` are not
  executable by a signed-in caller, so the sweep does not reach them. `2716` needs nothing (no capability is added).
- The `mrq_waiting_for_me` result, the chain row and the pin row gain `job_role`, so `src/lib/db/materialRequests.test.ts` mock rows and
  expectations gain the field, and `ChainStepInput` literals in two tests gain `jobRole: null`.
- The two existing `MaterialRequestSettings` suites mock `useBuiltInRolesEnabled` (the page now reads it); `test/setup.ts` stubs
  `useOrderJobRoles` off for the procurement and shell suites that have no query client, as it already does for the print setting.
- `src/lib/repositories/index.test.ts` lists the three new procurement repository methods.
- The Users "Edit role" picker now builds its options with the shared `useJobRoleOptions` (same options; its tests unchanged).
- The merged role-capabilities branch's 1535 and 1536 carried restatements without a `-- drops:` line, which the restated-function
  guard refuses; each now names what it removes (comment only, no SQL change).

## 6. Settings and defaults

| Setting | Default | Effect of the default |
|---|---|---|
| step `job_role` | null | the step decides by its level, as today |
| `purchase_order_settings.order_job_roles` | `{}` | purchasing by today's levels only |
| `built_in_roles_enabled` (existing) | false | job roles cannot be named; nothing changes |

## 7. Questions only the customer can answer

1. **People not yet given a job role.** Recommended: they count for every job role built on their access level (FR-RTD-003), so a
   chain keeps working while people are being given roles. Built meanwhile: that rule. The alternative (job role holders only) is one
   condition in `holds_job_role`.
2. **Who orders.** Recommended: the Admin names Buyer in the ordering setting; until then nothing changes. Consequence of Q1: while an
   Engineer has no job role, naming Buyer lets them order too; the settings screen says so. Built meanwhile: the setting, empty.
3. **Can a Buyer order an unapproved purchase?** Recommended: no, only after approval (FR-RTD-010). Built meanwhile: that rule.
4. **Billing step owners and document viewers.** Answered: the billing lane's spec is pushed; §2.4 gives the exact calls. Their lane
   builds the billing code.
