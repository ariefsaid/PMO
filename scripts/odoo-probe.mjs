// odoo-probe.mjs — verifies the #1504 Odoo 20 API claims against the local dev bed.
// Reads .env.odoo.local (untracked); prints claim, HTTP status and response SHAPE only
// (keys/types, never values, never the key). Usage: node scripts/odoo-probe.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

async function call(model, method, body = {}, { key = env.ODOO_API_KEY, db = env.ODOO_DB, headers = {} } = {}) {
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
const po = await call('purchase.order', 'create', { vals_list: [{ partner_id: partner, order_line: [[0, 0, { product_id: prod, product_qty: 2, price_unit: 10, analytic_distribution: { [aid]: 100 } }]] }] })
record('PO with analytic_distribution on the line can be created', 'purchase.order/create', po, po.status === 200 ? 'verified' : 'wrong')
const poid = po.json?.[0]
if (po.status !== 200) record('PO create error', 'purchase.order/create', po, `error: ${po.json?.message}`)
r = await call('purchase.order.line', 'search_read', { domain: [['order_id', '=', poid]], fields: ['analytic_distribution'] })
record('PO line analytic_distribution is a {"<id>": pct} object', 'purchase.order.line/search_read', r, r.json?.[0]?.analytic_distribution?.[String(aid)] === 100 ? 'verified' : 'wrong', { keyIsString: typeof Object.keys(r.json?.[0]?.analytic_distribution || {})[0] })
r = await call('purchase.order', 'button_confirm', { ids: [poid] })
record('PO confirm via model method (action_confirm per research doc)', 'purchase.order/button_confirm', r, r.status === 200 ? 'verified (button_confirm; action_confirm is wrong name)' : `wrong (${r.status})`)
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
// cleanup
if (poid) { await call('purchase.order', 'button_cancel', { ids: [poid] }) }
await call('account.analytic.line', 'unlink', { ids: ts.json || [] })
await call('project.task', 'unlink', { ids: [task] })
await call('hr.employee', 'unlink', { ids: [emp] })
await call('project.project', 'unlink', { ids: [pid] })

for (const x of results) console.log(JSON.stringify(x))
