# Spec: Document categories with per-role visibility (#2579)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-DCV-###`, `NFR-DCV-###`, `AC-DCV-###`. Plan: `docs/plans/2026-11-20-document-category-visibility.md`. Map #2516; scheduled after the 15 December go-live (January). Executor: Director-dispatched Orca worker, shipping alone (it changes read authority on an existing table and a storage bucket). Fulfils the seam deferred in OD-DOC-4 (`docs/decisions.md`) and extends `docs/specs/document-file-upload.spec.md`; it does not change upload, revision, status or preview behaviour except where stated.

> **Review 20 Nov** — checked against the shipped schema (`project_documents` 0001/0017/0025/0176/0292/0348, storage 0025/0310/0391, the CLI guard 0884, `transition_document_status` 0292/0342, the M365 definers 0292, `record_history_config`/`record_history_visible` 0260, the initplan guard 0646). Changed: the seeded system set is **eight** names, because shipped code already files Microsoft 365 folder references under `Reference`, which is not in `documentCategories.json` (Context, FR-DCV-001/007, Definitions, new OD-DCV-11); register writes are the four write roles, not every member (Context); FR-DCV-003's "require an explicit selection" and "server default Admin only" contradicted each other and now refuse an empty selection (OD-DCV-2); a revision's category is now enforced on the insert path, not by the form (FR-DCV-009, AC-DCV-013); "the revision function" does not exist and FR-DCV-012 now names the routines that do; the record-history and notification clauses described surfaces that do not exist (`project_documents` is not in `record_history_config`; there is no document notification), and FR-DCV-014/AC-DCV-015 now target the one helper that could leak (`notify_workflow_user`); AC-DCV-004 cannot create a signed link from pgTAP and now asserts the object row, with the storage API path referenced; AC-DCV-014 used an Engineer, whom the CLI operator tier refuses outright before any category rule applies, and now uses a Project Manager; AC-DCV-016 is already shipped and is a regression proof; NFR-DCV-001/006 claimed "no per-row function call" while the plan called a wrapper per row — the role seam is the existing `auth_role()` and the policy inlines one primary-key `EXISTS`; the register already shows a category column and derives its filter from visible rows. Open owner decisions: OD-DCV-2 (refuse an empty viewer set instead of defaulting to Admin only), OD-DCV-11 (make `Reference` a system category), and the OD-DCV-3/4/9 rulings already listed.

## Job story

When our organisation files documents against projects, I want each document to carry a category and I want to say which roles may see each category, so that people see only the documents their job needs, for example quality staff do not see commercial approvals and site administrators do not see invoices.

## Context and boundary

- **What exists.** The project document register (`project_documents`) already stores a free-text `category` (`text not null`). The form and the CLI share the seven names in `pmo-portal/src/lib/documentCategories.json` (Drawing, Specification, Report, Transmittal, Submittal, Certificate, Other), but shipped code also files a Microsoft 365 **folder reference** under the system label `Reference` (0292/0336/0338/0375/0763 write it; `DocumentFormModal` defaults to it and `documentCategoryLabel` translates it), and no JSON list contains it. The bucket is one org-scoped private bucket `project-documents` with keys `{org_id}/{project_id}/{document_id}/{filename}`; there is a status workflow with approver-not-author separation (0025/0292/0342), revision lineage by `parent_document_id`, and linked Microsoft 365 entries. Register rows and files are readable by every active member of the organisation and writable by Admin, Executive, Project Manager and Finance (0017 §2b, 0176 §2c, 0391); this spec replaces the read rule with a per-category, per-role rule.
- **In scope.** The register rows, their files in the `project-documents` bucket, and every server path that reads or lists them on a user's behalf (register list and detail, file download and signed links, preview, the audit trail, any notification that names a document, the assistant's read tools, the command-line client and the operator read API).
- **Out of scope.** Procurement attachments, expense-claim files, incident files, people and equipment expiry documents (`docs/specs/document-expiry.spec.md`) and assistant chat attachments keep their own access rules; extending categories to them is OD-DCV-5. Per-document or per-project overrides, per-user grants, and time-limited sharing are not part of this increment. Files held in Microsoft 365 stay governed by Microsoft permissions (ADR-0063); PMO controls only whether its own register entry, preview and open link are available to the caller, and the screen says so.
- **Roles.** Visibility is expressed over the roles the organisation has. Today these are the five fixed `user_role` values (Executive, Project Manager, Finance, Engineer, Admin); user-defined roles (ADR-0103, #902) are a proposal. The role seam is the existing `public.auth_role()` (0002), which already answers "what role is this caller" for every policy; the later migration changes that one function and the role column, nothing else (OD-DCV-1).
- **Authority.** RLS and security-definer functions decide; `can()` only shapes the screen (ADR-0016). Storage object access follows the same rule as the row it belongs to.

## Definitions

- **Category**: an organisation-owned label on every register document (for example Drawing, Invoice, Commercial approval). Every document has exactly one.
- **System category**: one of the eight seeded categories (Drawing, Specification, Report, Transmittal, Submittal, Certificate, Other, Reference). It cannot be renamed, deleted or archived; `Other` is the fallback for an unknown or blank legacy name, and `Reference` labels a Microsoft 365 folder entry (OD-DCV-11).
- **Viewer roles**: the set of roles allowed to see documents of a category. Absence of a role from the set means no access.
- **Visible document**: a register document whose category lists the caller's current role, in the caller's own organisation, for an active member. Admin is always a viewer of every category (OD-DCV-3).
- **Hidden**: not visible. A hidden document does not appear in lists, counts, search, previews or file access, and its existence is not revealed (OD-DCV-4). Its audit trail stays Admin/Operator-readable, and Admin sees every category (OD-DCV-3).
- **Attachment**: here, a file object in the `project-documents` bucket; its access follows the register row it belongs to.

## Requirements (EARS)

**Categories and rules**
- FR-DCV-001 The system shall store categories per organisation with a name (unique among live categories in that organisation, case-insensitive), a display order, a system flag and an archive state, and shall seed the eight system categories for every organisation.
- FR-DCV-002 The system shall store, per category, the set of viewer roles, and shall seed every existing category with all roles so that no one's access changes when the feature ships.
- FR-DCV-003 When an Admin creates a category, the system shall require at least one viewer role and shall always include Admin; a create that names no role is refused rather than defaulted, so a category is never created with an unintended audience (OD-DCV-2).
- FR-DCV-004 The system shall let only an Admin create, rename, reorder, archive or restore a category and change its viewer roles; changing the viewer roles shall replace the set in one atomic step and be recorded in record history with actor, time, old and new roles.
- FR-DCV-005 The system shall refuse to remove Admin from any category's viewer roles, and shall refuse to rename, delete or archive a system category.
- FR-DCV-006 Archiving a category shall keep its viewer roles in force for its existing documents; new documents cannot be filed in an archived category. Categories are never hard-deleted.

**Assigning a category**
- FR-DCV-007 The system shall give every register document a category reference. A writer that supplies only the legacy text name (the command-line client, the Microsoft 365 folder and link routines, the operator write API) shall have the name resolved on the row's `BEFORE INSERT OR UPDATE` trigger to the organisation's live category of that name, else to `Other` when the name is blank or unknown. `Reference` is a seeded system category, so a folder reference keeps its label (OD-DCV-11). The text name shown anywhere is always the category's current name.
- FR-DCV-008 When a user files or edits a document, the system shall accept only a category that is live, in the caller's organisation, and visible to the caller's role, and shall stamp `org_id` from the caller context, never from the client.
- FR-DCV-009 When a revision is created from a document, the server shall give it the parent's category: an insert carrying `parent_document_id` stamps the parent's category, refuses a supplied category that differs from it, refuses a parent the caller cannot see, and a later re-file moves the whole lineage together, in one step, and only by a caller who may edit every document in it and may see both the old and the new category (OD-DCV-8).

**Enforcement**
- FR-DCV-010 While a caller's role is not a viewer role of a document's category, the system shall return no row for that document from any read, and shall affect no row on any update or delete attempt, as if the document did not exist.
- FR-DCV-011 While a caller's role is not a viewer role of a document's category, the system shall deny reading, listing, and overwriting or deleting of that document's files in the `project-documents` bucket, using the same predicate as the row. A signed link is created only after the object is readable, so the denial reaches it without a second rule.
- FR-DCV-012 `transition_document_status` (a security-definer routine called with the caller's JWT) shall refuse a hidden document with the same not-found result as a missing one. The two service-role-only M365 definers (`m365_issue_document`, `m365_refresh_reference`) are reached only after the edge handler has read the same row under the caller's JWT; that ordering is what gates them and their existing tests must keep asserting it.
- FR-DCV-013 Every server path that reads register rows for a user, including edge functions, the assistant's read tools, the command-line client and the operator read API, shall evaluate the caller's role through the same rule and shall not use a privilege that skips it unless it re-applies the rule explicitly.
- FR-DCV-014 The audit trail of a document is written by `log_audit` and is readable only by Admin and Operator, who see every category, so it leaks nothing today. If a document type is ever added to `record_history_config`, it shall gain a `record_history_visible` arm (the function raises for an unknown entity type). A notification that names a document shall be written only through `notify_workflow_user`, which the system shall extend to refuse a `project_document` entity whose category the recipient cannot view (no document notification exists today).
- FR-DCV-015 For a Microsoft 365-linked or folder-reference entry, a hidden entry shall give no preview, open link, drift check or folder resolution to the caller. Preview and drift already read under the caller's JWT; the folder-resolution and refresh definers keep the same ordering rule as FR-DCV-012.
- FR-DCV-016 A role change, a category change or an edit to the viewer roles shall take effect on the caller's next request, without sign-in.

**Screens**
- FR-DCV-017 The register shall offer, in the create, edit and revision forms, only categories the caller can see. The register's category column and its category filter already exist and are derived from the rows the caller can read, so they need no new source of truth; a filter that lists a category with no visible document is a regression, not a feature.
- FR-DCV-018 A caller with no visible documents in a project shall see the ordinary empty state; no screen shall show a "hidden" count, a locked row or a message that something is withheld (OD-DCV-4).
- FR-DCV-019 An Admin shall have a Document categories settings page under Administration listing categories with a role matrix, a create/rename/reorder/archive action, and a plain note that linked Microsoft 365 files keep Microsoft's own permissions. A non-Admin shall not see the page or its link.
- FR-DCV-020 Actions (manage categories, set viewer roles) shall be registered in the role matrix (#902) and gated by `can()` for UX; RLS and the management function enforce.
- FR-DCV-021 System category names shall show in English and Bahasa Indonesia; organisation-created names display as typed.

## Non-functional requirements

- NFR-DCV-001 The caller's role shall resolve once per statement, not once per row: the policy uses the `(select auth_role())` InitPlan form and one `EXISTS` probe of `document_category_roles` on its primary key. A per-row wrapper function around the role test would defeat that, so the wrapper (if one exists for non-policy callers) is not what the policy calls.
- NFR-DCV-002 The register list for a project of 5,000 documents shall remain one bounded, indexed page read; the predicate shall not turn it into a sequential scan of the category tables.
- NFR-DCV-003 Denials are indistinguishable from absence: a hidden document, a nonexistent one and a foreign-organisation one return the same result and the same message.
- NFR-DCV-004 Every new table carries `org_id` by default, with RLS forced; every migration has a rollback file; archive over delete (ADR-0018).
- NFR-DCV-005 Phone-usable settings page; `DESIGN.md` tokens; English and Bahasa Indonesia; keyboard operable matrix with labelled checkboxes.
- NFR-DCV-006 The rule is one restrictive policy per surface over one predicate, so an audit of "who can see a document" reads one definition (`pg_policies` at head decides, not this text).

## Acceptance criteria and owning layer

Fixture used by the database tests: organisation A with categories `Commercial approval` (viewer roles Admin, Executive, Finance), `Invoice` (Admin, Finance), `Drawing` (all roles); one document in each, each with an uploaded file object; users: one per role plus a second organisation.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-DCV-001 | Given a database holding documents before the change, when the migration has run, then every document has a category, every system and existing category lists all roles, and each role sees the same document count as before. | pgTAP |
| AC-DCV-002 | Given a writer that supplies only the text `Drawing`, when it inserts a document, then the row references the `Drawing` category; given an unknown text, then it references `Other`; the stored text equals the category's name. | pgTAP |
| AC-DCV-003 | Given the fixture, when an Engineer selects documents, then only the `Drawing` document is returned; selecting the `Invoice` document by id returns no row; Finance sees all three. | pgTAP |
| AC-DCV-004 | Given the fixture, when an Engineer selects the `Invoice` document's file object row from `storage.objects` (as the storage API does before creating a link), then no object is returned; Finance gets the row, so the storage API's signed-link path succeeds for Finance and refuses for the Engineer (the API call itself is exercised in e2e, AC-DCV-022). | pgTAP |
| AC-DCV-005 | Given the fixture, when an Engineer tries to overwrite or delete the `Invoice` file object, then it is denied and the object is unchanged on read-back by Finance. | pgTAP |
| AC-DCV-006 | Given a document the actor can see, when they file or move it into a category they cannot see, a foreign-organisation category, or an archived category, then it is refused; given a hidden document, an update or delete affects zero rows and read-back by Admin shows it unchanged. | pgTAP |
| AC-DCV-007 | Given a hidden `Issued` document, when an Engineer calls the status transition on it, then the result equals a nonexistent id's result. | pgTAP |
| AC-DCV-008 | Given an Admin, when any category's viewer roles are set without Admin, then it is refused; when a non-Admin calls the management function, then it is refused; the Admin sees every fixture document regardless of rules. | pgTAP |
| AC-DCV-009 | Given a viewer-role change from (Admin, Finance) to (Admin, Executive), when it is applied, then the set is replaced atomically, Finance loses access on the next query without re-sign-in, and record history holds actor, time, old and new roles. | pgTAP |
| AC-DCV-010 | Given a client-supplied `org_id` on a category or a document, when it is inserted, then the stamped `org_id` is the caller's; a category of organisation B cannot be referenced from organisation A. | pgTAP |
| AC-DCV-011 | Given a system category, when an Admin renames, archives or deletes it, then it is refused; given a custom category archived, then its documents stay visible per its rules and no new document can be filed in it. | pgTAP |
| AC-DCV-012 | Given a lineage of three revisions, when an authorised Admin re-files one to another category, then all three move; when the actor cannot see the target category or edit every revision, then nothing moves. | pgTAP |
| AC-DCV-013 | Given a new revision of an `Invoice` document, then it has category `Invoice`; given a revision insert that supplies another category, then it is refused with a field error and no row is written. | pgTAP |
| AC-DCV-014 | Given the fixture, when the operator read API and the assistant's read tool path are called by a Project Manager (a role the operator tier admits and a category rule can exclude), then the `Invoice` and `Commercial approval` documents do not appear; the same calls as Finance return them. | pgTAP |
| AC-DCV-015 | Given a notification naming a document in a category, when it is written through `notify_workflow_user`, then a recipient who does not view that category gets no row and a viewer gets one. | pgTAP |
| AC-DCV-016 | Given a hidden Microsoft 365-linked entry, when the preview handler is called by a caller whose JWT cannot read the row, then it returns the generic not-found response and makes no Microsoft call (already shipped; this AC is the regression proof). | Unit (Deno, shipped handler with mocked fetch) |
| AC-DCV-017 | Given the command-line client, when it files a document with a category name, then it validates against the organisation's live categories, not a fixed list. | Unit |
| AC-DCV-018 | Given the create and edit forms, when the caller sees only some categories, then the options list only those (the register's filter already derives from visible rows); when none are visible the ordinary empty state shows with no hidden-count text. | Unit (RTL) |
| AC-DCV-019 | Given `can()` for the manage-categories action, then Admin passes and every other role is denied; given a non-Admin, then the settings section and its nav entry do not render. | Unit |
| AC-DCV-020 | Given the settings page, when an Admin unchecks a non-Admin role for a category and saves, then the repository receives the replaced set, and the Admin checkbox is locked on; a save with every non-Admin role unchecked is accepted. | Unit (RTL) |
| AC-DCV-021 | Given the policy bodies at head, when the initplan guard runs, then the new policies carry no bare helper call; the guard is catalog-derived, so it binds a new policy without a pinned list to update. | pgTAP (existing guard `0646_rls_initplan`) |
| AC-DCV-022 | Given a Finance user and an Engineer in one project, when an Admin creates category `Commercial approval` for Finance and Executive only, Finance uploads a file into it, and the Engineer opens the Documents tab and then requests the file directly, then Finance sees and downloads it and the Engineer sees no trace of it and cannot fetch it. | E2E (one journey) |
| AC-DCV-023 | Given category `Commercial approval` renamed to `Commercial`, when the rename applies, then every document in it stores the new text in the same transaction, the register shows the new name, and record history names the old and new name with the actor. | pgTAP |

## Errors

| Condition | Result |
|---|---|
| Hidden, nonexistent or foreign-organisation document or file | Identical not-found; no mention of category |
| Filing into a category the caller cannot see, archived, or from another organisation | Field error "Choose an available category" (no category names leaked beyond the caller's visible list) |
| A revision insert that names a category other than its parent's | Field error; no row written |
| Removing Admin from a category; renaming or archiving a system category | Refused with a plain message |
| Creating a category with no viewer role | Field error; nothing created |
| Duplicate live category name in the organisation | Field error |
| Non-Admin calls management function | Permission denied |
| Re-file of a lineage the actor cannot fully edit | Refused; nothing moved |

## Owner decisions (recommended defaults, not rulings)

| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-DCV-1 | Build on the five existing `user_role` values now; the role seam is the shipped `auth_role()` function (and the `profiles.role` column), so ADR-0103 custom roles later replace one function body and one column. A user whose organisation needs "quality" or "site admin" as distinct roles waits for #902; meanwhile those people hold the closest existing role. | If the owner needs QC and site admin as separate roles in January, the example cannot be expressed until #902 ships, and the role migration becomes part of this work. |
| OD-DCV-2 | Existing categories start visible to all roles (no change at ship); a new category must have its roles chosen at creation, and a create with none is refused (Admin is always included, so the minimum a create can send is Admin). | Defaulting new categories to all roles leaks by omission; defaulting them to Admin only hides documents from the team that files them, silently, and the creator may not notice. |
| OD-DCV-3 | Admin always sees every category and cannot be removed. | Without it a mis-set rule locks everyone out of a category, including the person who must fix it. |
| OD-DCV-4 | A hidden document leaves no trace: no count, placeholder or "restricted" row. Its audit trail stays Admin/Operator-only, and Admin sees every category, so no reader of the trail is excluded. | A visible placeholder confirms a document exists, and its title or presence can itself be sensitive. |
| OD-DCV-5 | Scope is the project register and its bucket. Procurement, expense-claim, incident and expiry attachments are a later increment reusing these categories. | If invoices are expected to be hidden where procurement invoice files live, they stay readable by procurement readers until that increment. |
| OD-DCV-6 | A person may file into, and edit within, only categories they can see; edit rights (author or Admin, 0348) are otherwise unchanged. | A writer who could file into a hidden category could not see the result; one who may not file where they work is blocked. |
| OD-DCV-7 | System category keys stay fixed and translated; organisation-created names are single-language as typed. | If the organisation expects every custom name in both languages, it must type each or #2529's terminology tool must cover them. |
| OD-DCV-8 | A revision lineage shares one category; the server takes the parent's category on a revision insert, and a re-file moves the whole lineage. | Revisions split across categories would show a superseded parent to one role and its successor to another. |
| OD-DCV-9 | Executive is a viewer only where the matrix says so; there is no implicit "sees everything" role besides Admin. | If Executive must always see everything, a mis-set matrix hides documents from the people accountable for them. |
| OD-DCV-10 | Linked Microsoft 365 files keep Microsoft's permissions; PMO hides its register entry and links only. | Someone with the raw Microsoft link can still open the file; PMO cannot prevent that. |
| OD-DCV-11 | `Reference` is a system category, because shipped code already files every Microsoft 365 folder reference under that label and the UI translates it. It is seeded with all roles, cannot be renamed or archived, and is not offered in the ordinary register forms (folders are created by the link routine, not typed). | If it were seeded as a custom category, an Admin could archive it; the folder routines would then resolve to `Other` and every folder entry would change label, with no way back except a data fix. |

## Delivery checklist

- [ ] Owner signs OD-DCV-1..11 (OD-DCV-2 and OD-DCV-11 are new since the 20 Nov review).
- [ ] Reader inventory of every path that reads register rows is complete before enforcement is switched on (plan Task 1), including the two service-role M365 definers and their caller-read ordering.
- [ ] pgTAP mutation check: remove the viewer-role predicate from the row policy and from the storage policy; AC-DCV-003 and AC-DCV-004 must go red; restore.
- [ ] Glossary: Document category, Viewer roles, System category, Reference (folder reference).
- [ ] ADR candidate recorded in the plan (category-gated visibility, restrictive policy per surface, `auth_role()` as the role seam).
