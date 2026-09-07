# Meeting module — spec

**Decision tickets:** #463 (record shape · **closed, decided**) · #467 (BlockNote prototype · **closed**)
**Rulings:** `DD-MTG-1..5` (`docs/decisions.md:1831`) · **`OD-MTG-1..2`, `DD-MTG-6..7` (owner grill 2026-08-21, §4/§8.1)** · `DD-TASK-1..2` (`docs/decisions.md:1650`) ·
`OD-CR-3`/`OD-CR-4` (`docs/decisions.md:1106`) · `DD-I18N-1` (`docs/decisions.md:1335`) ·
`OD-CR-12` (`docs/backlog.md:1038`)
**Spike:** `docs/spikes/2026-08-19-blocknote-prototype.md` (branch `spike/467-blocknote`, code deliberately unmerged)
**Id prefix:** `MTG` — unused today for both `FR-` and `AC-` across `docs/specs/`.

> **Why this document exists.** #463 and #467 are both closed and neither produced a build ticket, a
> spec, a table or a page. The meeting module is **step 3 of the RIS go-live sequence**
> (`docs/backlog.md:1057`) and a stated day-1 client requirement, and nobody has sized it. This is the
> missing half: `DD-MTG-1..5` fix the *shape*; this turns the shape into requirements a test can own.
>
> ⚑ **Four places where the shipped code contradicts the tickets are recorded in §8 and the code
> wins.** Two of them change what gets built.

---

> ## ⚑ v1 AS SHIPPED (2026-08-24) — read this before the body; `DD-MTG-8`/`DD-MTG-9` amend it
>
> The build landed on `dev` via #526 with two recorded amendments (`docs/decisions.md`):
>
> - **`DD-MTG-9` — the `actionItem` document block is OUT of v1**, and with it FR-MTG-003/004/006's
>   `props.taskId` shape, FR-MTG-018..021, and AC-MTG-001..008 (structurally moot: action items are
>   discovered by `tasks.meeting_id`, not by position in the document). Notes are flat typed-text
>   blocks; templates are a flag + filter, copy-on-create deferred with the block.
> - **`DD-MTG-8` — `/action` opens the task-create modal prefilled and editable** (an informed
>   publication into the org-visible task system), never a silent copy of the line.
>
> **Where the shipped oracles live (the greppable map — the build's test ids are `AC-MTG-1xx`, this
> spec's are `AC-MTG-0xx`; this table is the join):** access model + persistence + /action seam →
> `supabase/tests/0205_meeting_access.test.sql` (`AC-MTG-101..129`: attendance reads 106..110,
> shares/audit 111..119, edit rights + CHECK 120..121, /action + same-project + FK-block 122..124,
> authorship pin 125, schema-version pin 126, DB-level search 127..128, attendee org spoof 129) ·
> the cross-stack journey → `e2e/AC-MTG-060-meeting-minute-action.spec.ts` · axe →
> `e2e/AC-MTG-023-meetings-axe.spec.ts` · no-bleed → the shared sweep. Spec ACs whose subject
> matter those cover are owned there; AC-MTG-001..008 are void per `DD-MTG-9`.

## 1. Scope

A meeting is a **note-taking surface with a record around it**: title, when it happened, an optional
project, who attended, and a rich-text body captured live during the meeting. Its one structured
output is the **action item**, which is a `tasks` row, not a note.

**In v1**
- `meetings` and `meeting_attendees` tables, RLS + `org_id` from the first migration.
- A BlockNote editor persisting to `meetings.notes` (`jsonb`).
- Exactly **one** typed block: `actionItem`, holding a task reference and nothing else (`DD-MTG-1/2`).
- A reverse-chronological list, a project filter, and **search over the notes** (`DD-MTG-5`).
- Templates as a flag + copy-on-create. No template engine (`DD-MTG-5`).

**Out of v1 — with the reason, so it is not re-argued**
- **Decision / Risk / Attendee-mention blocks.** `DD-MTG-1`'s durable test: *a block earns being typed
  only when something outside its meeting must query, assign or filter it — otherwise it is
  formatting.* None of the three passes. Notes are JSON, so any of them can become typed later
  without a migration penalty.
- **A separate `contact_id` on the meeting** (`DD-MTG-4`) — the counterparty **is** an attendee.
- **Two-way row↔block sync** (`DD-MTG-2`) — see §3.
- **Multi-project meetings** (`DD-MTG-4`), **an org-wide task browser** (`DD-TASK-4`), **ERPNext
  sync of meetings** (no capability domain claims them, ADR-0055).
- **Embedded files and images** — see `FR-MTG-022` and §7.

---

## 2. Preconditions (this spec does not design any of them)

**P1 — first-class tasks (#462) must ship first.** `tasks.project_id` is `not null` today
(`supabase/migrations/0001_init_schema.sql:209`); a meeting-born action item that belongs to no
project cannot exist until that changes. `tasks.meeting_id` is the **second** nullable parent and
`DD-TASK-2` requires it in its **own** migration, after nullable `project_id` has landed alone.

**P2 — the i18n seam (#468) must ship first.** Meetings land *after* it precisely so translation is
not retrofitted (`OD-CR-3`). Two concrete dependencies: every user-facing string here is a
`react-i18next` key (`DD-I18N-1`), and the notes search config is resolved from the org's default
language (`FR-MTG-013`), which needs the per-org language column `OD-CR-4` describes.
`organizations` carries `default_currency` (`supabase/migrations/0187_money_currency_seam.sql:83`)
but **no language column today**.

### The task seam — what a meeting hands to a task, and what it needs back

This is the whole interface. Everything else about tasks is #462's.

| Direction | Contract |
|---|---|
| **Meeting → task, on `/action`** | Create a task with `meeting_id = <this meeting>`, `project_id = <the meeting's project, or NULL>`, and a default name. Nothing else. |
| **Meeting → task, on edit inside the block** | Writes go **straight to the task row** through the task repository — the same call path the task list uses. The block is a widget over the row, not a copy of it. |
| **Task → meeting, on render** | Read `{ id, name, assignee_id, end_date, status, archived_at }` by id, **live**. A batch read of *n* ids for one document, not *n* reads. |
| **Task → meeting, when the id resolves to nothing** | The block renders a tombstone (`FR-MTG-019`). Not an error, not an empty block. |
| **Never crosses** | Deletion. In either direction. (`FR-MTG-018`, `DD-MTG-2`.) |

⚑ **Assumptions to reconcile with #462 — flagged, not decided here:**
- **A1** — a task may be created with `project_id = NULL`. `DD-TASK-1` says so; the write surface that
  makes it true is #462's to reconcile, atomically, and is deliberately not restated here.
- **A2** — a task may be created with `meeting_id` set. Requires `DD-TASK-2`'s second migration.
- **A3** — a task's `name` is still `not null` (`0001_init_schema.sql:210`), so `/action` must supply a
  placeholder. See `FR-MTG-017` and the cost recorded in §7.
- **A4** — the invariant "a task and its meeting cannot name different projects" (`DD-TASK-1`,
  mirroring `check_tasks_parent_same_project`, `supabase/migrations/0140_task_model_fields.sql:54`)
  is enforced on the **task** side. This spec relies on it; it does not implement it.
- **A5** — whoever may take meeting notes may create the task the note produces. If #462's task-write
  role set and this spec's meeting-write role set differ, `/action` silently fails for somebody. §9
  asks the question that settles both.

---

## 3. The persistence question — where the line falls, and why

#463's title is *"the record shape and what a typed block persists as"*. This section is the answer.

### 3.1 The two failure modes, named

An opaque blob is **unqueryable** — `DD-MTG-5` makes search over notes the *primary* find mechanism,
so a design that cannot search them fails the ticket outright. Fully-normalised blocks are a **schema
nobody can evolve** — BlockNote owns the block vocabulary, ships new block types on its own release
cadence, and a per-block table makes every upstream addition a migration.

### 3.2 The line

> **The document is opaque to the schema. Everything the document *references* is not.**

Three columns, and each one is on a different side of that line:

| Column | Type | Side of the line |
|---|---|---|
| `notes` | `jsonb not null default '[]'` | **Opaque.** The BlockNote document verbatim. The schema asserts nothing about its interior. |
| `notes_text` | `text not null default ''` | **Derived, DB-owned.** A flattened plain-text projection, so Postgres FTS has something to index (`DD-MTG-5`). |
| `notes_search` | `tsvector` | **Derived, DB-owned.** The index payload. |

Plus one integer that makes the opaque half survivable: `notes_schema_version smallint not null
default 1`. Without it, a future BlockNote upgrade that changes block serialisation has no way to tell
an old document from a new one, and the migration becomes "parse and hope".

### 3.3 What the typed block persists as — concretely

`DD-MTG-2`: **the row is SoT; the block stores the task id and nothing else.** After that ruling,
there is nothing left for the block to hold, so the block is **atomic**:

```json
{
  "id": "b6d21a50-fc69-43ba-905e-15d366e08631",
  "type": "actionItem",
  "props": { "taskId": "11111111-1111-1111-1111-111111111111" },
  "children": []
}
```

No `content` key. No `assignee`. No `dueDate`. No title. No status. No cached copy of anything.

⚑ **This is not what the spike built** and the difference is structural, not cosmetic — see §8.2.

### 3.4 The tables

```sql
create table public.meetings (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id)
                         default '00000000-0000-0000-0000-000000000001',
  project_id           uuid references public.projects(id),          -- nullable, exactly one (DD-MTG-4)
  title                text not null,
  occurred_at          timestamptz not null default now(),
  location             text,
  notes                jsonb not null default '[]'::jsonb,
  notes_text           text not null default '',                     -- trigger-maintained
  notes_search         tsvector,                                     -- trigger-maintained
  notes_schema_version smallint not null default 1,
  is_template          boolean not null default false,
  created_by_id        uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz
);

create table public.meeting_attendees (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id)
                 default '00000000-0000-0000-0000-000000000001',
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  profile_id   uuid references public.profiles(id),
  contact_id   uuid references public.contacts(id),
  display_name text,
  created_at   timestamptz not null default now()
);
```

`meeting_attendees` copies the shipped child-table idiom rather than inventing one: a parent-org guard
in the policy plus a `BEFORE INSERT` org stamp from the parent, exactly as `crm_activities` does
(`supabase/migrations/0030_crm_contacts_activity.sql:65` and `:85`).

---

## 4. Requirements (EARS)

### Record shape and persistence

- **FR-MTG-001** — *Ubiquitous.* A meeting shall be **one row**. There shall be no per-block table and
  no block-level foreign key.
- **FR-MTG-002** — *Ubiquitous.* `meetings.notes` shall hold the editor document verbatim as a
  top-level JSON **array of block objects**, and the schema shall assert nothing about its interior
  beyond that it is an array.
- **FR-MTG-003** — *Ubiquitous.* The `actionItem` block shall persist **exactly** `type`, `props.taskId`
  and `children` — no title, assignee, due date, status or any other copy of task state.
- **FR-MTG-004** — *Ubiquitous.* The `actionItem` block spec shall be declared with **no inline
  content**, because `DD-MTG-2` leaves the block nothing of its own to hold.
- **FR-MTG-005** — *Ubiquitous.* `notes_schema_version` shall be written on every insert and update,
  and shall never be supplied by the client.
- **FR-MTG-006** — *Ubiquitous.* `actionItem` shall be the **only** custom block type in v1
  (`DD-MTG-1`).

### The plain-text projection and search

- **FR-MTG-007** — *Event-driven.* When `notes` is inserted or updated, the **database** shall
  recompute `notes_text` and `notes_search`. The client shall never write either column.
- **FR-MTG-008** — *Ubiquitous.* `notes_text` shall contain each text run **once**. ⚑ The obvious
  jsonpath `$.**.text` emits every run **twice** under lax-mode array unwrapping — verified against the
  running PG 17.6 stack; `strict $.**.text` does not. See §7.
- **FR-MTG-009** — *Ubiquitous.* `notes_search` shall be a stored `tsvector` column with a GIN index,
  **not** an expression index over `notes_text`. An expression index pins one text-search
  configuration as an immutable literal; a stored column lets the trigger choose the config per org
  (`FR-MTG-013`).
- **FR-MTG-010** — *Ubiquitous.* `notes_text` shall be maintained by a trigger, not a generated
  column: `array_to_string` is **STABLE**, not IMMUTABLE (verified on the running stack), so the
  natural flattening expression is not legal in a `GENERATED ALWAYS AS ... STORED` clause.
- **FR-MTG-011** — *Ubiquitous.* Free-text search shall query `notes_search` with
  `websearch_to_tsquery`, so a user's quoted phrase and `-exclusion` behave as they do everywhere else.
- **FR-MTG-012** — *Ubiquitous.* Search shall additionally match `meetings.title`.
- **FR-MTG-013** — *Where the organization declares a default language.* The trigger shall build
  `notes_search` with that language's text-search configuration; otherwise it shall use `simple`.
  ⚑ PG 17.6 **does** ship an `indonesian` configuration (verified: `pelanggan` → `langgan`), so
  Bahasa notes stem correctly rather than falling back to exact-token matching — but only if the
  config is chosen per org, which is why `FR-MTG-009` exists.

### Tenancy, authorization and lifecycle

- **FR-MTG-014** — *Ubiquitous.* Both tables shall have RLS **enabled and forced**, select scoped by
  `org_id = auth_org_id()`, and shall never accept an `org_id` from the client — the column default
  plus, for `meeting_attendees`, a `BEFORE INSERT` stamp from the parent meeting supply it. An
  explicitly-sent foreign `org_id` shall fail `WITH CHECK` rather than being silently rewritten
  (`supabase/migrations/0030_crm_contacts_activity.sql:75`).
- **FR-MTG-015** — *Ubiquitous.* A `meeting_attendees` row shall have **exactly one** of `profile_id`,
  `contact_id` or a non-blank `display_name` set — a table `CHECK`, not a polymorphic reference
  (`DD-MTG-3`). Whitespace shall not count as set.
- **FR-MTG-016** — *Ubiquitous.* Meetings shall soft-archive via `archived_at` (ADR-0018); hard delete
  shall be Admin-only and shall FK-block (23503, "in use") while tasks reference the meeting.

#### ⚑ Access model — settled by owner ruling 2026-08-21 (`OD-MTG-1`, `OD-MTG-2`, `DD-MTG-7`)

⛔ **This overrides the org-wide default FR-MTG-014 would otherwise give a meeting body.** FR-MTG-014's
`org_id = auth_org_id()` remains the tenancy floor; these narrow the *select* on `meetings` above it.
Widening later is a policy line; narrowing later is a migration over live client notes, so the
expensive direction is taken now.

- **FR-MTG-030** — *Ubiquitous.* **Writing a meeting is ordinary RBAC.** Every role, **`Engineer`
  included**, shall be able to create a meeting and write its minutes. The `Engineer` role widens for
  meetings only; it gains nothing on `contacts` or `crm_activities`.
- **FR-MTG-031** — *Ubiquitous.* **Reading a meeting body is attendance, not role.** The `meetings`
  select policy shall admit a caller who is an **attendee** of that meeting (the `meeting_attendees`
  join on `profile_id`), or its **author**, or holds an explicit **grant** (FR-MTG-032), or is
  **`Admin`**. ⛔ **The policy keys on the attendee join, never on `auth_role()`** — the owner's rule is
  that an Engineer must not read a peer's minute from a meeting they were not present at.
- **FR-MTG-032** — *Event-driven.* **When** a user with read access to a meeting shares it, the system
  shall insert a grant row (`meeting_id`, `user_id`, `granted_by`, `granted_at`) and that user shall
  gain read access; **when** the grant is revoked the row shall be deleted and access shall end.
  Grants shall be **audit-logged** — who opened a minute to whom is precisely what needs a trail.
- **FR-MTG-033** — *Ubiquitous.* Grants shall be **view-only and to named users**. There shall be **no
  permission tiers, no share links and no expiry**. (Deliberate floor, not an oversight — add when
  asked twice.)
- **FR-MTG-034** — *Ubiquitous.* A Project Manager shall get **no automatic read** across their own
  project's meetings (`DD-MTG-7`). The share panel shall **pre-suggest the project's PM** as a
  one-click add. A blanket project-scope grant re-opens exactly what FR-MTG-031 closes, and project
  scope is a much wider net than it sounds; one-click sharing makes inclusion a decision someone made
  rather than a default nobody noticed. ⚑ Consequence, stated so it is not a surprise in review: **a PM
  cannot read minutes from a meeting on their own project unless invited or shared in.** The owner may
  widen this — it is the one direction that stays cheap.

⚑ **Test note (the oracle here dies quietly).** A fixture in which every user attends every meeting
**cannot distinguish an attendance check from an unconditional allow**. Every case for FR-MTG-031 must
include a **non-attendee same-org peer** and assert refusal, then mutation-check by breaking the join
condition. Same for FR-MTG-034: assert the *project's own PM* is refused when not an attendee.

⛔ **FR-MTG-030 has an unmet dependency: an `Engineer` cannot create a task** — `tasks_insert`
(`0199:116-121`) lists only `Admin`/`Executive`/`Project Manager`/`Finance`, so an Engineer who can
minute a meeting still cannot create its `/action` items. **Settled by `DD-TASK-8`: the Engineer gets
ordinary task create/edit** (the restriction turned out to be un-ruled boilerplate inherited from
`0002_rls.sql:93`), which also requires a new `tasks.created_by`. Tracked as
[#551](https://github.com/ariefsaid/PMO/issues/551) — **land it before the `/action` contract below**,
and do not design around the restriction as this spec's first draft did.

### The action item — the `/action` contract

- **FR-MTG-017** — *Event-driven.* When the author invokes `/action`, the system shall create the task
  row **immediately** and insert a block referencing it (`DD-MTG-2`). ⚑ `tasks.name` is `not null`
  (`0001_init_schema.sql:210`), so creation shall supply a placeholder name from a translation key.
- **FR-MTG-018** — *Ubiquitous.* Deleting an `actionItem` block shall remove **only the reference**.
  It shall never delete, archive or unassign the task. Deleting assigned work must not be a side
  effect of tidying a note.
- **FR-MTG-019** — *While a referenced task no longer resolves.* The block shall render a **tombstone**
  — never a crash, never a silent disappearance, never a blank block.
- **FR-MTG-020** — *Event-driven.* When `actionItem` blocks are pasted or duplicated, the system shall
  produce additional **references to the same task** and shall perform **no write**. A paste that
  silently creates a task is worse than one that does not.
- **FR-MTG-021** — *Event-driven.* When a template is copied into a new meeting, every `actionItem`
  block shall be copied with an **empty** `taskId`. A template must never hand live task references to
  every meeting created from it.

### Editor surface, i18n and the block palette

- **FR-MTG-022** — *Ubiquitous.* The block palette shall exclude image, video, audio and file blocks in
  v1, and the persisted document shall contain **no embedded binary content** (no `data:` URIs). The
  attachment path is a storage bucket, following `project-documents`
  (`supabase/migrations/0025_document_file_upload.sql:93`) — a later slice, not this one.
- **FR-MTG-023** — *Ubiquitous.* Every user-facing string on this surface — page copy, the slash-menu
  item and its aliases, the tombstone text, the action-item placeholder name, empty and error states —
  shall be a `react-i18next` key (`DD-I18N-1`). ⚑ The slash-menu **aliases** are a translation concern
  too: an author typing in Bahasa will not type `/action`.
- **FR-MTG-024** — *Ubiquitous.* All date and number display shall route through
  `pmo-portal/src/lib/format.ts`; the locale-drift ESLint guard
  (`pmo-portal/eslint.config.js:70`) applies to this surface unchanged.
- **FR-MTG-025** — *Ubiquitous.* The editor's heading sizes shall be overridden to `DESIGN.md`'s
  hierarchy — Page Title 24px / Heading 20px / Subheading 18px / Body 14px (`DESIGN.md:306`) — not
  BlockNote's own scale. Colour, font-family, radius and shadow overrides are **not sufficient**; the
  spike overrode those and left headings alone (§8.3).
- **FR-MTG-026** — *Ubiquitous.* The editor chunk shall be lazily loaded and shall not enter the
  initial route bundle.
- **FR-MTG-027** — *Ubiquitous.* Every create/edit/archive/delete affordance shall be gated with
  `can(action, entity, ctx)` on the **real** JWT role (`pmo-portal/src/auth/policy.ts:36` lists the
  `Entity` union this adds to; impersonation stays view-only). `can()` is UX only — RLS is the
  enforcement authority (ADR-0016).

### List and find

<!-- ⚑ 2026-08-24: this section's requirement was FR-MTG-030, COLLIDING with the access-model FR-MTG-030 added the same week; renumbered FR-MTG-035. The access-model id wins because migrations 0205's comments cite it. -->

- **FR-MTG-028** — *Ubiquitous.* The meeting list shall be ordered `occurred_at` **descending**
  (`DD-MTG-5`).
- **FR-MTG-029** — *Ubiquitous.* The list shall filter by project, shall include project-less meetings
  when no project filter is applied, and shall exclude templates and archived meetings by default.
- **FR-MTG-035** — *Ubiquitous.* The list shall be bounded by an explicit row cap and explicit
  ordering rather than a required filter — the same correction `DD-TASK-3` applied to tasks.

---

## 5. Acceptance criteria

**Persistence and the typed block**

- **AC-MTG-001** — *Given* a note containing a heading, a paragraph and an `actionItem`, *when* it is
  saved and read back, *then* `notes` round-trips byte-equivalently and no per-block rows exist
  anywhere.
- **AC-MTG-002** — *Given* an `actionItem` block, *when* the stored document is inspected, *then* its
  `props` contain **only** `taskId`, and the block has no `content` key.
- **AC-MTG-003** — *Given* a task whose name and assignee are changed **from the task list**, *when*
  the meeting is reopened, *then* the block renders the new values — because it never held the old
  ones.
- **AC-MTG-004** — *Given* a meeting note containing an `actionItem`, *when* the block is deleted and
  the note saved, *then* the task still exists, is still assigned, and still appears in "My tasks".
- **AC-MTG-005** — *Given* an `actionItem` whose task has been deleted elsewhere, *when* the meeting is
  opened, *then* a tombstone renders, the page does not error, and the rest of the document renders.
- **AC-MTG-006** — *Given* an `actionItem` block, *when* it is copied and pasted into the same note,
  *then* two blocks reference the same task id and the task count is unchanged.
- **AC-MTG-007** — *Given* `/action` is invoked and then undone, *then* the block is gone, the task
  still exists, and it is reachable in "My tasks".
- **AC-MTG-008** — *Given* a template containing an `actionItem`, *when* a meeting is created from it,
  *then* the new meeting's `actionItem` blocks carry an empty `taskId` and reference no live task.
- **AC-MTG-009** — *Given* any saved note, *when* the row is read, *then* `notes_schema_version` is set
  and equals the version the application writes — and a client attempting to set it does not change it.

**Search**

- **AC-MTG-010** — *Given* a note whose paragraph contains "pipeline", *when* the list is searched for
  `pipeline`, *then* that meeting is returned.
- **AC-MTG-011** — *Given* a note containing nested child blocks, *when* it is saved, *then*
  `notes_text` contains each text run **exactly once** — the duplication oracle for `FR-MTG-008`.
- **AC-MTG-012** — *Given* a saved note, *when* its paragraph text is edited and saved again, *then*
  the old term no longer matches and the new term does.
- **AC-MTG-013** — *Given* a note whose only match is inside an `actionItem`'s **referenced task
  name**, *when* the list is searched for that term, *then* the meeting is **not** returned — task text
  is not meeting text, and this asserts the boundary rather than leaving it accidental.
- **AC-MTG-014** — *Given* an org whose default language is Indonesian and a note containing
  `pelanggan`, *when* the list is searched for `langganan`, *then* the meeting is returned (stemming
  is live, not `simple`).

**Tenancy and authorization**

- **AC-MTG-015** — *Given* two orgs each with meetings, *when* a member of org A selects meetings,
  *then* only org A's rows are returned, for both tables.
- **AC-MTG-016** — *Given* a client insert that explicitly carries another org's `org_id`, *when* it is
  attempted, *then* it is rejected — not silently rewritten to the caller's org.
- **AC-MTG-017** — *Given* an attendee insert setting two of `profile_id` / `contact_id` /
  `display_name`, or zero, or a whitespace-only `display_name`, *when* it is attempted, *then* the
  `CHECK` rejects it.
- **AC-MTG-018** — *Given* an attendee row inserted with no `org_id`, *when* it is read back, *then*
  its `org_id` equals the parent meeting's.
- **AC-MTG-019** — *Given* a meeting referenced by a task, *when* a hard delete is attempted, *then* it
  fails with 23503 and surfaces as "in use".
- **AC-MTG-020** — *Given* a role without meeting-write permission, *when* the meeting page renders,
  *then* no create/edit affordance is shown **and** a direct write is refused by RLS. Both halves — the
  FE gate is UX, the DB is the authority.

**Surface**

- **AC-MTG-021** — *Given* the meeting editor at 390px and 360px, *when* the no-bleed sweep runs,
  *then* no element's right edge exceeds the viewport
  (`pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts`). ⚑ The spike clipped a
  paragraph mid-word at 375px, so this is a known-red surface, not a formality.
- **AC-MTG-022** — *Given* the rendered editor, *when* heading sizes are measured, *then* they match
  `DESIGN.md`'s hierarchy and not BlockNote's.
- **AC-MTG-023** — *Given* the meeting routes, *when* `axe-core` runs, *then* there are no violations.
- **AC-MTG-024** — *Given* the app's initial load, *when* the emitted chunks are inspected, *then* the
  editor chunk is not among them.
- **AC-MTG-025** — *Given* the meeting surface, *when* it is rendered under a non-default locale,
  *then* no literal English string appears in the page copy, slash menu, tombstone or empty state.
- **AC-MTG-026** — *Given* a paste of an image into the editor, *when* the note is saved, *then* the
  stored `notes` contains no `data:` URI.

**List**

- **AC-MTG-027** — *Given* meetings across several dates, *when* the list loads, *then* they are
  ordered newest-first and templates and archived meetings are absent.
- **AC-MTG-028** — *Given* a project filter, *when* it is applied, *then* only that project's meetings
  show; *when* it is cleared, *then* project-less meetings are included.

---

## 6. Traceability

| AC | Owning layer | Location |
|---|---|---|
| AC-MTG-001/002/008/009 | Unit (Vitest) | serialisation + template-copy of the block schema |
| AC-MTG-003/005/006/007 | Unit (Vitest/RTL) | the `actionItem` renderer against a mocked task repository |
| AC-MTG-004 | **Integration (pgTAP)** | the block delete path must not touch `tasks` — a DB fact, not a render fact |
| AC-MTG-010/011/012/013/014 | Integration (pgTAP) | the projection trigger + `notes_search` |
| AC-MTG-015/016/017/018/019/020 (DB half) | Integration (pgTAP) | RLS, the `CHECK`, the org stamp, the FK block |
| AC-MTG-020 (FE half) | Unit (Vitest/RTL) | `can()` gating of the affordances |
| AC-MTG-021 | E2E (Playwright) | add the meeting routes to the existing no-bleed sweep — do not fork it |
| AC-MTG-022 | E2E (Playwright, visual) | rendered measurement; the a11y tree cannot express it |
| AC-MTG-023 | E2E (Playwright + axe) | joins `AC-PR-026-axe.spec.ts`'s pattern |
| AC-MTG-024 | Unit (Vitest) | build-manifest assertion, no browser needed |
| AC-MTG-025 | Unit (Vitest/RTL) | render under a stub locale |
| AC-MTG-026 | Unit (Vitest) | the paste handler |
| AC-MTG-027/028 | **E2E (Playwright)** | one curated journey: open the list, filter, find a meeting by searching its notes |

One curated e2e journey covers `AC-MTG-027/028` and the `DD-MTG-5` find story end to end; everything
else sits at the lowest sufficient layer (ADR-0010).

---

## 7. Traps this work will hit

**`strict` is not optional in the jsonpath.** `jsonb_path_query_array(notes, '$.**.text')` returns
**every text run twice** — lax mode unwraps arrays and matches at more than one depth. Verified on the
running PG 17.6 stack: the lax form returned `Kickoff Kickoff Discussed… Discussed… nested child
nested child`; `strict $.**.text` returned each once. Doubling is invisible in a boolean match and
shows up only in `ts_rank` and storage — which is exactly how it ships. `AC-MTG-011` is the oracle.

**`array_to_string` is STABLE, so the generated-column route is closed.** `DD-MTG-5` says
"trigger-maintained or generated"; the tree decides it. Verified against `pg_proc`:
`jsonb_path_query_array` and `jsonb_array_elements_text` are IMMUTABLE, `array_to_string` is STABLE.
A `GENERATED ALWAYS AS … STORED` clause using it will be rejected at migration time. Trigger.

**Postgres ships an `indonesian` config — do not settle for `simple` by default.** Easy to assume
otherwise (it is absent from the commonly-cited list). PG 17.6 has it and it stems. But the choice
must be per-org, which is why `notes_search` is a stored column rather than an expression index — a
decision that costs nothing now and is a migration over live client notes later.

**BlockNote's typed block cannot be `content: 'inline'` under `DD-MTG-2`.** The spike's block is
(`.claude/worktrees/467-blocknote/pmo-portal/pages/BlockNoteSpike.tsx:27`). If the title is inline
content, the document holds a second copy of `tasks.name` and every case `DD-MTG-2` dissolved comes
straight back. The block must be atomic and edit the row through the repository. This is the single
largest delta between the spike and the ruling.

**`/action` will manufacture placeholder-named tasks.** `DD-MTG-2` chose immediate creation
deliberately ("untidy, never lossy") and `tasks.name` is `not null`. A stray `/action` therefore
leaves a real, assignable "Untitled action" in someone's "My tasks". That is the accepted cost, not a
bug to fix later by deferring creation — deferring it re-opens the undo/paste cases.

**Promoting a free-typed attendee to a contact needs a company.** `contacts.company_id` is `not null`
(`supabase/migrations/0030_crm_contacts_activity.sql:17`). `DD-MTG-3`'s "promote later, when someone
cares" is a two-field promotion, not a one-field one — and the promotion UI must ask.

**`crm_activities` already has a `'Meeting'` kind** — see §8.1. Decide the relationship before writing
the table, not after both surfaces have data.

**Attachments.** `FR-MTG-022` forbids embedded binary because a rich-text editor's default paste
behaviour will inline a pasted screenshot as a `data:` URI, into a `jsonb` column, with no size limit
and no MIME allowlist — while the shipped document path has a private bucket, a 5 MB cap and an
allowlist (`supabase/migrations/0025_document_file_upload.sql:93`). The gap is one paste wide, and it
lands in a column every search query reads.

**The shared component library will fight the editor's internals.** The spike found BlockNote's
selection/drag behaviour and its native date/colour controls are not cleanly replaceable through the
shadcn surface API without forking deeper components. `DESIGN.md` tokens reach the surfaces, not those
internals. Budget for "close enough, scoped" rather than "identical", and keep the seam scoped under
one class so it cannot leak into the rest of the app.

**Run the whole verify, not the touched files.** This adds a shared editor surface and a new route;
`npm run verify` (`pmo-portal/package.json:28`) is the gate, and the mobile-overflow and axe sweeps
are route lists that must be **edited**, not forked.

---

## 8. Where the shipped code contradicts #463 / #467 — the code wins

### 8.1 `crm_activities` already records meetings, and neither ticket mentions it

`crm_activity_kind` is `('Call','Email','Meeting','Note')`
(`supabase/migrations/0030_crm_contacts_activity.sql:11`), the table has `contact_id`, `company_id`,
`project_id`, `subject`, `body` and `occurred_at` (`:45`), and the Contacts page tells users in so many
words that this is where you "log calls, emails and meetings"
(`pmo-portal/pages/Contacts.tsx:185`). `DD-MTG-4` reasons that CRM filtering survives dropping the
meeting's contact field because "every meeting with Acme" resolves through attendees → contacts →
company — but that join does not exist yet, and the *existing* answer to that question is
`crm_activities`. **Shipping `meetings` without deciding this puts two rows behind the sentence "we met
Acme on Tuesday."** Settle it in the plan: either the meeting module supersedes the `'Meeting'` kind
(and the contact timeline unions both), or a meeting writes a `crm_activities` row per contact
attendee. Do not leave it emergent.

#### ✅ Settled 2026-08-21 — `DD-MTG-6`: the `'Meeting'` kind survives, re-scoped

**Ruled: keep the enum value, narrow what it means.** `crm_activities`' `'Meeting'` becomes the
**lightweight touchpoint log** — a call, an email, a site visit, the one-line "we saw them Tuesday".
**This module owns anything with attendees and minutes.** The Contacts page copy
(`pmo-portal/pages/Contacts.tsx:185`, *"log calls, emails and meetings against each contact"*) drops
"meetings" and links across to the meeting module instead. The contact timeline unions both sources.

⚑ **Correction to the reason first recorded on #527.** The ruling was justified there as *"retiring it
would delete real history"* — **that is false and should not be reused.** Checked: the only
`'Meeting'`-kind rows in the tree are **8 rows in `supabase/seed.sql`** (demo data), and no client is
live. Nothing real would be lost.

**The reason that does hold** is the distinction itself: a logged touchpoint and a minuted meeting are
different records with different lifecycles, and collapsing them would force every one-line "called
Acme" into a document with an attendee list and a notes body. The enum stays because the cheap record
is worth having, not because history depends on it.

### 8.2 The spike's typed block violates `DD-MTG-2`

`BlockNoteSpike.tsx:27-31` declares `content: 'inline'` with `propSchema: { assignee, dueDate }`, and
the spike's own recorded JSON carries `"props": { "assignee": "", "dueDate": "2026-09-18" }`. Every one
of those is a copy of task state, which is exactly what `DD-MTG-2` ruled out. The spike proved a typed
block *can* carry row-shaped props — and its own report says so — but the ruling that followed makes
that shape wrong. Build `FR-MTG-003`/`FR-MTG-004`, not the spike.

### 8.3 The spike's scoped-CSS seam is smaller than it reads

The overridden variables are colour, font-family, radius and shadow only. **No heading size or
line-height variable is overridden**, so H1/H2/H3 inherit BlockNote's scale — which is why the
Director's pixel pass found H1 eating a third of the first mobile viewport. `DESIGN.md:306` defines the
scale this surface must land on. It is an omission, not a limitation, but it is estimate-bearing.

### 8.4 There is no PWA, and no bundle gate to hold the +44% against

The spike's headline — "+416,952 bytes gzip (+44.35%) … the gating number for an installable PWA" — has
nothing to gate against in the tree today: no `vite-plugin-pwa`, no manifest link in
`pmo-portal/index.html`, no service worker, and `verify` (`pmo-portal/package.json:28`) runs thirteen
gates, none of which is a size budget. `OD-CR-12` un-parked the PWA (`docs/backlog.md:1038`) but it is
unbuilt. The number is real and the concern is right; the mechanism does not exist. `FR-MTG-026` and
`AC-MTG-024` do the affordable part — assert the chunk stays lazy — and a real budget gate is a
separate, cheap ticket that should exist before, not after, ~300 kB lands.

### 8.5 `tasks` INSERT is denied outright while ClickUp owns the domain

`tasks_insert` carries `and not public.domain_externally_owned(auth_org_id(), 'tasks')`
(`supabase/migrations/0093_clickup_tasks_flip.sql:69`), and `tasks_update_own_status` is likewise fully
denied while flipped (`:87`). This is correct and deliberate — the external system owns the domain. But
it means **`/action` cannot create a task at all in an org that has assigned `tasks` to ClickUp**, and
neither #463 nor `DD-MTG-2` accounts for that state. The block palette must hide `/action`, or the
slash item must explain why it is unavailable, when `domain_externally_owned(org,'tasks')` is true. §9
asks whether RIS is such an org.

---

## 9. ⏸ Needs an owner ruling

Three questions. Each is a fact about how the client works or what they are entitled to see — not
architecture — and each changes what gets built.

**⏸ MTG-Q1 — Who at RIS writes meeting notes?**
Today the four "master data" roles (Admin, Executive, Project Manager, Finance) may write contacts and
their activities; **Engineer cannot**
(`supabase/migrations/0030_crm_contacts_activity.sql:35`, `pmo-portal/src/auth/policy.ts`). If
engineers at RIS attend and minute client or site meetings, the same role set locks them out of the
day-1 feature, and `DD-MTG-3`'s whole argument — that notes are taken *live, during the meeting* —
argues for the person in the room. *Answer with: which job titles at RIS actually type the minutes?*

**⏸ MTG-Q2 — Can everyone in the organization read every meeting's notes?**
Every business table in this schema scopes reads to `org_id = auth_org_id()`, so the default is: yes,
anyone signed in reads every meeting. Meeting notes are the first surface where that default is
uncomfortable — a commercial negotiation, a supplier dispute or a conversation about a person all live
in free text. Narrowing later means a migration over live client notes. *Answer with: is a meeting's
body readable by everyone in the company, or only by its attendees plus management?*

**⏸ MTG-Q3 — Will RIS run ClickUp as the owner of tasks?**
If yes, §8.5 applies from day one and `/action` — the module's single structured output — cannot create
a task. That is not a defect to fix in this spec; it is a different feature (create in ClickUp through
the adapter, then reference it), and it must be known before the module is sized. *Answer with: at
go-live, does RIS keep its tasks in ClickUp, in PMO, or in neither?*
