# Requester Cash & Invoice Who-Next Proof

## Scope of Changes & Owned Files
Changes strictly bounded to the assigned domain files and their direct owning test suites:
- `pmo-portal/pages/imprest/PlansSection.tsx`
- `pmo-portal/pages/imprest/PlansSection.test.tsx`
- `pmo-portal/pages/ImprestFloatDetail.tsx`
- `pmo-portal/pages/ImprestFloatDetail.test.tsx`
- `pmo-portal/pages/sales-invoices/SalesInvoiceDetail.tsx`
- `pmo-portal/pages/sales-invoices/SalesInvoiceDetail.headerFacts.test.tsx`

No shared files, catalogues, database types, or other domain code were modified.

---

## 1. Imprest Monthly Plans (`PlansSection.tsx`)
- **Waiting State**: `plan.status === 'Submitted'`.
- **Authority**: Under migration `0422`/`0424` (`transition_imprest_plan` and `spend_approval_route`), flat approval route permits all four roles in `APPROVAL_RANK`: `Admin`, `Executive`, `Finance`, `Project Manager`.
- **Role Token**: `roleApprovalRank` (`waitingRoleLabel('roleApprovalRank', t)`).
- **Formatted Outputs**:
  - English: `Waiting for Project Manager, Finance, Executive, or Admin` (explicitly includes Executive).
  - Indonesian: `Menunggu Manajer Proyek, Keuangan, Eksekutif, atau Admin`.
- **Non-waiting States**: `Draft`, `Approved`, `Rejected`, `Cancelled` display no waiting line.
- **SoD & Integrity**:
  - Author and custodian cannot approve their own plan.
  - The waiting string accurately reflects the four eligible roles without self-approver claims.
  - Preserves plan totals, currency, show/hide line toggles, plan creation, editing, submission, cancellation, rejection notes, and error toasts.

---

## 2. Site Cash Replenishments & Float Limits (`ImprestFloatDetail.tsx`)
- **Waiting State (Replenishments)**: `rep.status === 'Requested'`.
  - **Authority**: Migration `0423`/`0534` (`transition_imprest_replenishment`) restricts decisions to `Admin` or `Finance`, excluding the requester and custodian.
  - **Role Token**: `roleFinanceAdmin` (`waitingRoleLabel('roleFinanceAdmin', t)`).
  - **Formatted Outputs**:
    - English: `Waiting for Finance or Admin`
    - Indonesian: `Menunggu Keuangan atau Admin`
  - **Step Formatting**: Replenishment is a single decision step; step counts are omitted (no invented steps).
  - **Non-waiting States**: `Approved`, `Paid`, `Rejected`, `Cancelled` display no waiting line.
- **Waiting State (Limit Changes)**: Proposed limit changes (`pendingLimit` / `c.status === 'Proposed'`).
  - **Authority**: Migration `0422` (`decide_imprest_float_change`) reads `imprest_senior_route`, which checks org-level spend approvers (`roleOrg`), distinct from flat spend approval.
  - **Role Token**: `roleOrg` (`waitingRoleLabel('roleOrg', t)`).
  - **Formatted Output**:
    - English: `<Amount> · Waiting for senior approver`
    - Indonesian: `<Amount> · Menunggu penyetuju senior`
- **SoD & Integrity**:
  - Custodian/requester is excluded from self-approval.
  - Preserves all cash positions, hold balances, variance checks, cash counts, receipts, ERP posting states, refetch callbacks, and mutation dialogs.

---

## 3. Native PMO Sales Invoices (`SalesInvoiceDetail.tsx`)
- **Waiting State**: Native PMO invoice in draft awaiting approval (`viewTarget.pmo_native && viewTarget.status === 'Draft'`).
- **Authority**: Migration `0534` / `assert_sales_invoice_approver` strictly permits `Admin` or `Finance`, excluding the author and prior invoice authors (SoD).
- **Role Token**: `roleFinanceAdmin` (`waitingRoleLabel('roleFinanceAdmin', t)`).
- **Formatted Outputs**:
  - English: `Waiting for Finance or Admin`
  - Indonesian: `Menunggu Keuangan atau Admin`
- **Excluded Non-waiting & External States**:
  - External ERP draft invoices (`pmo_native: false`): No waiting line rendered.
  - Non-draft native invoices (`Unpaid`, `Paid`, `Cancelled`): No waiting line rendered.
- **SoD & Integrity**:
  - Author (`author_user_id`) cannot approve; the role token states the required server category (`roleFinanceAdmin`) without self-approver claims.
  - Preserves invoice lifecycle stepper, PDF downloads, ERP delivery notes, payments, outstanding/tax calculations, and refetch handlers.

---

## Owning Unit Test Suites & Unrun Commands
In this source-only worktree without local node modules, verify with:
```sh
cd pmo-portal && npx vitest run pages/imprest/PlansSection.test.tsx
cd pmo-portal && npx vitest run pages/ImprestFloatDetail.test.tsx
cd pmo-portal && npx vitest run pages/sales-invoices/SalesInvoiceDetail.headerFacts.test.tsx
```

All suites contain explicit coverage for:
1. Exact waiting state role names including Executive (`roleApprovalRank`) and `roleFinanceAdmin`.
2. Both English and Bahasa Indonesia outputs.
3. Negative assertions that non-waiting states produce no waiting line.
4. Separation-of-duties compliance without self-approver claims.
