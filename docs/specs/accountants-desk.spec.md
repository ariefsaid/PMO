# Accountant's desk — manual journals (spec, #895)

Sections 5–8 cover piece 1, manual journals. Identifiers use the `MJE` prefix (`FR-MJE-###`, `AC-MJE-###`).

## 5. Drafting and submitting

- **FR-MJE-001** The Journals screen lists journals for a date range (default: the organisation's current month) and the ledger's own moves made outside PMO, read-only.
- **FR-MJE-010** A Finance, Executive or Admin member writes a draft: kind, date, memo (up to 500 characters) and two or more lines. Each line has an account and exactly one of debit or credit above zero; a line may carry a project and a label.
- **FR-MJE-020** Only a draft is editable. Save draft and Submit both go through `save_journal_draft`; a failed submit retries the same draft.
- **FR-MJE-021** Submit refuses a journal with fewer than two lines, or a line whose account the ledger chart does not hold or holds archived, naming the account.
- **FR-MJE-023** The journal's author set is its maker plus every member who saved an edit to it; an edit never changes the maker.
- **AC-MJE-001** An unbalanced journal is refused at submit, naming the difference, and mints no outbox row; the ledger adapters also refuse it before any ledger write.
  - Given a journal of 100.00 debit against 99.99 credit, when it is submitted, then it is refused with "does not balance by 0.01" and nothing is queued for the ledger.
- **AC-MJE-021** Submit stays disabled until debits equal credits, summed in exact cents (100.00 against 99.99 is blocked).
- **FR-MJE-022** A journal reaches the ledger only once approved; the dispatch re-reads the approved journal under the caller's JWT and builds the ledger body from that read.
- **FR-MJE-024** Until an Admin chooses the Odoo journal for desk entries, posting is refused with a setup message.
- **AC-MJE-020** The three journal tables are read-only to every client role; only Finance, Executive and Admin members read them, and only their own org's rows. Every write goes through the definer RPCs.
  - Given a Project Manager, when they read the journal tables or call `save_journal_draft`, then they see no rows and the draft is refused.
- **FR-MJE-110** A ledger journal has two or more lines and its debits equal its credits exactly, compared in cents (no float).
- **FR-MJE-113** Every ledger journal carries its date (the organisation's day), always sent to the ledger.

## 6. Approval

- **FR-MJE-030** Every manual journal needs a second approver before it posts. There is no threshold.
- **AC-MJE-002** The approver is a Finance, Executive or Admin member of the same org who is not the maker or any editor of the journal; for a reversal, also not anyone who wrote the original. Rank does not matter.
- **AC-MJE-002 (one-member exemption)** When the organisation has exactly one member, counting every profile whatever its status, and has never had a second member, that member may approve (and return) their own journal. Each organisation carries a permanent "has had a second member" marker (`org_second_member_marks`): a trigger on profiles sets it whenever a profile lands in an organisation that then holds two or more, nothing clears it, and the migration backfilled it from each organisation's profile count. The check runs inside `approve_journal` at approval time. The approval's audit entry carries `sole_member: true` in that case and `false` otherwise.
  - Given an Admin who disabled every other member, when they approve their own journal, then it is refused (the profiles still count).
  - Given an organisation whose peer profile was deleted, leaving one, when the remaining member approves their own journal, then it is refused (the marker stays).
  - Given an organisation that has only ever had one member, when its member approves their own journal, then it is approved and the audit entry records sole member.
  - Given a second member added between submit and approval, when the author approves, then it is refused.
- **FR-MJE-031** `may_approve_journal(journal id)` answers for the signed-in user only; it takes no approver id. The predicate that takes an approver id and the sole-member count have no execute grant for any client role.
- **FR-MJE-032** A journal is returned to its maker with a reason (1–500 characters) by an allowed approver.
- **FR-MJE-033** The screen offers Approve and Return only to a member `may_approve_journal` would allow: never to the maker, an editor, or (for a reversal) anyone who wrote the original. This mirrors AC-MJE-002 for the eye; the server rule is the authority.

## 7. Posting

- **FR-MJE-040** Approve sends the journal to the ledger. If the send fails after the approval, the drawer says so and offers **Retry send**; Approve is not offered again.
- **FR-MJE-041** A journal the ledger did not confirm shows Needs a check; one the ledger refused shows Refused; one dated later in the ledger shows Scheduled, never Posted.
- **FR-MJE-026** A line's project reaches the ledger as that project's analytic reference, resolved on the server.
- **FR-MJE-027** A journal is shown Posted only after the ledger's copy has been read back and matches; the date recorded is the ledger's own, never the request's.
- **FR-MJE-028** A reversal dated after the ledger's day, which the ledger keeps as a draft until then, is recorded Scheduled with no posted date.
- **FR-MJE-116** Only the service role records a ledger outcome (posted, held, refused, scheduled) on a journal; a signed-in client cannot.
- **AC-MJE-003** A journal posts once: the ledger body is built from the approved journal the dispatch re-reads, never from the request payload, and posting the same key again adopts the first document.
  - Given an approved journal of 25000.00 and a request payload claiming 1.00, when it is dispatched, then the ledger move carries 25000.00.
- **AC-MJE-004** On ERPNext a manual journal is a submitted Journal Entry: debit and credit per row in account currency, the project where set, and the journal key in its remark (the anchor a conclusive miss may reissue under once).
- **AC-MJE-024** On every ledger, a journal posts one document under its key, with its lines, on its own date.
- **AC-MJE-027** A post the ledger re-dated, or whose totals differ, is held for a person with the reason, never shown Posted.
- **AC-MJE-028** A journal held for a person shows Needs a check with the held reason.
- **AC-MJE-029** A Scheduled journal never says Posted, in the list or the record.
- **AC-MJE-040** Journey: Finance drafts and submits; a different member approves; the maker is never offered Approve.

## 8. Reversal and display

- **FR-MJE-050** A posted journal is undone by a reversal: a new draft with every side swapped, needing its own second approver.
- **FR-MJE-025** A reversal is a new draft naming the original, with every line's sides swapped and the original's lines kept (it cannot be edited); one live reversal per original; it carries its own reversal key and the original's ledger reference to the ledger.
- **AC-MJE-005** A reversal posts as one new ledger document that nets the original to zero per account and leaves the original unchanged; reversing again under the same key adopts it.
- **AC-MJE-008** When the ledger already holds a reversal of the original under another key, the reversal is refused naming it, and nothing new is sent.
- **AC-MJE-006** A posted PMO journal that also appears in the ledger mirror is listed once, as the PMO journal.
- **AC-MJE-007** A ledger move PMO did not write is listed as Outside PMO, read-only.
- **FR-MJE-060** Amounts on read screens use the shared money formatter and carry the organisation's currency; a whole amount shows no cents.
- **FR-MJE-061** Editing a stored draft shows each amount in the viewer's own decimal mark, read back without any locale-dependent parse of the stored text.
