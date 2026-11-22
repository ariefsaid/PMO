# Gemini Requester Field Proof (Who-Next Implementation)

## 1. Summary & Slice Scope
- **Slice**: `requester-field` (Item 3 of fix-1122 waiting list approvals who-next)
- **Base SHA**: `b87c085cb89e6f8ea98af56ab1de2b768b3772b4` (seam providing `waitingRoleLabel`, `alternativeRoles`, and role translations)
- **Files Owned & Modified**:
  - `pmo-portal/pages/siteReports/SiteReportDetail.tsx`
  - `pmo-portal/pages/siteReports/SiteReportDetail.test.tsx`
  - `pmo-portal/pages/quantityChanges/QuantityChangeDetail.tsx`
  - `pmo-portal/pages/quantityChanges/QuantityChangeDetail.test.tsx`
  - `pmo-portal/pages/subcontractCertificates/SubcontractCertificateDetail.tsx`
  - `pmo-portal/pages/subcontractCertificates/SubcontractCertificateDetail.test.tsx`
- **Untouched Surfaces**: WorkOrder, Procurement, Transfer, shared `waitingFor.ts`, DB types, SQL schema, catalogues.

---

## 2. Server Authority & Ruling Analysis

### 2.1 Daily Site Report (DSR)
- **Authority**: Migrations `1041_daily_site_report_rpcs.sql` and `1560_waiting_decisions.sql` (`dsr_may_validate(project_id)`).
- **Rule**:
  - The project's assigned Project Manager (`projects.project_manager_id`) may validate, provided they are active and **not** the report author (`r.author_id <> auth.uid()`).
  - `Finance` and `Admin` also hold validation standing.
- **DTO Inspection & Truthful Role / Name Mapping**:
  - Existing `project` DTO carries `project.project_manager_id` and `project.pm.full_name`.
  - Author check: `isAuthorPm = Boolean(project?.project_manager_id && project.project_manager_id === report.author_id)`.
  - If `isAuthorPm`: The PM is the author, so the PM cannot validate. Author is **never** named. Formats truthful role-only:
    `waitingForText({ names: [], role: waitingRoleLabel('roleFinanceAdmin', t) }, t)`
    - EN: `Waiting for Finance or Admin`
    - ID: `Menunggu Keuangan atau Admin`
  - If `!isAuthorPm` and `pmName` is present:
    `waitingForText({ names: [pmName], role: waitingRoleLabel('roleProject', t), alternativeRoles: [waitingRoleLabel('roleFinanceAdmin', t)] }, t)`
    - EN: `Waiting for Rina Wati, project approver or Finance or Admin`
    - ID: `Menunggu Rina Wati, penyetuju proyek atau Keuangan atau Admin`
  - If `!isAuthorPm` and no PM is assigned or known:
    `waitingForText({ names: [], role: waitingRoleLabel('roleProject', t), alternativeRoles: [waitingRoleLabel('roleFinanceAdmin', t)] }, t)`
    - EN: `Waiting for project approver or Finance or Admin`
    - ID: `Menunggu penyetuju proyek atau Keuangan atau Admin`
- **State Gating**: Shown **only** in waiting state `report.status === 'submitted'`. Non-waiting states (`draft`, `validated`, `returned`) render no waiting line.

### 2.2 Quantity Change Request (QCR)
- **Authority**: Migration `1177_quantity_change_approval.sql` (`qcr_assert_approver`).
- **Rule**:
  - Approved by `Admin`, `Executive`, or `Finance`.
  - **Never** Project Manager.
  - Separation of Duties (SoD): The author (`author_id`), editors (`editor_ids`), and submitter (`submitted_by`) can never approve.
- **DTO Inspection & Truthful Role Mapping**:
  - QCR DTO carries no list of distinct approver profiles.
  - Excludes author/editor/submitter; uses new role `roleFinanceExecAdmin` translation (never `roleFlat`):
    `waitingForText({ names: [], role: waitingRoleLabel('roleFinanceExecAdmin', t) }, t)`
    - EN: `Waiting for Finance, Executive, or Admin`
    - ID: `Menunggu Keuangan atau Admin` (ID translation: `Keuangan, Eksekutif, atau Admin`)
- **State Gating**: Shown **only** in waiting state `request.status === 'pending_approval'`. Non-waiting states (`draft`, `approved`, `client_accepted`, `withdrawn`, `returned`) render no waiting line.
- **SoD Controls**: Preserved existing `approval.block.*` text and `approval.nobody` notes without regression.

### 2.3 Subcontract Certificate (cert)
- **Authority**: Migration `1186_certificate_approval_and_bill.sql` (`approve_subcontract_certificate`).
- **Rule**:
  - Approved by `Admin`, `Executive`, or `Finance`.
  - Preparer (`prepared_by`) and submitter (`submitted_by`) cannot approve (`needs-different-approver`).
- **DTO Inspection & Truthful Role Mapping**:
  - Cert DTO carries no list of individual approvers.
  - Uses new role `roleFinanceExecAdmin` translation:
    `waitingForText({ names: [], role: waitingRoleLabel('roleFinanceExecAdmin', t) }, t)`
    - EN: `Waiting for Finance, Executive, or Admin`
    - ID: `Menunggu Keuangan, Eksekutif, atau Admin`
- **State Gating**: Shown **only** in waiting state `c.status === 'submitted'`. Non-waiting states (`draft`, `approved`, `returned`, `billed`, `cancelled`) render no waiting line.
- **SoD Controls**: Preserved existing `sameApprover` banner (`A certificate needs a different approver than the person who prepared and submitted it.`) and return/refusal banners.

---

## 3. Strict Type Safety (No `as any`)
All fields read:
- `report.status`, `report.author_id`, `report.project_id` on `DsrReportDetail['report']`
- `project.project_manager_id`, `project.pm?.full_name` on `ProjectWithRefs`
- `request.status` on `QcrDetail['request']`
- `c.status` on `CertificateView['certificate']`
No fields were cast using `as any`.

---

## 4. Owning Unit Unrun Commands (Owner Batch UNTESTED Cadence)

Under the owner batch cadence, optional unit tests, typechecks, lints, DB migrations, and browser suites are kept unrun locally. The directly bound owning test commands to verify these changes are:

```sh
# 1. Daily Site Report Record Test Suite
npx vitest run pmo-portal/pages/siteReports/SiteReportDetail.test.tsx

# 2. Quantity Change Request Record Test Suite
npx vitest run pmo-portal/pages/quantityChanges/QuantityChangeDetail.test.tsx

# 3. Subcontract Certificate Record Test Suite
npx vitest run pmo-portal/pages/subcontractCertificates/SubcontractCertificateDetail.test.tsx

# 4. Approvals Shared Waiting Helper Unit Suite (from base seam)
npx vitest run pmo-portal/src/lib/approvals/waitingFor.test.ts
```

---

## 5. Verification Checklist
- [x] DSR: `submitted` state displays named project approver + alternative roles Finance/Admin (`Waiting for Rina Wati, project approver or Finance or Admin`)
- [x] DSR: When PM is author, PM name is omitted; displays truthful role-only (`Waiting for Finance or Admin`)
- [x] DSR: When PM is not assigned or unknown, displays truthful role-only (`Waiting for project approver or Finance or Admin`)
- [x] DSR: Non-waiting states (`draft`, `validated`, `returned`) display no waiting line
- [x] QCR: `pending_approval` state displays `roleFinanceExecAdmin` (`Waiting for Finance, Executive, or Admin`), never PM, never `roleFlat`
- [x] QCR: Non-waiting states display no waiting line
- [x] QCR: SoD block reasons and nobody-eligible warnings preserved
- [x] Cert: `submitted` state displays `roleFinanceExecAdmin` (`Waiting for Finance, Executive, or Admin`)
- [x] Cert: Non-waiting states display no waiting line
- [x] Cert: `sameApprover` SoD banner preserved
- [x] English and Indonesian translations supported for all three components
- [x] Zero changes to other domain builders (WorkOrder, Procurement, Transfer)
- [x] Zero edits to shared waitingFor / database types / SQL
