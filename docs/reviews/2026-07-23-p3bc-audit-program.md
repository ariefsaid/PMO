# P3b/P3c adversarial audit program — 11 rounds, 2026-07-21 → 23

The per-round reports lived in `/tmp` and are gone. This is the durable record: what the program
found, and — more useful — **why a fully green test suite kept failing to see it.**

**Outcome:** rounds 1–10 NO SHIP, round 11 SHIP. ~54 defects. **Nine were in fixes made during the
review itself.** Shipped as PR #360.

---

## 1. The defects that mattered

Each was invisible to a green suite (verify ~6,000 tests, pgTAP ~2,000, deno ~450, e2e 54).

| Round | Defect | Consequence had it shipped |
|---|---|---|
| 4 | `actualsScope: {}` ⇒ `project_id` NULL, joined non-NULL | Every project's actuals read **0.00**; variance = the whole budget |
| e2e | FR-BUD-121 upsert never built | ERPNext kept enforcing the **superseded** budget figure |
| 5 | `commitAmend` cancel→create not recoverable | ERPNext enforcing **no budget at all**, terminally (`neverReissue`) |
| 5 | `held` had no exit; inside the one-in-flight index | A week's payroll costing could **never** reach ERP — even under a new key |
| 8 | Unpaged GL read past `max_rows` | A **truncated sum** certified as known money, different every tick |
| 10 | RPC summing across snapshot generations | A $40k category reporting **$80k**, a −15k overrun that didn't exist |
| 7 | Desk-draft adoption reachable only in its harmful direction | PMO **overwriting an accountant's work** in their own system |

## 2. The real lesson: eleven ways a test could not fail

This is the transferable part. Every one of these sat behind green.

1. **Stale grep anchor** — a source-scan test whose anchor moved asserted against `''`.
2. **Fixture too thin to model its own premise** — "a unique work-email match" seeded profiles with no email.
3. **A fake whose `limit` was a no-op** — hid a queue that returned nothing at realistic scale.
4. **A gate that excluded what it should measure** — the mobile gate skipped horizontal scrollers, so it was blind to the overflow they cause.
5. **Asserting the REQUEST, not the accepted RESULT** — the recovery test checked the body sent, never that ERP took it.
6. **A fake HANDED a state the shipped writers never produce** — the adoption tests posited a mirror row nothing writes, dressing an unreachable branch as working.
7. **An assertion that survived mutation** because the fixture already held the asserted value.
8. **A fake with no cap** — `Promise.resolve({data})` cannot express PostgREST's silent truncation.
9. **A thenable-only fake** with no `eq`/`range` — could not express filtering or paging.
10. **A fake treating every order as TOTAL** — so paging on a tied column looked correct.
11. **A fixture giving every row its own `snapshot_id`** — a state production cannot produce, hiding a defect that DOUBLED a client's actuals.

**The question that finds these:** *what is this guard structurally unable to see?*

## 3. Patterns worth carrying

- **Fixed at one scope, alive at another.** Money-honesty appeared at four scopes (project → category → never-synced → wrong-fiscal-year); unpaged reads at two. Fixing the named site is not fixing the class — **enumerate**.
- **A fix can be worse than the bug.** Round 5: the budget upsert turned a benign failure (old budget still enforcing) into a destructive one (nothing enforcing). Round 9: the round-8 paging fix paged on a tied column — *the defect wearing the fix's clothes*.
- **A feature can be reachable only in its harmful direction.** Orphan-draft adoption needed a name only a *successful* push writes, so it could never recover our own failure — but could overwrite a Desk user's work. Deleted.
- **A frozen spike can be wrong.** Round 7's HIGH cited spike §10(g); the bench disproved it in five shapes, and its prescribed remedy was the only route to the one failure that *does* reproduce. **Field truth is re-probed, not inherited.**
- **An audit finding is a hypothesis.** Where checkable against the bench, DB, or shipped code — check it. A confidently-wrong HIGH costs real work.
- **Guarantees must be true, not aspirational.** Round 11: `delete`+`insert` in one transaction is not mutual exclusion. No money was wrong, but three table comments asserted a guarantee that was false. A per-org advisory lock made the claim true.

## 4. Process findings beyond P3

- **CI never ran `deno test`** — only `deno check` (type-only) + boot-smoke, neither of which executes an assertion. ~432 edge-function tests, including every money oracle built here, were **local-only**. Now enforced.
- **`database.types.ts` must not be raw-regenerated** — `supabase gen types` emits RPC return columns as NON-NULL, silently wiping the `| null` annotations the money-honesty invariant depends on.
- **E2E cleanup must RESTORE org-global seed state, never DELETE it** — a cleanup deleting a shared row poisons every later spec and presents as flake.
- **The harness can poison itself.** The timesheet week allocator wrapped every 8 minutes while ERPNext validates overlap per employee *forever*, so a fix/verify loop collided with itself and looked like a product defect.
- **Load ≥ ~100 produces phantom `waitForTimeout` failures** in unrelated specs. Signature: ~5,200ms or 30s timeouts, unrelated areas, high `uptime`. Re-run before believing.

## 5. The invariant that ended the money-honesty class

Stated in `0141` and its pgTAP, after the same class was fixed at three scopes and found at a fourth:

> **A money figure may be stated only when its INPUTS ARE KNOWN.** Otherwise it is NULL — unobtainable
> — and every figure derived from it is NULL too. **`0` is a CLAIM about the world, and PMO may only
> make it when it actually looked.**

The function's three money inputs each get exactly one knowability test, asserted in both directions,
so a fifth scope cannot be added without failing the block. Enforcing it immediately surfaced three
more violations no audit had named.
