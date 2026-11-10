# Odoo 20 dev bed: verification of the #1504 research claims (2026-10-31)

Prerequisite for [#1504](https://github.com/ariefsaid/PMO/issues/1504). Every API claim in
`2026-10-30-odoo20-api.md` and every coverage claim in `2026-10-30-odoo20-native-coverage.md` that the
adapter depends on, run against a live stock **Odoo Community 20.0** (`odoo:20.0`, server `20.0-20261015`;
the Docker Hub tag `20.0` exists; no custom modules). Bed and commands: `docs/environments.md`, "Odoo 20
Community dev bed". Reproduce with `node scripts/odoo-probe.mjs` (claim, status, response shape, verdict; no
values, no credentials). Responses below are shapes, never data.

Bed for the run: demo data off; modules `purchase stock account project analytic hr_timesheet fleet maintenance`
plus `l10n_id`; `--workers=0`. The API user is a bot in the manager groups of those apps plus HR manager.
Verdicts: **verified**, **wrong** (the doc differs from the instance), **not testable** (here).

## Summary: what the adapter must change

| # | Doc claim | Reality on the bed |
|---|---|---|
| 1 | Project carries `analytic_account_id` | **wrong name.** The field is `project.project.account_id` (many2one to `account.analytic.account`) |
| 2 | Confirm a PO with `action_confirm` | **wrong.** `purchase.order/action_confirm` returns 404; use `button_confirm` |
| 3 | Employee cost field `timesheet_cost` | **wrong name.** It is `hr.employee.hourly_cost`, and only readable with HR rights |
| 4 | API keys expire within 3 months at most | **wrong for an admin-group user.** `expiration_date: null` mints a non-expiring key. The cap is per user group; not testable for a non-admin bot |
| 5 | Webhook body `{_id,_model,...fields}` | **verified**, plus an `_action` key, and **several deliveries for one create**, so the receiver must be idempotent |
| 6 | `base_automation` needs no custom module | **verified**, but it ships **uninstalled** and must be installed once per database |
| 7 | Timesheets need no setup | **gotcha.** Creating one without an active `hr.employee` linked to the calling user fails with 422 |
| 8 | `l10n_id_efaktur` (CSV) exists | **wrong for v20.** Only `l10n_id_efaktur_coretax` is on disk (installed as a dependency of `l10n_id`) |

Everything else the adapter needs checked out. Details follow.

## 1. JSON-2 protocol and auth

| Claim | Call | Result |
|---|---|---|
| `POST /json/2/{model}/{method}` with `Authorization: bearer <key>` returns 200 + JSON | `res.partner/search_read {domain,fields,limit}` | **verified.** 200, `[{id,name,email,vat,write_date}]` |
| Bad key rejected | same, key `invalid` | **verified.** 401 |
| Missing Authorization rejected | same, no header | **verified.** 401 |
| `X-Odoo-Database` needed with several DBs | same, header omitted | **not testable.** Optional here because the bed pins one db (`--database`, `--no-database-list`). Send it anyway |
| Errors are 4xx/5xx JSON with `name,message,arguments,context,debug` | `res.partner/no_such_method` | **verified.** 404, `{name:string, message:string, arguments:[string,string], timestamp:number, context:{}, debug:string}` (`timestamp` is extra) |
| `create` takes a list | `res.partner/create {vals_list:[{name}]}` | **verified.** 200, `[id]` |
| `write` | `res.partner/write {ids,vals}` | **verified.** 200, `true` |
| Record methods take `ids` | `purchase.order/button_confirm {ids}` | **verified** |
| One SQL transaction per HTTP call | n/a | **not testable.** No failing multi-call scenario was run |
| Legacy `/jsonrpc` and `/xmlrpc/2` still work in 20 | n/a | **not testable.** Not exercised |

## 2. API keys (`res.users.apikeys`)

| Claim | Call | Result |
|---|---|---|
| `generate(key, scope, name, expiration_date)` mints a key with an existing own key | `res.users.apikeys/generate {key:<own key>, scope:"rpc", name, expiration_date:"YYYY-MM-DD HH:MM:SS"}` | **verified.** 200; the response is the **bare key string** (40 chars, shown once) |
| `key` must be the caller's own key | same with `key:"invalid"` | **verified.** 403 `AccessDenied` |
| `revoke(key)` invalidates it | `res.users.apikeys/revoke {key}` | **verified.** 200; the revoked key then gets 401 |
| Maximum lifetime 3 months | `generate ... expiration_date:null` | **wrong (admin-group bot).** 200, non-expiring key |
| Fields `name, user_id, scope, expiration_date` | `res.users.apikeys/fields_get` | **verified** |
| Bot user with an empty password can authenticate by key | bed bot made via `odoo shell` with `no_reset_password` | **verified.** Key auth works with no password set |

Adapter guidance: rotate anyway (the cap applies to non-admin groups). Store the key from `generate`'s return
value, then `revoke` the old one.

## 3. Change detection (`write_date` sweep)

| Claim | Call | Result |
|---|---|---|
| Every needed model has `write_date` | `fields_get` on the 13 models in section 4 | **verified** (all 13) |
| `write_date > watermark`, `order:"write_date asc, id asc"` returns new rows | `res.partner/search_read {domain:[["write_date",">",mark]], fields:["id","write_date","name"], order:"write_date asc, id asc", limit:100}` | **verified.** 200, the new partner returned |
| `write_date` is a naive UTC `YYYY-MM-DD HH:MM:SS` string | read of `write_date` | **verified** (regex match) |
| An update bumps `write_date` | `write`, then read | **verified** |
| A delete is invisible to the sweep | `unlink`, then `search_read` with `active_test:false` | **verified.** The row is gone with no tombstone. Deletions need the webhook or an id reconcile |

## 4. Models and fields the adapter reads

All via `fields_get` and `search_read`; all returned 200.

| Model | Verdict | Fields confirmed |
|---|---|---|
| `res.partner` | verified | `name, email, vat, write_date` |
| `product.product` | verified | `name, uom_id ([id,name]), standard_price, type` |
| `uom.uom` | verified | v20 names: `name, relative_factor (number), relative_uom_id ([id,name])` |
| `account.analytic.account` | verified | `name, plan_id ([id,name]), code` |
| `account.analytic.plan` | verified | readable |
| `stock.warehouse` | verified | `name, code, lot_stock_id, view_location_id` |
| `stock.location` | verified | `complete_name, usage, location_id` (false at a root) |
| `account.account` | verified | `code, name, account_type` |
| `account.move` | verified | `name, move_type, state, write_date` |
| `purchase.order`, `purchase.order.line` | verified | line has `analytic_distribution` |
| `project.project` | verified | `account_id` (see summary row 1) |
| `stock.move` | verified | exists, has **no** `analytic_distribution` |
| `stock.picking` | verified | readable |

## 5. Analytic chain (api doc, section 2.5)

| Claim | Call | Result |
|---|---|---|
| A new project gets an analytic account | `project.project/create`, then `read {fields:["account_id"]}` | **verified.** `account_id: [id, name]` |
| The field is called `analytic_account_id` | `read {fields:["analytic_account_id"]}` | **wrong.** 500 invalid field; the name is `account_id` |
| A PO line takes `analytic_distribution: {"<id>": 100}` | `purchase.order/create` with a line carrying it | **verified.** 200; the key is a **string** id, the value a number |
| PO to vendor bill via `action_create_invoice`; the bill line inherits the distribution | `purchase.order/action_create_invoice {ids}`, then `account.move.line/search_read` | **verified.** 200; `analytic_distribution` copied as `{"<id>": 100}` |
| A timesheet is an `account.analytic.line` on the project account with `unit_amount` hours | `account.analytic.line/create {project_id,task_id,unit_amount}`, then read | **verified** once an employee exists (200; `account_id` is the project account; `amount` numeric). Without one: **422** "Timesheets must be created with an active employee" |
| Employee cost field `timesheet_cost` | `hr.employee/fields_get` | **wrong name.** `hourly_cost`; hidden from a user without HR rights |

## 6. Change feed: webhooks (`base_automation`)

Run by hand with a throwaway listener on the host (`http://host.docker.internal:<port>/hook`); the probe does
not repeat it because it needs a listener.

| Claim | Call | Result |
|---|---|---|
| In Community with no custom code | `ir.module.module/search_read` | **verified.** Present, state `uninstalled`; `button_immediate_install` over JSON-2 returned 200 and installed it |
| Server action state `webhook` | `ir.actions.server/fields_get` | **verified.** The selection includes `webhook` |
| A rule on create/write POSTs JSON | create `ir.actions.server {state:"webhook", webhook_url, webhook_field_ids:[]}` and `base.automation {trigger:"on_create_or_write", action_server_ids}`, then create a partner | **verified.** `POST`, `application/json`, body `{"_action":"<name>(#id)","_id":<id>,"_model":"res.partner"}` (no fields selected) |
| One delivery per change | same | **wrong.** At least 4 deliveries for one create within 8 s. Dedupe on `_model,_id` and re-read the record |
| No retry queue | n/a | **not testable.** The listener never failed. Keep the sweep as the source of truth |

The bed leaves `base_automation` installed after this run.

## 7. Coverage claims from the native-coverage doc

| Claim | Result |
|---|---|
| `purchase stock account project analytic hr_timesheet fleet maintenance` install on Community | **verified.** All `installed` |
| `l10n_id` is in Community | **verified.** Installed |
| `l10n_id_efaktur` (CSV) and `l10n_id_efaktur_coretax` | **partly wrong.** Only `l10n_id_efaktur_coretax` is on disk (installed); `l10n_id_efaktur` is absent in v20 |
| Enterprise-only `account_budget`, `approvals`, `hr_payroll`, and OCA `stock_analytic` | **verified absent on disk** (`ir.module.module` lists none of them) |
| `stock.move` has no `analytic_distribution` (per-project issue gap) | **verified.** Absent |
| `fleet.vehicle`, `fleet.vehicle.odometer`, `maintenance.equipment`, `maintenance.request` | **verified.** All four readable. Behaviour (utilisation, trips) not exercised |
| Stock move validation posts project expense without analytic accounts | **not testable here.** Needs costed products and `stock_account` valuation set up; left for the #1504 test bench |
| Odoo Online 1 req/s cap and Custom-plan-only API | **not testable.** SaaS policy, not the Community image |
| Community has no rate limit | **not testable.** No load run |

## Notes for the adapter

- Use `button_confirm`, `account_id` (project) and `hourly_cost`; do not copy the research docs' names.
- Webhook receivers must be idempotent: dedupe on `_model,_id`, re-read the record, rely on the watermark sweep.
- Deletes show only through webhooks or an id reconcile.
- The service user needs an `hr.employee` row before it can write timesheets.

## 9. O2 findings

| Claim | Verdict | Evidence |
|---|---|---|
| V-OPP1 | **Verified.** | A tuple-based order confirmed to `purchase`; above the two-step threshold a purchase user obtained `to approve`, and `button_approve` completed the approval. |
| V-OPP2 | **Decision pending.** | Candidate fields survived the exercised transitions, matched `ilike`, and were API-editable by a second user. A second user saved order Source, pending-transfer Source, posted-bill narration, and payment Memo in the UI; the completed transfer's Source and Note appeared read-only. Bill purchase auto-completion rewrote `invoice_origin`. An external identifier survived each tested transaction step, but is a separate write and required the Access Rights administrator group; the normal user received an access error in the UI. See the candidate table below. |
| V-OPP3 | **Verified for the exercised flows.** | The confirmed order created one incoming transfer; the move's `quantity` held the done quantity. A complete lot-tracked receipt refused validation without a lot and completed after a lot was assigned. The partial result is recorded under V-OPP4. |
| V-OPP4 | **Completable.** | On a ten-unit incoming transfer with six units entered, `button_validate` returned a `stock.backorder.confirmation` action. Creating that wizard using the returned context and calling `process` completed the transfer and created a separate outstanding backorder. On an untracked transfer with no entered quantity, validation instead completed the full ordered quantity without a wizard. The probe checks the partial quantities and both resulting states. |
| V-OPP5 | **Verified.** | A directly created bill retained its PO-line link, analytic distribution and invoice origin; after posting, the linked line’s billed quantity advanced and the partially billed order remained `to invoice`. A second `action_post` returned 422. |
| V-OPP6 | **Partial.** | The stock Indonesian chart exposed purchase VAT but no PPh 23 or PPh 4(2) named tax. A separately configured synthetic -2% purchase tax, assigned to a liability account, combined with an 11% VAT tax on a 100 service line yielded untaxed 100, tax 9, total and residual 109, and tax lines +11 and -2. A second synthetic -2.5% tax also accepted a liability repartition account and was not price-included. These check configured shapes, not the absent stock PPh definitions. |
| V-OPP7 | **Verified.** | A supplier payment can be posted and reconciled through `account.move.line/reconcile`. A payment of 40 against 100 left a residual of 60 and state `partial`; a subsequent 61 cleared the bill and left 1 on the payment line. With an outstanding payment account, the stock bed showed `paid` with zero residual even while the payment remained unmatched to a bank statement; its Community implementation maps this state to `paid`. |
| V-OPP8 | **Verified.** | For each purchase model, 1,001 synthetic records were read once each using `(write_date, id)` keyset ordering at page sizes 200 and 1,000; all timestamps matched `YYYY-MM-DD HH:MM:SS`. Bill and payment queries included the proposed supplier filters. The probe removes its records afterwards. |
| V-OPP9 | **Verified for the exercised API calls.** | Adding a line succeeded and removing it returned 422. Reducing quantity below received or billed amounts succeeded, as did an edit after locking; the adapter must apply its own revision guard. |
| V-OPP10 | **Verified for the exercised calls.** | An internal user with Purchase User, Inventory User and Accounting Invoice groups completed the purchase-to-payment path, a partial backorder, lot creation, revision and directory reads. Removing each app group individually blocked an exercised operation. This is the smallest set tested on this bed, not a universal result for customized installations. |
| V-OPP11 | **Verified for exercised failures; payment-post ceiling.** | Validation failures on creation, confirmation, line removal, receipt validation, backorder processing, bill posting and reconciliation returned HTTP 422 with `name`, `message`, `arguments`, `timestamp`, `context`, and `debug` fields. A repeat manual payment post was accepted with a null response; no payment-post validation failure was observed for that stock method. The probe prints types only. |

### `ODOO_ANCHORS` candidate findings — pending decision

All tested visible fields are API-editable; the second user also saved the order Source, pending-transfer
Source, bill narration and payment Memo through the UI. The completed transfer's Source and Note appeared
read-only in that user's UI. Other onchanges and user roles were not exhaustively tested.

| Kind | Candidate verdict | Recommendation pending decision |
|---|---|---|
| Order | `origin` is a visible Source field; `note` is HTML terms text. Both survived the tested confirmation and matched `ilike`. | Neither should be reserved without a decision on preserving existing business content. An external identifier may supplement the primary anchor. |
| Transfer | `origin` is visible Source and Odoo populates it with the PO reference; `note` is HTML. Both survived validation and matched `ilike`. | Preserve the order reference and existing note; use an external identifier only as a supplement pending a primary-anchor decision. |
| Bill | `invoice_origin` is plain text but purchase auto-completion rewrites it. `narration` survived that onchange but is HTML terms text. | Preserve existing terms and order references; an external identifier may supplement the primary anchor pending a decision. |
| Payment | `memo` is plain text, survives posting/reconciliation and is UI-editable. | The signed payment flow already specifies `memo`; retain that recommendation subject to the same pending anchor decision. |
| All four | A stock `ir.model.data` external identifier with a safe name was created and searched, and survived the exercised document transitions. A normal UI user received an access error; JSON-2 read and create were denied until the Access Rights administrator group was added. | The identifier is a separate HTTP write after document creation, so an interruption between those writes leaves a document without it. It cannot by itself satisfy recovery after create; use it only as a supplement unless that gap is resolved. |

The `ODOO_ANCHORS` table remains pending a Director decision. Bill HTML values require HTML-aware extraction
before comparing a plain anchor, and inconclusive recovery must hold as required by the purchase spec.

## 10. O3 findings

Run: `scripts/with-odoo-lock.sh node scripts/odoo-probe.mjs --revenue` (2026-11-03) on a synthetic company with the stock Indonesian chart (`account.chart.template/try_loading`, code `id`; currency IDR, 2 decimals on this bed). Records are synthetic. Prints statuses, shapes and numbers only. The bed has no `sale` module installed (not needed: the invoice is created on `account.move` directly).

| Claim | Verdict | Evidence |
|---|---|---|
| V-OCI1 | **Verified; two refusals the spec must absorb.** | `account.move/create` (`out_invoice`) with `[0,0,{…}]` tuples then `action_post` returns `false` (HTTP 200); state `posted`, `name` assigned on post only (shape `INV/####/#####`, `false` in draft), `amount_total` 1110 for 1000 + 11%. **Tax ids:** omitted `tax_ids` applies the product's default tax (110); `[[6,0,[]]]` and `[[5,0,0]]` both give an explicit empty set (0); an explicit id replaces the default. A negative-price line beside a positive one posts (1000 − 200 = 800 + 88 tax). **A negative-total invoice does not post** (422 `UserError`, stays draft). **A zero-total invoice posts** and reads `payment_state = paid`, residual 0. |
| V-OCI2 | **No invisible anchor exists; external identifier recommended per model (see below).** | See the anchor table. |
| V-OCI3 | **Verified.** | A line-level `account_id` (an advance liability account) is honoured and read back after post; a product with its own income account posts to it; a product with none posts to the stock income account. |
| V-OCI4 | **Verified.** | `analytic_distribution` `{"<id>": 100}` on a +1000 and a −200 line survives post; analytic lines are generated with amounts −200 and +1000 (the negative line reverses). The bed's bot needed the analytic group to create a plan; a billing-group user can still create the invoice lines that carry a distribution (V-OCI14). |
| V-OCI5 | **Verified; naming trap.** | The stock Indonesian chart names the effective 11% sale tax **"12% (Non-Luxury Good)"** (amount 11) beside a "12%" tax (amount 12): select the org default tax by id, never by name or label. 1000 → untaxed 1000 / tax 110 / total 1110 / residual 1110; 1000.50 → 110.06 / 1110.56; 3 × 333.33 → untaxed 999.99, tax 110, total 1109.99; 12% on a reduced base 916.67 → tax 110, total 1026.67; two lines (1000 + 250.25) → tax 137.53, total 1387.78, one tax line; a price-included 11% tax (`price_include_override = tax_included`) on 1110 → untaxed 1000, tax 110. Tax lines are one per tax. |
| V-OCI6 | **Verified.** | A second `action_post` returns 422 (`UserError`, "must be in draft"); the invoice is unchanged. After post: `payment_state = not_paid`, residual = total. |
| V-OCI7 | **Verified.** | (a) Payment create (inbound, customer, journal, method line) + `action_post` + `account.move.line/reconcile` on the two receivable lines → invoice residual 0, `paid`. (b) The register wizard (`account.payment.register/create` then `action_create_payments`, context `active_model`/`active_ids`) → full: residual 0 `paid`; 400: residual 710 `partial`; the call returns an `ir.actions.act_window` dict with `res_id`. **A wizard amount above the residual is accepted** (2000 on 1110): the invoice closes `paid` and the excess stays on the payment (no error), so the over-receipt refusal is PMO's (FR-OCI-050). A second wizard on a paid invoice refuses (422). On this bed `in_payment` was not observed: with an outstanding-receipts account the invoice reads `paid` before bank reconciliation (as O2 found for bills). |
| V-OCI8 | **Verified (stock wizard).** | `payment_difference_handling = reconcile` with `writeoff_account_id` and `writeoff_label`: paying 1090 on 1110 posts the 20 difference to the tax-prepaid account (one line, balance +20) and the invoice closes (residual 0, `paid`). Not "unavailable"; AC-OCI-044b does not apply. |
| V-OCI9 | **Nothing numbered is exposed.** | `l10n_id_efaktur` (CSV, NSFP numbers) is absent in v20. `l10n_id_efaktur_coretax` (LGPL-3, Community) adds to `account.move` only: `l10n_id_kode_transaksi` (2-char code, set from the partner), `l10n_id_coretax_efaktur_available` (boolean), `l10n_id_coretax_document` (link, false until export), `…add_info_07/08`, `…facility_info_07/08`, `…custom_doc`, `…custom_doc_month_year`. **No tax-invoice number or status field exists, before or after export.** The research note's NSFP claim does not hold in v20. |
| V-OCI10 | **Verified (one stock call; it writes in Odoo).** | `account.move/download_efaktur` (public, no wizard) on a posted invoice returns `{type: "ir.actions.act_url", url}` (a session HTTP route, not a file). With mandatory data missing it returns 422 `ValidationError` naming the reasons in one message (company tax id, customer tax id and country, invoice draft or not a customer invoice or no tax; from source also: down-payment lines, an unabsorbed negative line, mixed companies). When it succeeds it **creates** an `l10n_id_efaktur_coretax.document` and an attachment and **sets `l10n_id_coretax_document` on the invoice**; a repeat call reuses the same document. Customer tax ids are validated on save for Indonesian partners (a leading zero is rejected at 16 digits). |
| V-OCI11 | **Verified.** | Attachment `application/xml`, binary, ~1.5 KB for one invoice; root element `TaxInvoiceBulk`. `ir.attachment/read` of `raw` returns an object `{filename, content (base64), size}` (not a string; `datas` does not exist in v20). The bot read it. See V-OCI14 for a minimal user. |
| V-OCI12 | **No.** | `account.move/action_invoice_print` and `ir.actions.report/render_qweb_pdf` return 404 (not callable over JSON-2); `ir.actions.report/_render_qweb_pdf` returns 403 (private). The PDF stays out of scope (OQ-OCI-12). |
| V-OCI13 | **Verified.** | `write_date` is `YYYY-MM-DD HH:MM:SS`. 1001 draft invoices (`move_type in (out_invoice, out_refund)`) and 1001 payments (`inbound`, `customer`) were read once each with `(write_date, id)` keyset at page sizes 200 and 1000; no gap or repeat. **Credit note:** `account.move.reversal/create` needs `journal_id` and `company_id` in the vals (JSON-2 does not default them: 422 otherwise), then `refund_moves` returns an act_window dict; the note is `out_refund`, draft, total = original, and `reversed_entry_id` points at the invoice. |
| V-OCI14 | **Verified for the exercised calls.** | 15-call battery (create with analytic lines, read, post, sweep read, register wizard, payment create/post, line reconcile, reversal, Coretax export, attachment read, external id create and search). **Billing (`account.group_account_invoice`) passes all but the two external-identifier calls (403).** Billing + Access Rights (`base.group_erp_manager`) passes all 15. Accountant (`account.group_account_user`) adds nothing over Billing for these calls. An internal user with no accounting group is refused (403). An API key for an internal-only user could not exceed one day (a `ValidationError` on key creation); the Billing user got a longer key, so key lifetime follows the group set. Smallest set tested on this bed, not a universal result. |
| V-OCI15 | **Verified for exercised failures.** | Every failure body has the six keys `name, message, arguments, timestamp, context, debug`; classify on `name`: `odoo.exceptions.UserError` (post without a partner, reversal of a draft, register wizard without ids, unlink of a posted invoice) and `ValidationError` (negative payment amount, Coretax prerequisites) are 422; `MissingError` (a partner id that does not exist) is 404; an unknown method is 404 (`werkzeug.exceptions.NotFound`); an access refusal is 403 (`AccessError`). `line reconcile` on a single line is a no-op (200). The probe prints the class name and key list only. |

### `ODOO_REVENUE_ANCHORS` candidate findings (C0-T2)

Tested on both `account.move` (invoice) and `account.payment`: written at create, read in draft, read after post, searched with `ilike`, and edited by a second (Billing) user after post. Form editability is read from the form view's `readonly` modifier.

| Model | Field | Survives create and post | `ilike` search | Second user edits after post | Prints / user-visible |
|---|---|---|---|---|---|
| invoice | `ref` | yes, exact | yes | yes (form editable) | **"Reference"** block: the client's PO. Reserved for FR-OCI-010. |
| invoice | `payment_reference` | yes, exact | yes | yes API; form read-only after post | **"Payment Communication"** on the invoice. |
| invoice | `invoice_origin` | yes, exact (no `sale` module on the bed) | yes | yes by API; model field is read-only, so the UI cannot edit it | **"Source"** on the printed invoice. Sale-order auto-complete rewrites it when a `sale` order is linked (O2 saw the purchase equivalent). |
| invoice | `narration` | yes (HTML-wrapped) | yes | yes (form editable) | "Terms and Conditions" block. |
| invoice | external identifier (`ir.model.data`) | yes | yes | needs Access Rights | not printed |
| payment | `memo` | yes, exact | yes | yes (form editable) | the payment's visible memo |
| payment | `payment_reference` | yes, exact | yes | not tested | visible on the payment |
| payment | external identifier (`ir.model.data`) | yes | yes | needs Access Rights | not printed |

**Verdict.** As for the purchase kinds (#1505), **no stock business field meets the "not user-visible" rule** for invoices or payments: `ref`, `payment_reference`, `narration` and `memo` are user-editable and shown; `invoice_origin` is the only API-writable text field the UI cannot edit, but it prints as "Source" on the client's invoice. Recommendation per model, for the Director's ruling:

- **Invoice:** the stock external identifier (`ir.model.data`, a safe `si_<uuid>` name) as the anchor, with the composite hold-on-doubt probe `move_type = out_invoice`, customer, `amount_total`, invoice date window (adopt only a unique match; zero or several after the window holds). `invoice_origin` is the one candidate that is written in the same call as the create (no gap) and cannot be edited in the UI; it is NOT recommended unless the owner accepts the key printing as "Source" on the client's invoice.
- **Payment:** the external identifier with the composite `payment_type = inbound`, `partner_type = customer`, customer, amount, date window, plus the reconciled invoice. `memo` stays a human-readable convenience (the signed receipt flow uses it), never trusted alone.
- The external identifier is a separate write after the document is created and needs the service user to hold Access Rights (V-OCI14); a crash between the two leaves a document without it, which is exactly the case the composite probe and the hold rule cover.

## 11. O4 findings

Run: `scripts/with-odoo-lock.sh node scripts/odoo-probe.mjs --actuals [--case V-ODA#]` (2026-11-07, #1507 S0) on two synthetic companies with the stock Indonesian chart (PT Sinar Baja, PT Baja Timur) and one volume company (PT Volume Uji, loaded by `scripts/odoo-bed/load-ledger.mjs`). IDR, 2 decimals. Shapes and numbers only. Three outcomes per claim: verified, wrong, differs.

| Claim | Verdict | Evidence |
|---|---|---|
| V-ODA1 | **Verified; three shape facts the parser must absorb.** | All 15 fields of the S1 list (`date, parent_state, debit, credit, balance, account_id, move_id, move_name, journal_id, partner_id, company_id, currency_id, amount_currency, analytic_distribution, write_date`) are returned to the bot. Types: many2one = `[id, name]`; `date` and `write_date` strings (`YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS`); money plain numbers; `analytic_distribution` an object or `false`. **`move_name` is `false` while the move was never posted** (posted: `BILL/####/##/####`, `INV/####/#####`). `parent_state` seen: `draft`, `posted`, `cancel`. **Display types seen: `product`, `payment_term`, `tax`, `line_note`, `line_section`.** Note and section lines have `account_id = false`, `account_type = false`, balance 0. Payment-term lines (payable/receivable) and tax lines carry `analytic_distribution = false` unless set. A bill of 100.01 + 50 + 30 + 20 reads a payable line of −200.01 (sum of lines is 0). Keyset on `(write_date, id)` pages at 200 and 1,000 (see V-ODA7). |
| V-ODA2 | **Verified: Odoo's split equals PMO's split of `balance`; `account.analytic.line` stays a cross-check only.** | 100.01 split 60/40 writes analytic amounts −60.01 and −40 (sum −100.01): the odd cent goes to the larger share, matching `round(balance × 60%)` then remainder. 0.05 at 50/50 writes −0.03 and −0.02. **Sign is the negative of `balance`** (expense line +100.01 writes −100.01). A line with no distribution writes no analytic line. On v20 `account.analytic.line.account_id` reads `false` (the account sits in per-plan columns), and `plan_id` is not a field there. |
| V-ODA3 | **Verified.** | `account.account` has `company_ids` (many2many), not `company_id`. The same code (`########`, eight digits on the stock chart) exists in both companies as **different record ids** (no shared ids across the 200 accounts each); within a company codes are unique. Reading company A's account under company B's context still returns the code. Map accounts by `(company, code)`, never by code alone. |
| V-ODA4 | **Verified for fiscal year; one lock field differs.** | `fiscalyear_last_month` is a **string** (`"12"`), `fiscalyear_last_day` a number (31). `fiscalyear_lock_date`, `tax_lock_date`, `sale_lock_date`, `purchase_lock_date`, `hard_lock_date` read `false` when unset. **`period_lock_date` does not exist (500 ValueError)**; v20 also has `user_*_lock_date` variants. |
| V-ODA5 | **Verified: `formatted_read_group` works; `read_group` is refused.** | `account.move.line/formatted_read_group` with `{domain, groupby: ['account_id'], aggregates: ['debit:sum','credit:sum']}` returns a list of `{account_id: [id, name], __extra_domain, 'debit:sum', 'credit:sum'}`. `groupby: ['account_id','date:month']` adds `'date:month': ['2026-11-01','November 2026']`. `limit` is honoured. `read_group` with `fields` is 422 ("unexpected keyword argument 'fields'"); `_read_group` is 403 (private). **No group cap seen**: 480 groups (40 accounts × 12 months) returned in one call. Whole-company grouped read over 130,000 lines: 875 ms by account, 1,142 ms by account × month. |
| V-ODA6 | **Verified; no refusal for any form.** | Stored verbatim after save and post: `{"157":100}`, multi-plan `{"157,159":100}` (comma-joined ids in one key), `{"157":50}`, `{"157":150}`, a non-project plan only `{"159":100}`, and `{"157":33.33,"158":66.67}`. The distribution is not normalised or rejected. FR-ODA-003 must split keys on `,`. |
| V-ODA7 | **Verified; page time is flat through the first 60 pages.** | 130,000 synthetic posted lines, 100 lines per move. Load: about 0.9–2 s per 100-line move (peak load on the shared Mac), 126,000 lines in 1,304 s; plus a first 4,000. Keyset `(write_date, id)`, 60 calls: **200/page p50 169 ms, p95 291 ms, max 398 ms, 12,000 lines in 10.7 s; 1,000/page p50 335 ms, p95 847 ms, max 1,359 ms, 60,000 lines in 23.4 s.** So the 60-call budget reads about 12,000 lines per tick at 200 and 60,000 at 1,000; 130,000 lines is 3 ticks at 1,000 and 11 at 200 (time is not the limit before 100 s). Id sweep (`search`, limit 5,000): 90 ms. Deeper pages were not timed beyond 60 calls. |
| V-ODA8 | **Verified for all four paths.** | **Reverse:** a new posted move whose `reversed_entry_id` is the original; the original's lines get a **new `write_date`** too (reconciliation), ids unchanged. **Reset to draft + repost:** same line ids; `parent_state` goes `posted → draft → posted`, `write_date` changes at each step, `move_name` keeps its value; edited amounts show on repost. **Cancel:** lines stay, `parent_state = cancel`, `write_date` changes, `move_name` kept. **Hard delete of a draft:** the lines are gone, **no tombstone**, nothing for the keyset to see (needs the id sweep). **Delete of a posted move: 422 `UserError`.** A keyset cursor taken before a post-then-reset-to-draft returns that move's lines with `parent_state = draft`. |
| V-ODA9 | **Verified: no usable statement report; the model is reachable but empty of statements.** | `account.report` is readable by the bot and holds 3 records, all the generic **tax** report ("Generic Tax report" and two groupings), with **zero `line_ids`**; `account.report.line` and `account.report.expression` read 0 rows. Every engine method tried (`get_report_information`, `get_options`, `export_to_pdf`, `action_open_report`, `get_expressions_to_audit`, `get_available_variants`) is 404 "does not exist". `account.financial.report`, `account.common.report`, `account.balance.report` do not exist (404). The `accountant` module is `uninstallable`. No Trial Balance, P&L or Balance Sheet definition exists, so statements cannot be read as saved reports. |
| V-ODA10 | **Verified: the smallest tested set is `base.group_user` + `account.group_account_readonly`.** | A 7-call read battery (line `search_read` with the S1 fields, keyset at 1,000, grouped read, `account.account`, analytic accounts, `res.company` fiscal fields, `account.move`): **Billing (`account.group_account_invoice`), Readonly (`account.group_account_readonly`) and Accountant (`account.group_account_user`) all pass 7/7; an internal user with no accounting group gets 403 on `account.move.line` and `account.move`** (and its grouped read). No accounting-manager or Access Rights group is needed for reads. Smallest set tested on this bed, not a universal result. |
| V-ODA11 | **Verified.** | An opening-balance entry is `move_type = entry` in a `general` journal; its lines are ordinary `parent_state = posted`, `display_type = product` rows on the real accounts (asset, equity). A manual year-end closing to an `equity_unaffected` account posts the same way (income debited, `equity_unaffected` credited). Grouping posted lines up to the year end by `account_type` gives each account's cumulative balance, with the closing visible as `equity_unaffected` and income netting to 0. The 19 account types include `equity_unaffected`. There is no stock company-level year-end creator on `res.company`. |

### Corrections to `LEDGER_LINE_FIELDS` (S1, `feed.ts`), field by field

All 15 names exist and return to the Billing/Readonly/Accountant bot; none needs renaming. Parser facts:

| Field | Verdict |
|---|---|
| `date`, `write_date`, `debit`, `credit`, `balance`, `amount_currency` | Verified, shapes as the parser expects. |
| `account_id`, `move_id`, `journal_id`, `partner_id`, `company_id`, `currency_id` | Verified: `[id, name]`, or `false` when empty. **`account_id` is `false` on note and section lines** (balance 0), which the parser drops through its `!account` test; keep that. |
| `parent_state` | Verified: `draft`, `posted`, `cancel`. |
| `move_name` | **Differs for a never-posted draft: `false`.** `parse` returns null on that, so a never-posted draft line is skipped (harmless for actuals), but a repost-after-draft is still seen because the name is kept once posted. No change needed; note it in the comment. |
| `analytic_distribution` | Verified; `false` when empty. **Keys can be multi-plan `"157,159"` and percentages 50 or 150**; `distribution()` accepts these, `fanOutLine` must split on `,` (FR-ODA-003). |
| Missing | `display_type` and `account_type` are readable and not in the list; not needed if S2 maps by account code, but `display_type` separates payable/tax counterpart lines from product lines if the account map cannot. |

## 12. Fleet and maintenance field check

Run: `scripts/with-odoo-lock.sh node scripts/odoo-probe.mjs --equipment` (2026-11-10), on the retained stock Community bed. Results distinguish field metadata and actual writes; absence of a usable prerequisite is inconclusive, not a failed behavioral claim.

| Claim | Verdict | Evidence |
|---|---|---|
| V-OFM-1 | Differs | Listed fields exist, but a vehicle without a model was accepted. |
| V-OFM-2 | Differs | Listed fields exist; metadata also exposes a company field. |
| V-OFM-3 | Differs | Name-only creation succeeds, but the claimed location field is absent. |
| V-OFM-4 | Differs | The requested create succeeds; request date and archive fields are absent and active exists. |
| V-OFM-5 | Differs; stage behavior inconclusive | An ordinary stage update succeeded, but the claimed done field is absent and no done stage could be selected for the close transition. |
| V-OFM-6 | Wrong | The claimed date field is absent; the requested service-log create was refused, while the same create without date succeeded. Service type is required in metadata. |
| V-OFM-7 | Verified | Creating and updating a service log without the unsupported date field left the account-move count unchanged. |
| V-OFM-8 | Verified | All listed fields exist. |
| V-OFM-9 | Verified | The access checks for the requested operations returned true. |
| V-OFM-10 | Verified | The external identifier was found after editing and archiving its equipment. |
