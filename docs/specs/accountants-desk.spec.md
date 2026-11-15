# Accountant's desk — manual journals (spec, #895)

Sections 5–8 cover piece 1, manual journals. Identifiers use the `MJE` prefix (`FR-MJE-###`, `AC-MJE-###`).

## 5. Drafting and submitting

- **FR-MJE-001** The Journals screen lists journals for a date range (default: the organisation's current month) and the ledger's own moves made outside PMO, read-only.
- **FR-MJE-010** A Finance, Executive or Admin member writes a draft: kind, date, memo (up to 500 characters) and two or more lines. Each line has an account and exactly one of debit or credit above zero; a line may carry a project and a label.
- **FR-MJE-020** Only a draft is editable. Save draft and Submit both go through `save_journal_draft`; a failed submit retries the same draft.
- **AC-MJE-021** Submit stays disabled until debits equal credits, summed in exact cents (100.00 against 99.99 is blocked).
- **FR-MJE-022** A journal reaches the ledger only once approved; the dispatch re-reads the approved journal under the caller's JWT and builds the ledger body from that read.
- **FR-MJE-024** Until an Admin chooses the Odoo journal for desk entries, posting is refused with a setup message.

## 6. Approval

- **FR-MJE-030** Every manual journal needs a second approver before it posts. There is no threshold.
- **AC-MJE-002** The approver is a Finance, Executive or Admin member of the same org who is not the maker or any editor of the journal; for a reversal, also not anyone who wrote the original. Rank does not matter.
- **AC-MJE-002 (one-member exemption)** When the organisation has exactly one member, counting every profile whatever its status, that member may approve (and return) their own journal. The count is taken inside `approve_journal` at approval time. The approval's audit entry carries `sole_member: true` in that case and `false` otherwise.
  - Given an Admin who disabled every other member, when they approve their own journal, then it is refused (the profiles still count).
  - Given an organisation that has only ever had one member, when its member approves their own journal, then it is approved and the audit entry records sole member.
  - Given a second member added between submit and approval, when the author approves, then it is refused.
- **FR-MJE-031** `may_approve_journal(journal id)` answers for the signed-in user only; it takes no approver id. The predicate that takes an approver id and the sole-member count have no execute grant for any client role.
- **FR-MJE-032** A journal is returned to its maker with a reason (1–500 characters) by an allowed approver.

## 7. Posting

- **FR-MJE-040** Approve sends the journal to the ledger. If the send fails after the approval, the drawer says so and offers **Retry send**; Approve is not offered again.
- **FR-MJE-041** A journal the ledger did not confirm shows Needs a check; one the ledger refused shows Refused; one dated later in the ledger shows Scheduled, never Posted.
- **AC-MJE-040** Journey: Finance drafts and submits; a different member approves; the maker is never offered Approve.

## 8. Reversal and display

- **FR-MJE-050** A posted journal is undone by a reversal: a new draft with every side swapped, needing its own second approver.
- **FR-MJE-060** Amounts on read screens use the shared money formatter and carry the organisation's currency; a whole amount shows no cents.
- **FR-MJE-061** Editing a stored draft shows each amount in the viewer's own decimal mark, read back without any locale-dependent parse of the stored text.
