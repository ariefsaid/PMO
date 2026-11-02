// odoo-probe.mjs — verifies the #1504 Odoo 20 API claims against the local dev bed.
// Reads .env.odoo.local (untracked); prints claim, HTTP status and response SHAPE only
// (keys/types, never values, never the key). Usage: node scripts/odoo-probe.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const envPath = fileURLToPath(new URL('../.env.odoo.local', import.meta.url))
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const base = `http://127.0.0.1:${env.ODOO_PORT || 8069}`

const shape = (v, d = 0) => {
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1), `x${v.length}`] : []
  if (v && typeof v === 'object') return d > 2 ? 'object' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, d + 1)]))
  return v === null ? 'null' : typeof v
}

let probeDatabase
async function call(model, method, body = {}, { key = env.ODOO_API_KEY, db = env.ODOO_DB, headers = {} } = {}) {
  if (db) probeDatabase = db
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'pmo-probe 0', ...headers }
  if (key) h.Authorization = `bearer ${key}`
  if (db) h['X-Odoo-Database'] = db
  const r = await fetch(`${base}/json/2/${model}/${method}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
  const text = await r.text()
  let json
  try { json = JSON.parse(text) } catch { json = text.slice(0, 80) }
  return { status: r.status, json }
}

const results = []
const record = (claim, call_, r, verdict, facts) => {
  results.push({ claim, call: call_, status: r.status, shape: shape(r.json), ...(facts ? { facts } : {}), verdict })
}

// P0 external-identifier candidate: each name uses only stock XML-ID-safe characters.
const externalIds = []
const externalPrefix = `synthetic_${Date.now()}`
async function attachExternalId(model, resId) {
  const name = `${externalPrefix}_${externalIds.length}`
  const created = await call('ir.model.data', 'create', { vals_list: [{ module: 'pmo_probe', name, model, res_id: resId, noupdate: true }] })
  const item = { model, resId, name, status: created.status, id: created.json?.[0] }
  externalIds.push(item)
  return item
}

// 1. endpoint + auth
let r = await call('res.partner', 'search_read', { domain: [['is_company', '=', true]], fields: ['name', 'email', 'vat', 'write_date'], limit: 2 })
record('JSON-2 POST /json/2/{model}/{method} with bearer key returns 200 + list', 'res.partner/search_read', r, r.status === 200 && Array.isArray(r.json) ? 'verified' : 'wrong')
r = await call('res.partner', 'search_read', { fields: ['name'], limit: 1 }, { key: 'invalid' })
record('bad key is rejected (401)', 'res.partner/search_read bad key', r, r.status === 401 ? 'verified' : `wrong (${r.status})`)
r = await call('res.partner', 'search_read', { fields: ['name'], limit: 1 }, { key: '' })
record('no Authorization header is rejected', 'res.partner/search_read no key', r, [401, 403].includes(r.status) ? 'verified' : `wrong (${r.status})`)
r = await call('res.partner', 'search_read', { fields: ['name'], limit: 1 }, { db: '' })
record('X-Odoo-Database optional when --db_name pins the single db', 'res.partner/search_read no db header', r, r.status === 200 ? 'verified (optional here)' : `required (${r.status})`)
r = await call('res.partner', 'no_such_method', {})
record('errors return 4xx/5xx JSON with name/message/arguments/context/debug', 'res.partner/no_such_method', r, r.status >= 400 && typeof r.json === 'object' ? 'verified' : 'wrong')

// 2. fields_get on the models #1504 needs
const models = ['res.partner', 'product.product', 'uom.uom', 'account.analytic.account', 'account.analytic.plan', 'stock.warehouse', 'stock.location', 'account.account', 'account.move', 'purchase.order', 'purchase.order.line', 'project.project', 'stock.move']
for (const m of models) {
  r = await call(m, 'fields_get', { attributes: ['type', 'string'] })
  const f = r.status === 200 ? r.json : {}
  const has = (n) => (n in f ? 'y' : 'n')
  record(`${m} exists; write_date present`, `${m}/fields_get`, { status: r.status, json: {} }, r.status === 200 && 'write_date' in f ? 'verified' : `wrong/missing (${r.status})`, { fieldCount: Object.keys(f).length, write_date: has('write_date'), analytic_distribution: has('analytic_distribution'), analytic_account_id: has('analytic_account_id'), account_id: has('account_id') })
}

// 3. write_date watermark: write a partner, confirm cursor query returns it, ordered asc, ties by id
const mark = (await call('res.partner', 'search_read', { fields: ['write_date'], order: 'write_date desc', limit: 1 })).json[0]?.write_date
const c = await call('res.partner', 'create', { vals_list: [{ name: 'probe partner' }] })
record('create returns id list (vals_list)', 'res.partner/create', c, Array.isArray(c.json) ? 'verified' : 'wrong')
const id = c.json[0]
r = await call('res.partner', 'search_read', { domain: [['write_date', '>', mark]], fields: ['id', 'write_date', 'name'], order: 'write_date asc, id asc', limit: 100 })
record('write_date > watermark with "write_date asc, id asc" returns the new record', 'res.partner/search_read watermark', r, r.status === 200 && r.json.some((x) => x.id === id) ? 'verified' : 'wrong')
const fmt = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(mark || '')
record('write_date serialised as "YYYY-MM-DD HH:MM:SS" naive UTC string', 'res.partner/search_read', { status: 200, json: { writeDateFormatOk: fmt } }, fmt ? 'verified' : 'wrong')
const w2 = await call('res.partner', 'write', { ids: [id], vals: { comment: 'x' } })
r = await call('res.partner', 'search_read', { domain: [['id', '=', id]], fields: ['write_date'] })
record('write bumps write_date (change detection on update)', 'res.partner/write', w2, r.json[0]?.write_date >= mark ? 'verified' : 'wrong')
await call('res.partner', 'unlink', { ids: [id] })
r = await call('res.partner', 'search_read', { domain: [['id', '=', id]], fields: ['id'], context: { active_test: false } })
record('deletes are invisible to write_date sweep (hard unlink leaves no tombstone)', 'res.partner/unlink', r, r.json.length === 0 ? 'verified (needs separate reconcile)' : 'wrong')

// 4. product + uom, analytic, stock, accounting
r = await call('product.product', 'search_read', { fields: ['name', 'uom_id', 'standard_price', 'type'], limit: 1 })
record('product.product exposes uom_id as [id,name] pair', 'product.product/search_read', r, r.status === 200 ? 'verified' : 'wrong')
r = await call('uom.uom', 'search_read', { fields: ['name', 'relative_factor', 'relative_uom_id'], limit: 2 })
record('uom.uom readable (v20 field names)', 'uom.uom/search_read', r, r.status === 200 ? 'verified' : `wrong (${r.status})`)
r = await call('account.analytic.account', 'search_read', { fields: ['name', 'plan_id', 'code'], limit: 2 })
record('account.analytic.account has plan_id', 'account.analytic.account/search_read', r, r.status === 200 ? 'verified' : 'wrong')
r = await call('stock.warehouse', 'search_read', { fields: ['name', 'code', 'lot_stock_id', 'view_location_id'], limit: 2 })
record('stock.warehouse readable with lot_stock_id', 'stock.warehouse/search_read', r, r.status === 200 ? 'verified' : 'wrong')
r = await call('stock.location', 'search_read', { fields: ['complete_name', 'usage', 'location_id'], limit: 3 })
record('stock.location readable (usage, parent)', 'stock.location/search_read', r, r.status === 200 ? 'verified' : 'wrong')
r = await call('account.account', 'search_read', { fields: ['code', 'name', 'account_type'], limit: 2 })
record('account.account readable (code, account_type)', 'account.account/search_read', r, r.status === 200 ? 'verified' : 'wrong')
r = await call('account.move', 'search_read', { fields: ['name', 'move_type', 'state', 'write_date'], limit: 1 })
record('account.move readable', 'account.move/search_read', r, r.status === 200 ? 'verified' : 'wrong')

// 5. locale + extras
r = await call('ir.module.module', 'search_read', { domain: [['name', 'in', ['l10n_id', 'l10n_id_efaktur', 'account_budget', 'approvals', 'hr_payroll', 'stock_analytic']], ['state', '=', 'installed']], fields: ['name'] })
record('l10n_id installed; enterprise-only/OCA modules absent', 'ir.module.module/search_read', r, r.status === 200 ? `installed: ${r.json.map((x) => x.name).join(',') || 'none'}` : 'wrong')
r = await call('res.users.apikeys', 'search_read', { fields: ['name'], limit: 1 })
record('res.users.apikeys exposes a programmatic surface', 'res.users.apikeys/search_read', r, `status ${r.status}`)

// 6. gap claims (coverage doc)
r = await call('stock.move', 'fields_get', { attributes: ['type'] })
record('stock.move has NO analytic_distribution (coverage 1A)', 'stock.move/fields_get', { status: r.status, json: { analytic_distribution: 'analytic_distribution' in (r.json || {}) } }, r.status === 200 && !('analytic_distribution' in r.json) ? 'verified' : 'wrong')

// 7. analytic chain: project -> analytic account -> PO line / bill line / timesheet line
const val = (rr) => (rr.status === 200 ? rr.json : null)
const proj = await call('project.project', 'create', { vals_list: [{ name: 'probe project' }] })
const pid = proj.json?.[0]
r = await call('project.project', 'read', { ids: [pid], fields: ['account_id'] })
record('project.project links to analytic account via account_id', 'project.project/read', r, r.status === 200 ? 'verified' : `wrong (${r.status})`)
const aid = r.json?.[0]?.account_id?.[0]
r = await call('project.project', 'read', { ids: [pid], fields: ['analytic_account_id'] })
record('project.project.analytic_account_id (research doc field name) exists', 'project.project/read', r, r.status === 200 ? 'verified' : `wrong (${r.status}; real name is account_id)`)
record('creating a project auto-provisions an analytic account', 'project.project/create+read', { status: 200, json: { account_id: 'pair' } }, aid ? 'verified' : 'wrong (no analytic account on create)')
const partner = (await call('res.partner', 'create', { vals_list: [{ name: 'probe vendor', supplier_rank: 1 }] })).json?.[0]
const prod = (await call('product.product', 'create', { vals_list: [{ name: 'probe item', purchase_ok: true, standard_price: 10 }] })).json?.[0]
const po = await call('purchase.order', 'create', { vals_list: [{ partner_id: partner, origin: 'synthetic anchor', note: 'synthetic anchor', order_line: [[0, 0, { product_id: prod, product_qty: 2, price_unit: 10, analytic_distribution: { [aid]: 100 } }]] }] })
record('PO with analytic_distribution on the line can be created', 'purchase.order/create', po, po.status === 200 ? 'verified' : 'wrong')
const poid = po.json?.[0]
if (po.status === 200) await attachExternalId('purchase.order', poid)
if (po.status !== 200) record('PO create error', 'purchase.order/create', po, `error: ${po.json?.message}`)
r = await call('purchase.order.line', 'search_read', { domain: [['order_id', '=', poid]], fields: ['analytic_distribution'] })
record('PO line analytic_distribution is a {"<id>": pct} object', 'purchase.order.line/search_read', r, r.json?.[0]?.analytic_distribution?.[String(aid)] === 100 ? 'verified' : 'wrong', { keyIsString: typeof Object.keys(r.json?.[0]?.analytic_distribution || {})[0] })
r = await call('purchase.order', 'button_confirm', { ids: [poid] })
record('PO confirm via model method (action_confirm per research doc)', 'purchase.order/button_confirm', r, r.status === 200 ? 'verified (button_confirm; action_confirm is wrong name)' : `wrong (${r.status})`)
const normalOrderRead = await call('purchase.order', 'read', { ids: [poid], fields: ['state', 'name', 'amount_total', 'company_id'] })
const operatingCompanyId = normalOrderRead.json?.[0]?.company_id?.[0]
r = await call('purchase.order', 'action_confirm', { ids: [poid] })
record('purchase.order/action_confirm exists (research doc names it)', 'purchase.order/action_confirm', r, r.status === 200 ? 'verified' : `wrong (${r.status}; real method is button_confirm)`)
r = await call('purchase.order', 'action_create_invoice', { ids: [poid] })
record('PO -> vendor bill via action_create_invoice', 'purchase.order/action_create_invoice', r, r.status === 200 ? 'verified' : `wrong/not-ready (${r.status}: ${r.json?.message?.slice(0, 120)})`)
const bill = await call('account.move', 'search_read', { domain: [['invoice_line_ids.purchase_line_id.order_id', '=', poid]], fields: ['id', 'state', 'move_type'] })
const bid = bill.json?.[0]?.id
r = await call('account.move.line', 'search_read', { domain: [['move_id', '=', bid], ['display_type', '=', 'product']], fields: ['analytic_distribution'] })
record('bill line inherits the PO line analytic_distribution', 'account.move.line/search_read', r, aid && r.json?.[0]?.analytic_distribution?.[String(aid)] === 100 ? 'verified' : 'wrong')
// timesheet -> analytic line
const task = (await call('project.task', 'create', { vals_list: [{ name: 'probe task', project_id: pid }] })).json?.[0]
const bot = (await call('res.users', 'search_read', { domain: [['login', '=', 'pmo_adapter_bot']], fields: ['id'] })).json?.[0]?.id
const noEmp = await call('account.analytic.line', 'create', { vals_list: [{ name: 'probe', project_id: pid, unit_amount: 3 }] })
record('timesheet needs an active employee for the user (422 without)', 'account.analytic.line/create', noEmp, noEmp.status === 422 ? 'verified (observed gotcha)' : `unexpected ${noEmp.status}`)
const emp = (await call('hr.employee', 'create', { vals_list: [{ name: 'probe employee', user_id: bot }] })).json?.[0]
const ts = await call('account.analytic.line', 'create', { vals_list: [{ name: 'probe', project_id: pid, task_id: task, unit_amount: 3 }] })
r = await call('account.analytic.line', 'read', { ids: ts.json || [], fields: ['account_id', 'unit_amount', 'amount'] })
record('timesheet (account.analytic.line with project_id) lands on the project analytic account', 'account.analytic.line/create+read', r, aid && r.json?.[0]?.account_id?.[0] === aid ? 'verified' : 'wrong', { unit_amount: r.json?.[0]?.unit_amount, amountIsNumber: typeof r.json?.[0]?.amount })
r = await call('hr.employee', 'fields_get', { attributes: ['type'] })
record('hr.employee.timesheet_cost exists (research doc claim)', 'hr.employee/fields_get', { status: r.status, json: {} }, 'timesheet_cost' in (r.json || {}) ? 'verified' : ('hourly_cost' in (r.json || {}) ? 'wrong name (real field: hourly_cost)' : 'wrong (absent)'), { costLikeFields: Object.keys(r.json || {}).filter((k) => /cost|rate/.test(k)) })
// api key programmatic surface + webhooks
r = await call('res.users.apikeys', 'fields_get', { attributes: ['type'] })
record('res.users.apikeys fields (scope, expiration_date)', 'res.users.apikeys/fields_get', { status: r.status, json: {} }, r.status === 200 ? 'verified' : 'wrong', { fields: Object.keys(r.json || {}).filter((k) => ['name', 'scope', 'expiration_date', 'user_id', 'key'].includes(k)) })
r = await call('res.users.apikeys', 'generate', { key: 'invalid', scope: 'rpc', name: 'probe', expiration_date: null })
record('generate rejects a key that is not the caller\'s own', 'res.users.apikeys/generate bad key', r, r.status === 403 ? 'verified' : `unexpected ${r.status}`)
const exp = new Date(Date.now() + 80 * 864e5).toISOString().slice(0, 19).replace('T', ' ')
const g = await call('res.users.apikeys', 'generate', { key: env.ODOO_API_KEY, scope: 'rpc', name: 'probe', expiration_date: exp })
record('generate(key, scope, name, expiration_date) mints a new key using an existing own key', 'res.users.apikeys/generate', { status: g.status, json: typeof g.json === 'string' ? 'keystring' : g.json }, g.status === 200 && typeof g.json === 'string' ? 'verified (returns the key as a bare string; value not shown)' : `wrong (${g.status})`, { keyLength: typeof g.json === 'string' ? g.json.length : null })
const g2 = await call('res.users.apikeys', 'generate', { key: env.ODOO_API_KEY, scope: 'rpc', name: 'probe', expiration_date: null })
record('a key with no expiration (null) is refused or capped (research doc: max 3 months)', 'res.users.apikeys/generate null expiry', { status: g2.status, json: typeof g2.json === 'string' ? 'keystring' : g2.json }, g2.status === 200 ? 'wrong for admin-group user (null accepted; cap is per-group, see note)' : `verified (${g2.status})`)
if (g.status === 200) { const rv = await call('res.users.apikeys', 'revoke', { key: g.json }); record('revoke(key) invalidates a key', 'res.users.apikeys/revoke', rv, rv.status === 200 ? 'verified' : `wrong (${rv.status})`); const after = await call('res.partner', 'search_read', { fields: ['id'], limit: 1 }, { key: g.json }); record('a revoked key is rejected', 'res.partner/search_read revoked key', after, after.status === 401 ? 'verified' : `wrong (${after.status})`) }
if (g2.status === 200) await call('res.users.apikeys', 'revoke', { key: g2.json })
r = await call('ir.module.module', 'search_read', { domain: [['name', '=', 'base_automation']], fields: ['state'] })
record('base_automation module available in Community', 'ir.module.module/search_read', r, r.json?.length ? `verified (state ${r.json[0].state})` : 'wrong')
r = await call('ir.actions.server', 'fields_get', { attributes: ['selection'] })
record('ir.actions.server state selection includes "webhook"', 'ir.actions.server/fields_get', { status: r.status, json: {} }, JSON.stringify(r.json?.state?.selection || []).includes('webhook') ? 'verified' : 'wrong/not-installed', { states: (r.json?.state?.selection || []).map((x) => x[0]) })
// 8. fleet / maintenance / efaktur availability
for (const m of ['fleet.vehicle', 'fleet.vehicle.odometer', 'maintenance.equipment', 'maintenance.request', 'stock.picking']) {
  r = await call(m, 'fields_get', { attributes: ['type'] })
  record(`${m} model exists and is readable`, `${m}/fields_get`, { status: r.status, json: {} }, r.status === 200 ? 'verified' : `wrong (${r.status})`, { fieldCount: Object.keys(r.json || {}).length })
}
r = await call('ir.module.module', 'search_read', { domain: [['name', 'in', ['l10n_id_efaktur', 'l10n_id_efaktur_coretax', 'account_budget', 'approvals', 'hr_payroll', 'stock_analytic']]], fields: ['name', 'state'] })
record('availability on disk of l10n_id_efaktur(_coretax) and of Enterprise/OCA modules', 'ir.module.module/search_read', r, r.status === 200 ? 'listed' : 'wrong', { present: Object.fromEntries((r.json || []).map((x) => [x.name, x.state])) })
// V-OPP5: a directly created bill links back to its PO line and analytic account.
const billOrderLine = await call('purchase.order.line', 'search_read', { domain: [['order_id', '=', poid]], fields: ['id'], limit: 1 })
const billExpense = await call('account.account', 'search_read', { domain: [['account_type', '=', 'expense'], ['company_ids', 'in', [operatingCompanyId]]], fields: ['id'], limit: 1 })
const linkedBill = await call('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: partner, invoice_origin: 'synthetic order reference', invoice_date: '2026-11-02', invoice_line_ids: [[0, 0, { name: 'synthetic service', quantity: 1, price_unit: 10, account_id: billExpense.json?.[0]?.id, purchase_line_id: billOrderLine.json?.[0]?.id, analytic_distribution: { [aid]: 100 }, tax_ids: [[5, 0, 0]] }]] }] })
let linkedBillPost = { status: linkedBill.status, json: null }
let linkedBillVerified = false
let linkedOrderInvoiceStatus = 'unknown'
let billedLowerAllowed = false
if (linkedBill.status === 200) {
  const linkedBillId = linkedBill.json[0]
  linkedBillPost = await call('account.move', 'action_post', { ids: [linkedBillId] })
  const postAgain = await call('account.move', 'action_post', { ids: [linkedBillId] })
  record('V-OPP11 double bill posting error', 'account.move/action_post', postAgain, postAgain.status === 422 ? 'validation-error' : 'unverified')
  const postedRead = await call('account.move', 'read', { ids: [linkedBillId], fields: ['state', 'invoice_origin'] })
  const linkedLines = await call('account.move.line', 'search_read', { domain: [['move_id', '=', linkedBillId], ['purchase_line_id', '=', billOrderLine.json?.[0]?.id]], fields: ['analytic_distribution'] })
  const billedRead = await call('purchase.order.line', 'read', { ids: [billOrderLine.json?.[0]?.id], fields: ['qty_invoiced'] })
  const invoicing = await call('purchase.order', 'read', { ids: [poid], fields: ['invoice_status'] })
  linkedOrderInvoiceStatus = invoicing.json?.[0]?.invoice_status || 'unknown'
  const billedLower = await call('purchase.order', 'write', { ids: [poid], vals: { order_line: [[1, billOrderLine.json?.[0]?.id, { product_qty: 0.5 }]] } })
  const billedLowerRead = await call('purchase.order.line', 'read', { ids: [billOrderLine.json?.[0]?.id], fields: ['product_qty', 'qty_invoiced'] })
  billedLowerAllowed = billedLower.status === 200 && billedLowerRead.json?.[0]?.product_qty === 0.5 && billedLowerRead.json?.[0]?.qty_invoiced === 1
  const reconcileLines = await call('account.move.line', 'search_read', { domain: [['move_id', '=', linkedBillId]], fields: ['account_id'], limit: 20 })
  const firstLine = reconcileLines.json?.[0]
  const differentAccount = reconcileLines.json?.find?.((x) => x.account_id?.[0] !== firstLine?.account_id?.[0])
  if (firstLine && differentAccount) {
    const invalidReconcile = await call('account.move.line', 'reconcile', { ids: [firstLine.id, differentAccount.id] })
    record('V-OPP11 reconciliation validation error', 'account.move.line/reconcile', invalidReconcile, invalidReconcile.status === 422 ? 'validation-error' : 'unverified')
  }
  linkedBillVerified = linkedBillPost.status === 200 && postAgain.status === 422 && postedRead.json?.[0]?.state === 'posted' && postedRead.json?.[0]?.invoice_origin === 'synthetic order reference' && linkedLines.json?.[0]?.analytic_distribution?.[String(aid)] === 100 && billedRead.json?.[0]?.qty_invoiced === 1 && invoicing.json?.[0]?.invoice_status === 'to invoice'
}
record('V-OPP5 linked bill posting and double post', 'account.move/action_post', linkedBillPost, linkedBillVerified ? `verified; double post rejected; order status ${linkedOrderInvoiceStatus}` : 'unverified')

// cleanup
if (poid) { await call('purchase.order', 'button_cancel', { ids: [poid] }) }
await call('account.analytic.line', 'unlink', { ids: ts.json || [] })
await call('project.task', 'unlink', { ids: [task] })
await call('hr.employee', 'unlink', { ids: [emp] })
await call('project.project', 'unlink', { ids: [pid] })

// V-OPP1: the two-step path must run as a purchase user, not a manager.
const probeUserName = `synthetic-purchase-${Date.now()}`
const userSetup = `from datetime import datetime, timedelta
import json
env = self.env
u = env['res.users'].sudo().with_context(no_reset_password=True).create({'name': 'Synthetic purchase user', 'login': ${JSON.stringify(probeUserName)}, 'group_ids': [(6, 0, [env.ref('base.group_user').id, env.ref('purchase.group_purchase_user').id, env.ref('stock.group_stock_user').id, env.ref('account.group_account_invoice').id])]})
k = env['res.users.apikeys'].with_user(u)._generate('rpc', 'synthetic probe', datetime.now() + timedelta(days=30))
draft = env['account.move'].new({'move_type': 'in_invoice', 'partner_id': ${partner}, 'purchase_id': ${poid}, 'invoice_origin': 'synthetic anchor', 'narration': 'synthetic anchor'})
onchange_ok = False
try:
    draft._onchange_purchase_auto_complete()
    onchange_ok = draft.invoice_origin != 'synthetic anchor' and 'synthetic anchor' in (draft.narration or '')
except Exception:
    pass
env.cr.commit()
print('PROBE_USER=' + json.dumps({'id': u.id, 'key': k, 'onchange_ok': onchange_ok, 'groups': {g: env.ref(g).id for g in ['purchase.group_purchase_user', 'stock.group_stock_user', 'account.group_account_invoice', 'base.group_erp_manager']}}))
`
const shellResult = spawnSync('docker', ['compose', '-f', fileURLToPath(new URL('./odoo-bed/compose.yml', import.meta.url)), '--env-file', envPath, 'run', '--rm', '--no-deps', '-T', 'odoo', 'odoo', 'shell', '-d', probeDatabase, '--no-http'], { input: userSetup, encoding: 'utf8' })
let probeUser
try { probeUser = JSON.parse(shellResult.stdout?.split('\n').find((x) => x.startsWith('PROBE_USER='))?.slice('PROBE_USER='.length) || 'null') } catch { probeUser = null }
const companyRead = await call('res.users', 'search_read', { domain: [['login', '=', 'pmo_adapter_bot']], fields: ['company_id'], limit: 1 })
const companyId = companyRead.json?.[0]?.company_id?.[0]
const companySettings = await call('res.company', 'read', { ids: [companyId], fields: ['po_double_validation', 'po_double_validation_amount'] })
const priorSettings = companySettings.json?.[0]
let twoStep = { status: 0, json: null }
let twoStepVerified = false
try {
  if (probeUser?.key && priorSettings) {
    const configured = await call('res.company', 'write', { ids: [companyId], vals: { po_double_validation: 'two_step', po_double_validation_amount: 1 } })
    const draft = await call('purchase.order', 'create', { vals_list: [{ partner_id: partner, order_line: [[0, 0, { product_id: prod, product_qty: 2, price_unit: 10 }]] }] }, { key: probeUser.key })
    if (configured.status === 200 && draft.status === 200) {
      const draftId = draft.json[0]
      twoStep = await call('purchase.order', 'button_confirm', { ids: [draftId] }, { key: probeUser.key })
      const observed = await call('purchase.order', 'read', { ids: [draftId], fields: ['state', 'name', 'amount_total'] })
      const approved = await call('purchase.order', 'button_approve', { ids: [draftId] })
      twoStepVerified = twoStep.status === 200 && observed.json?.[0]?.state === 'to approve' && approved.status === 200
      await call('purchase.order', 'button_cancel', { ids: [draftId] })
    }
  }
} finally {
  if (priorSettings) await call('res.company', 'write', { ids: [companyId], vals: { po_double_validation: priorSettings.po_double_validation, po_double_validation_amount: priorSettings.po_double_validation_amount } })
}
record('V-OPP1 order confirmation and double validation', 'purchase.order/button_confirm', twoStep, twoStepVerified && normalOrderRead.status === 200 && normalOrderRead.json?.[0]?.state === 'purchase' && typeof normalOrderRead.json?.[0]?.name === 'string' && typeof normalOrderRead.json?.[0]?.amount_total === 'number' ? 'verified' : 'unverified')

// V-OPP4: complete a partial incoming transfer using the stock backorder wizard.
const receiptProduct = await call('product.product', 'create', { vals_list: [{ name: 'synthetic receipt product', purchase_ok: true, is_storable: true, standard_price: 10 }] })
const receiptOrder = await call('purchase.order', 'create', { vals_list: [{ partner_id: partner, order_line: [[0, 0, { product_id: receiptProduct.json?.[0], product_qty: 10, price_unit: 10 }]] }] })
const receiptOrderId = receiptOrder.json?.[0]
const receiptConfirm = await call('purchase.order', 'button_confirm', { ids: [receiptOrderId] })
const receiptPicking = await call('stock.picking', 'search_read', { domain: [['purchase_id', '=', receiptOrderId]], fields: ['move_ids'] })
const receiptPickingId = receiptPicking.json?.[0]?.id
if (receiptPickingId) await attachExternalId('stock.picking', receiptPickingId)
const receiptMoveIds = receiptPicking.json?.[0]?.move_ids || []
await call('stock.picking', 'write', { ids: [receiptPickingId], vals: { origin: 'synthetic anchor', note: 'synthetic anchor' } })
const receiptQuantity = await call('stock.move', 'write', { ids: receiptMoveIds, vals: { quantity: 6 } })
const receiptValidation = await call('stock.picking', 'button_validate', { ids: [receiptPickingId] })
let receiptWizard = { status: receiptValidation.status, json: null }
let receiptProcess = { status: receiptValidation.status, json: null }
if (receiptValidation.json?.res_model === 'stock.backorder.confirmation') {
  receiptWizard = await call('stock.backorder.confirmation', 'create', { vals_list: [{}], context: receiptValidation.json.context })
  if (receiptWizard.status === 200) receiptProcess = await call('stock.backorder.confirmation', 'process', { ids: receiptWizard.json, context: receiptValidation.json.context })
}
const receiptAfter = await call('stock.picking', 'search_read', { domain: [['purchase_id', '=', receiptOrderId]], fields: ['state', 'backorder_id', 'move_ids'] })
const receiptStates = Array.isArray(receiptAfter.json) ? receiptAfter.json : []
const receiptDone = receiptStates.find((x) => x.state === 'done')
const receiptBackorder = receiptStates.find((x) => x.backorder_id && x.state !== 'done')
const receiptMoves = await call('stock.move', 'read', { ids: [...(receiptDone?.move_ids || []), ...(receiptBackorder?.move_ids || [])], fields: ['quantity', 'product_uom_qty'] })
const bookedMove = receiptMoves.json?.find?.((x) => receiptDone?.move_ids.includes(x.id))
const remainingMove = receiptMoves.json?.find?.((x) => receiptBackorder?.move_ids.includes(x.id))
const backorderComplete = bookedMove?.quantity === 6 && remainingMove?.product_uom_qty === 4 && receiptConfirm.status === 200 && receiptQuantity.status === 200 && receiptProcess.status === 200 && receiptStates.some((x) => x.state === 'done') && receiptStates.some((x) => x.backorder_id && x.state !== 'done')
record('V-OPP4 partial receipt backorder via stock wizard', 'stock.backorder.confirmation/process', receiptProcess, backorderComplete ? 'completable' : 'unverified')

// With no explicit quantity, stock validation completes this untracked transfer in full.
const immediateOrder = await call('purchase.order', 'create', { vals_list: [{ partner_id: partner, order_line: [[0, 0, { product_id: receiptProduct.json?.[0], product_qty: 3, price_unit: 10 }]] }] })
await call('purchase.order', 'button_confirm', { ids: immediateOrder.json || [] })
const immediatePickings = await call('stock.picking', 'search_read', { domain: [['purchase_id', '=', immediateOrder.json?.[0]]], fields: ['move_ids'] })
const immediateResult = await call('stock.picking', 'button_validate', { ids: [immediatePickings.json?.[0]?.id] })
const immediateMove = await call('stock.move', 'read', { ids: immediatePickings.json?.[0]?.move_ids || [], fields: ['state', 'quantity', 'product_uom_qty'] })
const immediateVerified = immediateResult.status === 200 && immediateResult.json === true && immediateMove.json?.[0]?.state === 'done' && immediateMove.json?.[0]?.quantity === 3 && immediateMove.json?.[0]?.product_uom_qty === 3
record('V-OPP4 immediate transfer with no entered quantity', 'stock.picking/button_validate', immediateResult, immediateVerified ? 'completed in full without wizard' : 'unverified')

// V-OPP9: revise a received order and compare the locked state.
const reviseBefore = await call('purchase.order', 'read', { ids: [receiptOrderId], fields: ['order_line'] })
const reviseLineId = reviseBefore.json?.[0]?.order_line?.[0]
const reviseAdd = await call('purchase.order', 'write', { ids: [receiptOrderId], vals: { order_line: [[1, reviseLineId, { product_qty: 12 }], [0, 0, { product_id: receiptProduct.json?.[0], product_qty: 1, price_unit: 10 }]] } })
const reviseAfter = await call('purchase.order', 'read', { ids: [receiptOrderId], fields: ['order_line'] })
const addedLineId = reviseAfter.json?.[0]?.order_line?.find((x) => x !== reviseLineId)
const reviseRemove = await call('purchase.order', 'write', { ids: [receiptOrderId], vals: { order_line: [[2, addedLineId, 0]] } })
record('V-OPP11 order line removal error', 'purchase.order/write', reviseRemove, reviseRemove.status === 422 ? 'validation-error' : 'unverified')
const reviseBelow = await call('purchase.order', 'write', { ids: [receiptOrderId], vals: { order_line: [[1, reviseLineId, { product_qty: 5 }]] } })
const reviseRead = await call('purchase.order.line', 'read', { ids: [reviseLineId], fields: ['product_qty', 'qty_received'] })
const lockOrder = await call('purchase.order', 'button_lock', { ids: [receiptOrderId] })
const lockedEdit = await call('purchase.order', 'write', { ids: [receiptOrderId], vals: { order_line: [[1, reviseLineId, { product_qty: 7 }]] } })
const lockedRead = await call('purchase.order.line', 'read', { ids: [reviseLineId], fields: ['product_qty'] })
await call('purchase.order', 'button_unlock', { ids: [receiptOrderId] })
const reviseVerified = reviseAdd.status === 200 && reviseRemove.status === 422 && reviseBelow.status === 200 && reviseRead.json?.[0]?.product_qty === 5 && reviseRead.json?.[0]?.qty_received === 6 && lockOrder.status === 200 && billedLowerAllowed
record('V-OPP9 confirmed order revision and lock', 'purchase.order/write', reviseBelow, reviseVerified ? `add allowed; remove rejected; below-received and below-billed allowed; locked edit ${lockedEdit.status === 200 && lockedRead.json?.[0]?.product_qty === 7 ? 'allowed' : 'refused'}` : 'unverified')

// V-OPP3: a tracked product requires a lot before a complete validation.
const trackedProduct = await call('product.product', 'create', { vals_list: [{ name: 'synthetic tracked product', purchase_ok: true, is_storable: true, tracking: 'lot' }] })
const trackedOrder = await call('purchase.order', 'create', { vals_list: [{ partner_id: partner, order_line: [[0, 0, { product_id: trackedProduct.json?.[0], product_qty: 2, price_unit: 10 }]] }] })
const trackedOrderId = trackedOrder.json?.[0]
const trackedConfirm = await call('purchase.order', 'button_confirm', { ids: [trackedOrderId] })
const trackedPickings = await call('stock.picking', 'search_read', { domain: [['purchase_id', '=', trackedOrderId]], fields: ['move_ids'] })
const trackedPickingId = trackedPickings.json?.[0]?.id
await call('stock.move', 'write', { ids: trackedPickings.json?.[0]?.move_ids || [], vals: { quantity: 2 } })
const withoutLot = await call('stock.picking', 'button_validate', { ids: [trackedPickingId] })
record('V-OPP11 tracked receipt missing lot error', 'stock.picking/button_validate', withoutLot, withoutLot.status === 422 ? 'validation-error' : 'unverified')
const invalidWizardContext = { button_validate_picking_ids: [trackedPickingId], default_pick_ids: [[4, trackedPickingId]] }
const invalidWizard = await call('stock.backorder.confirmation', 'create', { vals_list: [{}], context: invalidWizardContext })
if (invalidWizard.status === 200) {
  const wizardError = await call('stock.backorder.confirmation', 'process', { ids: invalidWizard.json, context: invalidWizardContext })
  record('V-OPP11 wizard validation error', 'stock.backorder.confirmation/process', wizardError, wizardError.status === 422 ? 'validation-error' : 'unverified')
}
const trackedLot = await call('stock.lot', 'create', { vals_list: [{ name: 'synthetic lot', product_id: trackedProduct.json?.[0] }] })
const trackedLines = await call('stock.move.line', 'search_read', { domain: [['picking_id', '=', trackedPickingId]], fields: ['quantity'] })
const assignedLot = await call('stock.move.line', 'write', { ids: (trackedLines.json || []).map((x) => x.id), vals: { lot_id: trackedLot.json?.[0] } })
const trackedValidate = await call('stock.picking', 'button_validate', { ids: [trackedPickingId] })
const trackedState = await call('stock.picking', 'read', { ids: [trackedPickingId], fields: ['state'] })
const trackedVerified = trackedConfirm.status === 200 && trackedPickings.json?.length === 1 && withoutLot.status === 422 && assignedLot.status === 200 && trackedValidate.status === 200 && trackedState.json?.[0]?.state === 'done'
record('V-OPP3 complete tracked receipt', 'stock.picking/button_validate', trackedValidate, trackedVerified ? 'verified; lot required' : 'unverified')

// V-OPP6: load a stock Indonesian chart and test a configured withholding tax.
const indonesianCountry = await call('res.country', 'search_read', { domain: [['code', '=', 'ID']], fields: ['id'], limit: 1 })
let localCompany = await call('res.company', 'search_read', { domain: [['name', '=', 'Synthetic Indonesian chart']], fields: ['id'], limit: 1 })
let newLocalCompany = false
if (!localCompany.json?.length) {
  const createdCompany = await call('res.company', 'create', { vals_list: [{ name: 'Synthetic Indonesian chart', country_id: indonesianCountry.json?.[0]?.id }] })
  localCompany = { status: createdCompany.status, json: [{ id: createdCompany.json?.[0] }] }
  newLocalCompany = true
}
const localCompanyId = localCompany.json?.[0]?.id
const botId = companyRead.json?.[0]?.id
const botCompanies = await call('res.users', 'read', { ids: [botId], fields: ['company_ids'] })
const previousCompanies = botCompanies.json?.[0]?.company_ids || []
const localeContext = { allowed_company_ids: [localCompanyId], active_test: false }
let taxResult = { status: 0, json: null }
let taxVerified = false
let stockPphCount = 0
try {
  await call('res.users', 'write', { ids: [botId], vals: { company_ids: [[4, localCompanyId]] } })
  if (newLocalCompany) await call('account.chart.template', 'try_loading', { template_code: 'id', company: localCompanyId })
  const localTaxes = await call('account.tax', 'search_read', { domain: [['company_id', '=', localCompanyId]], fields: ['name', 'amount', 'type_tax_use', 'price_include'], context: localeContext, limit: 200 })
  const taxes = Array.isArray(localTaxes.json) ? localTaxes.json : []
  stockPphCount = taxes.filter((x) => /pph\s*(23|4)/i.test(x.name)).length
  const vat = taxes.find((x) => x.type_tax_use === 'purchase' && x.amount === 11 && x.price_include === false)
  const localExpense = await call('account.account', 'search_read', { domain: [['account_type', '=', 'expense']], fields: ['id'], context: localeContext, limit: 1 })
  const localLiability = await call('account.account', 'search_read', { domain: [['account_type', '=', 'liability_current']], fields: ['id'], context: localeContext, limit: 1 })
  const withholding = await call('account.tax', 'create', { vals_list: [{ name: `synthetic withholding ${Date.now()}`, company_id: localCompanyId, type_tax_use: 'purchase', amount_type: 'percent', amount: -2 }], context: localeContext })
  const secondWithholding = await call('account.tax', 'create', { vals_list: [{ name: `synthetic withholding second ${Date.now()}`, company_id: localCompanyId, type_tax_use: 'purchase', amount_type: 'percent', amount: -2.5 }], context: localeContext })
  let secondTaxVerified = false
  if (secondWithholding.status === 200) {
    const secondTaxId = secondWithholding.json[0]
    const secondTax = await call('account.tax', 'read', { ids: [secondTaxId], fields: ['amount', 'price_include', 'invoice_repartition_line_ids'], context: localeContext })
    const parts = await call('account.tax.repartition.line', 'read', { ids: secondTax.json?.[0]?.invoice_repartition_line_ids || [], fields: ['repartition_type'], context: localeContext })
    const ids = (parts.json || []).filter((x) => x.repartition_type === 'tax').map((x) => x.id)
    const assigned = await call('account.tax.repartition.line', 'write', { ids, vals: { account_id: localLiability.json?.[0]?.id }, context: localeContext })
    const partRead = await call('account.tax.repartition.line', 'read', { ids, fields: ['account_id'], context: localeContext })
    secondTaxVerified = secondTax.json?.[0]?.amount === -2.5 && secondTax.json?.[0]?.price_include === false && assigned.status === 200 && partRead.json?.[0]?.account_id?.[0] === localLiability.json?.[0]?.id
    await call('account.tax', 'write', { ids: [secondTaxId], vals: { active: false }, context: localeContext })
  }
  if (vat && withholding.status === 200) {
    const taxId = withholding.json[0]
    const tax = await call('account.tax', 'read', { ids: [taxId], fields: ['invoice_repartition_line_ids'], context: localeContext })
    const taxParts = await call('account.tax.repartition.line', 'read', { ids: tax.json?.[0]?.invoice_repartition_line_ids || [], fields: ['repartition_type'], context: localeContext })
    const taxPartIds = (taxParts.json || []).filter((x) => x.repartition_type === 'tax').map((x) => x.id)
    await call('account.tax.repartition.line', 'write', { ids: taxPartIds, vals: { account_id: localLiability.json?.[0]?.id }, context: localeContext })
    const localizedBill = await call('account.move', 'create', { vals_list: [{ company_id: localCompanyId, move_type: 'in_invoice', partner_id: partner, invoice_date: '2026-11-02', invoice_line_ids: [[0, 0, { name: 'synthetic service', quantity: 1, price_unit: 100, account_id: localExpense.json?.[0]?.id, tax_ids: [[6, 0, [vat.id, taxId]]] }]] }], context: localeContext })
    if (localizedBill.status === 200) {
      const localBillId = localizedBill.json[0]
      taxResult = await call('account.move', 'action_post', { ids: [localBillId], context: localeContext })
      const header = await call('account.move', 'read', { ids: [localBillId], fields: ['amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual'], context: localeContext })
      const lines = await call('account.move.line', 'search_read', { domain: [['move_id', '=', localBillId], ['tax_line_id', '!=', false]], fields: ['tax_line_id', 'tax_base_amount', 'balance'], context: localeContext })
      const h = header.json?.[0]
      const vatLine = lines.json?.find?.((x) => x.tax_line_id?.[0] === vat.id)
      const withholdingLine = lines.json?.find?.((x) => x.tax_line_id?.[0] === taxId)
      taxVerified = secondTaxVerified && taxResult.status === 200 && h?.amount_untaxed === 100 && h?.amount_tax === 9 && h?.amount_total === 109 && h?.amount_residual === 109 && vatLine?.balance === 11 && withholdingLine?.balance === -2 && vatLine?.tax_base_amount === 100 && withholdingLine?.tax_base_amount === 100
    }
    await call('account.tax', 'write', { ids: [taxId], vals: { active: false }, context: localeContext })
  }
} finally {
  if (botId && previousCompanies.length) await call('res.users', 'write', { ids: [botId], vals: { company_ids: [[6, 0, previousCompanies]] } })
}
record('V-OPP6 Indonesian VAT and configured withholding', 'account.move/action_post', taxResult, taxVerified ? `verified configured tax; stock PPh entries ${stockPphCount ? 'present' : 'absent'}` : 'unverified')

// V-OPP7: post and reconcile two supplier payments, including an overpayment.
const expenseAccount = await call('account.account', 'search_read', { domain: [['account_type', '=', 'expense'], ['company_ids', 'in', [operatingCompanyId]]], fields: ['id'], limit: 1 })
const paymentJournal = await call('account.journal', 'search_read', { domain: [['type', '=', 'bank'], ['company_id', '=', operatingCompanyId]], fields: ['outbound_payment_method_line_ids'], limit: 1 })
const paymentBill = await call('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: partner, invoice_date: '2026-11-02', invoice_origin: 'synthetic anchor', narration: 'synthetic anchor', invoice_line_ids: [[0, 0, { name: 'synthetic service', quantity: 1, price_unit: 100, account_id: expenseAccount.json?.[0]?.id, tax_ids: [[5, 0, 0]] }]] }] })
let paymentResult = { status: paymentBill.status, json: null }
let paymentVerified = false
let firstPaymentId
if (paymentBill.status === 200 && paymentJournal.json?.[0]?.outbound_payment_method_line_ids?.length) {
  const billId = paymentBill.json[0]
  await attachExternalId('account.move', billId)
  const postedBill = await call('account.move', 'action_post', { ids: [billId] })
  const billStates = []
  const remainingCredits = []
  for (const amount of [40, 61]) {
    const payment = await call('account.payment', 'create', { vals_list: [{ payment_type: 'outbound', partner_type: 'supplier', partner_id: partner, amount, journal_id: paymentJournal.json[0].id, payment_method_line_id: paymentJournal.json[0].outbound_payment_method_line_ids[0], memo: 'synthetic anchor' }] })
    if (payment.status !== 200) { paymentResult = payment; break }
    const paymentId = payment.json[0]
    if (!firstPaymentId) { firstPaymentId = paymentId; await attachExternalId('account.payment', paymentId) }
    const posted = await call('account.payment', 'action_post', { ids: [paymentId] })
    if (amount === 40) {
      const postedAgain = await call('account.payment', 'action_post', { ids: [paymentId] })
      record('V-OPP11 repeat payment posting', 'account.payment/action_post', postedAgain, postedAgain.status === 200 && postedAgain.json === null ? 'accepted without validation error' : 'unverified')
    }
    const paymentRead = await call('account.payment', 'read', { ids: [paymentId], fields: ['move_id', 'memo'] })
    const paymentMoveId = paymentRead.json?.[0]?.move_id?.[0]
    const payable = await call('account.move.line', 'search_read', { domain: [['move_id', 'in', [billId, paymentMoveId]], ['account_type', '=', 'liability_payable'], ['reconciled', '=', false]], fields: ['amount_residual'] })
    if (posted.status !== 200 || payable.status !== 200 || payable.json.length !== 2) { paymentResult = posted.status !== 200 ? posted : payable; break }
    paymentResult = await call('account.move.line', 'reconcile', { ids: payable.json.map((x) => x.id) })
    const after = await call('account.move', 'read', { ids: [billId], fields: ['payment_state', 'amount_residual'] })
    billStates.push(after.json?.[0])
    const credit = await call('account.move.line', 'search_read', { domain: [['move_id', '=', paymentMoveId], ['account_type', '=', 'liability_payable']], fields: ['amount_residual'] })
    remainingCredits.push(credit.json?.[0]?.amount_residual)
  }
  paymentVerified = postedBill.status === 200 && paymentResult.status === 200 && billStates[0]?.payment_state === 'partial' && billStates[0]?.amount_residual === 60 && billStates[1]?.amount_residual === 0 && remainingCredits[1] === 1
}
// The bank method can use an outstanding account, leaving the bill in payment.
let unmatchedPaidVerified = false
const methodId = paymentJournal.json?.[0]?.outbound_payment_method_line_ids?.[0]
const paymentMethod = await call('account.payment.method.line', 'read', { ids: [methodId], fields: ['payment_account_id'] })
const originalPaymentAccount = paymentMethod.json?.[0]?.payment_account_id?.[0] || false
const outstanding = await call('account.account', 'search_read', { domain: [['name', '=', 'Outstanding Payments'], ['company_ids', 'in', [operatingCompanyId]]], fields: ['id'], limit: 1 })
try {
  if (outstanding.json?.[0]?.id) {
    await call('account.payment.method.line', 'write', { ids: [methodId], vals: { payment_account_id: outstanding.json[0].id } })
    const bill = await call('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: partner, invoice_date: '2026-11-02', invoice_line_ids: [[0, 0, { name: 'synthetic service', quantity: 1, price_unit: 100, account_id: expenseAccount.json?.[0]?.id, tax_ids: [[5, 0, 0]] }]] }] })
    if (bill.status === 200) {
      await call('account.move', 'action_post', { ids: bill.json })
      const pay = await call('account.payment', 'create', { vals_list: [{ payment_type: 'outbound', partner_type: 'supplier', partner_id: partner, amount: 100, journal_id: paymentJournal.json[0].id, payment_method_line_id: methodId, memo: 'synthetic bank payment' }] })
      if (pay.status === 200) {
        const posted = await call('account.payment', 'action_post', { ids: pay.json })
        const payRead = await call('account.payment', 'read', { ids: pay.json, fields: ['move_id', 'is_matched'] })
        const payable = await call('account.move.line', 'search_read', { domain: [['move_id', 'in', [bill.json[0], payRead.json?.[0]?.move_id?.[0]]], ['account_type', '=', 'liability_payable'], ['reconciled', '=', false]], fields: ['id'] })
        const reconciled = await call('account.move.line', 'reconcile', { ids: Array.isArray(payable.json) ? payable.json.map((x) => x.id) : [] })
        const after = await call('account.move', 'read', { ids: bill.json, fields: ['payment_state', 'amount_residual'] })
        unmatchedPaidVerified = posted.status === 200 && reconciled.status === 200 && after.json?.[0]?.payment_state === 'paid' && after.json?.[0]?.amount_residual === 0 && payRead.json?.[0]?.is_matched === false
      }
    }
  }
} finally {
  if (methodId) await call('account.payment.method.line', 'write', { ids: [methodId], vals: { payment_account_id: originalPaymentAccount } })
}
record('V-OPP7 payment posting and payable reconciliation', 'account.move.line/reconcile', paymentResult, paymentVerified && unmatchedPaidVerified ? 'verified; overpayment accepted; paid before bank matching' : paymentVerified ? 'partial; bank-matching state unverified' : 'unverified')

// V-OPP2: check candidate persistence, filtering, and a second user's edit.
const anchorCandidates = [
  ['purchase.order', poid, ['origin', 'note']],
  ['stock.picking', receiptPickingId, ['origin', 'note']],
  ['account.move', paymentBill.json?.[0], ['invoice_origin', 'narration']],
  ['account.payment', firstPaymentId, ['memo']],
]
let anchorChecks = true
let lastAnchorResult = { status: 0, json: null }
for (const [model, anchorId, fields] of anchorCandidates) {
  for (const field of fields) {
    const read = await call(model, 'read', { ids: [anchorId], fields: [field] })
    const matches = await call(model, 'search_read', { domain: [[field, 'ilike', 'synthetic anchor'], ['id', '=', anchorId]], fields: ['id'] })
    const edit = probeUser?.key ? await call(model, 'write', { ids: [anchorId], vals: { [field]: 'synthetic edited anchor' } }, { key: probeUser.key }) : { status: 0 }
    const edited = await call(model, 'read', { ids: [anchorId], fields: [field] })
    lastAnchorResult = edited
    if (read.status !== 200 || !String(read.json?.[0]?.[field]).includes('synthetic anchor') || matches.status !== 200 || matches.json?.length !== 1 || edit.status !== 200 || !String(edited.json?.[0]?.[field]).includes('synthetic edited anchor')) anchorChecks = false
  }
}
record('V-OPP2 candidate fields survive transitions and permit user edits', 'purchase fields/read+write+search_read', lastAnchorResult, anchorChecks && probeUser?.onchange_ok ? 'API edits verified; purchase onchange rewrites bill origin' : anchorChecks ? 'API edits verified; onchange unverified' : 'unverified')
// Stock external IDs survive independently of the document fields, but their write is a separate call.
let externalSurvived = externalIds.length === 4
let lastExternalResult = { status: 0, json: null }
for (const item of externalIds) {
  const found = await call('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo_probe'], ['name', '=', item.name]], fields: ['model', 'res_id'] })
  lastExternalResult = found
  if (item.status !== 200 || found.status !== 200 || found.json?.length !== 1 || found.json[0].model !== item.model || found.json[0].res_id !== item.resId) externalSurvived = false
}
let normalRead = { status: 0, json: null }
let normalCreate = { status: 0, json: null }
let systemRead = { status: 0, json: null }
let systemCreate = { status: 0, json: null }
if (probeUser?.key && externalIds.length) {
  const domain = [['module', '=', 'pmo_probe'], ['name', '=', externalIds[0].name]]
  normalRead = await call('ir.model.data', 'search_read', { domain, fields: ['model', 'res_id'] }, { key: probeUser.key })
  normalCreate = await call('ir.model.data', 'create', { vals_list: [{ module: 'pmo_probe', name: `${externalPrefix}_limited`, model: externalIds[0].model, res_id: externalIds[0].resId, noupdate: true }] }, { key: probeUser.key })
  const membership = await call('res.users', 'read', { ids: [probeUser.id], fields: ['group_ids'] })
  const priorGroups = membership.json?.[0]?.group_ids || []
  try {
    await call('res.users', 'write', { ids: [probeUser.id], vals: { group_ids: [[4, probeUser.groups['base.group_erp_manager']]] } })
    systemRead = await call('ir.model.data', 'search_read', { domain, fields: ['model', 'res_id'] }, { key: probeUser.key })
    systemCreate = await call('ir.model.data', 'create', { vals_list: [{ module: 'pmo_probe', name: `${externalPrefix}_system`, model: externalIds[0].model, res_id: externalIds[0].resId, noupdate: true }] }, { key: probeUser.key })
  } finally {
    await call('res.users', 'write', { ids: [probeUser.id], vals: { group_ids: [[6, 0, priorGroups]] } })
  }
  if (normalCreate.status === 200) await call('ir.model.data', 'unlink', { ids: normalCreate.json })
  if (systemCreate.status === 200) await call('ir.model.data', 'unlink', { ids: systemCreate.json })
}
const externalPermissions = [401, 403].includes(normalRead.status) && [401, 403].includes(normalCreate.status) && systemRead.status === 200 && systemRead.json?.length === 1 && systemCreate.status === 200
record('V-OPP2 external identifier candidate', 'ir.model.data/create+search_read', lastExternalResult, externalSurvived && externalPermissions ? 'survives; ordinary user denied; access-rights group succeeds; separate write' : 'unverified')
for (const item of externalIds) if (item.id) await call('ir.model.data', 'unlink', { ids: [item.id] })

// V-OPP10: exercise a purchase-to-payment path as the limited service user.
let limitedResult = { status: 0, json: null }
const limitedStages = []
if (probeUser?.key) {
  const asLimited = (model, method, body) => call(model, method, body, { key: probeUser.key })
  const limitedOrder = await asLimited('purchase.order', 'create', { vals_list: [{ partner_id: partner, order_line: [[0, 0, { product_id: receiptProduct.json?.[0], product_qty: 1, price_unit: 10 }]] }] })
  limitedStages.push(limitedOrder.status)
  if (limitedOrder.status === 200) {
    const limitedId = limitedOrder.json[0]
    const confirm = await asLimited('purchase.order', 'button_confirm', { ids: [limitedId] })
    const pick = await asLimited('stock.picking', 'search_read', { domain: [['purchase_id', '=', limitedId]], fields: ['move_ids'], limit: 1 })
    const qty = await asLimited('stock.move', 'write', { ids: pick.json?.[0]?.move_ids || [], vals: { quantity: 1 } })
    const validate = await asLimited('stock.picking', 'button_validate', { ids: [pick.json?.[0]?.id] })
    limitedStages.push(confirm.status, pick.status, qty.status, validate.status)
    const line = await asLimited('purchase.order.line', 'search_read', { domain: [['order_id', '=', limitedId]], fields: ['id'], limit: 1 })
    const bill = await asLimited('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: partner, invoice_date: '2026-11-02', invoice_line_ids: [[0, 0, { name: 'synthetic service', quantity: 1, price_unit: 10, account_id: expenseAccount.json?.[0]?.id, purchase_line_id: line.json?.[0]?.id, tax_ids: [[5, 0, 0]] }]] }] })
    limitedStages.push(line.status, bill.status)
    if (bill.status === 200) {
      const billId = bill.json[0]
      const posted = await asLimited('account.move', 'action_post', { ids: [billId] })
      const pay = await asLimited('account.payment', 'create', { vals_list: [{ payment_type: 'outbound', partner_type: 'supplier', partner_id: partner, amount: 10, journal_id: paymentJournal.json?.[0]?.id, payment_method_line_id: paymentJournal.json?.[0]?.outbound_payment_method_line_ids?.[0], memo: 'synthetic payment' }] })
      limitedStages.push(posted.status, pay.status)
      if (pay.status === 200) {
        const postedPay = await asLimited('account.payment', 'action_post', { ids: pay.json })
        const paymentMove = await asLimited('account.payment', 'read', { ids: pay.json, fields: ['move_id'] })
        const payable = await asLimited('account.move.line', 'search_read', { domain: [['move_id', 'in', [billId, paymentMove.json?.[0]?.move_id?.[0]]], ['account_type', '=', 'liability_payable'], ['reconciled', '=', false]], fields: ['id'] })
        limitedResult = await asLimited('account.move.line', 'reconcile', { ids: (payable.json || []).map((x) => x.id) })
        limitedStages.push(postedPay.status, paymentMove.status, payable.status, limitedResult.status)
      }
    }
  }
}
const limitedExtra = []
if (probeUser?.key) {
  const asLimited = (model, method, body) => call(model, method, body, { key: probeUser.key })
  const taxes = await asLimited('account.tax', 'search_read', { domain: [['type_tax_use', '=', 'purchase']], fields: ['amount'], limit: 1 })
  const analytics = await asLimited('account.analytic.account', 'search_read', { fields: ['id'], limit: 1 })
  limitedExtra.push(['tax directory', taxes.status], ['analytic directory', analytics.status])
  const order = await asLimited('purchase.order', 'create', { vals_list: [{ partner_id: partner, order_line: [[0, 0, { product_id: receiptProduct.json?.[0], product_qty: 2, price_unit: 10 }]] }] })
  limitedExtra.push(['partial order', order.status])
  if (order.status === 200) {
    const confirmed = await asLimited('purchase.order', 'button_confirm', { ids: order.json })
    const pick = await asLimited('stock.picking', 'search_read', { domain: [['purchase_id', '=', order.json[0]]], fields: ['move_ids'], limit: 1 })
    const quantity = await asLimited('stock.move', 'write', { ids: pick.json?.[0]?.move_ids || [], vals: { quantity: 1 } })
    const action = await asLimited('stock.picking', 'button_validate', { ids: [pick.json?.[0]?.id] })
    limitedExtra.push(['confirm partial', confirmed.status], ['read transfer', pick.status], ['enter quantity', quantity.status], ['validate partial', action.status])
    if (action.status === 200 && action.json?.res_model === 'stock.backorder.confirmation') {
      const wizard = await asLimited('stock.backorder.confirmation', 'create', { vals_list: [{}], context: action.json.context })
      const processed = wizard.status === 200 ? await asLimited('stock.backorder.confirmation', 'process', { ids: wizard.json, context: action.json.context }) : wizard
      limitedExtra.push(['backorder wizard', processed.status])
    } else limitedExtra.push(['backorder wizard', 0])
    const orderLines = await asLimited('purchase.order.line', 'search_read', { domain: [['order_id', '=', order.json[0]]], fields: ['id'], limit: 1 })
    const revised = await asLimited('purchase.order', 'write', { ids: order.json, vals: { order_line: [[1, orderLines.json?.[0]?.id, { product_qty: 3 }]] } })
    limitedExtra.push(['revise order', revised.status])
  }
  const lot = await asLimited('stock.lot', 'create', { vals_list: [{ name: `synthetic-lot-${Date.now()}`, product_id: trackedProduct.json?.[0] }] })
  limitedExtra.push(['create lot', lot.status])
}
const groupChecks = []
if (probeUser?.groups && limitedStages.length === 13 && limitedStages.every((status) => status === 200)) {
  const memberships = await call('res.users', 'read', { ids: [probeUser.id], fields: ['group_ids'] })
  const originalGroups = memberships.json?.[0]?.group_ids || []
  for (const [groupName, groupId] of Object.entries(probeUser.groups)) {
    if (groupName === 'base.group_erp_manager') continue
    await call('res.users', 'write', { ids: [probeUser.id], vals: { group_ids: [[3, groupId]] } })
    let trial
    if (groupName === 'purchase.group_purchase_user') {
      trial = await call('purchase.order', 'create', { vals_list: [{ partner_id: partner }] }, { key: probeUser.key })
      if (trial.status === 200) { await call('purchase.order', 'button_cancel', { ids: trial.json }); await call('purchase.order', 'unlink', { ids: trial.json }) }
    } else if (groupName === 'stock.group_stock_user') {
      trial = await call('stock.lot', 'create', { vals_list: [{ name: `synthetic-permission-${Date.now()}`, product_id: trackedProduct.json?.[0] }] }, { key: probeUser.key })
      if (trial.status === 200) await call('stock.lot', 'unlink', { ids: trial.json })
    } else {
      const draft = await call('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: partner, invoice_date: '2026-11-02', invoice_line_ids: [[0, 0, { name: 'synthetic service', quantity: 1, price_unit: 10, account_id: expenseAccount.json?.[0]?.id, tax_ids: [[5, 0, 0]] }]] }] }, { key: probeUser.key })
      trial = draft.status === 200 ? await call('account.move', 'action_post', { ids: draft.json }, { key: probeUser.key }) : draft
      if (draft.status === 200 && trial.status !== 200) await call('account.move', 'unlink', { ids: draft.json })
    }
    groupChecks.push(`${groupName}: ${[401, 403].includes(trial.status) ? 'required' : trial.status === 200 ? 'not required for this call' : 'inconclusive'}`)
    await call('res.users', 'write', { ids: [probeUser.id], vals: { group_ids: [[6, 0, originalGroups]] } })
  }
}
record('V-OPP10 limited service user purchase-to-payment', 'purchase and accounting calls', limitedResult, limitedStages.length === 13 && limitedStages.every((status) => status === 200) && limitedExtra.length === 10 && limitedExtra.every(([, status]) => status === 200) ? `path verified; ${groupChecks.join('; ')}` : `unverified: ${limitedExtra.filter(([, status]) => status !== 200).map(([label]) => label).join(', ')}`)
if (probeUser?.id) await call('res.users', 'write', { ids: [probeUser.id], vals: { active: false } })

// V-OPP8: exercise actual page boundaries and timestamp ties on all four models.
const pageMarker = `synthetic-page-${Date.now()}`
const pagePicking = await call('stock.picking', 'read', { ids: [receiptPickingId], fields: ['picking_type_id', 'location_id', 'location_dest_id'] })
const pageJournal = await call('account.journal', 'search_read', { domain: [['type', '=', 'bank'], ['company_id', '=', operatingCompanyId]], fields: ['outbound_payment_method_line_ids'], limit: 1 })
const pickingSetup = pagePicking.json?.[0]
const journalSetup = pageJournal.json?.[0]
const pageCases = [
  ['purchase.order', 'origin', { partner_id: partner, origin: pageMarker }],
  ['stock.picking', 'origin', { picking_type_id: pickingSetup?.picking_type_id?.[0], location_id: pickingSetup?.location_id?.[0], location_dest_id: pickingSetup?.location_dest_id?.[0], origin: pageMarker }],
  ['account.move', 'ref', { move_type: 'in_invoice', partner_id: partner, ref: pageMarker }],
  ['account.payment', 'memo', { payment_type: 'outbound', partner_type: 'supplier', partner_id: partner, amount: 1, journal_id: journalSetup?.id, payment_method_line_id: journalSetup?.outbound_payment_method_line_ids?.[0], memo: pageMarker }],
]
if (!process.argv.includes('--skip-paging')) for (const [model, marker, vals] of pageCases) {
  const ids = []
  let lastStatus = 200
  let passed = true
  try {
    for (let index = 0; index < 11; index++) {
      const created = await call(model, 'create', { vals_list: Array.from({ length: index === 10 ? 1 : 100 }, () => vals) })
      lastStatus = created.status
      if (created.status !== 200 || !Array.isArray(created.json)) { passed = false; break }
      ids.push(...created.json)
    }
    if (ids.length !== 1001) passed = false
    for (const limit of [200, 1000]) {
      const seen = []
      let cursor = null
      do {
        const domain = [[marker, '=', pageMarker]]
        if (model === 'account.move') domain.push(['move_type', '=', 'in_invoice'])
        if (model === 'account.payment') domain.push(['payment_type', '=', 'outbound'], ['partner_type', '=', 'supplier'])
        if (cursor) domain.push('|', ['write_date', '>', cursor.write_date], '&', ['write_date', '=', cursor.write_date], ['id', '>', cursor.id])
        const page = await call(model, 'search_read', { domain, fields: ['id', 'write_date'], order: 'write_date asc, id asc', limit })
        lastStatus = page.status
        if (page.status !== 200 || !Array.isArray(page.json)) { passed = false; break }
        seen.push(...page.json)
        cursor = page.json.length === limit ? page.json.at(-1) : null
      } while (cursor)
      if (seen.length !== 1001 || new Set(seen.map((x) => x.id)).size !== 1001 || !seen.every((x) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(x.write_date))) passed = false
    }
  } finally {
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100)
      if (model === 'purchase.order') await call(model, 'button_cancel', { ids: batch })
      const removed = await call(model, 'unlink', { ids: batch })
      if (removed.status !== 200) passed = false
    }
  }
  record(`V-OPP8 ${model} keyset paging`, `${model}/search_read`, { status: lastStatus, json: { pagesChecked: true } }, passed ? 'verified' : 'unverified')
}

// A draft with a product removed is a confirmation validation failure.
const invalidOrder = await call('purchase.order', 'create', { vals_list: [{ partner_id: partner, order_line: [[0, 0, { product_id: prod, product_qty: 1, price_unit: 10 }]] }] })
if (invalidOrder.status === 200) {
  const invalidLines = await call('purchase.order.line', 'search_read', { domain: [['order_id', '=', invalidOrder.json[0]]], fields: ['id'] })
  const unsetProduct = await call('purchase.order.line', 'write', { ids: (invalidLines.json || []).map((x) => x.id), vals: { product_id: false } })
  const invalidConfirm = await call('purchase.order', 'button_confirm', { ids: invalidOrder.json })
  record('V-OPP11 order confirmation error', 'purchase.order/button_confirm', invalidConfirm, unsetProduct.status === 200 && invalidConfirm.status === 422 ? 'validation-error' : 'unverified')
  await call('purchase.order', 'button_cancel', { ids: invalidOrder.json })
  await call('purchase.order', 'unlink', { ids: invalidOrder.json })
}

// V-OPP11: validation errors are recorded as shapes, never exception text.
for (const [model, vals] of [
  ['purchase.order', {}],
  ['stock.picking', {}],
  ['account.payment', { amount: -1, payment_type: 'outbound' }],
]) {
  const error = await call(model, 'create', { vals_list: [vals] })
  record(`V-OPP11 ${model} validation error`, `${model}/create`, error, error.status === 422 ? 'validation-error' : 'unverified')
}
const invalidBill = await call('account.move', 'create', { vals_list: [{ move_type: 'in_invoice' }] })
if (invalidBill.status === 200) {
  const billError = await call('account.move', 'action_post', { ids: invalidBill.json })
  record('V-OPP11 account.move validation error', 'account.move/action_post', billError, billError.status === 422 ? 'validation-error' : 'unverified')
  await call('account.move', 'unlink', { ids: invalidBill.json })
}

for (const x of results) console.log(JSON.stringify(x))
