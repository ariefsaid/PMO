# Plan — BlockNote minutes editor (#805)

Spec: `docs/specs/meeting-module.spec.md` (§4 FR-MTG-001..008, 017..027; §5 AC-MTG-001..014, 021..026; §7 traps).
Rulings: `DD-MTG-2` (block = `{type, props:{taskId}, children}`, no inline content, no sync), `DD-MTG-5`
(plain-text projection, indexed), `DD-MTG-8` (`/action` opens the prefilled task-create modal — an informed
publication, kept), `DD-MTG-9` (the in-document block was cut in v1; #805 is the ruling that brings it back,
**as a fresh design under DD-MTG-2**). Spike: `docs/spikes/2026-08-19-blocknote-prototype.md`, code at tag
`archive/spike-467-blocknote` (reference only — its block is `content:'inline'`, which DD-MTG-2 forbids).

## Design

- **Storage.** `meetings.notes` holds BlockNote's `Block[]` JSON verbatim (v2). v1 rows are
  `[{type:'p', text}]`. `notes_schema_version` stays server-written (FR-MTG-005): migration `0254`
  replaces the trigger so version = 2 when any top-level element carries `children` (every BlockNote
  block does; no v1 block does), else 1. A client-set value still never sticks (AC-MTG-126 pin updated).
- **Projection.** Trigger recomputes `notes_text` with a recursive walk over `content`/`children`/`rows`
  runs — each text run exactly once (FR-MTG-008), v1 `text` keys included — and `notes_search` as before.
- **v1 upgrade (one-way, on load).** `upgradeNotes(json)` in `src/lib/meetingNotes.ts` maps each v1 line to a
  paragraph with the same text (empty text → empty paragraph, bare strings → paragraph); the next Save
  writes v2. No migration over live rows, no data loss.
- **Action-item block.** `createReactBlockSpec({type:'actionItem', content:'none', propSchema:{taskId:{default:''}}})`.
  Renders the live `tasks` row via `repositories.task.get(id)` (name · status · assignee · due), tombstone
  when it does not resolve or `taskId` is empty. Deleting the block never touches the task (FR-MTG-018);
  paste duplicates the reference with no write (FR-MTG-020, BlockNote clipboard keeps props).
  `/action` slash item opens the existing `ActionItemModal` (DD-MTG-8); on create the block is inserted with
  the new `taskId`. Hidden when `tasksExternal` (§8.5).
- **Palette.** Default blocks minus image/video/audio/file (FR-MTG-022): schema omits them, so the
  persisted doc cannot hold `data:` URIs.
- **Surface.** `src/components/meetings/MinutesEditor.tsx` (+ `minutesEditor.css`, scoped `.minutes-editor`),
  `React.lazy` from `MeetingDetail` (FR-MTG-026). Read-only viewers get the same editor with
  `editable={false}`. Explicit "Save minutes" button kept (existing journeys).
- **i18n.** BlockNote dictionary: its `en`; `id` from BlockNote's locale if shipped, else en + our
  Bahasa overrides for slash menu / placeholders. Our own strings via `react-i18next` keys in both
  `en` and `id` `common.json`; slash aliases are translation keys (FR-MTG-023).
- **Lockfile.** Linux container: `npm install` the three `@blocknote/*` packages (same pinned version as
  the spike), then confirm `@emnapi/core` + `@emnapi/runtime` still in `package-lock.json`.

## Tasks (TDD: red first, at the cheapest layer)

| # | Task (2–5 min each) | Files |
|---|---|---|
| T1 | Add deps; confirm lock canaries; baseline + candidate build, record bundle delta | `package.json`, `package-lock.json` |
| T2 | RED→GREEN `upgradeNotes` / `isV1Notes`: lossless v1→v2, idempotent on v2 | `src/lib/meetingNotes.ts`, `.test.ts` |
| T3 | RED→GREEN `assertNoBinary` + `actionItemRefs` helpers (data: URI guard, taskId list) | same |
| T4 | Migration 0254 + rollback: version derivation + recursive text projection | `supabase/migrations/0254_*.sql`, `rollback/` |
| T5 | pgTAP: v2 doc round-trips (AC-MTG-001), version derived/pinned (009, 126), text once (011), edit re-index (012), task-name boundary (013), block removal leaves task (004) | `supabase/tests/0254_meeting_blocknote.test.sql`, adjust 0205 test |
| T6 | `database.types.ts` + `meetings.ts`: `notes` typed as `Json`, drop `'p'`-only patch type, keep `parseNoteBlocks` for v1 reads | `src/lib/db/meetings.ts`, `.test.ts` |
| T7 | RED→GREEN block spec: atomic schema (no `content`, props only `taskId`) AC-MTG-002; schema excludes media AC-MTG-022(FR) / AC-MTG-026 | `src/components/meetings/minutesSchema.ts`, test |
| T8 | RED→GREEN `ActionItemBlock` renderer: live values (003), tombstone (005), empty id | `ActionItemBlock.tsx`, test |
| T9 | `MinutesEditor` (lazy), slash `/action` → modal → insert block (007, 008 empty id), hidden when external | `MinutesEditor.tsx`, `MeetingDetail.tsx`, tests |
| T10 | Scoped CSS: tokens, heading scale 24/20/18, dark mode, mobile overflow; `@source` seam | `minutesEditor.css`, `index.css` |
| T11 | i18n en + id (labels, slash aliases, tombstone, dictionary), `check:i18n`; AC-MTG-025 test | `public/locales/*/common.json`, test |
| T12 | Lazy-chunk assertion AC-MTG-024; e2e: extend mobile no-bleed route + heading measure + axe (specs only, not run here) | `src/**/__tests__`, `e2e/*` |
| T13 | Full verify (typecheck, eslint, touched vitest, check:i18n, build); spec/decisions note; push | docs |

## AC → owning test

| AC | Layer | Test |
|---|---|---|
| AC-MTG-001, 009, 011, 012, 013, 004, 126 | pgTAP | `supabase/tests/0254_meeting_blocknote.test.sql` |
| AC-MTG-002, 026 (+FR-MTG-022 palette) | Vitest | `minutesSchema.test.ts` |
| AC-MTG-003, 005, 007(render-side), 008 | Vitest/RTL | `ActionItemBlock.test.tsx` |
| AC-MTG-006 | Vitest | `meetingNotes.test.ts` (refs duplicate, no write) |
| AC-MTG-201 v1→v2 lossless upgrade | Vitest | `meetingNotes.test.ts` |
| AC-MTG-022 heading scale | Vitest (CSS source) + e2e measure | `minutesEditor.css.test.ts`, e2e |
| AC-MTG-021 mobile overflow | e2e | existing `AC-MOBILE-OVERFLOW-001` sweep (meeting-detail route already listed) |
| AC-MTG-023 axe | e2e | `AC-MTG-023-meetings-axe.spec.ts` |
| AC-MTG-024 lazy chunk | Vitest | `MeetingDetail.lazy.test.ts` (static-import guard on the editor module) |
| AC-MTG-025 locale | Vitest/RTL | `MinutesEditor.i18n.test.tsx` |

## Out of scope

Template copy-on-create (FR-MTG-021 — deferred with templates, DD-MTG-9), attachments (FR-MTG-022 later slice),
autosave, collaborative editing, Indonesian per-org search config (FR-MTG-013 unchanged), a bundle-budget gate (§8.4).
