# E2E Parallel-Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Playwright e2e suite reliably green at `workers:4` by giving every spec a declared, build-enforced isolation class — fixing today's shared-state collisions and preventing future ones.

**Architecture:** Every `e2e/*.spec.ts` declares `// @e2e-isolation: read-only | self-isolated | dedicated-row | serial`. Parallel-safe classes run 4-wide in the `chromium` project; org-global (`serial`) specs run one-at-a-time in a second `serial` project/phase at `--workers=1`. A guard script (`check-e2e-isolation.sh`, wired into `verify` + all CI jobs like `check-migration-collisions.sh`) fails the build on a missing tag, a lane mismatch, or a high-signal mislabel. Design doc: `docs/superpowers/specs/2026-07-11-e2e-parallel-isolation-design.md`.

**Tech Stack:** Playwright (projects/`fullyParallel`/`workers`), bash guard, Supabase seed (service-role fixtures), Vitest-independent (e2e only). Run from `pmo-portal/`. Local DB commands via `scripts/with-db-lock.sh`.

**Branch:** `fix/e2e-parallel-isolation` (off `dev`, which has #306).

---

## Reference: the offender map (from the audit)

- **Mode ① global-state flips → `serial` lane:** `AC-CUA-090`, `AC-CUA-091`, `AC-ENT-005`, `AC-AU-001`, `AC-732`.
- **Mode ② shared-row → convert to dedicated/self-isolated (stay parallel):** `AC-816`, `AC-SCA-014`, `AC-TSE-021`, `AC-VB-E01`.
- **Mode ③ retry/contention → stabilize (stay parallel):** `AC-DEL-022` (beforeEach reset P013), `AC-AR-013` (waits).
- **Already parallel-safe (~55) → just tag.** Existing serial-config files: `AC-PR-020`, `AC-IXD-PROC-W5-3`.

Known **shared** seed IDs (deny-list for the guard — writes to these outside `serial`/`dedicated-row` are the mode-② smell): org `00000000-0000-0000-0000-000000000001`; P001 `40000000-0000-0000-0000-000000000001`; P002 `40000000-0000-0000-0000-000000000002`; SP-2401 `41000000-0000-0000-0000-000000000001`; shared login `engineer@acme.test`.
Dedicated (safe) rows: P011/P012/P013 (`…011/012/013`), PROC-2026-006/007, Grace/Heidi.

---

## Task 1: Config — add the `serial` project + two-phase runner (no specs moved yet)

**Files:**
- Modify: `pmo-portal/playwright.config.ts`
- Modify: `pmo-portal/package.json` (scripts)
- Create: `pmo-portal/e2e/serial/.gitkeep`

- [ ] **Step 1: Read the current config**

Run: `sed -n '1,60p' pmo-portal/playwright.config.ts` — confirm the `projects` array and `webServer` block match the plan's assumptions (setup + chromium projects; `workers: process.env.CI ? 4 : undefined`; `retries: process.env.CI ? 2 : 0`).

- [ ] **Step 2: Split the projects + enable server reuse**

Replace the `projects` array so `chromium` excludes the serial dir and a new `serial` project matches it:

```ts
projects: [
  { name: 'setup', testMatch: /auth\.setup\.ts/, fullyParallel: false },
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
    dependencies: ['setup'],
    // Exclude the setup file AND the serial lane — the serial project owns e2e/serial/**.
    testIgnore: [/auth\.setup\.ts/, /e2e[\\/]serial[\\/]/],
  },
  {
    // @e2e-isolation: serial lane — org-global specs. Run in a SECOND invocation at --workers=1
    // (see the `e2e` npm script) so these never overlap the parallel batch or each other.
    name: 'serial',
    use: { ...devices['Desktop Chrome'] },
    dependencies: ['setup'],
    testMatch: /e2e[\\/]serial[\\/].*\.spec\.ts/,
    fullyParallel: false,
  },
],
```

In the `webServer` block, allow both invocations to share one server:

```ts
webServer: {
  command: 'npm run dev',
  url: 'http://localhost:5173',        // keep the existing url/port
  reuseExistingServer: true,           // was likely `!process.env.CI`; both e2e phases attach to one server
  // ...keep existing timeout etc.
},
```

- [ ] **Step 3: Add the two-phase e2e script + isolation-tag check placeholder**

In `pmo-portal/package.json` `scripts`, replace the current `e2e`/`test:e2e` invocation with two phases (keep the existing script name the repo uses — check with `grep -E '"(e2e|test:e2e)"' pmo-portal/package.json`):

```jsonc
"e2e": "playwright test --project=chromium && playwright test --project=serial --workers=1",
"e2e:parallel": "playwright test --project=chromium",
"e2e:serial": "playwright test --project=serial --workers=1"
```

- [ ] **Step 4: Create the empty serial lane**

Run: `mkdir -p pmo-portal/e2e/serial && touch pmo-portal/e2e/serial/.gitkeep`

- [ ] **Step 5: Sanity — Playwright still lists tests under both projects**

Run: `cd pmo-portal && npx playwright test --list --project=chromium | tail -3 && npx playwright test --list --project=serial | tail -3`
Expected: chromium lists the current specs; serial lists none yet (empty dir) — no config error.

- [ ] **Step 6: Commit**

```bash
git add pmo-portal/playwright.config.ts pmo-portal/package.json pmo-portal/e2e/serial/.gitkeep
git commit -m "test(e2e): add serial project + two-phase runner (workers:1 lane)"
```

---

## Task 2: Move the mode-① global-flip specs into the serial lane + tag them

**Files (move + edit header):**
- `pmo-portal/e2e/AC-CUA-090-clickup-task-writethrough.spec.ts` → `pmo-portal/e2e/serial/`
- `pmo-portal/e2e/AC-CUA-091-clickup-webhook-reflect.spec.ts` → `pmo-portal/e2e/serial/`
- `pmo-portal/e2e/AC-ENT-005-toggle.spec.ts` → `pmo-portal/e2e/serial/`
- `pmo-portal/e2e/AC-AU-001-admin-users-crud.spec.ts` → `pmo-portal/e2e/serial/`
- `pmo-portal/e2e/AC-732-budget-activate.spec.ts` → `pmo-portal/e2e/serial/`

- [ ] **Step 1: git-move each file into the serial lane**

```bash
cd pmo-portal
for f in AC-CUA-090-clickup-task-writethrough AC-CUA-091-clickup-webhook-reflect AC-ENT-005-toggle AC-AU-001-admin-users-crud AC-732-budget-activate; do
  git mv "e2e/$f.spec.ts" "e2e/serial/$f.spec.ts"
done
```

- [ ] **Step 2: Add the isolation tag to each moved file**

For each moved file, add this as the FIRST line (above the existing header comment):

```ts
// @e2e-isolation: serial — mutates org-global state (see design 2026-07-11-e2e-parallel-isolation).
```

- [ ] **Step 3: Fix any relative import depth**

The files moved one directory deeper (`e2e/` → `e2e/serial/`). Fix imports of helpers:
Run: `cd pmo-portal && grep -nE "from '\.\./(helpers|.*helpers)" e2e/serial/*.spec.ts`
For each hit, change `'../helpers'` → `'../helpers'` becomes `'../../helpers'`? No — `e2e/serial/x.spec.ts` importing `e2e/helpers.ts` is `'../helpers'`. Verify: `../` from `e2e/serial/` = `e2e/`. So `'../helpers'` is correct. Only fix deeper imports (e.g. `'../../supabase/...'` becomes `'../../../supabase/...'`). Apply the +1 `../` to any path that reaches outside `e2e/`.

- [ ] **Step 4: Verify the serial project now lists these 5**

Run: `cd pmo-portal && npx playwright test --list --project=serial | grep -cE "AC-(CUA-090|CUA-091|ENT-005|AU-001|732)"`
Expected: `5`

- [ ] **Step 5: Run the serial lane alone (workers:1) against a fresh local DB**

```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/pmo-backend-ig-audit-c393d3
scripts/with-db-lock.sh bash -c "cd pmo-portal && npx playwright test --project=serial --workers=1"
```
Expected: 5 specs PASS (they were green at workers:1 before; this confirms the move + imports).

- [ ] **Step 6: Commit**

```bash
git add pmo-portal/e2e/serial/ && git commit -m "test(e2e): move org-global specs to serial lane (mode-1 flips)"
```

---

## Task 3: Convert mode-② shared-row mutators to parallel-safe isolation

Each sub-task: read the spec, repoint its mutation to a dedicated/unique target, add the tag, verify it still asserts the SAME user-goal (never weaken the oracle — qa-acceptance BINDING rule).

### 3a: AC-816 → dedicated procurement fixture

**Files:** `pmo-portal/e2e/AC-816-procure-to-pay.spec.ts`

- [ ] **Step 1:** Run `grep -n "PROC-2026-003\|60000000" pmo-portal/e2e/AC-816-procure-to-pay.spec.ts` and `grep -n "isolation" supabase/seed.sql | sed -n '1,20p'` to find the §J dedicated e2e procurement fixtures.
- [ ] **Step 2:** Repoint the spec from shared `PROC-2026-003` (`60000000-…-004`) to a **dedicated** §J isolation procurement (or add one to `seed.sql §J` if none is free — a Draft procurement reserved for AC-816). Keep the full Draft→…→Paid journey and all assertions unchanged.
- [ ] **Step 3:** Add first line: `// @e2e-isolation: dedicated-row — owns procurement <NEW-ID>; no other spec reads it.`
- [ ] **Step 4:** If a seed row was added, apply it: `scripts/with-db-lock.sh supabase db reset`.
- [ ] **Step 5:** Run `scripts/with-db-lock.sh bash -c "cd pmo-portal && npx playwright test AC-816"` → PASS.
- [ ] **Step 6:** Commit: `git add -p && git commit -m "test(e2e): AC-816 use dedicated procurement (parallel-safe)"`

### 3b: AC-SCA-014 → dedicated task on SP-2401

**Files:** `pmo-portal/e2e/AC-SCA-014-actual-line-moves.spec.ts`, `supabase/seed.sql`

- [ ] **Step 1:** `grep -n "41000000\|SP-2401\|task" pmo-portal/e2e/AC-SCA-014-actual-line-moves.spec.ts` — find which seed task it marks Done.
- [ ] **Step 2:** Add a **dedicated** In-Progress task on SP-2401 in `seed.sql §H` reserved for AC-SCA-014, and repoint the spec to it (so no S-curve/task reader of the existing SP-2401 tasks collides). Keep the "actual line moves" assertion intact.
- [ ] **Step 3:** Tag: `// @e2e-isolation: dedicated-row — owns task <NEW-ID> on SP-2401.`
- [ ] **Step 4:** `scripts/with-db-lock.sh supabase db reset`
- [ ] **Step 5:** `scripts/with-db-lock.sh bash -c "cd pmo-portal && npx playwright test AC-SCA-014"` → PASS.
- [ ] **Step 6:** Commit.

### 3c: AC-TSE-021 → dedicated engineer + week

**Files:** `pmo-portal/e2e/AC-TSE-021-timesheet-entry.spec.ts`

- [ ] **Step 1:** Read the spec + `grep -n "ts-colocated-eng\|engineer@acme\|IXD-TS-001" pmo-portal/e2e/AC-IXD-TS-001*.spec.ts` to mirror how AC-IXD-TS-001 already dedicated an engineer to avoid this exact collision.
- [ ] **Step 2:** Repoint AC-TSE-021 off shared `engineer@acme.test` onto a dedicated seed engineer + its own week (add one to `seed.sql §U/§K` if needed). Keep the log/edit/delete journey + assertions.
- [ ] **Step 3:** Tag: `// @e2e-isolation: self-isolated — dedicated engineer <email> + own week; self-cleans.`
- [ ] **Step 4–6:** reset (if seed changed) → `npx playwright test AC-TSE-021` PASS → commit.

### 3d: AC-VB-E01 → unique view name

**Files:** `pmo-portal/e2e/AC-VB-E01-view-builder-compose-save.spec.ts`

- [ ] **Step 1:** `grep -n "Test View" pmo-portal/e2e/AC-VB-E01-view-builder-compose-save.spec.ts`.
- [ ] **Step 2:** Change the fixed `"Test View"` to `` `Test View ${Date.now()}` `` (unique) and add `afterEach`/service-role cleanup of the created `user_views` row (mirror `AC-DOC-020`'s cleanup). Keep the save+persist assertion.
- [ ] **Step 3:** Tag: `// @e2e-isolation: self-isolated — unique view name + cleanup.`
- [ ] **Step 4:** `scripts/with-db-lock.sh bash -c "cd pmo-portal && npx playwright test AC-VB-E01"` → PASS.
- [ ] **Step 5:** Commit.

---

## Task 4: Stabilize the mode-③ specs (retry / contention)

### 4a: AC-DEL-022 → retry-safe empty-state precondition

**Files:** `pmo-portal/e2e/AC-DEL-022-milestone-journey.spec.ts`

- [ ] **Step 1:** Read the spec; confirm it asserts `milestone-strip-empty` (≈L51) on dedicated project P013 (`40000000-…-013`).
- [ ] **Step 2: Write the guard-rail as a `beforeEach`** that resets P013 to zero milestones/tasks via the service-role client (so retries and re-runs always start empty):

```ts
import { requireServiceRoleKey } from './helpers';
import { createClient } from '@supabase/supabase-js';

const P013 = '40000000-0000-0000-0000-000000000013';

test.beforeEach(async () => {
  const admin = createClient(process.env.VITE_SUPABASE_URL!, requireServiceRoleKey());
  // delete tasks then milestones on P013 so the empty-state precondition holds on every attempt
  const { data: ms } = await admin.from('milestones').select('id').eq('project_id', P013);
  const ids = (ms ?? []).map((m) => m.id);
  if (ids.length) {
    await admin.from('tasks').delete().in('milestone_id', ids);
    await admin.from('milestones').delete().eq('project_id', P013);
  }
});
```

(Adjust table/column names to the real schema — verify with `grep -n "milestone" supabase/migrations/*.sql | grep -i "project_id"`.)

- [ ] **Step 3: Tag:** `// @e2e-isolation: dedicated-row — owns P013; beforeEach resets to empty (retry-safe).`
- [ ] **Step 4: Prove retry-safety** — run it twice back-to-back without a DB reset between:

```bash
scripts/with-db-lock.sh bash -c "cd pmo-portal && npx playwright test AC-DEL-022 && npx playwright test AC-DEL-022"
```
Expected: PASS both times (previously the 2nd run/retry failed the empty-state assertion).

- [ ] **Step 5: Commit.**

### 4b: AC-AR-013 → robust waits (contention, no data change)

**Files:** `pmo-portal/e2e/AC-AR-013-assistant-panel-journey.spec.ts`

- [ ] **Step 1:** Read L91–130; the panel-visible (`toBeVisible`, ≈L108) + streamed-answer waits use 5s timeouts. Under `workers:4` load, the ⌘J open + SSE-mock settle races.
- [ ] **Step 2:** Make the open deterministic: after triggering ⌘J, `await expect(panel).toBeVisible({ timeout: 15_000 })` (match the suite's 15s convention), and gate the streamed-answer assertion on the mock's final frame arriving (wait for the assistant message locator, not a fixed delay). Do NOT change what it asserts.
- [ ] **Step 3: Tag:** `// @e2e-isolation: read-only — page.route-mocked agent-chat; no DB writes.`
- [ ] **Step 4:** Run under simulated load: `scripts/with-db-lock.sh bash -c "cd pmo-portal && npx playwright test AC-AR-013 --repeat-each=3"` → PASS ×3.
- [ ] **Step 5: Commit.**

---

## Task 5: Tag every remaining spec with its isolation class

The guard (Task 6) requires a tag on ALL specs. Tasks 2–4 tagged the 11 offenders; this tags the rest (~67).

**Files:** all remaining `pmo-portal/e2e/*.spec.ts` and `pmo-portal/e2e/serial/*.spec.ts` without a tag.

- [ ] **Step 1: List untagged specs**

Run:
```bash
cd pmo-portal && for f in e2e/*.spec.ts e2e/serial/*.spec.ts; do
  grep -q "@e2e-isolation:" "$f" || echo "$f"
done
```

- [ ] **Step 2: Classify + tag each**, using the audit map. Add the tag as the first line. Rules:
  - Pure nav/assert or `page.route`-mocked with no DB write → `read-only`.
  - Creates own `Date.now()`/uuid-named data (+ cleanup) → `self-isolated`.
  - Owns a dedicated seed row (P011/P012, Grace/Heidi, PROC-2026-006/007) → `dedicated-row`.
  - The 2 existing `describe.configure({mode:'serial'})` files (`AC-PR-020`, `AC-IXD-PROC-W5-3`) mutate own unique data → `self-isolated` (they don't touch org-global state; they stay in `chromium`, their in-file serial config is independent of the lane).

  Reference classification (from the audit) — read-only: AC-401, AC-701, AC-1117, AC-1200/1201/1202, AC-AUTH-001/003/005/006/012, AC-CAL-001, AC-CMDK-007, AC-IXD-DASH-003, AC-IXD-PROJ-007, AC-LEG-022/024, AC-MOBILE-OVERFLOW-001, AC-PK-005, AC-PR-019/026, AC-SP-pipeline-drilldown, AC-VISUAL-ICON-001, AC-W2-IXD-001, AC-CONFIRM-001, quarantine-guard, AC-AW-012, AC-CV-015, AC-ACD-010, AC-AT2-001/007, AC-ATC-017, AC-AXP-011/012/013/014/016, AC-AS-022, AC-VR-020; self-isolated: AC-CO-001, AC-PRJ-001, AC-PROC-001, AC-TASK-001, AC-IN-001, AC-INC-001, AC-DOC-001/020/060/090, AC-CRM-032, AC-IMP-011, AC-IMP-CYCLE-001, AC-IXD-PROJ-001, AC-W2-IXD-004, AC-PR-020, AC-IXD-TS-001, AC-AUTHF-005/020, AC-AGP-023, AC-INV-001, AC-AAN-036; dedicated-row: AC-1011, AC-911, AC-CONFIRM-001, AC-IXD-WP-001/002, AC-IXD-PROC-W5-3.

  (Any spec not in the list: read it, decide by the rules above, and if it writes shared org-global state it belongs in Task 2's serial lane instead.)

- [ ] **Step 3: Verify no spec is untagged**

Run the Step 1 loop again — expect **no output**.

- [ ] **Step 4: Verify tag values are all valid**

```bash
cd pmo-portal && grep -rhoE "@e2e-isolation: (read-only|self-isolated|dedicated-row|serial)" e2e | sort | uniq -c
grep -rhoE "@e2e-isolation: [a-z-]+" e2e | grep -vE "(read-only|self-isolated|dedicated-row|serial)" && echo "INVALID TAG FOUND" || echo "all tags valid"
```
Expected: only the 4 valid classes; "all tags valid".

- [ ] **Step 5: Commit** (may be several commits by group): `git add pmo-portal/e2e && git commit -m "test(e2e): declare @e2e-isolation class on all specs"`

---

## Task 6: The enforcement guard — `check-e2e-isolation.sh`

**Files:**
- Create: `scripts/check-e2e-isolation.sh`
- Modify: `pmo-portal/package.json` (`verify` + a `check:e2e-isolation` script)
- Modify: `.github/workflows/ci.yml` (add a step to each job, next to the migration-collision step)

- [ ] **Step 1: Write the guard script**

```bash
#!/usr/bin/env bash
# Fail when an e2e spec does not correctly declare its parallel-isolation class.
# Every pmo-portal/e2e/**/*.spec.ts must carry `// @e2e-isolation: <class>` where class is one of
# read-only | self-isolated | dedicated-row | serial. `serial` specs must live under e2e/serial/.
# This is the forcing function that keeps workers:4 e2e green as new specs are added (design
# 2026-07-11-e2e-parallel-isolation). Heuristic, not a proof — see the ceiling note in the design.
# Run with --self-test to prove it catches violations.
set -euo pipefail

VALID='read-only|self-isolated|dedicated-row|serial'
# Shared seed IDs/logins — a WRITE to these outside serial/dedicated-row is the mode-2 smell.
SHARED_IDS='00000000-0000-0000-0000-000000000001|40000000-0000-0000-0000-000000000001|40000000-0000-0000-0000-000000000002|41000000-0000-0000-0000-000000000001'

check_dir() {
  local root="$1" rc=0 f tag base
  while IFS= read -r f; do
    tag=$(grep -m1 -oE "@e2e-isolation: (${VALID})" "$f" | sed -E 's/.*: //') || true
    if [[ -z "$tag" ]]; then
      echo "  MISSING/invalid @e2e-isolation tag: $f" >&2; rc=1; continue
    fi
    base="${f#"$root"/}"
    # lane consistency
    if [[ "$tag" == "serial" && "$base" != e2e/serial/* ]]; then
      echo "  serial-tagged but not under e2e/serial/: $f" >&2; rc=1
    fi
    if [[ "$tag" != "serial" && "$base" == e2e/serial/* ]]; then
      echo "  under e2e/serial/ but not tagged serial: $f" >&2; rc=1
    fi
    # read-only must not write
    if [[ "$tag" == "read-only" ]] && grep -qE "requireServiceRoleKey|\.insert\(|\.update\(|\.delete\(" "$f"; then
      echo "  read-only tag but has write signals (service-role/insert/update/delete): $f" >&2; rc=1
    fi
    # non-serial/non-dedicated must not write shared seed IDs
    if [[ "$tag" != "serial" && "$tag" != "dedicated-row" ]] && grep -qE "$SHARED_IDS" "$f" \
        && grep -qE "requireServiceRoleKey|\.insert\(|\.update\(|\.delete\(" "$f"; then
      echo "  ${tag} spec writes a SHARED seed id (use dedicated-row or serial): $f" >&2; rc=1
    fi
  done < <(find "$root/e2e" -name '*.spec.ts' | sort)
  return $rc
}

if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/e2e/serial"
  printf '// @e2e-isolation: read-only\n' > "$tmp/e2e/ok.spec.ts"
  check_dir "$tmp" >/dev/null || { echo "self-test FAIL: valid tree flagged" >&2; exit 1; }
  printf 'no tag here\n' > "$tmp/e2e/bad.spec.ts"
  if check_dir "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: untagged not caught" >&2; exit 1; fi
  rm "$tmp/e2e/bad.spec.ts"
  printf '// @e2e-isolation: serial\n' > "$tmp/e2e/wrongdir.spec.ts"   # serial tag, not in serial/
  if check_dir "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: lane mismatch not caught" >&2; exit 1; fi
  echo "self-test OK"; exit 0
fi

root="${1:-$(dirname "$0")/../pmo-portal}"
if check_dir "$root"; then
  echo "e2e isolation OK ($(find "$root/e2e" -name '*.spec.ts' | wc -l | tr -d ' ') specs tagged)"
else
  echo "ERROR: e2e isolation violations above — fix before pushing (see docs/qa-portfolio.md)." >&2
  exit 1
fi
```

- [ ] **Step 2: chmod + self-test**

```bash
chmod +x scripts/check-e2e-isolation.sh
bash scripts/check-e2e-isolation.sh --self-test
```
Expected: `self-test OK`

- [ ] **Step 3: Run against the real tree (must pass now that Tasks 2–5 tagged everything)**

Run: `bash scripts/check-e2e-isolation.sh`
Expected: `e2e isolation OK (NN specs tagged)`. If it flags anything, fix the tag/lane before continuing.

- [ ] **Step 4: Wire into `verify`**

In `pmo-portal/package.json`, add the script and chain it next to `check:migrations`:
```jsonc
"check:e2e-isolation": "bash ../scripts/check-e2e-isolation.sh",
"verify": "npm run check:migrations && npm run check:e2e-isolation && npm run typecheck && npm run lint:ci && npm run test && npm run build",
```

- [ ] **Step 5: Wire into CI (all 3 jobs)**

In `.github/workflows/ci.yml`, directly after each existing `Migration prefix collision check` step (there are 3 — verify, pgtap, integration), add:
```yaml
      - name: E2E isolation-tag check
        run: bash scripts/check-e2e-isolation.sh
```
Verify: `grep -c "E2E isolation-tag check" .github/workflows/ci.yml` → `3`.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-e2e-isolation.sh pmo-portal/package.json .github/workflows/ci.yml
git commit -m "ci(e2e): enforce @e2e-isolation tags (guard in verify + all CI jobs)"
```

---

## Task 7: Docs & agent-awareness

**Files:**
- Create: `pmo-portal/e2e/README.md`
- Modify: `docs/qa-portfolio.md`
- Modify: `docs/product-expectations.md`
- Modify: `.claude/agents/qa-acceptance.md`

- [ ] **Step 1: `e2e/README.md`** — practical "pick your isolation class" for humans + agents:

```markdown
# E2E isolation contract (workers:4 — parallel by default)

Every spec declares one class on its first line: `// @e2e-isolation: <class>`.
`check-e2e-isolation.sh` (in `npm run verify` + CI) fails the build without a valid tag.

| Class | Use when | Rule |
|---|---|---|
| `read-only` | only navigates/asserts (incl. `page.route`-mocked edge fns) | no DB writes |
| `self-isolated` | you create your own data | name it uniquely (`${Date.now()}`) + clean up |
| `dedicated-row` | you own an expendable seed row (P012/P013…) | `beforeEach` resets it (retry-safe) |
| `serial` | you mutate ORG-GLOBAL state (entitlements, domain ownership, shared user roles) | file lives in `e2e/serial/`; runs at `--workers=1` |

Default to `read-only`/`self-isolated`. Reach for `serial` ONLY when the journey is intrinsically
org-global — never to paper over a race you could dedicate away. Never weaken an assertion to fit a lane.
```

- [ ] **Step 2: `docs/qa-portfolio.md`** — add a section "e2e parallel-isolation contract" after the Layers section (≈L29), summarizing the taxonomy + the guard + the two-lane run, linking `e2e/README.md` and the design doc.

- [ ] **Step 3: `docs/product-expectations.md`** — in the Part B Acceptance row (L97), append: "**e2e specs declare a valid `@e2e-isolation` class and pass `check-e2e-isolation.sh`; parallel-safety is a Definition-of-Done property, not an afterthought.**"

- [ ] **Step 4: `.claude/agents/qa-acceptance.md`** — under the BINDING authoring principle (L9), add: "**Every e2e spec you author declares `// @e2e-isolation: <class>` (read-only | self-isolated | dedicated-row | serial). Prefer self-isolated/dedicated-row; use `serial` (→ `e2e/serial/`) ONLY for genuinely org-global journeys. `check-e2e-isolation.sh` enforces it. Never weaken an oracle to fit a lane — dedicate data or serialize instead.**"

- [ ] **Step 5: Commit**

```bash
git add pmo-portal/e2e/README.md docs/qa-portfolio.md docs/product-expectations.md .claude/agents/qa-acceptance.md
git commit -m "docs(e2e): document + agent-brief the @e2e-isolation contract"
```

---

## Task 8: Full-suite verification at workers:4

- [ ] **Step 1: Full local e2e, both phases, clean DB**

```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/pmo-backend-ig-audit-c393d3
scripts/with-db-lock.sh bash -c "supabase db reset && cd pmo-portal && CI=1 npm run e2e"
```
Expected: parallel phase (workers:4) all PASS, serial phase (workers:1) all PASS. Capture wall-clock.

- [ ] **Step 2: Full `npm run verify`** (includes both guards)

```bash
cd pmo-portal && npm run verify
```
Expected: exit 0 — `check:migrations` + `check:e2e-isolation` + typecheck + lint + unit + build all green.

- [ ] **Step 3: Prove the guard bites** — temporarily break one tag, confirm red, revert:

```bash
cd pmo-portal
sed -i.bak '1s|@e2e-isolation: read-only|@e2e-isolation: nope|' e2e/AC-401*.spec.ts
npm run check:e2e-isolation; echo "exit=$?"   # expect non-zero + the offending file
mv e2e/AC-401*.spec.ts.bak e2e/AC-401*.spec.ts  # (or git checkout) restore
```

- [ ] **Step 4: Push branch + open PR to `dev`; watch CI**

```bash
git push -u origin fix/e2e-parallel-isolation
gh pr create --base dev --title "test(e2e): parallel-safe isolation contract + guard (fix #313 workers:4)" --body "See docs/superpowers/specs/2026-07-11-e2e-parallel-isolation-design.md"
gh pr checks <n> --watch
```
Expected: `verify` + `pgtap` green (PR→dev skips integration).

- [ ] **Step 5: Re-open the dev→main promote → integration lane green at workers:4** (the real proof). Compare the `integration` job time to the 10.3m baseline. Do NOT merge to main without owner go.

---

## Self-review notes (author)

- **Spec coverage:** §4 taxonomy → Tasks 2/5; §5 lane mechanism → Task 1; §6 offender table → Tasks 2/3/4; §7 guard → Task 6; §8 docs/agent → Task 7; §9 verification → Task 8. All spec sections mapped.
- **Sequencing:** guard (Task 6) lands AFTER all tagging (Tasks 2–5) so it doesn't red-fail its own PR. ✓
- **Oracle integrity:** every offender fix says "keep assertions unchanged" (qa-acceptance BINDING rule). ✓
- **Ceiling:** the guard is a heuristic lint (documented); the workers:4 integration lane is the empirical backstop. ✓
