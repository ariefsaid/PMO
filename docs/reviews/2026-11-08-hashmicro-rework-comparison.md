# Feature comparison — PMO vs HashMicro and Rework

**Date:** 2026-11-08 · **Extends:** `2026-10-31-feature-comparison.md` (KANNA, RIS-portal-2, ERPNext, Odoo 20 CE). The PMO column is taken from that doc, not re-verified today.
**Why now:** prospects are comparing PMO with HashMicro and Rework.

## Evidence

Neither vendor offers public product access, so this is a desk study: vendor product and pricing pages, official YouTube tutorials, App Store listings, press, and review-site snippets (G2, Capterra and GetApp blocked direct reads).

| Comparator | What it is | Evidence quality |
|---|---|---|
| **HashMicro** (hashmicro.com) | Indonesian/Singapore ERP suite, sold per module with heavy per-client customisation; third-party reports place it on Odoo | Marketing pages and mockups; 360p video frames. No public manual or help centre. A ✅ means *claimed*. |
| **Rework** (rework.com) | Vietnam-founded horizontal SME work platform ("Agentic OS"): Revenue OS, Work OS, People OS | Product pages plus 27 official tutorials (real UI frames). Help centre unreadable. Finance/GL is a page claim with no UI seen. |

Legend: ✅ yes/claimed · 🟡 partial · ❌ not found (in the sources read; absence ≠ proof).

## 1. Summary

- **HashMicro competes on breadth and construction specifics.** It is a full ERP: GL, tax, bank rec, inventory, fixed assets, HR/payroll, fleet, contracts. Construction extras PMO lacks: retention on progress claims, a site diary with photo and GPS, a punch list, equipment logs, WBS material tracking, EAC/ETC, three S-curves, and AI milestone-slip and workload forecasts. All of this is *claimed*; nothing shows how deep it goes.
- **Rework competes on generic work tools at a low, public price.** It has configurable workflows and request types, Gantt with dependencies, recurring tasks, a report builder, native iOS/Android apps, lead capture and ads, e-sign and contracts, and HR. It has **no project budget, procurement chain, work-order billing or ERP connector**. It is not built for contract businesses.
- **PMO wins on the governed contract thread both lack:** one record from deal → project → budget → procurement → delivery → billing → cash, with budget-backed approvals and approver ≠ author enforced in the database. It also has work-order billing, BAST, drawdown and down payments, write-through to the client's existing ERP, M365 custody, and an assistant whose writes are confirm-gated, re-authorised server-side and eval-tested.
- **Honest "no" answers stay the same as 2026-10-31:** accounting back office, stock, field/offline/native mobile. Two more answers come from this pair: **HR/payroll**, and **user-configurable workflows**.

## 2. Matrix

| Capability | PMO | HashMicro | Rework | Notes |
|---|---|---|---|---|
| **Commercial / CRM** | | | | |
| Pipeline kanban, stages, weighted value | ✅ | ✅ | ✅ (stale-deal flag) | |
| One record deal → delivery, no convert step | ✅ | ❌ tender converts to project | ❌ separate apps | PMO's moat |
| Follow-up reminders on deals/contacts | ❌ | ✅ | ✅ | gap |
| Win/loss reasons | ❌ | 🟡 funnel leaks | ✅ lost-reason dialog | gap |
| Lead capture, scoring, auto-assignment, ads | ❌ | ✅ | ✅ | out of scope today |
| Quote → order | 🟡 | ✅ | 🟡 | |
| Tender/bid tracking | 🟡 | ✅ tender budget → baseline | ❌ | |
| Meetings with minutes + action items | ✅ | ❌ | ✅ | |
| **Budgets and cost** | | | | |
| Versioned project budgets, approval | ✅ | ✅ | ❌ | |
| Committed/reserved spend vs budget | ✅ | ✅ | ❌ | |
| WBS / org cost codes | 🟡 fixed categories | ✅ | ❌ | |
| EAC/ETC, cash-flow forecast | 🟡 projection | ✅ | ❌ | gap |
| S-curves | ✅ one | ✅ cost, progress, material | ❌ | |
| **Procurement** | | | | |
| PR → quote compare → PO → GR → vendor invoice | ✅ | ✅ | ❌ | |
| Multi-level approvals | ✅ budget-backed tiers | ✅ by value/department | ✅ sequential/parallel request types | |
| Approver ≠ author enforced in the DB | ✅ | ❌ not stated | 🟡 audit claim | |
| Approve from chat (WhatsApp/Telegram) | ❌ (Lark #1521) | ✅ | ❌ | |
| Vendor scoring | ❌ | ✅ | ❌ | |
| **Delivery** | | | | |
| Gantt with dependencies | ✅ | ✅ | ✅ drag, export | |
| Board, list, calendar views | ✅ | 🟡 no task kanban | ✅ | |
| Milestones with weighted delivery-% | ✅ | 🟡 | ❌ | |
| Baseline vs actual, critical path | ❌ | ✅ | ❌ | gap (#1574) |
| Resource capacity / workload | ❌ | ✅ | 🟡 workload view | gap |
| Project templates, recurring tasks, form → task | ❌ | ✅ templates | ✅ | gap |
| User-configured stage workflows (owner, SLA per stage) | ❌ | 🟡 | ✅ | gap |
| Punch list / closeout | ❌ | ✅ | ❌ | |
| **Timesheets and expenses** | | | | |
| Timesheets with approval | ✅ | ✅ (AI-suggested entries) | ✅ task timer | |
| GPS / face attendance | ❌ #1517 | ✅ | ✅ | |
| Expenses, cash advances | ✅ | ✅ | 🟡 no advances | |
| **Billing / AR** | | | | |
| Progress billing, work orders, BAST, drawdown, down payments | ✅ | 🟡 milestone invoices; no BAST/drawdown wording | ❌ | PMO strength |
| Retention on claims | ❌ | ✅ | ❌ | gap |
| Overdue reminders | ❌ | ✅ | ❌ | gap |
| e-Faktur submit in flow | 🟡 NSFP capture | ✅ | ❌ | |
| **Accounting** | | | | |
| GL, bank rec, tax reports, fixed assets | — ERP owns (#894–#899) | ✅ | 🟡 claim only | |
| **Documents** | | | | |
| Project document register with approval | ✅ | ✅ DMS | 🟡 doc boards | |
| Contract clause review, e-sign | ❌ | ✅ | ✅ | |
| OCR of vendor bills | ❌ | ✅ | ❌ | |
| SharePoint / M365 | ✅ | ❌ | ❌ | |
| **Field / mobile** | | | | |
| Native mobile apps | ❌ PWA | 🟡 HR app only | ✅ iOS + Android | gap |
| Daily site diary (photo, GPS) | ❌ #1522 | ✅ | ❌ | |
| Inventory / site stock | ❌ #1512 | ✅ | ✅ claim | |
| **Admin** | | | | |
| Configurable roles × modules | ❌ #902 | 🟡 | ✅ by edition | |
| Multi-company | 🟡 org_id seam | ✅ | ✅ | |
| HR / payroll | ❌ | ✅ | ✅ | |
| **Integrations** | | | | |
| Works over the client's existing ERP | ✅ ERPNext (Odoo next) | ❌ it is the ERP | ❌ sits beside, no connector | PMO strength |
| Automations / webhooks / API | ✅ | ✅ claim, no public spec | ✅ | |
| **AI** | | | | |
| Assistant over business data | ✅ | ✅ "Hashy" in every module | ✅ record copilot | |
| Writes confirm-gated and re-authorised server-side | ✅ | ❌ not stated | 🟡 confirm seen, no model published | PMO strength |
| Assistant in WhatsApp/Telegram | ❌ | ✅ | ❌ | |
| Agent library / event-triggered agents | 🟡 automations | ✅ | ✅ | |
| Answers render charts/tables, not only text | ❌ (#2047) | ✅ | 🟡 | gap |
| Eval harness / accuracy evidence | ✅ | ❌ | ❌ | |
| **Reporting** | | | | |
| Role dashboards | ✅ | ✅ | ✅ | |
| User-built dashboards / chart builder | ❌ | 🟡 templates | ✅ | gap |
| **Pricing** | | | | |
| Public price list | — | ❌ quote only; "no per-user fee" claim | ✅ bundles $59–159/mo | |
| Implementation time | weeks | 2–3 months (vendor) | self-serve | |

## 3. New gaps this pair surfaces

The gaps from 2026-10-31 still stand. These are new, or now stronger because two more competitors have them:

1. **Retention on progress claims**: HashMicro has it, and Indonesian construction contracts expect it.
2. **Deal follow-up reminders and lost reasons**: everyone else has them (CRM C2/C4, never filed).
3. **Baseline vs actual, critical path, resource workload** (#1574 covers baseline).
4. **Project templates and recurring tasks.**
5. **Overdue-invoice reminders.**
6. **User-built dashboards and an assistant whose answers render charts** (#2047).
7. **Native mobile with an approvals queue**: Rework shows it, and HashMicro does for HR.

## 4. Selling notes

- **vs HashMicro:** "keep your ERP, or don't need one yet." HashMicro replaces everything over 2–3 months of customisation. Ask for a scripted demo of retention, BAST/drawdown, PPh 23 withholding, approver ≠ author, and what happens before the AI writes.
- **vs Rework:** Rework is cheaper generic work management. Show the budget → PO → GR → claim → cash thread, which Rework doesn't have. Ask to see its GL, bank reconciliation and tax screens live, which are claimed but not shown.
- Don't claim parity on HR, field, inventory or native apps.
