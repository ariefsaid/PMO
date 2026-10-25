# PMO UX standard
Machine-checked preamble (required evidence for UI work, not a claim that existing pages pass): Impeccable detector findings empty; axe serious/critical violations = 0; at 390px, document scrollWidth ≤ clientWidth and every phone target ≥44×44px; exactly one h1; colours use existing semantic tokens only.
Apply [OD-VISUAL-RESET and OD-REDESIGN-SCOPE](../decisions.md) to contract- and project-based work. ADR-0068 colours, fonts and radii stay; every existing feature keeps a reachable home. DESIGN.md supplies tokens only; §7 and docs/design-workflow.md supply no composition authority.
Review evidence: screenshots at 390/1440, EN/ID, light/dark, every toggle/period and loading/empty/error state; include URL and before/after pairs for navigation and actions. Checks below refer to these captures; rendered screens require owner approval.

## Page anatomy
**PA-01** Give each page one type: collection (find projects), record (understand a contract), capture (enter time), review queue (decide requests), dashboard (prioritize portfolio), settings (configure tools), sign-in (enter workspace) — *title and main content identify one job/type.*
**PA-02** Use title → scope → toolbar → content → action bar, where applicable, on one left edge so PM/Finance can scan consistently — *section starts align; project/customer/period precede their results.*
**PA-03** Put decision evidence together: PM sees phase/task context; Finance sees amount and invoice; approver sees request and evidence — *no intervening unrelated tiles or repeated summary boxes.*
**PA-04** Each fact appears once per page and content fills the content track: no block repeats a figure or caveat, no card or band only holds whitespace or a single caption, and no empty band wider than 25% sits beside content at 1440px; the Executive dashboard and project Overview must avoid scattered facts and whitespace without deliberate intent — *reviewer counts each figure once and finds no near-empty container.*

## Navigation
**N-01** Show where the user is with a named current area and record/project identity — *active navigation, heading and breadcrumb agree in the PM's project capture.*
**N-02** Provide a named way back that preserves the working list's filters and sort — *Finance's invoice → back pair restores the same collection, scope and ordering.*
**N-03** Use tabs only for 2–3 views of one job; use named section navigation for distinct jobs — *PM's budget, delivery and billing remain discoverable without a long tab strip.*
**N-04** Keep selected section, filters, sort and period in the URL; give each object one canonical home — *reopened URL reproduces scope; pipeline and Projects open the same project URL.*

## Actions
**A-01** Show one filled primary when a next action exists; keep alternatives quieter — *PM's create, Finance's submit or Admin's connect has no competing filled button in the active view.*
**A-02** Place collection creation in its toolbar and capture/review submission after its evidence; phone action bars must not cover content — *last field/amount and submit remain readable together.*
**A-03** Name the result with verb + object, including consequential transitions — *Finance reads “Send invoice” or “Record payment”, never “OK” or “Proceed”.*
**A-04** Explain disabled actions beside the control; confirm consequential writes with object, amount and consequence — *Finance can see what prevents submission and what confirmation will do.*

## Entry/forms
**E-01** Keep project/customer/period visible and reuse the originating scope — *PM's time entry and Finance's invoice form show the selected project without asking again.*
**E-02** Label fields above inputs; show required/optional, currency/unit and date meaning before entry — *Finance can distinguish invoice date, due date and payment amount with populated fields.*
**E-03** Group fields by the business decision; disclose secondary detail with a named control — *Admin's connection setup shows the next required inputs and a visible route to advanced options.*
**E-04** Keep entered values on error, explain the fix beside the field, and show pending/saved outcomes plus Cancel/Back — *PM's invalid → corrected → saved captures preserve task context.*

## Collections/tables
**C-01** Order toolbar controls search → scope/filters → sort → view → secondary actions → creation; omit irrelevant groups — *PM finds project narrowing before display/export controls at both widths.*
**C-02** Separate no matches from no data: offer clear filters/search for the former and the permitted first step for the latter — *Finance sees “No matching invoices” versus “No invoices yet”.*
**C-03** Show the active default sort: urgency/due date for work, latest business date for transactions, name for directories — *PM/Finance/Admin can read the sort label and verify visible row order.*
**C-04** Order columns identity → project/customer context → decision status/date → amounts → actions; put selection first when present — *Finance can identify an invoice before judging its balance.*
**C-05** Make the record name an obvious open link; keep row controls separate and show selected count with bulk actions — *PM can distinguish opening a project from selecting or changing it.*
**C-06** Preserve headers and geometry while loading; spell out unavailable/not applicable values; phone rows retain identity, status, key amount and open action — *Finance never mistakes a blank or clipped cell for zero.*

## Status and figures
**S-01** Label status in words with its date/period and applicable basis; colour only reinforces meaning — *PM can distinguish late work; Finance can distinguish committed spend from payments.*
**S-02** A figure keeps its form across its own controls: toggle/period changes numbers, never chart type or layout — *Executive's before/after captures keep plot, axes, legend and footprint recognizable.*
**S-03** Unknown is never zero: name missing information and a useful next step; reserve zero for known zero — *Finance can distinguish “Not available” from an actual zero balance.*
**S-04** Show a caveat once per page, only for an abnormal condition, naming affected scope and remedy — *Finance sees one missing-data explanation, not repeated disclaimers on every figure.*
**S-05** Keep exact amounts visibly readable with currency; short form is allowed only on KPI tiles with exact value in title — *Finance reads full balances in tables/charts; Executive's tile title reveals its exact amount.*

## Language
**L-01** Use plain domain nouns from [the glossary](../glossary.md), consistently across navigation, titles and actions — *PM sees “Phase”/“Fase”; Finance sees invoices/payments rather than implementation jargon.*
**L-02** Give EN and ID the same job, scope, action and status meaning, with locale-aware dates/numbers and complete labels — *paired Admin/Finance captures have no mixed-language fallback, clipped translation or ambiguous amount.*
