# Budget: propose lines from a document, implementation plan (#1466)

> **For agentic workers:** execute through supervised Orca workers, TDD, one slice per worker. Each checkbox is a 2–5 minute step. Paths are relative to the repo root.

**Goal:** Fill the existing paste preview from an attached document; the user reviews and saves exactly as in #1445.

**Architecture:** Two routes into one box. Spreadsheet/CSV/TSV are converted to TSV in the browser. PDF/image go to a new edge function that calls the `ModelClient` port with a forced tool call and returns TSV. The dialog, preview and commit from #1445 are unchanged.

**Spec:** `docs/specs/budget-propose-from-document.spec.md`. **Depends on:** #1445 paste dialog (shipped) and the agent flag/usage plumbing.

## Constraints and grounding

- No migration is expected. If the usage table needs a new call kind, it is migration NNNN, number on request.
- Reuse, do not rebuild: `src/lib/budget/pasteRows.ts` (parse/preview), `_shared/modelClient.ts`, `_shared/modelResolution.ts`, `_shared/usage.ts`, `_shared/requestRateGuard.ts`, `_shared/readBodyBounded.ts`, ExcelJS (already a dependency). Edge test pattern: import the shipped handler from `./index.ts`, mock `globalThis.fetch`, no dependency injection in production code.
- Model output is untrusted (ADR-0039). Do not log source cells or model text.
- Money-adjacent (draft amounts) but no write path is added: the function returns text only. Security review focuses on caller gating, size bounds and the untrusted-output boundary.
- Local gate per CLAUDE.md: `npm run check:guards`, `npm run typecheck`, eslint on touched files, directly touched tests, `deno test` for the new function, `scripts/e2e-local.sh AC-BPD-013`, `scripts/ux-proof.sh` on the budget route.

## Slices

| Slice | Scope |
|---|---|
| A | Local reader: file to TSV, type/size checks (AC-002, 003) |
| B | Edge function `propose-budget-lines` (AC-004..006, 008, 010) |
| C | Dialog wiring, notice, errors, i18n, flag (AC-001, 007, 009, 011, 012, 013) |

A and B are independent; C needs both.

## A — local reader

**Files:** create `pmo-portal/src/lib/budget/documentToTsv.ts`, `documentToTsv.test.ts`.

- [ ] A1 (AC-BPD-002): failing test `AC-BPD-002 rejects other types and oversize`. Run `cd pmo-portal && npx vitest run src/lib/budget/documentToTsv.test.ts`; confirm red.
- [ ] A2: implement `classifyBudgetFile(file: { name: string; type: string; size: number }): { kind: 'sheet' | 'model'; } | { error: 'type' | 'size' }` using `MAX_FILE_SIZE_BYTES` from the documents constant; allowlist by extension and MIME. Green.
- [ ] A3 (AC-BPD-003): failing test: a workbook built with ExcelJS holding `=1+1` as text and `1,234.50` yields TSV containing both literally; a formula cell yields its cached result, never evaluated; tabs/newlines in cells are quoted per the paste parser.
- [ ] A4: implement `sheetFileToTsv(file: File): Promise<string>` (ExcelJS for xlsx, direct decode for csv/tsv with the existing CSV state machine converted to tab output). First sheet only; truncate beyond 500 data rows with the same flag shape as B. Green; no `fetch` call asserted.

## B — edge function

**Files:** create `supabase/functions/propose-budget-lines/index.ts`, `index.test.ts`, `deno.json`; reuse `_shared/*`.

- [ ] B1 (AC-004): failing Deno test: no token → 401; token of a role without create rights on the project → 403 and `fetch` (the model) never called. Run `deno test --allow-env --allow-net supabase/functions/propose-budget-lines/index.test.ts`.
- [ ] B2: implement `handleProposeBudgetLinesRequest(req)`: verify JWT as `purchase-capture` does, resolve the caller's profile, confirm create right on the project through an RLS-scoped read with the caller's token, bound body with `readBodyBounded`, validate mime and size server-side. Green.
- [ ] B3 (AC-005, 006, 008): failing tests with `fetch` mocked as the model: 600 rows → 500 returned + `truncated: true`; a row with an injected instruction string is returned as plain data and nothing else is called; an illegible-amount row is omitted by the prompt contract (assert the prompt text contains the omit/never-guess/never-round rules); zero rows → `{ rows: 0 }`.
- [ ] B4: implement the forced tool call via `ModelClient`, the schema `{category, description, amount|quantity+rate, source_ref}`, TSV serialization with a header row, tab/newline escaping, per-field length cap. Green.
- [ ] B5 (AC-010): failing tests: one usage row on success; metering insert failing → fail closed (no rows returned); rate guard exceeded → 429. Implement using `_shared/usage.ts` and `requestRateGuard.ts`. Green.
- [ ] B6 mutation check: set the role gate to always-allow; the AC-004 test must go red; restore.

## C — dialog

**Files:** modify `pmo-portal/pages/project-budget/BudgetPasteRowsDialog.tsx`, `pmo-portal/pages/ProjectBudget.test.tsx`, translations (`finance` namespace, en + id); create `pmo-portal/src/hooks/useProposeBudgetLines.ts` + test; create `pmo-portal/e2e/AC-BPD-013-budget-propose-document.spec.ts`.

- [ ] C1 (AC-001): failing test: control shown for Draft + permitted + flag; absent for Active, viewer or flag off. Green by gating on the existing `canPaste` props plus the flag helper.
- [ ] C2 (AC-007, 011): failing test: after a proposal the box holds the TSV, the "Proposed from <file>; check every line" notice shows, Save is still gated by preview, and the commit hook is called only on Save with the confirmed rows. Confirm no schema or repository change.
- [ ] C3 (AC-009): failing hook test: timeout/429/network error → classified error with `role="alert"`, paste unaffected. Implement `useProposeBudgetLines` (calls the function with `supabase.functions.invoke`, 60 s abort).
- [ ] C4 (AC-012): add en/id strings; test no fallback key renders in `id`; focus moves to the notice when rows arrive.
- [ ] C5 (AC-013): write the journey (model stubbed at the function boundary, not in the app): attach sample PDF, edit one row, Save, reload, assert rows on the Draft and Active unchanged. Run `scripts/with-db-lock.sh scripts/e2e-local.sh AC-BPD-013`; then `scripts/with-db-lock.sh scripts/ux-proof.sh /projects/41000000-0000-0000-0000-000000000001/budget`.

## Traceability (one owner per AC, ADR-0010)

| AC | Owning layer and test | Slice |
|---|---|---|
| 001 | unit `pages/ProjectBudget.test.tsx` | C1 |
| 002 | unit `src/lib/budget/documentToTsv.test.ts` | A1 |
| 003 | unit `src/lib/budget/documentToTsv.test.ts` | A3 |
| 004 | Deno `supabase/functions/propose-budget-lines/index.test.ts` | B1 |
| 005 | Deno same file | B3 |
| 006 | Deno same file (boundary) plus unit `ProjectBudget.test.tsx` (mapping step) | B3 |
| 007 | unit `pages/ProjectBudget.test.tsx` | C2 |
| 008 | Deno same file | B3 |
| 009 | unit `src/hooks/useProposeBudgetLines.test.tsx` | C3 |
| 010 | Deno same file | B5 |
| 011 | unit `pages/ProjectBudget.test.tsx` (no repository change asserted) | C2 |
| 012 | unit `pages/ProjectBudget.test.tsx` | C4 |
| 013 | e2e `e2e/AC-BPD-013-budget-propose-document.spec.ts` | C5 |

## Final builder gate

From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0` on every touched file, `npx vitest run` on the touched test files; Deno test for B; e2e C5 and `ux-proof` under the DB lock. Reviews: spec, quality, security (caller gating, size bounds, untrusted output). Model quality is checked by a local sample-document run against the deployed model, recorded in the PR; not CI.

## Owner questions (recommended answers)

1. Send PDFs/images to the configured model provider, with spreadsheets read locally only? **Recommend yes**, opt-in per file with a disclosure line.
2. Retain the attached file as evidence from this dialog? **Recommend no**; attach it through Documents (#1447/#1406) so this stays stateless.
3. Ship behind a default-off flag until a sample-document accuracy run is accepted? **Recommend yes**.
