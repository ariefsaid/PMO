# PPN invoice correction and project VAT unlock — #956

Date: 2026-10-08. Status: **signed off by the owner 2026-10-09; implementation and rehearsal not run**.
Decision authority: OD-TAX-4, DD-TAX-4b (amends DD-TAX-4a's permanent lock only), OD-TAX-4c, DD-PBL-13,
DD-PBL-7, OD-SAR-PMO-IS-THE-UI, OD-SAR-DRAFT-SUBMIT. e-Faktur replacement/cancellation in
Coretax remains manual (#893 records its number/date only).

## Job story and scope

When an issued customer invoice carries PPN but its amount or the project's VAT applicability
needs correction, Finance wants to correct it in PMO, preserve its history, and see the right tax,
AR and work-order billing figures, without opening ERPNext Desk or guessing whether a retry issued
another invoice. Admin has the same VAT-edit authority; a second non-author approver submits.

Two deliverables: (1) real-ERP **cancel + re-issue** proof using PMO's existing cancel, create and
independent approval path; (2) DD-TAX-4b's server-authoritative project VAT unlock and its existing
contract/VAT editor explanation. OD-TAX-4c rules out a new in-app amend affordance. The corrected
invoice is a **new PMO invoice UUID and ERP document**, not a repointed mirror or an amended-from
successor. No receipt redesign, ERP tax setup redesign, claim-amend feature, retroactive rebasing
of invoice history, native amendment numbering, or Coretax automation. Native invoices are included
in the unlock rule and next-invoice VAT behavior; the tax-row rehearsal targets ordinary ERP Sales
Invoices only. PMO records the new invoice's e-Faktur number through #893; Coretax replacement
remains manual.

## Observed facts, not rehearsal conclusions

- OBS-PPNC-001: the adapter supports amend and creates a replacement Draft needing a separate
  non-author approver; `pages/SalesInvoices.tsx`, `src/hooks/useRevenue.ts` and the revenue repository
  in `src/lib/repositories/index.ts` expose no amend control/method at this revision. OD-TAX-4c
  deliberately leaves that seam unexposed; it is not a prerequisite for this issue.
- OBS-PPNC-002: `erpnext/dispatchFactory.ts` resolves ordinary create tax rows;
  `erpSalesTaxRows.ts` scales template 12% × 11/12 to an effective **11% On Net Total** row.
  Re-issue goes through this fresh create path, not unproven ERP amendment tax-copy behavior.
- OBS-PPNC-003: the existing revenue repository exposes `cancelInvoice`, `createInvoice` and
  `submitInvoice`; ordinary creates are Drafts and submissions retain the existing server SoD.
- OBS-PPNC-004: cancel + re-issue keeps the original mirror Cancelled and creates a separate mirror
  for the corrected invoice. No `amended_from` link or same-UUID replacement is required. Cancelled
  taxed history is unchanged by re-issue or by the project's later VAT flag change.
- OBS-PPNC-005: 0275 native invoices use `status='Cancelled'`, not ERP docstatus, and stamp tax
  from the project. 0260 already captures `subject_to_vat` as a boolean old/new project diff.
- OBS-PPNC-006: `getRevenueByProject` aggregates submitted mirror rows; work-order billing is
  net-of-tax, while ERP mirror `amount` is grand total with inclusive treatment.

## Definitions and state contract

**All cancelled** means no same-org `sales_invoices` row on the project remains non-cancelled:
ordinary ERP mirrors, PMO-native (including frozen pre-connect rows), progress-claim and
down-payment invoices, and never-sent local drafts all count. No invoices is eligible (existing
pre-first-invoice behavior). A paid, submitted, unpaid or draft invoice blocks. Cancelled ERP
rows must also show ERP docstatus 2; contradictory/unknown cancellation evidence blocks rather
than inventing success. A cancelled never-sent row with no ERP name/docstatus is permitted;
native cancellation uses its native status. Active claims with **no invoice and no command** are
not invoices and do not by themselves lock this flag; their next create follows the new flag.

**Pending/in flight** means outbox state `pending`, `committing`, `committed`, `quarantined` or
`held`. `confirmed` and `failed` are terminal at rest (0096/0131); failed does not lock, but revival
must validate the persisted VAT context before making it active again. Associations include:
case-insensitive payload `projectId`; authoritative same-org invoice via `pmo_record_id`; and
same-org progress claim via that id before its mirror exists. Cancel/submit commonly omit projectId.
All Sales Invoice revenue commands block while nonterminal, including create, cancel, explicit
amend, update that can rebuild a submitted invoice, and submit; incoming-payment-only commands
and commands for other projects/orgs do not. These operational verbs are **not** outbox operation
names: outbox operation is `create`, `update` or `transition`, with `payload.verb` on transitions.

**Unlocked** means eligible for an active same-org Finance/Admin caller; eligibility readback is
advisory UX. The existing setter/lock trigger re-evaluates inside the write transaction.
The flag itself defaults on; rate/base/treatment are separate facts and are not silently reset.

## Functional requirements (EARS)

- **FR-PPNC-001:** When Finance corrects an issued PPN invoice, the system shall use the existing
  PMO cancel action followed, after confirmed cancellation, by the normal create path for a new
  invoice with corrected lines and the same customer/project/work-order associations; each write
  shall retain its own stable intent across retries, with distinct original and new invoice UUIDs.
- **FR-PPNC-002:** When the new Draft is submitted through the normal approval path, the system
  shall require an approver outside its complete author set and mirror fresh ERP totals/status;
  Admin shall not bypass this existing rule.
- **FR-PPNC-003:** When the Director rehearses cancel + re-issue on the local ERP bed, the system
  shall prove freshly computed tax on the **new** net amount in ERP full-document `taxes` rows and
  totals, both before and after independent submission, and compare the original Cancelled mirror,
  new mirror, project AR/revenue and work-order billing against it.
- **FR-PPNC-004:** While OD-TAX-4c governs invoice correction, the system shall retain the existing
  cancel/create/approval affordances without adding an amend form, repository method or hook;
  re-issue shall use DD-PBL-13's fresh create rows rather than predecessor taxes or an ERP link.
- **FR-PPNC-005:** While an invoice is Cancelled, the system shall exclude it from submitted revenue/AR
  and work-order billed figures; while the new invoice is Draft, the system shall count it only as
  pending work-order billing; when submitted, it shall count only the new invoice as invoiced.
- **FR-PPNC-006:** When active same-org Finance/Admin changes `projects.subject_to_vat` through the
  existing contract-value setter, the system shall permit it only when all project invoices are
  Cancelled (or none exist) and no associated SI revenue command is nonterminal.
- **FR-PPNC-007:** While any project invoice is non-cancelled or its cancellation cannot be established,
  the server shall refuse a VAT flag change with `42501` and detail `vat-live-invoice`.
- **FR-PPNC-008:** While all invoices are Cancelled but any associated SI revenue command is nonterminal,
  the server shall refuse a VAT flag change with `42501` and detail `vat-command-pending`.
- **FR-PPNC-009:** When a non-Finance/Admin, inactive, anonymous or cross-org caller requests a flag
  change, the server shall refuse it according to the authorization/detail table below without
  changing project, invoice, outbox or history facts; direct column writes shall remain unavailable.
- **FR-PPNC-010:** When a flag change commits, the system shall capture exactly one boolean old/new
  diff, actor and time in the existing project change history and retain its audit event; when the
  flag is unchanged or the request fails, it shall emit no VAT diff.
- **FR-PPNC-011:** When the flag changes after cancellation, the system shall leave cancelled invoice
  amount, tax, rate/base/treatment, ERP identity and lineage untouched; the next ordinary/native/
  progress/down-payment invoice shall follow the new flag and relock the editor while live.
- **FR-PPNC-012:** When the project's contract/VAT editor opens, the system shall use one scoped
  server editability read and show the stored flag with a readable locked/unlocked explanation;
  only the real Finance/Admin permission shall enable its edit; loading/error shall never imply
  unlocked; after cancellation, correction, flag save or a stale-state refusal, it shall refresh.
- **FR-PPNC-013:** When a flag-changing save races an invoice insertion or command activation, the
  system shall serialize on the project, validate the server-resolved VAT witness at outbox
  activation, and either reserve the existing context (blocking the flag change) or refuse the
  stale command before an ERP write; a failed command revived after a flag flip shall never send
  a superseded body or acquire a newly minted intent automatically.
- **FR-PPNC-014:** While a claim/down-payment invoice needs correction, the system shall keep DD-PBL-7's
  cancel-and-new-claim route; #956 shall not add any claim or ordinary invoice amend affordance.

## Stable refusals

Codes are translated to user copy once, never displayed raw. Existing contract-value validation,
value-setter roles/status rules, tax-basis requirement and SoD remain unchanged. Live-invoice takes
precedence over pending-command for an eligible caller; authorization takes precedence over either.

| Condition | SQLSTATE / detail | UI remedy |
|---|---|---|
| Flag-changing role not Finance/Admin | `42501` / `vat-role-forbidden` | Ask Finance or Admin |
| Inactive or wrong-org caller | `42501` / `vat-not-authorized` | No project eligibility facts disclosed |
| Unknown project | `P0002` / `vat-project-not-found` | Refresh project |
| Any live/uncertain invoice | `42501` / `vat-live-invoice` | Cancel all project invoices first |
| Any nonterminal SI command | `42501` / `vat-command-pending` | Wait for command settlement; held requires review |
| Outbox body's VAT witness differs from locked project | `P0001` / `vat-context-changed` | Refresh and start a new intentional correction, not blind replay |
| New project-bound body/revived failed body has no valid witness | `P0001` / `vat-context-unavailable` | Review command; no automatic resend |
| Anonymous RPC/direct-column write | `42501` at grant boundary, **no custom detail guaranteed** | Sign in/use permitted setter |

“Failed is terminal” does not mean retryable commands can bypass activation checks. Legacy active
commands still settle with their original payload and block the flag; legacy failed body commands
without a witness require deliberate review before revival. A terminal failure is never relabelled
as success to unlock this feature.

## UI direction (Operate mode; incumbent DESIGN.md)

Keep `ProjectDetailHeader`'s existing contract editor/confirmation, Checkbox, tax fields and history
panel. No new settings page, status card or toggles in ERPNext Desk. Checkbox remains stored-value
read-only when locked. A text reason, not color or hover alone, conveys eligibility; visible label
click and keyboard toggle operate identically when enabled; help is associated via `aria-describedby`.
No extra backend counts exposed in the UI. English and Bahasa Indonesia use existing locale files.

| State | English copy |
|---|---|
| No invoices | “Editable until an invoice is raised. New invoices follow this setting.” |
| All cancelled and settled | “All project invoices are cancelled and no invoice command is in flight. You can change PPN for the next invoice; cancelled invoices keep their original tax.” |
| Live invoice | “Locked while this project has an invoice that is not cancelled. Cancel every project invoice to change PPN.” |
| Pending command | “Locked while an invoice command is in flight. Wait for it to settle; held commands need review.” |
| Loading | “Checking whether PPN can be changed…” |
| Read unavailable | “PPN editability could not be checked. Retry the check.” |
| Role read-only | “Only Finance or Admin can change whether this project is subject to PPN.” |
| Race refusal | “PPN was not changed. The project's invoice state changed; refresh and try again when all invoices are cancelled and commands have settled.” |

Keep unrelated contract edits usable when the flag is unchanged, even if VAT eligibility is loading
or locked. Do not convert the contract's exclusive/inclusive treatment silently when the checkbox
moves. The existing contract editor still requires explicitly stated tax treatment and amount.

Invoice correction uses the existing **Cancel invoice**, normal new-invoice form and independent
Submit action. Wait for confirmed cancellation before creating the corrected invoice. Each operation
has its own intent; retries of that operation reuse it. Do not add Cancel and amend, a new approval
route, same-UUID replacement, automatic submission or an amended-from requirement. Preserve existing
pending-push/error handling. The invoice list retains the Cancelled historical row separately; only
the new submitted invoice contributes to project AR/revenue and invoiced work-order drawdown.

## Acceptance criteria (Given / When / Then)

| ID | Given / When / Then |
|---|---|
| AC-PPNC-001 | Given an ordinary submitted ERP invoice with net 1,200,000, rate 12, base 11/12 and subject_to_vat on, when Finance A cancels it in PMO, waits for settlement, raises a new invoice for net 2,400,000 through normal create and non-author B submits it, then the original ERP doc is docstatus 2 with its original tax 132,000/gross 1,332,000, the distinct NEW ERP invoice's fresh taxes are 12% on 11/12 of 2,400,000 (effective 11%, tax 264,000/gross 2,664,000), and PMO's separate history/current rows, project AR/revenue and work-order drawdown reflect only the new invoice in the appropriate active figures. |
| AC-PPNC-006 | Given no invoices or only cancelled ERP/native/progress/down-payment invoices and no nonterminal commands, when Finance or Admin flips the flag either way via the setter, then it succeeds without changing invoice facts. |
| AC-PPNC-007 | Given a live invoice of each supported category/status or contradictory ERP cancellation evidence, when Finance/Admin flips the flag, then SQLSTATE/detail are `42501/vat-live-invoice` and nothing changes. |
| AC-PPNC-008 | Given all invoices Cancelled and an associated create/cancel/amend/update/submit in each nonterminal state, including a claim without a mirror or uppercase project id or command omitting projectId, when Finance/Admin flips the flag, then SQLSTATE/detail are `42501/vat-command-pending` and nothing changes. |
| AC-PPNC-009 | Given only confirmed/failed commands or nonterminal incoming-payment/other-project/other-org commands, when an otherwise eligible Finance/Admin flips the flag, then those commands do not prevent the change. |
| AC-PPNC-010 | Given a Project Manager, Executive, Engineer, inactive member, wrong-org member, anon or direct-column writer, when they request a flag change, then the documented authorization/grant refusal applies and no VAT/history/invoice facts change. |
| AC-PPNC-011 | Given an eligible same-org caller and existing project history, when a VAT flip commits, then exactly one VAT old/new diff carries the caller actor and timestamp; when the flag is unchanged or the save fails, then there is no new VAT diff. |
| AC-PPNC-012 | Given cancelled taxed invoices and a successful flag-off change, when a new native invoice is raised, then old tax facts remain identical, the new invoice is untaxed and its live draft relocks the flag; given a later eligible flag-on change, when a new native invoice is raised, then its tax uses the recorded rate/base. |
| AC-PPNC-013 | Given the authoritative eligible/locked/loading/error result and the caller's real permission, when the project contract/VAT editor renders, then its checkbox, explanatory copy, label/keyboard behavior, retry and permitted save match the state in both languages; ordinary contract edits remain available. |
| AC-PPNC-014 | Given a previously unlocked editor, when another invoice/command makes the save ineligible, then the dialog retains the selected value, shows the stable-code remedy once, refetches eligibility and never announces a successful VAT change. |
| AC-PPNC-015 | Given failed body commands and an intervening VAT flip, when a command becomes active again with a mismatched/missing witness, then `vat-context-changed`/`vat-context-unavailable` refuses it before ERP writes; unchanged valid context can be revived. |
| AC-PPNC-016 | Given concurrent invoice creation or outbox activation and a VAT setter, when both attempt to commit, then creation uses the serialized flag or the stale activation is refused, with no body sent under the wrong VAT context and no inconsistent history. |
| AC-PPNC-018 | Given eligible cancelled invoices and a flag flip, when the next ERP ordinary/progress/down-payment create resolves, then it uses the new authoritative flag and rows at the right fraction, rather than caller taxes or cancelled history. |
| AC-PPNC-019 | Given the scoped editability reader, when active own-org members read it, then it returns only eligibility/reason/has-invoices; when wrong-org/inactive/anon reads are attempted, then no foreign project or outbox facts are returned. |

Amend-only AC-PPNC-002..005 and 017 are retired, not conditionally skipped; their proposed capability
is outside OD-TAX-4c. Existing create-path SoD, tax-row and replay tests remain intact. AC-PPNC-001
has one curated served-lane journey/pin as its canonical cross-stack owner, supported by existing
create-path tax unit tests and the spike's sanitized REST/render evidence. A mock does not certify
ERP tax or rendered totals. Canonical layers/files and exact oracles are in the companion plan.

## Nonfunctional requirements

- **NFR-PPNC-001:** The system shall preserve RLS/org scoping, column-grant restrictions, SoD,
  generation fencing, digest identity and original money-path invariants on every route.
- **NFR-PPNC-002:** The system shall use indexed existence checks, not download all invoices or
  outbox payloads to infer UI eligibility; changed queries shall receive index/query-plan review.
- **NFR-PPNC-003:** The system shall use DESIGN.md tokens/shared primitives, accessible names/focus,
  persistent in-dialog failures and English/Indonesian copy; raw detail codes shall not reach DOM.
- **NFR-PPNC-004:** The system shall have a reversible forward migration, mutation-sensitive guards,
  ≥80% changed-line coverage and all applicable targeted/CI gates green before acceptance.
