# ADR-0070 — Approval authority is rank, not an enumerated role list

- **Status:** Accepted (2026-07-29)
- **Context:** the create-path SoD program (PR #411, migrations `0173`–`0177`), `docs/specs/create-path-sod-class.spec.md`
- **Related:** ADR-0019 (server-enforced SoD), ADR-0016 (`can()` is UX-only), ADR-0011/0012 (transition-RPC pattern)

## Context

Every separation-of-duties rule in this codebase answers the same question — *who is allowed to
approve what this person did?* — and until now each one answered it by **enumerating roles**:

- `transition_document_status`: approver ≠ author.
- `set_project_contract_value`: `{Admin, Executive, Project Manager}` pre-win,
  `{Admin, Executive, Finance}` on-hand.
- `transition_procurement`: requester ≠ approver, approver ≠ payer.

Two problems surfaced while closing the create-path SoD class.

**1. Enumerated lists go stale silently.** `0177` gated the pipeline→Won transition on an
enumerated `{Admin, Executive, Finance}` carve-out, justified in its own header as *"the roles
`set_project_contract_value` already trusts"*. That was **false** — the RPC has two gates and the
pre-win one is `{Admin, Executive, Project Manager}`. The list was copied from the wrong branch, and
neither the migration, its 62 assertions, nor two reviewers caught it, because a list of role
literals carries no meaning a reader or a test can check it against.

**2. The role set is going to grow.** Operations Manager and Director roles are anticipated but not
yet created. Under an enumerated model, every new role means auditing and editing every SoD
predicate in the schema — and each edit is another chance to copy the wrong list.

**The concept the rules are all reaching for is rank.** The owner stated it directly:

> anyone who can approve is anyone who is a supervisor of the person, or higher rank (including
> Finance, Executive and Admin)

Crucially, **this is already the app's convention** — it is simply not applied uniformly.
`transition_timesheet` resolves `profiles.manager_id` to find the owner's line manager and gates
approval on it. `profiles.manager_id` exists, is populated, and is already load-bearing for
authorisation. The money path never adopted it.

## Decision

**Approval authority is derived from rank and line-management, not from an enumerated role list.**

An actor may approve another actor's work when **either** holds:

1. **Line management** — the approver is the author's manager (`profiles.manager_id`), the
   relationship `transition_timesheet` already uses. **Unconditional: being in someone's supervisor
   field is sufficient, whatever the two roles are.** That is the point of storing a hierarchy
   rather than inferring one from job titles.
2. **Rank** — the approver's role outranks the author's role.

### Why the supervisor path is safe to trust

`profiles.manager_id` becomes an authorisation input, so who may write it decides whether the rule
holds. Verified against the live catalog: the `profiles_update_self` policy pins **both `manager_id`
and `role`** to their current values, so **a user cannot change their own supervisor or their own
role**. Only the profile-administration policy — same org, `is_active_member()`, and rank authority
over the subject (`profiles_hierarchy_update`, migration `0179`; `profiles_admin_write` before it) —
can. Nobody can self-grant approval authority. An Admin can set it for others arbitrarily, but an
Admin already outranks everyone, so no escalation is available that they did not already have.

⚑ **This is a precondition, not a side note.** If a future change lets a user edit their own
`manager_id`, every SoD rule built on this ADR silently becomes self-serve. Any migration touching
`profiles_update_self` must treat that pin as load-bearing.

### Org-shape conventions are conventions, not constraints

"A Project Manager will never have another Project Manager as their line manager" is a true
statement about how the org is run, and it is **not enforced by the schema**. The rule above is
deliberately written not to depend on it: if such a pairing were ever entered, that manager could
approve their report's work — which is the correct reading of "supervisors may approve downline",
not a loophole. We are choosing to trust the hierarchy as entered, on the strength of it being
Admin-only writable. If that ever stops feeling right, the fix is a CHECK that a manager must
outrank their report, **not** a special case inside the SoD predicates.

Rank is defined **in exactly one place** so that adding a role is a one-line change rather than a
sweep of every SoD predicate. Today it is a **strict total order**:

```
Admin  >  Executive  >  Finance  >  Project Manager  >  Engineer
```

`Finance` outranks `Project Manager` **for money decisions** — it is the role accountable for
revenue. Operations Manager / Director slot between `Finance` and `Project Manager` when created,
and **no SoD predicate changes**.

⚑ **`Admin > Executive`, strictly — this was `Admin = Executive` in the first draft of this ADR and
that was wrong.** Existing role gates list the two together (`auth_role() in ('Admin','Executive',…)`)
which made equality look natural, but the two are not interchangeable for *administration*: the
owner's rule is that **only an Admin may assign the Executive role**, and under an equality that is
unexpressible — Executive is not "below" Admin if they rank the same, so no one could ever assign it,
and no one could edit an Executive's profile. Equality also has no meaning under the profile-editing
rule below, which is defined in terms of *outranking*. A strict order makes both rules fall out with
no special cases.

### Profile editing follows the same order (owner ruling, 2026-07-29)

> **You may edit a profile only if you outrank the person whose profile it is, and you may only
> assign a role below your own.**

**Implemented** by migration `supabase/migrations/0179_profiles_hierarchy_write.sql`, which splits the
old `profiles_admin_write` (`FOR ALL`, Admin-only) into `profiles_admin_insert` +
`profiles_admin_delete` (both byte-for-byte the old Admin-only predicate — the ruling widens *editing*
only) and `profiles_hierarchy_update`, which carries the rule via
`public.may_administer_profile(actor_role, subject_role)` over `public.holds_profile_admin_authority`
and `0178`'s `role_outranks`. Proven by `supabase/tests/0172_profiles_hierarchy_write.test.sql`
(`AC-PHW-001` … `AC-PHW-102`).

Enforced in **both `USING` and `WITH CHECK`** — `USING` governs whose profile you may touch,
`WITH CHECK` governs what you may set it to. Checking only one leaves the other open, which is the
USING/WITH-CHECK asymmetry this program has already had to repair twice. The two mutations that catch
each side are `AC-PHW-031` (USING-only ⇒ an Executive demotes an Admin, because `Finance` *is* a
role an Executive may assign — the illegal part is the **subject**, caught by the persisted-value
read-back) and `AC-PHW-021` (WITH-CHECK-only ⇒ an Executive promotes a Project Manager to Executive,
caught by a `throws_ok`); both were run and both killed their mutant. ⚑ A `lives_ok` proves nothing about a
USING denial: an RLS USING denial is a SILENT 0-row no-op, so only the persisted-value read-back can catch it.

⚑ **The rule is a conjunction, not just "outranks".** `role_rank` is a strict total order, so
`Finance > Project Manager > Engineer` — a literal "may edit whoever you outrank" would hand Finance
authority over PMs and a PM authority over Engineers, contradicting row 3 of the table below. The
implementation therefore requires an **authority floor** (`holds_profile_admin_authority`: Executive
rank and above) *and* outranking. Dropping the floor is not a convenience widening: a PM who can write
a peer's `manager_id` can re-point this ADR's own line-management limb.

| actor | may edit the profile of | may assign role |
|---|---|---|
| Admin | anyone, **including other Admins** (never themselves) | any, including Executive |
| Executive | Finance, Project Manager, Engineer | Finance, Project Manager, Engineer — **not** Executive |
| everyone else | nobody | nobody |

⚑ **Scope of the ruling — editing only (owner rulings, 2026-07-30).** The rank widening above reaches
`profiles_hierarchy_update` (the UPDATE path) and nothing else, by explicit owner confirmation on
2026-07-30 — not by implementer default: **INSERT and DELETE on `profiles` stay Admin-only.** A single
`FOR ALL` policy cannot carry two rules, so `profiles_admin_insert`/`profiles_admin_delete` keep the
pre-`0179` Admin-only predicate byte-for-byte, and ADR-0019 keeps destructive delete Admin-only
regardless. The owner's second ruling of the same date: **`profiles.status` is Admin-only** — changeable
only through `admin_set_user_status`, and enforced at the column level by `0182`'s UPDATE allow-list on
`public.profiles` (every column is client-writable *except* `id`, `org_id`, `created_at` and `status`),
so the Executive widening here can touch a subordinate's `role`/`manager_id` but never their status.

**The one carve-out: Admin may edit a peer Admin** (owner ruling, 2026-07-29). Strict outranking alone
would mean *nobody* can edit an Admin's profile, since Admin does not outrank Admin — so an Admin
could never be demoted in-app. Offboarding is unaffected either way (`admin_set_user_status` is a
separate RPC that one Admin may use on another, and it already refuses self-disable), but a role or
supervisor correction on an Admin would have required direct database access.

The carve-out is deliberately **not** generalised to "equal rank may edit equal rank": that would let
one Executive edit another (explicitly ruled out) and let one Project Manager assign supervisors for
their peers (which would quietly undo the money SoD this ADR exists to support). Admin is the top of
the order and already holds every authority the carve-out could confer, so it grants nothing new —
it only removes a lockout.

⚑ **Correction (2026-07-29, found while implementing `0179`).** An earlier revision of this section
said self-edits of `role` and `manager_id` "remain barred for everyone, Admin included, via the
`profiles_update_self` pin". **That was true of every role except Admin.** `profiles_admin_write` was
`FOR ALL` and matched the Admin's *own* row, and permissive policies OR — so it satisfied the write on
its own, past the pin. Probed live at `0178`: an Admin's `update profiles set role='Engineer' where
id = <self>` returned `UPDATE 1`. "Never themselves" is therefore a **narrowing** that `0179` adds
(`id is distinct from auth.uid()` in both clauses of `profiles_hierarchy_update`), not a restatement
of existing behaviour. Everything else the Admin could do — INSERT, DELETE, editing anyone else, and
editing their own *non-pinned* fields through `profiles_update_self` — is preserved and asserted as a
control (`AC-PHW-062`/`073`/`074`).

Consequences that need no special-casing: "only Admin assigns Executive" is simply Executive not
outranking Executive; an Executive cannot make themselves the supervisor of an Admin or a peer
Executive, so the widening grants no authority rank did not already confer; and self-edits of `role`
and `manager_id` stay barred for everyone including Admin, via the existing `profiles_update_self`
pin — otherwise an Executive promotes themselves to Admin in one statement.

### Consequences for the money SoD specifically

ADR-0019 §1 already says only `{Admin, Executive, Finance}` may set a contract value on a won
project. Winning a deal is exactly the moment a pipeline value **becomes** a won value. Therefore
the second person on a PM-authored contract value must **outrank the PM** — a peer Project Manager
is not sufficient, because a PM is not trusted with a won value.

This supersedes the "any second person" rule shipped in `0177`, which permitted a PM to ratify a
value that then became a won value — permitting by two steps what ADR-0019 forbids in one.

## Alternatives considered

- **Keep enumerated role lists.** Rejected: it is what produced the wrong-list defect above, and it
  makes every future role a schema-wide audit.
- **"Any second person" (approver ≠ author, as shipped in `0177`).** Rejected: it stops one person
  acting alone, which is real, but it puts nobody accountable for revenue in the loop and it
  contradicts ADR-0019. Its practical failure mode is that the easiest second signature is the
  colleague at the next desk.
- **Full org-chart traversal (transitive `manager_id` walk).** Deferred, not rejected. Direct
  manager plus rank covers every case reachable today; a recursive walk adds cycle-handling and
  depth questions for no present benefit. Revisit when Operations Manager / Director exist and real
  reporting depth appears.

## Consequences

**Good.** One definition of "who may approve", checkable against a written rule. Adding Operations
Manager or Director becomes a one-line rank change. The money path stops contradicting ADR-0019.
It matches what `transition_timesheet` already does, so the codebase converges rather than diverges.

**Costs.** A PM can no longer close a deal without someone senior touching the number — heavier
than the shipped rule, and if Finance is slow to respond that friction is real and will be felt.
`profiles.manager_id` becomes authorisation-relevant for money, so it must be **correct** — today
only 6 of 11 seeded profiles have one, and a missing manager must **fail closed** (fall back to
rank), never open.

**Migration.** SoD predicates that currently enumerate roles are not rewritten wholesale; they adopt
the rank helper as they are next touched. The money SoD adopts it immediately (it is the reason this
ADR exists). `transition_timesheet`'s existing manager check is already conformant.
