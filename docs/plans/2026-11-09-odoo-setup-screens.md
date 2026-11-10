# Plan: Odoo setup screens: census, Accept all, sends, Employ, project sends (#2050)

- **Issue:** #2050 (map #1481). Found by the #1504 S10 bed run: the Odoo section of Integrations has no screen for the census, Accept all, the send states, Employ, or sending projects, so an Admin cannot finish Odoo setup in the app.
- **Spec:** `docs/specs/odoo-connect-master-data.spec.md` (FR-ODC-110, 112, 113; AC-ODC-080) and `docs/specs/erp-connect-anytime.spec.md` (FR-ECA-001, 002, 012; NFR-ECA-004). No new spec: every behaviour below is already specified; this plan only mounts it for Odoo.
- **Owner rule (2026-10-16):** integrations map once at setup. PMO proposes, the Admin accepts all in one step and answers only the unclear rows. No per-record clicking, no jargon.
- **Baseline:** `origin/dev` at `97d781c5f` (2026-11-09). Paths and line numbers were read at that SHA. `(new)` means the file does not exist yet.
- **Not touched:** the redesign and library-swap work (#2042–#2062). Build only with the primitives on `origin/dev` today (`Button`, `Card`, `ConfirmDialog`, `ListState`, `SelectField`, `StatusPill`, `Icon` from `@/src/components/ui`).
- **Public repo:** fixtures use invented names only (`PT Sinar Baja`); no hosts, keys or client names.

---

## 0. Scope and slices

| Slice | What | Size | Executor |
|---|---|---|---|
| **Slice 1 (this build)** | UI only, on verbs that already serve tier `odoo`: the record review (census + Accept all + unclear rows), the analytic-plan choice that lets projects be sent, the send states, Employ for vendors/clients and for purchases, "Sends finished" derived from send state (#2053), error copy, en+id, and the curated e2e journey. | ~2 h, Sonnet | Orca UI worker (`ui-implementer` contract) |
| Slice 2 (later) | Create one project's cost account from the project page (FR-ODC-072, AC-ODC-052) for projects made **after** setup. It needs the new `send-project` server verb, which writes the money outbox. | backend + 1 button | Director-dispatched (outbox); ships alone with a security review |

Why projects are in slice 1 without a new verb: in setup, PMO projects with no Odoo account come back from the census as **send** proposals, and the Accept all sends them (S8 drain, `supabase/functions/_shared/odooConnectSends.ts:90`). The bed run proved it (AC-ODC-093 passed on the bed: two analytic accounts created once). What blocks it in the app today is the **analytic plan**: with no plan chosen, projects are "not checked" and a project send is refused. The only plan picker is on one project's page (`pages/project-detail/ProjectOdooLink.tsx:62-69`). Slice 1 moves that one-time choice into setup (T5).

**Out of scope here; separate issues change what the screen shows, not how it is built:** census counts Odoo's built-in partners (#2048), Odoo login partners land as review rows (#2049), Re-check fails at the CPU limit (#2051), no link proposal when a project code matches an account (#2052).

### Decisions (default taken; Director overrides)

| # | Question | Default |
|---|---|---|
| D1 | Reuse `ConnectProposalReview` (ERPNext's setup screen, #1851) or build an Odoo copy? | **Reuse.** It already takes `tier` (`src/components/integrations/ConnectProposalReview.tsx:27`), and its copy says "your connected system", which suits Odoo. Every verb it calls (`census`, `connect-status`, `list-proposals`, `accept-proposals`, `decide-review`, `unlink-match`, `retry-send`, `search-connect-staged`) is in the shared router that runs before the Odoo router (`supabase/functions/external-set-company/connect.ts:14`, `index.ts:250`). A copy would mean two matchers. |
| D2 | Who sees the record review? | **Admin only** (`useOdooCan().manage`). The server lets Finance read `connect-status` and act on `account` rows only (`connect.ts:59-64`). Odoo has no account matching yet (`account.match` is pending, `odoo/workflowDeclarations.ts`), so for Finance the panel would fail on its first unfiltered `list-proposals`. |
| D3 | `ErpSendStates` is hard-wired to ERPNext (`ErpSendStates.tsx:6`). Add a `tier` prop or copy it? | **Add `tier` prop** (default `'erpnext'`). ERPNext behaviour and its tests stay unchanged. Odoo gets its own copy keys for the four lines that name the system. |
| D4 | Employ: companies only, or purchases too? | **Both.** The server takes both (`odoo/purchasing.ts:12`); neither has a screen; the P2P plan's P2-T9 "employ verb in the setup checklist" was never built. Each gets one button on its own checklist step with one confirm, same pattern for both. |
| D5 | "Sends finished" never shows Done (#2053). | **Derive it in the checklist from send state** (the option #2053 offers): a finished setup run, nothing waiting, no open send or review rows. The stored key still counts if something writes it later. Closes #2053. Drop T9 if the Director wants #2053 on its own. |
| D6 | Where the review sits on the page. | A plain `<section>` after the Map once card, **not** inside a `Card`: `ConnectProposalReview` renders its own per-kind cards, and DESIGN.md §5 forbids a card inside a card. |
| D7 | Curated e2e. | Rewrite the API steps of `AC-ODC-080-odoo-setup-journey.spec.ts` (on `origin/test/1504-s10`, not on dev yet) as clicks. It is bed-gated and skipped in CI (Q5 of `docs/plans/2026-11-07-odoo-master-data.md`). **Dependency:** the Director merges `test/1504-s10` to dev first, or the builder branches from it (§3). |

---

## 1. What exists on dev (reuse; do not rebuild)

| Need | Exists | Where |
|---|---|---|
| Census + Accept all + unclear rows + sending progress, tier-param | `ConnectProposalReview({ tier, open, onClose })`; starts the census on first open for a role with `manage integration` | `src/components/integrations/ConnectProposalReview.tsx:27,363-370` |
| Send states (waiting / refused / held + retry / people) | `ErpSendStates({ enabled })`, `TIER = 'erpnext'` | `src/components/integrations/ErpSendStates.tsx:6,16` |
| Shared verbs (browser side) | `repositories.integrations.startConnectCensus(tier)`, `getConnectStatus(tier)`, `listConnectProposals(...)`, `acceptConnectProposals(...)`, `retryConnectSend(tier,id)`; `ConnectTier = 'erpnext' \| 'odoo'` | `src/lib/repositories/integrations.ts:38-60`, `contracts/integrations.ts:142` |
| Odoo verbs (browser side) | `repositories.odoo.setup(verb, input)` → `external-set-company` with `tier:'odoo'`; hook `useOdooSetup(verb)` | `src/lib/repositories/odoo.ts:168`, `src/hooks/useOdoo.ts:40` |
| Plan list / chosen plan | `useOdooProjectLinks()` → `list-projects`: `{ planId: null, plans:[{id,name}] }` while unset, else `{ planId, accounts, linked }` | `src/hooks/useOdoo.ts:115`, `supabase/functions/external-set-company/odoo/projectLinks.ts:16-27` |
| Plan setter | `set-analytic-plan {planId}`; gate Admin or Operator | `odoo/projectLinks.ts:60`, `odoo/router.ts:33` |
| Employ | `employ-domain {domain:'companies'\|'procurement'}`; 409 `sends-pending` while partner sends wait; 422 `config-rejected`; gate Admin or Operator | `odoo/purchasing.ts:12-27`, `odoo/router.ts:35` |
| Odoo section | card, checklist (Admin + Finance), Map once (`setValue`), ledger card | `src/components/integrations/odoo/OdooIntegrationSection.tsx` |
| Checklist | 9 steps; "Sends finished" reads `cfg.sends_finished_at`; "Vendors and clients managed in Odoo" reads ownership, no action | `odoo/OdooSetupChecklist.tsx:89-101` |
| Odoo role gates (UX only) | `useOdooCan()` → `manage` (Admin, real role, not view-as), `setValue` (Admin/Finance) | `odoo/useOdooCan.ts` |
| Error copy | `odooErrorMessage(t, err)`; server English never shown | `odoo/odooErrors.ts` |
| Ownership query key | `externalDomainOwnershipKey(orgId)` | `src/hooks/approvalsQueryKeys.ts:25` |
| Global test stub | `test/setup.ts:28` stubs `OdooIntegrationSection` for the Integrations view suites | `pmo-portal/test/setup.ts` |
| Bed journey + helpers | `AC-ODC-080-odoo-setup-journey.spec.ts`, `_connectScenario.ts` (`provisionOdooOrg`, `sweep`, `sweepUntil`, `signIn`, `openOdooSection`) | `origin/test/1504-s10` |

---

## 2. Screen design (design-architect)

One question per block, top to bottom inside `data-testid="odoo-section"`:

```
[Odoo connection card]                         (unchanged)
Odoo setup  (checklist, Admin + Finance)
  ✓ Odoo connected ... Done
  ...
  • Sends finished                     To do   ← now derived (T9)
  • Vendors and clients managed in Odoo To do
      [Let Odoo manage vendors and clients]    ← new, Admin only (T7)
      "Wait until every record has reached Odoo."  (shown while sends wait; button disabled)
  • Purchases go to Odoo               To do   ← new step (T8)
      [Send purchases to Odoo]                 ← Admin only
[Map once card]                                (unchanged)
<section aria-label="Records in PMO and Odoo"> ← new, Admin only (T5/T6)
  Project cost accounts (only while no plan is chosen)
    Proposed: Projects   [Use Projects]        (one plan in Odoo)
    or [Analytic plan ▾] [Use this plan]       (several)
    or "Odoo has no analytic plan yet. Add one in Odoo, then check again."
  [ConnectProposalReview tier=odoo]            (census lines, Accept all, per-kind cards, unclear rows, "Sending 4 of 12")
  [ErpSendStates tier=odoo]                    (refused / held with "It is not there: send it again")
[Odoo ledger card]                             (unchanged)
```

**Tokens and primitives:** `text-sm` body, `text-muted-foreground` hints, `font-semibold text-foreground` headings (`h4`, matching the checklist and Map once), `Button size="sm" variant="outline"` for step actions (the checklist's existing pattern; the one filled primary stays the dialog's confirm), `StatusPill variant="progress"` / `"warn"` as `ErpSendStates` already uses, `ConfirmDialog tone="default"` (employ can be handed back, so it is not destructive), `tabular-nums` on every count, `min-w-0` + `break-words` on every name. No new tokens, no new colours.

**States, per block:**

| Block | Loading | Empty | Error | Partial | Done |
|---|---|---|---|---|---|
| Plan choice | `ListState variant="loading" rows={1}` | no plans: plain line (copy `planNone`) | `ListState variant="error"` + Retry (`refetch`) | n/a | renders nothing once `planId` is set |
| Record review | the panel's own "Reading records from your connected system…" (`ConnectProposalReview.tsx:389`) | "Nothing to set up" | "Could not read records" + Try again | per-kind "Needs a decision" + "Sending x of y" | "All records connected" |
| Send states | renders nothing until status reads | renders nothing | renders nothing (never a wrong number, `ErpSendStates.tsx:13`) | waiting count + refused/held rows | renders nothing |
| Employ step | button `loading` while the call runs | n/a | `role="alert"` line with `odooErrorMessage` copy, under the button | button disabled + `waitSends` hint while `waitingForSend > 0` | step shows Done, button gone |
| Sends finished step | To do while status is unread | Done when the run finished with nothing to send | To do (status unread is never Done) | To do while anything waits or needs a person | Done |

**Accessibility:** the review section is a landmark with an accessible name (`aria-label`); step names stay the `<li aria-label>` the checklist uses (the e2e reads them); the employ confirm is `ConfirmDialog` (focus trap + restore); errors use `role="alert"`, progress uses `role="status"` (already in `ErpSendStates`). All controls are reached by keyboard in DOM order.

---

## 3. Copy (en + id)

All keys live in `public/locales/{en,id}/administration.json` under `odoo` (new subtrees `records`, `send`, `employ`; new leaves in `checklist`, `error`). Use the code's default string as the English value.

| Key (`administration:odoo.…`) | en | id |
|---|---|---|
| `records.title` | Records in PMO and Odoo | Data di PMO dan Odoo |
| `records.planTitle` | Project cost accounts | Akun biaya proyek |
| `records.planIntro` | Choose the Odoo analytic plan that holds one account per project. PMO sends each project there. This is done once. | Pilih rencana analitik Odoo yang memuat satu akun untuk setiap proyek. PMO mengirim setiap proyek ke sana. Ini dilakukan sekali. |
| `records.planProposed` | Proposed: {{name}} | Diusulkan: {{name}} |
| `records.planUseNamed` | Use {{name}} | Pakai {{name}} |
| `records.planNone` | Odoo has no analytic plan yet. Add one in Odoo, then check again. | Odoo belum punya rencana analitik. Tambahkan di Odoo, lalu periksa lagi. |
| `records.planLoadFailed` | The analytic plans could not be loaded | Rencana analitik tidak dapat dimuat |
| `send.title` | Records going to Odoo | Data yang sedang dikirim ke Odoo |
| `send.sending` | Sending to Odoo | Mengirim ke Odoo |
| `send.waiting` | {{count}} waiting for Odoo to confirm. | {{count}} menunggu konfirmasi Odoo. |
| `send.addPeople` | Add these people in Odoo. PMO does not send people to Odoo yet. | Tambahkan orang-orang ini di Odoo. PMO belum mengirim data orang ke Odoo. |
| `checklist.procurement` | Purchases go to Odoo | Pembelian dicatat di Odoo |
| `checklist.procurementHint` | After this, approved purchase orders, goods receipts and supplier bills are also created in Odoo. | Setelah ini, pesanan pembelian, penerimaan barang, dan tagihan pemasok yang disetujui juga dibuat di Odoo. |
| `employ.companiesAction` | Let Odoo manage vendors and clients | Biarkan Odoo mengelola vendor dan klien |
| `employ.companiesTitle` | Let Odoo manage vendors and clients? | Biarkan Odoo mengelola vendor dan klien? |
| `employ.companiesBody` | From now on, Odoo holds your vendor and client records. New vendors and clients, and changes to names and tax numbers, are saved in Odoo through PMO's forms. | Mulai sekarang, Odoo menyimpan data vendor dan klien Anda. Vendor dan klien baru, serta perubahan nama dan NPWP, disimpan di Odoo melalui formulir PMO. |
| `employ.companiesConfirm` | Let Odoo manage them | Biarkan Odoo mengelola |
| `employ.procurementAction` | Send purchases to Odoo | Kirim pembelian ke Odoo |
| `employ.procurementTitle` | Send purchases to Odoo? | Kirim pembelian ke Odoo? |
| `employ.procurementBody` | From now on, approved purchase orders, goods receipts and supplier bills are also created in Odoo. | Mulai sekarang, pesanan pembelian, penerimaan barang, dan tagihan pemasok yang disetujui juga dibuat di Odoo. |
| `employ.procurementConfirm` | Send purchases | Kirim pembelian |
| `employ.waitSends` | Wait until every record has reached Odoo. | Tunggu sampai semua data sampai di Odoo. |
| `error.sendsPending` | Some records are still on their way to Odoo. Try again when they have arrived. | Beberapa data masih dalam perjalanan ke Odoo. Coba lagi setelah semuanya sampai. |
| `error.configRejected` | Odoo is missing something this needs. Check the connection again, then try again. | Odoo belum memiliki sesuatu yang diperlukan. Periksa koneksi lagi, lalu coba lagi. |
| `error.featureOff` | Connecting an accounting system is not turned on for your organization. | Koneksi sistem akuntansi belum diaktifkan untuk organisasi Anda. |

Reused unchanged: `administration:odoo.projectLink.plan` ("Analytic plan" / "Rencana analitik"), `administration:odoo.projectLink.usePlan` ("Use this plan" / "Pakai rencana ini"), `administration:odoo.mapOnce.choose`, `administration:odoo.projectLink.retry`, `administration:odoo.checklist.employ` / `employHint`, every `integrations.connect.*` and `integrations.send.{needsDecision,retry,retryFailed,unnamed}` key (already en+id).

---

## 4. Slice 1 tasks (2–5 min each, in order)

**Gate rules for this build (owner override 2026-11-09):** do **not** run vitest, e2e, pgTAP, typecheck, build or ux-proof. TDD still binds: write each failing test first, then the code, and reason through both carefully. Allowed and required before the push: `cd pmo-portal && npm run check:guards` and `npx eslint --max-warnings=0 <touched files>`. CI is the test gate. No migration, no edge-function change, no SQL in slice 1.

### T0. Branch (2 min)
From `origin/dev`: `git checkout -b feat/2050-odoo-setup-screens`. If `pmo-portal/e2e/AC-ODC-080-odoo-setup-journey.spec.ts` is still absent on `origin/dev`, ask the Director (orca ask) whether to `git merge --no-ff origin/test/1504-s10` first. Until the answer comes, do T1–T9 (they do not depend on it).

### T1. Error codes → plain copy (AC-ODS-008) (4 min)
- **Test first:** `pmo-portal/src/components/integrations/odoo/odooErrors.test.ts` (new). A minimal `t` stub `(k, d) => d`; cases: `new AppError('Some records are still being sent…', 'sends-pending')` → `'Some records are still on their way to Odoo. Try again when they have arrived.'`; `'config-rejected'` → the `configRejected` line; `'feature_off'` → the `featureOff` line; for each, the result does **not** contain the server message passed in. Title each `it` with `AC-ODS-008`.
- **Code:** `odoo/odooErrors.ts`: add the three entries to `m` (`'sends-pending'`, `'config-rejected'`, `feature_off`) with the §3 keys.

### T2. One connect-status hook and one employ hook (4 min)
`src/hooks/useOdoo.ts`, append:
```ts
/** The shared setup run for Odoo (census, waiting sends, proposal counts). Same key as the review panel and the send states, so they share one read. */
export function useOdooConnectStatus(enabled = true) {
  return useQuery({ queryKey: ['integrations', 'connect-status', 'odoo'], queryFn: () => repositories.integrations.getConnectStatus('odoo'), enabled, retry: false });
}
/** Hand a domain to Odoo (`employ-domain`); refreshes ownership so the checklist step turns Done. */
export function useOdooEmploy() { /* useMutation: repositories.odoo.setup('employ-domain', { domain }); onSuccess invalidates ['odoo'], externalDomainOwnershipKey(orgId), ['integrations','health',orgId], ['integrations','bindings',orgId] */ }
```
Import `externalDomainOwnershipKey` from `./approvalsQueryKeys`. No separate test: T7–T9 own the behaviour through the components.

### T3. `ErpSendStates` takes a tier (AC-ODS-003), test first (5 min)
- **Test first:** append to `src/components/integrations/ErpSendStates.test.tsx` a `describe('AC-ODS-003 Odoo send states')`: render `<ErpSendStates enabled tier="odoo" />` with `answer(3, [proposal({ id: 'h1', reason: 'held', snapshot: { name: 'PT Sinar Baja' }, reason_text: 'x' })])` → `getConnectStatus` called with `'odoo'`; `listConnectProposals` called with `'odoo'` first; text `'Sending to Odoo'` and `/3 waiting for Odoo to confirm/` shown; clicking `'It is not there: send it again'` calls `retryConnectSend('odoo', 'h1')`. Existing ERPNext cases stay **unchanged** and must still pass (they render without `tier`).
- **Code:** `ErpSendStates.tsx`: signature `({ enabled, tier = 'erpnext' }: { enabled: boolean; tier?: ConnectTier })`; replace the `TIER` constant with `tier` in the three query keys / calls and the retry mutation; for the four system-naming lines (`title`, `sending`, `waiting`, `addPeople`) pick the key by tier:
  ```ts
  const sys = (k: 'title' | 'sending' | 'waiting' | 'addPeople') => (tier === 'odoo' ? `administration:odoo.send.${k}` : `administration:integrations.send.${k}`);
  ```
  with the Odoo defaults from §3 when `tier === 'odoo'` and the current ERPNext defaults otherwise. Update the doc comment's first line to say "the connected ERP (ERPNext or Odoo)".

### T4. `OdooRecordsSetup` shell + role gate (AC-ODS-001), test first (5 min)
- **Test first:** `src/components/integrations/odoo/OdooRecordsSetup.test.tsx` (new). Mock `@/src/hooks/useOdoo` (`useOdooConnection`, `useOdooProjectLinks`, `useOdooSetup`), `./useOdooCan`, and stub the two children so this suite owns only composition: `vi.mock('../ConnectProposalReview', () => ({ ConnectProposalReview: (p: { tier: string }) => <div data-testid="review" data-tier={p.tier} /> }))`, same for `../ErpSendStates` (`data-testid="sends"`). Cases (titles start `AC-ODS-001`):
  1. Admin (`manage: true`), connection `{status:'active', activated:true}`, `planId: 7` → `review` and `sends` render with `data-tier="odoo"`, inside `getByRole('region', { name: 'Records in PMO and Odoo' })`.
  2. Not activated → renders nothing (`container` empty). Status `'disconnected'` → nothing.
  3. Finance / Engineer / view-as Admin (`manage: false`) → nothing.
- **Code:** `src/components/integrations/odoo/OdooRecordsSetup.tsx` (new):
  ```tsx
  export function OdooRecordsSetup() {
    const { t } = useTranslation();
    const may = useOdooCan();
    const read = useOdooConnection().data;
    if (!may.manage || read?.status !== 'active' || !read.activated) return null;
    return (
      <section aria-label={t('administration:odoo.records.title', 'Records in PMO and Odoo')} className="mt-3 space-y-4" data-testid="odoo-records-setup">
        <OdooPlanChoice />
        <ConnectProposalReview tier="odoo" />
        <ul className="text-sm"><ErpSendStates enabled tier="odoo" /></ul>
      </section>
    );
  }
  ```
  (`ErpSendStates` renders an `<li>`, so it sits in a `<ul>`.) Doc comment: one line naming #2050 and the owner rule.

### T5. Plan choice inside setup (AC-ODS-004), test first (5 min)
- **Test first** (same file, titles `AC-ODS-004`); `useOdooProjectLinks` mocked per case, `useOdooSetup` returns `{ mutateAsync: h.setPlan, isPending: false }`, `repositories.integrations.startConnectCensus` mocked (`vi.mock('@/src/lib/repositories', …)`), and the suite wraps renders in a `QueryClientProvider`:
  1. `{ planId: null, plans: [{ id: '3', name: 'Projects' }] }` → `'Proposed: Projects'`; click `'Use Projects'` → `h.setPlan` called with `{ planId: '3' }`, then `startConnectCensus` called with `'odoo'` (re-reads projects now that they can be sent).
  2. two plans → a select labelled `'Analytic plan'` and `'Use this plan'` disabled until one is picked; picking `'5'` and clicking → `{ planId: '5' }`.
  3. `{ planId: null, plans: [] }` → `'Odoo has no analytic plan yet. Add one in Odoo, then check again.'`, no button.
  4. `{ planId: 7, … }` → no plan block (`queryByText('Project cost accounts')` null).
  5. `mutateAsync` rejects with `AppError('…', 'FORBIDDEN')` → `role="alert"` with `'Your role cannot do this.'`; `startConnectCensus` not called.
  6. links query error → `'The analytic plans could not be loaded'` + `'Retry'` calls `refetch`.
- **Code:** `OdooPlanChoice` as a function in `OdooRecordsSetup.tsx` (not exported). Reads `useOdooProjectLinks()`; `useOdooSetup('set-analytic-plan')`; `useQueryClient()`. On success: `await repositories.integrations.startConnectCensus('odoo')`, then invalidate `['integrations','connect-status','odoo']` and `['integrations','connect-proposals','odoo']`. Errors through `odooErrorMessage`. Heading `h4` `records.planTitle`, intro `records.planIntro`, `SelectField` with `administration:odoo.projectLink.plan` and `placeholder` `administration:odoo.mapOnce.choose`. One plan: `records.planProposed` + `Button` `records.planUseNamed`. Several: select + `administration:odoo.projectLink.usePlan`.

### T6. Mount in the Odoo section + sibling test (3 min)
- `odoo/OdooIntegrationSection.tsx`: render `<OdooRecordsSetup />` after the `OdooMapOnce` line, before the ledger. It gates itself (T4), so no condition at the call site.
- `odoo/OdooRoleControls.test.tsx` mocks `@/src/lib/repositories` with `integrations: {}` (line 14), so the real section would now call missing functions. Add `vi.mock('./OdooRecordsSetup', () => ({ OdooRecordsSetup: () => null }))` next to the existing mocks; the gate is owned by T4's suite. No assertion in that file changes.
- `grep -rn "OdooIntegrationSection\|ErpSendStates" pmo-portal/src pmo-portal/pages pmo-portal/test` and confirm no other suite renders the real section without the stub (`test/setup.ts:28` stubs it for the Integrations view suites).

### T7. Employ vendors and clients (AC-ODS-005), test first (5 min)
- **Test first:** `odoo/OdooSetupChecklist.test.tsx`. Extend the `vi.mock('@/src/hooks/useOdoo', …)` factory with `useOdooConnectStatus: () => h.status` and `useOdooEmploy: () => ({ mutateAsync: h.employ, isPending: false })`; extend `h` with `status: { data: { run: { id: 'r', state: 'ready', finished_at: null, error_class: null }, census: [], waitingForSend: 0, proposalCounts: {} } }`, `employ: vi.fn()`, and `can: { setValue: true, manage: true }`. Cases (titles `AC-ODS-005`):
  1. Admin, not employed → the step `'Vendors and clients managed in Odoo'` holds a button `'Let Odoo manage vendors and clients'`; click → dialog `'Let Odoo manage vendors and clients?'` with the body text; confirm `'Let Odoo manage them'` → `h.employ` called with `'companies'`.
  2. `waitingForSend: 2` → the button is disabled and `'Wait until every record has reached Odoo.'` shows.
  3. `h.employ` rejects with `AppError('Some records are still being sent', 'sends-pending')` → `role="alert"` with the `sendsPending` copy; the server text is absent.
  4. `manage: false` (Finance) → no button; step still shows To do.
  5. already employed (`h.owned.data = [{ externalTier: 'odoo', domain: 'companies' }]`) → Done, no button.
- **Code:** `OdooSetupChecklist.tsx`: a local `EmployAction({ domain, waiting }: { domain: 'companies' | 'procurement'; waiting: boolean })` with `useOdooEmploy()`, `useState` for `open` and `error`, `ConfirmDialog` (`tone="default"`, `loading={employ.isPending}`), `Button size="sm" variant="outline"`; on confirm `await employ.mutateAsync(domain)`, close, or set `error` from `odooErrorMessage`. In `OdooSetupChecklist`, read `useOdooCan().manage` and `useOdooConnectStatus(active && read.activated).data` (hooks before the early `return null`, as `proposal` is today). Attach `extra: manage && !employedCompanies ? <EmployAction domain="companies" waiting={waiting > 0} /> : undefined` to the employ step.

### T8. Purchases step (AC-ODS-006), test first (4 min)
- **Test first** (same file): update the **first** test's expected step list to append `'Purchases go to Odoo'` (a deliberate UX change: one new step). New cases (titles `AC-ODS-006`): Admin, not employed → `'Send purchases to Odoo'` → dialog `'Send purchases to Odoo?'` → confirm `'Send purchases'` → `h.employ` called with `'procurement'`; owned `{ externalTier:'odoo', domain:'procurement' }` → Done, no button; `h.employ` rejects with `'config-rejected'` → the `configRejected` copy.
- **Code:** append the step `{ name: checklist.procurement, done: owned procurement, hint: checklist.procurementHint, extra: manage && !done ? <EmployAction domain="procurement" waiting={false} /> : undefined }`. Purchases do not wait for sends (the server's wait rule is for partners only).

### T9. "Sends finished" from send state (AC-ODS-007, closes #2053), test first (4 min)
- **Test first** (same file, titles `AC-ODS-007`): Done when `run.state === 'ready'`, `waitingForSend === 0` and every `proposalCounts[k]` has `send === 0` and `review === 0`. To do when: `run` is `null`; `waitingForSend: 1`; `proposalCounts: { party: { link:0, bring_in:0, send:2, review:0, applied_link:0 } }`; `review: 1`; `h.status.data` undefined (unread is never Done). Done also when `sends_finished_at` is set (existing case in the second test stays as is).
- **Code:**
  ```ts
  const sendsDone = Boolean(cfg[SENDS_FINISHED_KEY]) || Boolean(status && status.run?.state === 'ready' && status.waitingForSend === 0
    && Object.values(status.proposalCounts ?? {}).every((c) => c.send === 0 && c.review === 0));
  ```
  Review rows count as not finished on purpose: a refused or held send comes back as a review row, and the step must never say Done while something needs a person.

### T10. Copy in both languages (4 min)
Add every §3 key to `public/locales/en/administration.json` and `public/locales/id/administration.json` in the same nesting (`odoo.records.*`, `odoo.send.*`, `odoo.employ.*`, `odoo.checklist.procurement*`, `odoo.error.{sendsPending,configRejected,featureOff}`). Then `cd pmo-portal && npm run check:guards` (includes the i18n completeness and namespace checks); paste its output body.

### T11. Curated journey through the screens (AC-ODC-080), 5 min
Only after T0's dependency is settled (the spec file is on your branch). Edit `pmo-portal/e2e/AC-ODC-080-odoo-setup-journey.spec.ts`. Keep its gate, fixtures, cleanup and **goal oracle unchanged** (checklist steps Done after a fresh sign-in; the project linked to the one bed account carrying its code). Replace each `setup(token, …)` step with the user's clicks:
1. `set-analytic-plan` → inside `getByTestId('odoo-records-setup')`: click `Use <plan name>` if shown, else pick the plan in `Analytic plan` and click `Use this plan`.
2. `census` + `connect-status` polling → `await sweep()` between reloads until `getByTestId('connect-kind-project')` shows `/will be sent/` (the census line, `integrations.connect.censusSendPart`). Use `sweepUntil` with a reader that reloads the page and reads that text.
3. `accept-proposals` → `getByTestId('connect-proposal-review')`'s header `Accept all` (first match) → the dialog's `Accept all`.
4. `decide-review … dismiss` → while `getByTestId('connect-kind-party')` shows `Needs a decision`: `Review list` → per open row `Change` → choose `Dismiss`. (Expected zero rows once #2049 ships; the loop then does nothing.)
5. drain → keep the existing `sweepUntil` on the bed account count; add the UI read: the "Sending x of y" line is gone.
6. `employ-domain companies` → the checklist's `Let Odoo manage vendors and clients` → `Let Odoo manage them`; expect the step to show Done.
Update the header comment: delete the "no census/accept/send/employ screen yet" line. Keep the skip-allowlist entry as it is (`scripts/check-e2e-skips.mjs`; bump `verified` only after a real bed run). Run nothing; the Director runs it on the bed (`scripts/with-odoo-lock.sh scripts/with-db-lock.sh scripts/serve-functions.sh -- scripts/e2e-local.sh AC-ODC-080`).

### T12. Final gate and push (3 min)
`cd pmo-portal && npm run check:guards && npx eslint --max-warnings=0 src/components/integrations/odoo/OdooRecordsSetup.tsx src/components/integrations/odoo/OdooRecordsSetup.test.tsx src/components/integrations/odoo/OdooSetupChecklist.tsx src/components/integrations/odoo/OdooSetupChecklist.test.tsx src/components/integrations/odoo/OdooIntegrationSection.tsx src/components/integrations/odoo/OdooRoleControls.test.tsx src/components/integrations/odoo/odooErrors.ts src/components/integrations/odoo/odooErrors.test.ts src/components/integrations/ErpSendStates.tsx src/components/integrations/ErpSendStates.test.tsx src/hooks/useOdoo.ts e2e/AC-ODC-080-odoo-setup-journey.spec.ts`. Check `git log --format=%B origin/dev..HEAD | grep -qi co-authored` finds nothing; `git push -u origin feat/2050-odoo-setup-screens`. No PR.

**Review after build (Director):** spec-reviewer + code-quality-reviewer; security-auditor confirms quickly that no auth/RLS/RPC changed (UI only; every write is an existing role-gated verb). UI lane: one rendered review of the Odoo section in every state of §2 on the bed, owner judges the screenshots.

---

## 5. Traceability (one owning test per AC)

| AC | Given / When / Then | Owning test | Layer | Task |
|---|---|---|---|---|
| AC-ODS-001 | Given an activated Odoo connection, when an Admin opens Integrations, then the record review and send states for Odoo are shown; Finance, other roles, view-as, an unactivated or a broken connection show neither. | `odoo/OdooRecordsSetup.test.tsx` | U | T4 |
| AC-ODS-002 | Given tier `odoo`, when the Admin opens the review and clicks Accept all, then the census and accept go to Odoo's setup run and the one confirm states the counts. | `ConnectProposalReview` is tier-param and its suite owns FR-ECA-001/012 (`ConnectProposalReview.test.tsx:83,185,969`); Odoo routing is owned by AC-ODS-001 (tier prop) + the shared verb suite (`external-set-company` connect tests). No new test. | U | T4 |
| AC-ODS-003 | Given Odoo sends waiting or held, when the Admin views setup, then "Sending to Odoo", the waiting count and the held row with its retry are shown, and retry goes to Odoo. | `ErpSendStates.test.tsx` (AC-ODS-003 block) | U | T3 |
| AC-ODS-004 | Given no analytic plan chosen, when the Admin uses the proposed plan (or picks one), then it is saved once and the census re-reads so projects can be sent; no plan in Odoo says so; a refusal says why. | `odoo/OdooRecordsSetup.test.tsx` | U | T5 |
| AC-ODS-005 | Given sends finished, when the Admin confirms "Let Odoo manage vendors and clients", then companies are employed and the step shows Done; while sends wait the action is disabled with a reason; a refusal shows plain words; non-Admins see no action. | `odoo/OdooSetupChecklist.test.tsx` | U | T7 |
| AC-ODS-006 | Same for "Send purchases to Odoo" (`procurement`). | `odoo/OdooSetupChecklist.test.tsx` | U | T8 |
| AC-ODS-007 | Given a finished setup run with nothing waiting and nothing to decide, then "Sends finished" shows Done; any waiting send, open send or review row, or an unread status keeps it To do. | `odoo/OdooSetupChecklist.test.tsx` | U | T9 |
| AC-ODS-008 | Given the server refuses with `sends-pending`, `config-rejected` or `feature_off`, then the screen shows the localised line, never the server's English. | `odoo/odooErrors.test.ts` | U | T1 |
| AC-ODC-080 | Given a fresh org and the stock bed, when the Admin connects, maps once, chooses the plan, accepts all, dismisses the unclear partners and lets Odoo manage vendors and clients **through the screens**, then every checklist step is Done after a fresh sign-in and the pilot project is linked to the one bed account with its code. | `e2e/AC-ODC-080-odoo-setup-journey.spec.ts` (bed-gated, CI-skipped per allowlist) | E | T11 |

---

## 6. Slice 2 (later, not this build): create one project's cost account from the project page

FR-ODC-072 / AC-ODC-052 for projects created **after** setup (setup itself sends projects through Accept all, slice 1).
- **Server:** exactly `docs/plans/2026-11-07-odoo-master-data.md` S8-T10 (`send-project {projectId}` verb in `external-set-company/odoo/projectLinks.ts` + router entry, gate = the link actor check, one outbox row keyed `seed:project:<id>`, probe before create, held on an inconclusive probe, 503 `odoo-unavailable` with no outbox row) and S8-T11 (bed test). Do not write a second plan for it.
- **UI** (after the verb is on dev): in `pages/project-detail/ProjectOdooLink.tsx`, in the "plan set, not linked" branch (`:70-74`), add `Button size="sm" variant="outline"` "Create in Odoo" (`administration:odoo.projectLink.create` / id "Buat di Odoo") next to Link, calling `useOdooSetup('send-project')` with `{ projectId }`. States: loading on the button; `{state:'held'}` → `StatusPill warn` + `administration:odoo.projectLink.held` ("We could not confirm whether Odoo created this account. Check Odoo, then try again." / "Kami tidak dapat memastikan apakah Odoo sudah membuat akun ini. Periksa Odoo, lalu coba lagi."); success → the linked branch renders from the refreshed `list-projects`; 503 → `administration:odoo.error.unreachable`. Test in `ProjectOdooLink.test.tsx`: Admin and the project's PM see the button, another PM does not; a double click calls the verb once (button `loading`); held shows the held line.
- **Executor:** Director-dispatched (outbox write), ships alone, all three reviewers.

---

## 7. Risks for the builder

- **Hidden sibling mocks.** `OdooRoleControls.test.tsx` and `OdooSetupChecklist.test.tsx` mock modules this build changes (T6, T7). `grep -rn "vi.mock('@/src/hooks/useOdoo'" pmo-portal/src pmo-portal/pages` before you finish: every factory that a changed component now calls into (`useOdooConnectStatus`, `useOdooEmploy`) must provide them, or that suite crashes in CI. `ProjectOdooLink.test.tsx` mocks `useOdoo` too but renders nothing changed here.
- **ERPNext must not move.** `ErpSendStates` defaults to `erpnext`; its existing tests are the proof and must not be edited.
- **Census for Finance.** The review is Admin-only (D2). Do not widen it: Finance's unfiltered `list-proposals` is refused by the server.
- **No local test runs (owner override).** Reason through each red → green by reading the component and the mock; CI is the first run. Never claim a test passes.
- **Bed facts the screen will show until other issues ship:** inflated Odoo partner counts (#2048) and two login-partner review rows (#2049). They are not this build's bugs; do not filter them in the UI.
