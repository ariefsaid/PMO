# Expiry warnings to the direct manager, chosen per document type, worker told after renewal

**Job story:** When a person's document is about to expire, I want the warning to go to that person's direct manager (not to every holder of an access level), the recipients to be choosable per document type, and the worker told after it is dealt with.

## Today (verified on land/fix-1122)
- **"Direct manager" exists.** `people.manager_id` (profile id, same-org FK): `supabase/migrations/0970_document_expiry_registry.sql:18,23`. `profiles.manager_id` (line management, ADR-0070, 0179) is a separate field and is not read by expiry warnings.
- **Warnings already go to the manager.** `public.run_document_expiry_warnings(date)` in `0971_document_expiry_warnings.sql:27-66`: recipients are `p.id = d.manager_id OR p.role = any(d.notify_roles)` (line 46-47), active members only, one notice per (document, expiry, threshold, recipient), sent with `notify_workflow_user` (line 52). The worker is never a recipient (`e2e/JOB-F14-expiry-warning-recipients.spec.ts`).
- **Per-type recipient roles already exist.** `document_types.notify_roles` (0970:38), edited on the admin Document types page (`pmo-portal/pages/admin/DocumentTypes.tsx:15-69`). Defaults on insert: person -> Admin, equipment -> Admin + Project Manager (`document_types_defaults`, 0970:81-89).
- **Gaps (the code wins over the item text):**
  1. The manager is always a recipient; it cannot be switched off for a type.
  2. "Manager only" cannot be chosen when creating a type: an empty list on INSERT is overwritten by the default role list (0970:84-85). It can only be reached by editing afterwards.
  3. When a person has no `people.manager_id`, nobody is warned except the role holders.
  4. No notice goes to the worker when the document is renewed. The "manager acts" step does not exist in the product: managers read, but only Admin writes documents (FR-DEX-006).

## Requirements (EARS)
- **FR-EXM-001** Each document type shall carry a setting "warn the direct manager" (`notify_manager`, default true, so every existing type and organisation keeps today's recipients).
- **FR-EXM-002** When the daily run warns about a person's document and its type has `notify_manager` on, the person's `people.manager_id` shall be a recipient; when off, only holders of the type's `notify_roles` shall be.
- **FR-EXM-003** When a document type is created with an explicitly empty role list, the list shall stay empty (manager only); the role defaults apply only when no list is supplied. Existing types keep their stored lists.
- **FR-EXM-004** When a person's document is renewed (its `expires_on` moves to a later date) and the person has a linked, active profile, the system shall send that person one in-app notice naming the document type and the new date. Medical documents say "renewed" and the date only, never the status.
- **FR-EXM-005** The Document types screen shall show the manager setting beside the role choices (English and Bahasa Indonesia), say why a type that warns nobody is allowed ("no one is warned for this type"), and list the manager among "Roles notified".

## Acceptance criteria
- **AC-EXM-001** Given a person type with `notify_manager` true and a document 14 days out, when the run executes, then the manager has one notice and the worker none. *(pgTAP; existing JOB-F14 e2e keeps its goal)*
- **AC-EXM-002** Given a type with `notify_manager` false and `notify_roles` {Admin}, when the run executes, then only Admin holders are notified and the manager is not. *(pgTAP)*
- **AC-EXM-003** Given a type inserted with `notify_roles = '{}'`, then it stays empty; inserted without the column, person -> {Admin}, equipment -> {Admin, Project Manager}. *(pgTAP; AC-DEX-001 unchanged)*
- **AC-EXM-004** Given a document with a linked worker, when Admin moves `expires_on` later, then the worker gets one notice with the new date; moving it earlier, editing other fields, or a worker with no active profile sends nothing; a medical document's notice carries no status. *(pgTAP)*
- **AC-EXM-005** Given the Document types form, when the manager box is unticked and saved, then the saved type shows no manager and the list says who is notified (or that no one is). *(Vitest component; one e2e journey extends JOB-F14: untick manager -> manager not warned)*

## Setting
`document_types.notify_manager boolean not null default true`. Default keeps today's recipients (route change for orgs already receiving manager warnings). No on/off switch for the feature.

## Questions for the customer (recommended answers)
1. **What does "the manager acts" mean?** There is no acknowledge step today and managers cannot edit documents. Recommended: the action is renewal (new date recorded by HR/Admin), and the worker is told then (FR-EXM-004). A separate manager "acknowledge" button is deferred until asked.
2. **When a person has no direct manager set, fall back to their line manager (`profiles.manager_id`)?** Recommended: yes, as a follow-up once the roster work decides which field is canonical; not built now because it adds recipients and the two fields can disagree.
3. **Should the worker also get the warnings themselves?** Recommended: no (today's behaviour; the manager chases).

## Out of scope
Email, acknowledgement button, roster rework, escalation to a second manager.
