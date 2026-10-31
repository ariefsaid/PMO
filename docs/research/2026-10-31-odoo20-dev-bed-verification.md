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

## 8. O1 follow-ups (S0, #1504)

Run 2026-10-31 on the same stock bed (`20.0`, `version_info` major 20), cases `S0-T*` in `scripts/odoo-probe.mjs`;
synthetic shapes in `pmo-portal/src/lib/adapterSeam/odoo/__fixtures__/json2.ts`. "Minimal user" = an internal user made
for the run with the group set in T13. Bed preconditions the probe sets and records: the bed bot is granted
`analytic.group_analytic_accounting` (it lacked it: plan reads were 403), and the `l10n_id` chart is loaded on the
company (the install alone leaves the generic chart; see T10).

| Task | Claim | Verdict | Fact |
|---|---|---|---|
| T1 (V1/V2) | wrong `X-Odoo-Database` | **verified** | 404 with a **non-JSON** body (not the `{name,message,...}` shape); handle as "database not found" by status + non-JSON |
| T1 | 401 / 403 / 404 bodies | **verified** | 401 `werkzeug.exceptions.Unauthorized` "Invalid apikey"; 403 `odoo.exceptions.AccessError` (valid key, model forbidden); 404 `werkzeug.exceptions.NotFound` |
| T1 | unknown model vs unknown method | **verified** | same `name`; only `message` differs ("the model '…' does not exist" vs "The method '….…' does not exist") |
| T2 (V3) | `res.company/search_read {id,name,currency_id}` as minimal user | **verified** | 200, `currency_id` is `[id,name]` |
| T3 (V4) | `ir.module.module` is 403 for a least-privilege user | **wrong** | internal users (`base.group_user`) can read it (200). Capability discovery of modules works without admin |
| T3 | `res.partner/fields_get {attributes:[type]}` | **verified** | 200, 190 fields |
| T3 | access-check method in 20 | **verified** | `has_access {operation}` → bare `true`/`false`; `check_access_rights` → 404 (removed) |
| T4 (V5) | product fields | **verified** | `default_code, purchase_ok, sale_ok, is_storable, type (selection), uom_id, active` |
| T4 | `product.product/create` with `default_code,name,uom_id,purchase_ok` | **verified** | 200 `[id]`; result `type: "consu"`, `is_storable: false`, `sale_ok: true`. Needs the **Products / Create** group (`product.group_product_manager`): 403 without it |
| T5 (V6) | partner fields | **verified** | all eight present; a new partner has `supplier_rank = customer_rank = 0` |
| T6 (V7) | `uom.uom` | **verified** | `name, relative_factor (number), relative_uom_id ([id,name] or false), active`; no category |
| T7 (V8) | `account.account` | **recorded** | `company_ids` (many2many), **no** `company_id`, **no** `deprecated`; `active` exists. `account_type` values: `asset_receivable, asset_cash, asset_current, asset_non_current, asset_prepayments, asset_fixed, liability_payable, liability_credit_card, liability_current, liability_non_current, equity, equity_unaffected, income, income_other, expense, expense_other, expense_depreciation, expense_direct_cost, off_balance`. The only non-postable-by-type value is `off_balance` |
| T8 (V9) | analytic plans | **recorded** | readable only with `analytic.group_analytic_accounting` (403 otherwise). One plan on the bed, "Project Plan" (the Project app's). `project.project.account_id` has domain `plan_id child_of <Project Plan id>`, company-scoped |
| T8 | analytic account fields | **verified** | `plan_id, company_id, code, active` |
| T8 | `code` unique | **verified not unique** | two accounts with the same `code` in one plan both created |
| T9 (V10) | `context.active_test:false` | **verified** | archived partner: 0 rows without, 1 with |
| T10 (V13) | PPN / PPh rows | **recorded** | after loading the `id` chart: 25 taxes, PPN as **`12%`** (rate 12, sale + purchase), `12% (Non-Luxury Good)` (rate 11), `12% NCR`, `12% IM`, `12% … Pemungut PPN`, `12% … WAPU` (negative / 100 rates, type `none`); `11%` rows present but **archived**. **No PPh rows** in the stock chart. Taxes match by name + rate only; use `type_tax_use`. The install alone left only the generic 15 % / 0 % taxes (company country stays US): the chart load is a bed step |
| T11 (V14) | keyset domain at 200 and 1000 over 2 500 partners | **verified** | seeded in five 500-row creates (same `write_date` per create, so ties cross page edges): 0 repeats, 0 missing at both limits |
| T12 (V12) | `ref` / `code` as minimal user | **verified** | writable and searchable; two partners share a `ref`, two analytic accounts share a `code` (not unique) |
| T13 (V16, SD-7) | minimal user | **recorded** | passes S2/S8-level reads and creates with `base.group_user` + `base.group_partner_manager` (partner create) + `product.group_product_manager` (product create) + `analytic.group_analytic_accounting` (plan read, analytic-account create). With only the first three: plan read and analytic create are 403 (T13h). The four-group set is inferred from that and from the full-set pass (T13c); it was not run as one exact set. Leave-one-out hid the analytic group because other groups imply it |
| T13 | key expiry cap | **recorded** | cap = the largest `api_key_duration` over the user's groups (90 days here). Non-admin: `null` → "The API key must have an expiration date"; past the cap → "You cannot exceed 90.0 days."; within it → key. `res.users.apikeys/generate` over JSON-2 is also refused for a non-admin with "Programmatic API keys are not enabled" until `ir.config_parameter` `base.enable_programmatic_api_keys` is true (admin sets it; `set_bool`). Rotation by API therefore needs that switch |
| T13 | revoked vs expired key | **verified** | both 401, `werkzeug.exceptions.Unauthorized`, "Invalid apikey": indistinguishable |
| T14 (V11) | hosted instances end in `.odoo.com` | **not testable** | documented only; the bed is local |
| T15 | create results | **verified** | `account.analytic.account/create {name,code,plan_id,company_id}` and `res.partner/create` with `ref` → `[id]` |
| T16 | `search_count` | **verified** | `search_count {domain}` honours `active_test:false`; **`domain` is required** (422 "missing a required argument: 'domain'" without) |
| T17 (V17, PQ-11) | `POST /web/webclient/version_info` | **verified** | no auth needed; `result.server_version_info[0]` is the number `20`; `result` also has `server_version`, `server_serie`. Fallback `ir.module.module` `latest_version` of `base` also works (four dot-separated numbers) |

Plan impacts: SD-7 gets the four-group set above; T3 means the capability probe can read `ir.module.module` as the
service user, so a 403 there is "unknown", not "expected"; rotation (S3) must treat "Programmatic API keys are not
enabled" as a connection-state reason, not a failure of the key; T10 means tax matching cannot rely on PPh names.
