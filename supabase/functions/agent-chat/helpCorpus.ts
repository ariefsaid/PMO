/**
 * helpCorpus.ts — curated, end-user-facing product-help text appended to the agent-chat system
 * prompt (spec docs/specs/deputy-help.spec.md, FR-DH-001/002/003).
 *
 * This is a PURPOSE-WRITTEN artifact, derived from docs/glossary.md + docs/jtbd.md but authored for
 * an end user reading an assistant's answer — NOT a copy of those internal documents.
 *
 * Editing rules (binding):
 *   - Plain language only. NO ADR/OD/NFR/FR/AC citations, no "RLS"/"STRIDE"/"OWASP", no org_id —
 *     this text is shown to end users (NFR-DH-SEC-003).
 *   - Each "how do I" entry declares the role(s) that can perform it, mirroring the role sets in
 *     pmo-portal/src/auth/policy.ts (FR-DH-004). Keep role names exact: Admin, Executive,
 *     Project Manager, Finance, Engineer.
 *   - Keep it bounded: HELP_CORPUS.length MUST stay ≤ 6000 chars (≈ 1500 tokens). The fixture test
 *     in pmo-portal/src/lib/agent/helpCorpus.test.ts enforces this (NFR-DH-PERF-001). If you must grow
 *     past it, bump the ceiling deliberately AND record the new measured size in the spec's
 *     "Injection strategy" section.
 *   - When a feature changes a screen's affordances, a role's permissions, or a glossary term, update
 *     this file in the same PR (FR-DH-011; see docs/director-playbook.md Ship step).
 *   - Ship as a plain TS template-string constant (Deno+Node-importable leaf module): no .md import,
 *     no Deno.readTextFile, no build step (FR-DH-003). Mirrors readEntities.ts/schema.ts style.
 */
export const HELP_CORPUS = `# PMO Portal — product help for the Assistant

Reference material. Answer only for what the asking user's role can do; if an action belongs to another role, say so and name who can do it.

## Terms (plain-language definitions)

**Milestone** — a named chunk of delivery work inside one project (e.g. "Engineering design", "Procurement", "Site construction"), with a target date, a weight, and a percent-complete. The PM may type an override percent; otherwise it is calculated from its tasks.

**Task** — the smallest unit of tracked work. Belongs to a project and may sit under one milestone. Engineers log hours against tasks.

**Document** — a controlled record in a project's document register (drawing, specification, report, contract) with a category, a revision mark, and a lifecycle (Draft → … → Approved). It holds one file, changeable only while Draft; once issued, content changes need a new revision.

**Revision** — a successive issue of the same document (Rev A → Rev B). Each revision is its own register entry with its own lifecycle, created from its predecessor — that act links the lineage. Older revisions become "Superseded" but stay readable.

**Superseded** — terminal document status meaning "replaced by a newer Approved revision of the same document". Read-only, reached automatically.

**Committed spend** — the sum of all procurement records (Purchase Orders, etc.) in statuses Ordered, Received, Vendor Invoiced, or Paid for a project — the single live spend number on the project header ("Committed"), the Finance dashboard, and the Delivery summary.

**Actual / Realized spend** — the same number as Committed spend, shown under the label "Actual" on the project stat strip and the Finance "Budget vs Actual" card. No separate actuals ledger exists today; committed purchase orders are the realized-cost proxy.

**Procurement case** — one procure-to-pay effort modeled as a folder that carries a title, project, requester, type, and lifecycle status. It is the folder the records hang under, not a single document.

**Procurement record** — a real document under a case: Purchase Request, RFQ, Quotation, Purchase Order, Goods Receipt, Vendor Invoice, or Payment. A case may hold many of each.

**RFQ (Request for Quotation)** — a procurement record asking vendors for pricing. One RFQ may gather many Quotations; a Quotation may cite its RFQ.

**System-assigned number** — the ID PMO mints for a procurement record (e.g. PR-250619-0001), unique per org, gap-tolerant.

**External reference number** — the ID the document carries in the outside world (vendor quotation number, real PO number, supplier invoice number), captured alongside the system-assigned number so a record is findable from both sides.

**Active contract value** — the sum of signed contract values across projects currently in delivery. Smaller than "revenue on hand" because revenue also accrues on completed work.

**Delivery** — the post-win, pre-handover execution of a project. Finite: it ends at handover or commissioning.

**O&M (Service)** — recurring post-handover service under its own contract (maintenance, breakdowns, asset care). Not part of Delivery.

**Organization (org)** — the tenant boundary: one paying client group behind one access wall. A client group with subsidiaries is still one org.

**Entity** — an operating or legal company within a client group, modeled as a dimension on the org's data; users span Entities by default. Not the same as a Company, which is a CRM counterparty (client or vendor).

**Assistant** — the in-app agent you are talking to. It explores your own data and can propose actions, acting under your identity and permissions — never more than you could yourself.

**Deputy** — the Assistant's authorization stance: it carries your badge, never a master key. Whatever bounds you (your organisation, your role, separation of duties) bounds the Assistant identically.

**User view** — a dashboard you compose at runtime (manually or via the Assistant) and own as data, not code. Private by default; sharing shows each viewer only their own authorized data.

## How do I… (by role)

**How do I log my hours?** — Role: Engineer. Go to Timesheets (/timesheets), pick the task you worked on, and enter your hours. Engineers log time against their own tasks.

**How do I approve a timesheet?** — Roles: Project Manager (Finance holds money authority). Go to Approvals (/approvals) or Timesheets (/timesheets); preview and approve or reject in place. Engineers cannot approve timesheets.

**How do I see whether my projects are on track?** — Roles: Project Manager, Executive. Open Projects (/projects) to spot the off-track ones, then open a project (/projects/:id) for status, what is blocked, and the next action.

**How do I create or edit a milestone?** — Roles: Project Manager, Admin. Inside a project's detail view, add or edit a milestone. Only PM and Admin can write milestones; other roles can view them.

**How do I run or advance a procurement case?** — Roles: Admin, Project Manager, Finance (procurement-admin hat). Open the case (/procurement/:id) and capture each record — PR, RFQ, quotes, Purchase Order, goods receipt, invoice, payment — with its reference number and file, then advance the case.

**How do I approve spend or release payment?** — Roles: Project Manager approves; Finance pays. Go to Approvals (/approvals) to preview and approve or reject; payment release is a Finance action. Approver and requester must be different people.

**How do I advance a sales opportunity?** — Roles: Project Manager, Finance. On the opportunity (/sales/:id), advance its stage. Marking a deal won records the contract value; editing contract value on a won or on-hand project needs money authority (Admin, Executive, or Finance).

**How do I manage users and roles?** — Role: Admin. Go to Administration (/administration) to create or edit users and assign roles.`;
