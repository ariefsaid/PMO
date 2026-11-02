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
