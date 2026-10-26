# PMO UX standard
Machine-checked preamble (required evidence for UI work, not a claim that existing pages pass): Impeccable detector findings empty; axe serious/critical violations = 0; at 390px, document scrollWidth ≤ clientWidth and every phone target ≥44×44px; exactly one h1; colours use existing semantic tokens only.
Apply [OD-VISUAL-RESET and OD-REDESIGN-SCOPE](../decisions.md) to contract- and project-based work. ADR-0068 colours, fonts and radii stay; records and data stay reachable, but routes and blocks are kept only when a persona can name their job (PA-00). DESIGN.md supplies tokens only; §7 and docs/design-workflow.md supply no composition authority.
Review evidence: screenshots at 390/1440, EN/ID, light/dark, every toggle/period and loading/empty/error state; include URL and before/after pairs for navigation and actions. Checks below refer to these captures; rendered screens require owner approval.

## Page anatomy
**PA-00** Before composing a route, answer for each persona who can reach it (Admin, Executive, Finance, PM, Engineer): "arriving here, what do I expect to see, and what job do I finish on this page?" in one clause each; a route or block no persona can answer for is **retired or merged in the same PR** (data stays reachable via a redirect to its new home), listed in the PR body with the reason; the owner reverts if they disagree. Minimise ruthlessly: the old composition is not evidence of need — *spec carries the per-persona lines; the first screen settles that job.*
**PA-01** Give each page one type: collection (find projects), record (understand a contract), capture (enter time), review queue (decide requests), dashboard (prioritize portfolio), settings (configure tools), sign-in (enter workspace); compose the six operational types with [page templates and molecules](patterns.md) — *title and main content identify one job/type.*
**PA-02** Use title → scope → toolbar → content → action bar, where applicable, on one left edge so PM/Finance can scan consistently — *section starts align; project/customer/period precede their results.*
**PA-03** Put decision evidence together: PM sees phase/task context; Finance sees amount and invoice; approver sees request and evidence — *no intervening unrelated tiles or repeated summary boxes.*
**PA-04** Each fact appears once per page and content fills the content track: no block repeats a figure or caveat, no card or band only holds whitespace or a single caption, and no empty band wider than 25% sits beside content at 1440px; the Executive dashboard and project Overview must avoid scattered facts and whitespace without deliberate intent — *reviewer counts each figure once and finds no near-empty container.*
**PA-05** Show the PA-00 primary answer without scrolling at 390×844 and 1440×900, including its scope or unavailable reason; collapse secondary controls before displacing it — *Finance sees the first invoice's outstanding balance, PM the project's decision fact, before scrolling.*
**PA-06** Group by proximity before containment: one content-container level, no nested cards; use `spacing.base` multiples tight/normal/generous (8/16/32px), more above section heads than below — *PM's blurred capture still separates primary, secondary and major groups in order.*

## Hierarchy and data shape
**H-01** Each page names one primary figure or fact per persona (the PA-00 answer) and sets it apart by size and position; everything else is secondary or tertiary — *a PM opening a project reads remaining-to-invoice and cash received before any other amount.*
**H-02** Use at most three text levels per block (section head · label · value) with distinct size or weight; a group head never looks like a label, a label never like a value — *Finance can tell "8 invoices" (head) from "Outstanding" (label) without reading.*
**H-03** Group related facts under one named head with shared unit, currency and caveat stated once in the head, not per line; order groups by the persona's decision (money in → billed → spending → margin) — *no "IDR", "excl. PPN" or "Updated …" repeated down a column.*
**H-04** Format large amounts for reading: whole units by default (IDR 2,226,648,000, never .00), compact forms (IDR 2.23 bn) in heads and tiles with the exact value visible on the row or in the title; align numbers right in columns — *a thirteen-digit amount fits a 390px line without wrapping.*
**H-05** One navigation layer per record: title → identity → primary action → sections; never stack an action row, collapsed summaries and tabs that all describe the same content — *a record's finances live in one place, not in a collapsed "summary" and an open "finances".*
**H-06** Every capture renders real-shaped data: IDR-scale amounts (10–13 digits), mixed IDR/USD, long project and customer names, high counts (80+ notifications, 20+ rows); the dataset in `docs/ux/2026-10-19-real-data-design-pass.md` is the minimum — *a layout that only passes on the seed org has not passed.*
**H-07** Use exactly the five named product type roles in [patterns](patterns.md#shared-type-rhythm-and-acceptance), one family and fixed rem sizes; keep repeated roles identical, head/label/value distinct in size and weight, figures tabular and money right-aligned — *Finance distinguishes heads, labels and values at a glance on every route.*
**H-08** Format counts, percentages, quantities and dates with the saved locale/number/timezone preferences; omit meaningless zero fractions, retain meaningful precision, label signs/units, use unambiguous dates (26 Oct 2026 / 26 Okt 2026), name timestamp timezone and keep date-only business dates unchanged — *Finance distinguishes -12.5% from an amount and reads the same due day in EN/ID.*
**H-09** Identity never truncates: wrap full project/customer/record names and references at both widths; never require hover to distinguish records — *PM can identify the complete 48-character project on a phone.*

## Navigation
**N-01** Show where the user is with a named current area and record/project identity — *active navigation, heading and breadcrumb agree in the PM's project capture.*
**N-02** Provide a named way back that preserves the working list's filters and sort — *Finance's invoice → back pair restores the same collection, scope and ordering.*
**N-03** Use tabs only for 2–3 views of one job; use named section navigation for distinct jobs — *PM's budget, delivery and billing remain discoverable without a long tab strip.*
**N-04** Keep selected section, filters, sort and period in the URL; give each object one canonical home — *reopened URL reproduces scope; pipeline and Projects open the same project URL.*
**N-05** Long records use one named section index and sticky record identity/current section; at 390 one Sections control replaces the desktop index, with anchor clearance and no extra tab strip — *PM reaches Billing from deep in a project and still knows which project is open.*
**N-06** Default landing scope follows the role: Admin/Executive portfolio exceptions, Finance billing/payables/collections, PM own delivery projects, Engineer own dated hours/status; use the area brief's collection defaults and preserve explicit URL scope — *each persona lands on their work; Engineer's Projects starts task-assigned, the other roles' Projects starts All.*

## Actions
**A-01** Show one filled primary when a next action exists; keep alternatives quieter — *PM's create, Finance's submit or Admin's connect has no competing filled button in the active view.*
**A-02** Place collection creation in its toolbar and capture/review submission after its evidence; phone action bars must not cover content — *last field/amount and submit remain readable together.*
**A-03** Name the result with verb + object, including consequential transitions — *Finance reads “Send invoice” or “Record payment”, never “OK” or “Proceed”.*
**A-04** Explain disabled actions beside the control; confirm consequential writes with object, amount and consequence — *Finance can see what prevents submission and what confirmation will do.*
**A-05** Every phone hit target is at least 44×44px, including row menus, chips that act, disclosure toggles and dismiss controls; preserve the existing visual-control tokens and separate adjacent hit areas — *Engineer opens the intended row/action by touch without overlap.*

## Entry/forms
**E-01** Keep project/customer/period visible and reuse the originating scope — *PM's time entry and Finance's invoice form show the selected project without asking again.*
**E-02** Label fields above inputs; show required/optional, currency/unit and date meaning before entry — *Finance can distinguish invoice date, due date and payment amount with populated fields.*
**E-03** Group fields by the business decision; disclose secondary detail with a named control — *Admin's connection setup shows the next required inputs and a visible route to advanced options.*
**E-04** Keep entered values on error, explain the fix beside the field, and show pending/saved outcomes plus Cancel/Back — *PM's invalid → corrected → saved captures preserve task context.*
**E-05** Disclose secondary evidence/options once per topic under a named toggle carrying count/key-figure summary; list default collapse per template, retain values, auto-open errors, never hide prerequisites — *Finance knows “View invoices · 8” holds supporting detail while amount and required evidence stay visible.*

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
**S-05** Keep exact amounts visibly readable with currency; compact heads/tiles follow H-04 with the exact value visibly adjacent or on the corresponding row, never hover-only on phone — *Finance reads full balances in tables/charts and Executive reads a tile's exact amount by touch.*

## Language
**L-01** Use plain domain nouns from [the glossary](../glossary.md), consistently across navigation, titles and actions — *PM sees “Phase”/“Fase”; Finance sees invoices/payments rather than implementation jargon.*
**L-02** Give EN and ID the same job, scope, action and status meaning, with locale-aware dates/numbers and complete labels — *paired Admin/Finance captures have no mixed-language fallback, clipped translation or ambiguous amount.*
