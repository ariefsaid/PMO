# Plan part 6 — Expense claims (#775): i18n, e2e, final gate, phase-B spike (Tasks 43–46)

Part of `docs/plans/2026-10-06-expense-claims.md`.

### Task 43 — i18n catalogues + launch-scope gate (NFR-EXP-006)

1. `pmo-portal/public/locales/en/common.json`: in the existing `shell.nav` object add `"expenses": "Expenses"`; add a
   new top-level `"expenses"` object (alphabetical position among the top-level keys):

```json
"expenses": {
  "actions": { "approve": "Approve", "cancel": "Cancel", "newClaim": "New claim", "pay": "Mark paid", "recordReturn": "Record cash returned", "reject": "Reject", "reopen": "Edit and resubmit", "requestAdvance": "Request advance", "submit": "Submit for approval" },
  "aging": {
    "bucket": { "d31to60": "31–60 days", "d61to90": "61–90 days", "over90": "Over 90 days", "upTo30": "0–30 days" },
    "columns": { "advance": "Advance", "age": "Age (days)", "claimant": "Claimant", "outstanding": "Outstanding", "project": "Project" },
    "errorSub": "The list below is unaffected. Try again.",
    "errorTitle": "Couldn't load outstanding advances",
    "title": "Advances outstanding",
    "truncated": "Showing the oldest {{count}} advances."
  },
  "approvals": { "errorSub": "Purchase requests and timesheets below are unaffected.", "errorTitle": "Couldn't load expense claims awaiting you", "heading": "Expense claims awaiting you ({{count}})", "label": "Expense claims awaiting you" },
  "columns": { "amount": "Amount", "category": "Budget category", "claimant": "Claimant", "kind": "Type", "number": "Number", "project": "Project", "status": "Status", "title": "Title" },
  "confirm": {
    "approveTitle": "Approve this?", "cancelConfirm": "Cancel it", "cancelDescription": "It stays on record as Cancelled and can no longer be approved or paid.", "cancelTitle": "Cancel this?",
    "keep": "Keep it", "notesLabel": "Note to the claimant (optional)", "payTitle": "Mark as paid?", "previewApplied": "Advance applied", "previewCash": "Cash to pay",
    "referenceLabel": "Payment reference (optional)", "rejectTitle": "Reject this?", "returnAmountHelper": "Up to {{amount}} is outstanding.", "returnAmountLabel": "Amount returned",
    "returnConfirm": "Record return", "returnReferenceLabel": "Reference (optional)", "returnTitle": "Record cash returned"
  },
  "description": "Expense claims and cash advances. You see your own; approvers see the whole team.",
  "detail": {
    "advanceApplied": "Advance applied", "amount": "Amount", "back": "Expenses", "cashPaid": "Cash paid", "editDetails": "Edit details",
    "errorSub": "Something went wrong fetching it. Try again.", "errorTitle": "Couldn't load this record", "linkedAdvance": "Settles a cash advance",
    "notFoundSub": "It doesn't exist, or it isn't yours and you don't approve spend.", "notFoundTitle": "Not found", "outstanding": "Outstanding",
    "reference": "Payment reference", "rejectionNote": "Rejected: {{note}}", "summary": "Summary"
  },
  "draftNumber": "Draft",
  "filters": { "allCategories": "All categories", "allKinds": "Claims and advances", "allStatuses": "All statuses", "category": "Budget category", "kind": "Type", "status": "Status" },
  "form": {
    "advance": { "current": "The advance already linked", "label": "Settle against advance", "none": "No advance" },
    "advanceSubtitle": "Cash you take before the work. Claims you file afterwards settle it.",
    "advanceTitle": "Request a cash advance",
    "amount": { "label": "Amount" },
    "category": { "helper": "Decides who approves: spend within the project's budget for this category goes to the project's approver.", "label": "Budget category", "none": "No category" },
    "claimSubtitle": "Add lines and receipts on the next screen.",
    "claimTitle": "New expense claim",
    "editTitle": "Edit details",
    "errors": { "amountPositive": "Enter an amount greater than zero.", "titleRequired": "Give it a short title." },
    "project": { "label": "Project", "none": "Overhead (no project)" },
    "purpose": { "label": "Purpose", "placeholder": "What the money was for" },
    "sections": { "details": "Details" },
    "submitCreate": "Create",
    "submitSave": "Save",
    "title": { "label": "Title", "placeholder": "e.g. Site visit, week 41" }
  },
  "kind": { "advance": "Cash advance", "claim": "Expense claim" },
  "lines": {
    "add": "Add line", "addTitle": "Add a line", "amount": "Amount",
    "columns": { "amount": "Amount", "date": "Date", "description": "Description", "type": "Type" },
    "date": "Date", "description": "Description", "edit": "Edit", "editAria": "Edit line {{description}}", "editTitle": "Edit line",
    "empty": "No lines yet. Add one per receipt.", "error": "Couldn't load the lines.",
    "errors": { "amountPositive": "Enter an amount greater than zero.", "dateRequired": "Enter the date of the expense.", "descriptionRequired": "Describe the expense." },
    "remove": "Remove", "removeAria": "Remove line {{description}}", "removeTitle": "Remove this line?", "save": "Save line",
    "sectionLegend": "Expense", "title": "Lines", "total": "Total", "type": "Type"
  },
  "overhead": "Overhead",
  "receipts": {
    "attach": "Attach receipt", "attachAria": "Choose a receipt file", "attached": "Receipt attached", "download": "Download {{name}}", "empty": "No receipts attached.",
    "error": "Couldn't load receipts.", "loading": "Loading receipts…", "remove": "Remove {{name}}", "removeConfirm": "Remove",
    "removeDescription": "It is removed from this claim. You can attach it again.", "removeTitle": "Remove this receipt?", "removed": "Receipt removed", "title": "Receipts",
    "uploading": "Uploading {{percent}}%"
  },
  "states": { "errorSub": "The request failed. Check your connection and try again.", "errorTitle": "Couldn't load expenses" },
  "status": { "approved": "Approved", "cancelled": "Cancelled", "draft": "Draft", "paid": "Paid", "rejected": "Rejected", "submitted": "Submitted" },
  "table": { "emptySub": "File a claim after the work, or request an advance before it.", "emptyTitle": "No expenses here yet", "rowLabel": "Open {{title}}" },
  "title": "Expenses",
  "toast": { "approved": "Approved", "cancelled": "Cancelled", "created": "Created", "paid": "Marked paid", "rejected": "Rejected", "reopened": "Back to Draft", "returned": "Return recorded", "submitted": "Submitted for approval" },
  "truncated": "Showing the latest {{count}}. Narrow the filters to see older records.",
  "type": { "accommodation": "Accommodation", "localTransport": "Local transport", "meals": "Meals", "other": "Other", "travel": "Travel" }
}
```

2. `pmo-portal/public/locales/id/common.json`: `shell.nav.expenses` = `"Biaya"`, and the same key tree with:

```json
"expenses": {
  "actions": { "approve": "Setujui", "cancel": "Batalkan", "newClaim": "Klaim baru", "pay": "Tandai dibayar", "recordReturn": "Catat pengembalian kas", "reject": "Tolak", "reopen": "Ubah dan ajukan ulang", "requestAdvance": "Ajukan uang muka", "submit": "Ajukan persetujuan" },
  "aging": {
    "bucket": { "d31to60": "31–60 hari", "d61to90": "61–90 hari", "over90": "Lebih dari 90 hari", "upTo30": "0–30 hari" },
    "columns": { "advance": "Uang muka", "age": "Umur (hari)", "claimant": "Pengaju", "outstanding": "Belum diselesaikan", "project": "Proyek" },
    "errorSub": "Daftar di bawah tidak terpengaruh. Coba lagi.",
    "errorTitle": "Gagal memuat uang muka yang belum diselesaikan",
    "title": "Uang muka belum diselesaikan",
    "truncated": "Menampilkan {{count}} uang muka tertua."
  },
  "approvals": { "errorSub": "Permintaan pembelian dan timesheet di bawah tidak terpengaruh.", "errorTitle": "Gagal memuat klaim biaya yang menunggu Anda", "heading": "Klaim biaya menunggu Anda ({{count}})", "label": "Klaim biaya menunggu Anda" },
  "columns": { "amount": "Jumlah", "category": "Kategori anggaran", "claimant": "Pengaju", "kind": "Jenis", "number": "Nomor", "project": "Proyek", "status": "Status", "title": "Judul" },
  "confirm": {
    "approveTitle": "Setujui ini?", "cancelConfirm": "Batalkan", "cancelDescription": "Tetap tercatat sebagai Dibatalkan dan tidak dapat lagi disetujui atau dibayar.", "cancelTitle": "Batalkan ini?",
    "keep": "Simpan", "notesLabel": "Catatan untuk pengaju (opsional)", "payTitle": "Tandai sebagai dibayar?", "previewApplied": "Uang muka dipakai", "previewCash": "Kas yang dibayar",
    "referenceLabel": "Referensi pembayaran (opsional)", "rejectTitle": "Tolak ini?", "returnAmountHelper": "Maksimal {{amount}} belum diselesaikan.", "returnAmountLabel": "Jumlah dikembalikan",
    "returnConfirm": "Catat pengembalian", "returnReferenceLabel": "Referensi (opsional)", "returnTitle": "Catat pengembalian kas"
  },
  "description": "Klaim biaya dan uang muka. Anda melihat milik Anda; penyetuju melihat seluruh tim.",
  "detail": {
    "advanceApplied": "Uang muka dipakai", "amount": "Jumlah", "back": "Biaya", "cashPaid": "Kas dibayar", "editDetails": "Ubah detail",
    "errorSub": "Terjadi kesalahan saat memuat. Coba lagi.", "errorTitle": "Gagal memuat catatan ini", "linkedAdvance": "Menyelesaikan uang muka",
    "notFoundSub": "Tidak ada, atau bukan milik Anda dan Anda tidak menyetujui pengeluaran.", "notFoundTitle": "Tidak ditemukan", "outstanding": "Belum diselesaikan",
    "reference": "Referensi pembayaran", "rejectionNote": "Ditolak: {{note}}", "summary": "Ringkasan"
  },
  "draftNumber": "Draf",
  "filters": { "allCategories": "Semua kategori", "allKinds": "Klaim dan uang muka", "allStatuses": "Semua status", "category": "Kategori anggaran", "kind": "Jenis", "status": "Status" },
  "form": {
    "advance": { "current": "Uang muka yang sudah ditautkan", "label": "Selesaikan dengan uang muka", "none": "Tanpa uang muka" },
    "advanceSubtitle": "Kas yang Anda ambil sebelum pekerjaan. Klaim yang Anda ajukan sesudahnya menyelesaikannya.",
    "advanceTitle": "Ajukan uang muka",
    "amount": { "label": "Jumlah" },
    "category": { "helper": "Menentukan penyetuju: pengeluaran dalam anggaran proyek untuk kategori ini disetujui oleh penyetuju proyek.", "label": "Kategori anggaran", "none": "Tanpa kategori" },
    "claimSubtitle": "Tambahkan rincian dan bukti di layar berikutnya.",
    "claimTitle": "Klaim biaya baru",
    "editTitle": "Ubah detail",
    "errors": { "amountPositive": "Masukkan jumlah lebih dari nol.", "titleRequired": "Beri judul singkat." },
    "project": { "label": "Proyek", "none": "Overhead (tanpa proyek)" },
    "purpose": { "label": "Keperluan", "placeholder": "Untuk apa uang ini" },
    "sections": { "details": "Detail" },
    "submitCreate": "Buat",
    "submitSave": "Simpan",
    "title": { "label": "Judul", "placeholder": "mis. Kunjungan lapangan, minggu 41" }
  },
  "kind": { "advance": "Uang muka", "claim": "Klaim biaya" },
  "lines": {
    "add": "Tambah rincian", "addTitle": "Tambah rincian", "amount": "Jumlah",
    "columns": { "amount": "Jumlah", "date": "Tanggal", "description": "Keterangan", "type": "Jenis" },
    "date": "Tanggal", "description": "Keterangan", "edit": "Ubah", "editAria": "Ubah rincian {{description}}", "editTitle": "Ubah rincian",
    "empty": "Belum ada rincian. Tambahkan satu per bukti.", "error": "Gagal memuat rincian.",
    "errors": { "amountPositive": "Masukkan jumlah lebih dari nol.", "dateRequired": "Masukkan tanggal pengeluaran.", "descriptionRequired": "Jelaskan pengeluarannya." },
    "remove": "Hapus", "removeAria": "Hapus rincian {{description}}", "removeTitle": "Hapus rincian ini?", "save": "Simpan rincian",
    "sectionLegend": "Pengeluaran", "title": "Rincian", "total": "Total", "type": "Jenis"
  },
  "overhead": "Overhead",
  "receipts": {
    "attach": "Lampirkan bukti", "attachAria": "Pilih berkas bukti", "attached": "Bukti terlampir", "download": "Unduh {{name}}", "empty": "Belum ada bukti terlampir.",
    "error": "Gagal memuat bukti.", "loading": "Memuat bukti…", "remove": "Hapus {{name}}", "removeConfirm": "Hapus",
    "removeDescription": "Bukti dihapus dari klaim ini. Anda dapat melampirkannya lagi.", "removeTitle": "Hapus bukti ini?", "removed": "Bukti dihapus", "title": "Bukti",
    "uploading": "Mengunggah {{percent}}%"
  },
  "states": { "errorSub": "Permintaan gagal. Periksa koneksi Anda dan coba lagi.", "errorTitle": "Gagal memuat biaya" },
  "status": { "approved": "Disetujui", "cancelled": "Dibatalkan", "draft": "Draf", "paid": "Dibayar", "rejected": "Ditolak", "submitted": "Diajukan" },
  "table": { "emptySub": "Ajukan klaim setelah pekerjaan, atau uang muka sebelumnya.", "emptyTitle": "Belum ada biaya", "rowLabel": "Buka {{title}}" },
  "title": "Biaya",
  "toast": { "approved": "Disetujui", "cancelled": "Dibatalkan", "created": "Dibuat", "paid": "Ditandai dibayar", "rejected": "Ditolak", "reopened": "Kembali ke Draf", "returned": "Pengembalian dicatat", "submitted": "Diajukan untuk persetujuan" },
  "truncated": "Menampilkan {{count}} terbaru. Persempit filter untuk melihat catatan lama.",
  "type": { "accommodation": "Akomodasi", "localTransport": "Transportasi lokal", "meals": "Makan", "other": "Lainnya", "travel": "Perjalanan" }
}
```

3. `pmo-portal/src/lib/i18n/launch-scope-routes.txt`: append after the Meetings block

```text
# ── Expenses (#775): claims and cash advances — the field team's own money, filed by every role.
/expenses                      pages/ExpenseClaims.tsx pages/expenses/*.tsx pages/expenses/expenseLabels.ts pages/expenses/useOwnAdvanceOptions.ts
/expenses/:claimId             pages/ExpenseClaimDetail.tsx pages/expenses/*.tsx pages/expenses/expenseLabels.ts src/components/shell/BackBar.tsx
```

and extend the existing `/approvals` line to `pages/Approvals.tsx pages/approvals/ExpenseClaimApprovalSection.tsx`.

**Verify:** `cd "$WT/pmo-portal" && npm run check:i18n` → passes (en complete, id complete, self-test).

### Task 44 — E2E journey (AC-EXP-070)

Create `pmo-portal/e2e/AC-EXP-070-expense-claim-journey.spec.ts`:

```ts
// @e2e-isolation: self-isolated — creates its own uniquely-named project, Active budget, project-approver row and expense claim each run, and deletes them afterwards; touches no shared seed row.
/**
 * AC-EXP-070 — expense claims (#775): the one cross-stack journey. A field Engineer files a Special-expenses claim on
 * a budgeted project; the project's named approver (the PM seed user) approves it from the record; Finance pays it;
 * the Engineer sees it Paid. Goal oracle: the record's status, end to end, by the people who act on it.
 * No receipt upload: CI runs with Storage disabled (ci.yml), so receipts are proven at the unit layer (AC-EXP-066).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2'; // the named project approver
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-EXP-070 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `EXP-070 ${Date.now()}`;
  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project' }).select('id').single();
  if (project.error) throw new Error(`AC-EXP-070 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  // budget_line_items_draft_guard: lines land only on a Draft version — Draft → line → Active.
  const version = await admin.from('budget_versions')
    .insert({ org_id: ORG_ID, project_id: projectId, name: tag, version: 1, status: 'Draft' }).select('id').single();
  if (version.error) throw new Error(`AC-EXP-070 fixture budget version: ${version.error.message}`);
  const line = await admin.from('budget_line_items')
    .insert({ org_id: ORG_ID, budget_version_id: version.data.id, category: 'Special expenses', budgeted_amount: 5_000_000 });
  if (line.error) throw new Error(`AC-EXP-070 fixture budget line: ${line.error.message}`);
  const activate = await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.data.id);
  if (activate.error) throw new Error(`AC-EXP-070 fixture budget activate: ${activate.error.message}`);
  const approver = await admin.from('spend_approvers').insert({ org_id: ORG_ID, project_id: projectId, profile_id: PM_ID });
  if (approver.error) throw new Error(`AC-EXP-070 fixture approver: ${approver.error.message}`);
});

test.afterEach(async () => {
  if (!admin || !projectId) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-EXP-070 cleanup ${step}: ${e.message}`); };
  // Lines and receipt rows go by ON DELETE CASCADE.
  fail('claims', (await admin.from('expense_claims').delete().eq('project_id', projectId)).error);
  fail('approvers', (await admin.from('spend_approvers').delete().eq('project_id', projectId)).error);
  fail('versions', (await admin.from('budget_versions').delete().eq('project_id', projectId)).error);
  fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  projectId = '';
});

test('AC-EXP-070 a field claim is filed, approved by the project approver, paid by Finance and seen as paid', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'New claim' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/Title/).fill(`${tag} site visit`);
  await form.getByLabel('Project').selectOption({ label: tag });
  await form.getByLabel('Budget category').selectOption({ label: 'Special expenses' });
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const claimUrl = page.url();

  await page.getByRole('button', { name: 'Add line' }).click();
  const lineForm = page.getByRole('dialog');
  await lineForm.getByLabel(/Date/).fill('2026-10-01');
  await lineForm.getByLabel(/Description/).fill('Taxi to site');
  await lineForm.getByLabel(/Amount/).fill('750000');
  await lineForm.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByTestId('lines-total')).toContainText('750');
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Submitted', { timeout: 15_000 });

  await signIn(page, 'pm@acme.test');
  await page.goto(claimUrl);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });

  await signIn(page, 'finance@acme.test');
  await page.goto(claimUrl);
  await page.getByRole('button', { name: 'Mark paid' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Payment reference (optional)').fill(`TRF-${Date.now()}`);
  await pay.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Paid', { timeout: 15_000 });

  await signIn(page, 'engineer@acme.test');
  await page.goto(claimUrl);
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Paid', { timeout: 15_000 });
});
```

**Verify:** `cd "$WT" && scripts/with-db-lock.sh scripts/e2e-local.sh AC-EXP-070 --reset` (this branch adds a
migration, so `--reset` applies) → 1 passed; `cd "$WT/pmo-portal" && npm run check:e2e-isolation` → passes.

### Task 45 — Local final gate (before the PR)

```bash
cd "$WT/pmo-portal" && npm run typecheck \
  && npx eslint --max-warnings=0 pages/ExpenseClaims.tsx pages/ExpenseClaimDetail.tsx pages/expenses pages/approvals/ExpenseClaimApprovalSection.tsx pages/Approvals.tsx \
       src/lib/db/expenseClaims.ts src/lib/db/expenseReceipts.ts src/lib/expenses src/hooks/useExpenseClaims.ts src/hooks/useExpenseReceipts.ts \
       src/lib/repositories src/auth/policy.ts src/lib/procurement/approvalRoute.ts src/components/shell App.tsx e2e/AC-EXP-070-expense-claim-journey.spec.ts \
  && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev \
  && npm run check:i18n && npm run check:migrations && npm run check:e2e-isolation
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_schema_rls.test.sql supabase/tests/expense_claims_transition.test.sql supabase/tests/expense_claims_routing.test.sql supabase/tests/expense_claims_line_lock.test.sql supabase/tests/expense_advances.test.sql supabase/tests/expense_claims_notify.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0237_workflow_notifications.test.sql supabase/tests/spend_approval_enforce.test.sql supabase/tests/spend_approval_classify.test.sql'
```

**Verify:** every command exits 0 with its body read (not `$?` through a pipe); coverage on the new files ≥ 80% lines
(`npx vitest run --coverage --changed origin/dev`). Then the three reviewers + the rendered Discover pass on rich
seed (CLAUDE.md steps 5–6); CI is the full gate.

### Task 46 — Phase B spike (separate dispatch; output `docs/spikes/2026-10-XX-erpnext-employee-expense-postings.md`)

Not part of the phase-A PR. Run against the ERPNext bench (the method of
`docs/spikes/2026-07-20-erpnext-timesheet-fields.md`; connection per `docs/environments.md`, never a secret in the doc),
once on a site **without** HRMS and once **with** it if one exists. Record verbatim REST requests/responses for:

1. `GET /api/method/frappe.utils.change_log.get_versions` — is `hrms` installed? (owner/ops fact Q1)
2. Create + submit a `Journal Entry`: row 1 Dr an expense account with `project` and `cost_center`; row 2 Cr a payable
   account with `party_type: "Employee"`, `party: <Employee name>`. Accepted on both sites?
3. The same with row 2 Cr an asset (employee-advance) account with `party_type: "Employee"`.
4. Stamp a 32-char key into `user_remark`, then `cheque_no`; re-fetch after submit and after an attempted post-submit
   PUT. Which survives verbatim, is filterable with `filters=[["<field>","like","%<key>%"]]`, and is immutable after
   submit? (ADR-0058 anchor + C-1 mutability)
5. Create + submit a `Payment Entry` `payment_type: "Pay"`, `party_type: "Employee"` without `paid_to`: what does
   ERPNext resolve or refuse? With an explicit `paid_to`?
6. `GET` the resulting `GL Entry` rows: does the JE row's `project` appear, so `erp_gl_entry_mirror` → actuals sees it?
7. Cancel the JE and PE: confirm `docstatus: 2` through the sweep's existing list call.

Output feeds the phase-B issue (new kinds `employee-journal` and `employee-payment` in `doctypeRegistry.ts`, a
`DOCTYPE_BODIES` pair, an Admin account map by expense type, push on →Approved / →Paid / return). Phase B is planned
only after this file exists.
