# What a migration must register — the pre-push list

A migration that adds a column or a function can owe an entry to as many as five hand-kept registers:
the change-history registry (`record_history_config`), the anon-executable-definers inventory, the
isolation-probe denominator, the AC-LA-014 light-account sweep, and the 2519 source-rights catalogue —
plus a rollback file. Every one of those gates runs against a database or in CI's database job, so a
forgotten entry surfaces only after a push. On 25–26 November two PRs went red exactly this way (a
new column with no registry entry; a function whose role admission was missing from the catalogue),
and a third (#2913) went red on the light-account sweep.

This runbook is the command that reads the branch's migrations statically — no database — and prints,
per migration, every registration it must carry and whether the branch already carried it. It names
the miss one push earlier; the database-backed gates remain the authority.

## The command

```bash
node scripts/check-migration-registers.mjs                 # HEAD against origin/dev
node scripts/check-migration-registers.mjs --base <ref> --head <ref>   # any pair of commits
node scripts/check-migration-registers.mjs --head worktree # include uncommitted edits
node scripts/check-migration-registers.mjs --self-test
```

Or through npm (from `pmo-portal/`):

```bash
npm run migration-registers
```

Exit 1 on any miss. A miss prints the fix (the exact registry statement or fragment line shape) and
names the gate that would have failed. A `✓` line means the branch already carries the entry.

## What each rule reads

| Rule | Fires when | Register to carry | Authority gate |
|---|---|---|---|
| change-history | a branch migration runs `alter table … add column` on a table `record_history_config` tracks (the tracked list is read from the migrations) | a registry statement classifying the column (`captured`, `flag_cols` or `omit_cols`) | `supabase/tests/record_changes_catalog_gate.test.sql` |
| inventory | a new SECURITY DEFINER function is executable by the signed-in role (granted to authenticated, or not revoked from it) | a proname line in `supabase/tests/inventory/anon-executable-definers/<feature>.txt` | `supabase/tests/0178_anon_executable_definers.test.sql` (AC-ACL-004) |
| denominator | a new SECURITY DEFINER function exists (client-callable or internal) | its exact signature in one `scripts/isolation-probe-denominator.d/<feature>.json` fragment | `scripts/check-isolation-denominator.mjs` |
| light-account | a new client-callable SECURITY DEFINER function | `assert_not_light()` in the body, or a line on the AC-LA-014 allowlist | `supabase/tests/2711_light_account_boundary_sweep.test.sql` |
| rights-catalogue | a function or policy body the branch writes admits a role the 2519 catalogue pins | the function/policy added to that role's pinned array | `supabase/tests/2519_source_rights_catalogue.test.sql` |
| drop-register | a branch migration drops a function that a fragment still names and nothing re-defines | remove the stale entry (a stale entry is itself a defect) | `check-isolation-denominator.mjs` / the inventory's stale rule |
| search-path | the branch defines a SECURITY DEFINER function whose `search_path` does not end with `pg_temp` | `set search_path = <trusted schemas>, pg_temp` | none yet (this guard is the only check) |
| rollback | the branch ADDS a migration file | `supabase/migrations/rollback/<name>_down.sql` | the migration-collisions/lane conventions |

"New or re-signatured" is decided against the base ref's migrations: a signature the base does not
define re-opens every register for that function, even when the name is old. A restatement with the
same signature re-opens nothing — but its body is still read, so a restatement that WIDENS a role
admission is caught by rights-catalogue (that is how the rental-terms PR went red), and every definer
restatement is still held to the search-path rule.

## Proven on history

The two November reds and the light-account red are the guard's own history proofs: at the red
commits it names exactly the miss (`work_orders.cancel_reason` unclassified at the work-order-capture
commit; the three 2519 catalogue pins at the rental-terms commit; the inventory, light-account and
search-path gaps on the close-out definer), and at each lane's fix commit it is clean. Re-run with:

```bash
node scripts/check-migration-registers.mjs --base da1c4d0ec^ --head da1c4d0ec   # the red
node scripts/check-migration-registers.mjs --base 488b5a367^ --head 488b5a367   # the fix, clean
node scripts/check-migration-registers.mjs --base 16b5d9c43^ --head 9a0eef2a2   # the red
node scripts/check-migration-registers.mjs --base ef6a527bd --head 493fac321    # the fix's PR head: pins ✓
node scripts/check-migration-registers.mjs --base 50746eeac^ --head 50746eeac   # the light-account red
```

## Scope and limits

Stated so nobody trusts it further than it goes. It is textual (grep-level, like
`check-date-formatting`), it sees only the migrations a branch adds or changes against the base ref,
and it reads `create [or replace] function` bodies only when they are dollar-quoted — a body it cannot
delimit is reported as `unread`, never silently skipped. It cannot see:

- columns added by dynamic SQL, or by a branch that registers a new table and adds columns to it in a
  later migration of the same branch (the tracked list comes from the base);
- an admission the branch REMOVES from a function or policy body (the pinned set would go stale the
  other way — the pgTAP catalogue still catches it);
- grants made by another migration, by a default privilege, or by `grant execute on all functions`;
- a migration whose register entries live in a DIFFERENT file of the same PR but outside
  `supabase/migrations/` and the fragment directories (there are none today);
- rename-carrying diffs (git rename status is out of scope; a renamed migration re-files as new).

Migrations written before this guard existed can carry shapes it names (several shipped definers use
`search_path` without a trailing `pg_temp`). The guard only ever reads a BRANCH's own migrations, so
that history never enters a normal run; whether to floor the search-path rule for restatements of
those shapes is a Director decision, not this runbook's.

## Where it runs

Not in `check:guards` yet: it needs `origin/dev` (or an explicit `--base`) to diff against, so wiring
it into a gate is a Director call. The npm script above is the builders' entry point. Proposed
CLAUDE.md line for the local final gate (the Director edits that list):

> DB branches also run `npm run migration-registers` (static, no database; runbook:
> `docs/runbooks/migration-registers.md`).

Mutation recipe (inside the self-test, each planted defect must redden): drop a registry
classification, drop an inventory line, mistype a denominator signature, remove an
`assert_not_light`, re-pin the catalogue without the new function, keep a fragment line for a dropped
function, set `search_path` without `pg_temp`, delete a rollback file. `--self-test` runs all of them
against fixtures and names each miss.
