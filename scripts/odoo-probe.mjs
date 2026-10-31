// odoo-probe.mjs — verifies the #1504 Odoo 20 API claims against the local dev bed.
// Reads .env.odoo.local (untracked); prints claim, HTTP status and response SHAPE only
// (keys/types, never values, never the key). Usage: node scripts/odoo-probe.mjs
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

// ===== O1 S0 follow-ups (#1504 plan S0-T1..T17). Shapes/facts only; never values or keys. =====
const s0 = (id, claim, r, verdict, facts) => record(`${id} ${claim}`, id, r, verdict, facts)
const fieldsOf = (m, attrs = ['type']) => call(m, 'fields_get', { attributes: attrs })
const dockerRun = (script) => {
  const compose = ['compose', '-f', fileURLToPath(new URL('./odoo-bed/compose.yml', import.meta.url)), '--env-file', envPath]
  return execFileSync('docker', [...compose, 'run', '--rm', '--no-deps', '-T', 'odoo', 'odoo', 'shell', '-d', env.ODOO_DB, '--no-http'], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] })
}
const cleanup = []
process.on('uncaughtException', async (e) => {
  console.error(String(e).slice(0, 300))
  for (const f of cleanup.reverse()) { try { await f() } catch {} }
  for (const x of results) console.log(JSON.stringify(x))
  process.exit(1)
})
const ids1 = (r) => (Array.isArray(r.json) ? r.json : [])

// Bed precondition: account.analytic.plan is gated by the Analytic Accounting group, which the bed bot lacks. Record, then grant.
{
  const before = await call('account.analytic.plan', 'search_read', { fields: ['id'], limit: 1 })
  const grp = (await call('ir.model.data', 'search_read', { domain: [['module', '=', 'analytic'], ['name', '=', 'group_analytic_accounting'], ['model', '=', 'res.groups']], fields: ['res_id'] })).json?.[0]?.res_id
  const bot = (await call('res.users', 'search_read', { domain: [['login', '=', 'pmo_adapter_bot']], fields: ['id'] })).json?.[0]?.id
  if (before.status !== 200) await call('res.users', 'write', { ids: [bot], vals: { group_ids: [[4, grp]] } })
  const after = await call('account.analytic.plan', 'search_read', { fields: ['id'], limit: 1 })
  s0('S0-T8-pre', 'analytic plan read needs analytic.group_analytic_accounting (admin-group bot lacked it)', before, before.status === 403 ? 'verified (403 until the group is granted)' : `status ${before.status}`, { beforeStatus: before.status, errorName: before.json?.name, afterGrantStatus: after.status })
}
// T1 (V1/V2) error body shapes
{
  const wrongDb = await call('res.partner', 'search_read', { fields: ['id'], limit: 1 }, { db: 'no_such_db' })
  s0('S0-T1a', 'wrong X-Odoo-Database', wrongDb, wrongDb.status >= 400 ? 'verified (rejected)' : 'not rejected (single-db host ignores header)', { status: wrongDb.status, name: wrongDb.json?.name, bodyType: typeof wrongDb.json })
  const noModel = await call('no.such.model', 'search_read', {})
  const noMethod = await call('res.partner', 'no_such_method', {})
  const forbidden = null
  s0('S0-T1b', '404 unknown model vs unknown method distinguishable by name', noModel, noModel.json?.name !== noMethod.json?.name || noModel.json?.message !== noMethod.json?.message ? 'verified (distinguishable)' : 'wrong (identical name and message)', { unknownModel: { status: noModel.status, name: noModel.json?.name }, unknownMethod: { status: noMethod.status, name: noMethod.json?.name, message: String(noMethod.json?.message).slice(0, 80) }, unknownModelMessage: String(noModel.json?.message).slice(0, 80), forbidden: 'see S0-T13h' })
}

// T17 (V17) version discovery
{
  const vr = await fetch(`${base}/web/webclient/version_info`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }) })
  const vj = await vr.json().catch(() => null)
  const vi = vj?.result?.server_version_info
  s0('S0-T17a', 'POST /web/webclient/version_info returns server_version_info[0]', { status: vr.status, json: vj }, Array.isArray(vi) && typeof vi[0] === 'number' ? 'verified' : 'wrong', { major: vi?.[0], resultKeys: Object.keys(vj?.result || {}) })
  const fb = await call('ir.module.module', 'search_read', { domain: [['name', '=', 'base']], fields: ['latest_version', 'installed_version'] })
  s0('S0-T17b', 'fallback ir.module.module base latest_version', fb, fb.status === 200 && fb.json?.[0]?.latest_version ? 'verified' : `wrong (${fb.status})`, { versionShape: String(fb.json?.[0]?.latest_version || '').replace(/\d+/g, 'N') })
}

// T13 (V16, SD-7) minimal internal user: leave-one-out over candidate groups, key via odoo shell
const GROUPS = ['base.group_user', 'base.group_partner_manager', 'account.group_account_user', 'account.group_account_readonly', 'analytic.group_analytic_accounting', 'purchase.group_purchase_user', 'stock.group_stock_user', 'project.group_project_user', 'uom.group_uom', 'product.group_product_manager']
const gid = {}
for (const x of GROUPS) {
  const [mod, name] = x.split('.')
  const q = await call('ir.model.data', 'search_read', { domain: [['module', '=', mod], ['name', '=', name], ['model', '=', 'res.groups']], fields: ['res_id'] })
  if (q.json?.[0]) gid[x] = q.json[0].res_id
}
const present = Object.keys(gid)
const uCreate = await call('res.users', 'create', { vals_list: [{ name: 'PMO S0 min', login: `s0_min_${Date.now()}`, group_ids: [[6, 0, present.map((g) => gid[g])]] }] })
const minId = uCreate.json?.[0]
cleanup.push(() => call('res.users', 'write', { ids: [minId], vals: { active: false } }))
s0('S0-T13a', 'create minimal internal user', uCreate, uCreate.status === 200 ? 'verified' : `wrong (${uCreate.status}: ${uCreate.json?.message?.slice?.(0, 100)})`, { groupsFound: present, groupsMissing: GROUPS.filter((g) => !gid[g]) })
const mintKey = (name) => (dockerRun(`import datetime
u = self.env['res.users'].browse(${minId})
cap = max(g.api_key_duration for g in u.all_group_ids) or 1.0
k = self.env['res.users.apikeys'].with_user(u)._generate('rpc', '${name}', datetime.datetime.now() + datetime.timedelta(days=cap * 0.9))
print('CAP=' + str(cap))
print('KEY=' + str(k))
self.env.cr.commit()
`).match(/^(KEY|CAP)=(.+)$/gm) || []).reduce((o, l) => ({ ...o, [l.slice(0, 3)]: l.slice(4) }), {})
const minMint = mintKey('s0-min')
const minKey = minMint.KEY || ''
const capDays = Number(minMint.CAP)
const M = (m, meth, body) => call(m, meth, body, { key: minKey })
const auth = await M('res.partner', 'search_read', { fields: ['id'], limit: 1 })
s0('S0-T13b', 'minimal user key authenticates', auth, auth.status === 200 ? 'verified' : `wrong (${auth.status})`, {})
const planId = (await call('account.analytic.plan', 'search_read', { fields: ['id'], limit: 1 })).json?.[0]?.id
const probes = {
  readCompany: async () => (await M('res.company', 'search_read', { fields: ['id', 'name', 'currency_id'], limit: 5 })).status,
  readPartner: async () => (await M('res.partner', 'search_read', { fields: ['id', 'write_date'], limit: 1 })).status,
  readProduct: async () => (await M('product.product', 'search_read', { fields: ['id'], limit: 1 })).status,
  readUom: async () => (await M('uom.uom', 'search_read', { fields: ['id'], limit: 1 })).status,
  readAccount: async () => (await M('account.account', 'search_read', { fields: ['id'], limit: 1 })).status,
  readTax: async () => (await M('account.tax', 'search_read', { fields: ['id'], limit: 1 })).status,
  readPlan: async () => (await M('account.analytic.plan', 'search_read', { fields: ['id'], limit: 1 })).status,
  readAnalytic: async () => (await M('account.analytic.account', 'search_read', { fields: ['id'], limit: 1 })).status,
  readWarehouse: async () => (await M('stock.warehouse', 'search_read', { fields: ['id'], limit: 1 })).status,
  readLocation: async () => (await M('stock.location', 'search_read', { fields: ['id'], limit: 1 })).status,
  readProject: async () => (await M('project.project', 'search_read', { fields: ['id'], limit: 1 })).status,
  createPartner: async () => { const r = await M('res.partner', 'create', { vals_list: [{ name: 'S0 min p', ref: 'pmo:s0' }] }); if (r.json?.[0]) cleanup.push(() => call('res.partner', 'unlink', { ids: r.json })); return r.status },
  createProduct: async () => { const r = await M('product.product', 'create', { vals_list: [{ name: 'S0 min item', default_code: 'S0-MIN', purchase_ok: true }] }); if (r.json?.[0]) cleanup.push(() => call('product.product', 'unlink', { ids: r.json })); return r.status },
  createAnalytic: async () => { const r = await M('account.analytic.account', 'create', { vals_list: [{ name: 'S0 min acc', code: 'S0-MIN', plan_id: planId }] }); if (r.json?.[0]) cleanup.push(() => call('account.analytic.account', 'unlink', { ids: r.json })); return r.status },
}
const runAll = async () => { const o = {}; for (const [k, f] of Object.entries(probes)) o[k] = await f(); return o }
const full = await runAll()
s0('S0-T13c', 'minimal user, full candidate group set: status per operation', { status: 200, json: {} }, Object.values(full).every((s) => s === 200) ? 'verified (all pass)' : 'partial', full)
const needed = {}
for (const g of present.filter((x) => x !== 'base.group_user')) {
  await call('res.users', 'write', { ids: [minId], vals: { group_ids: [[3, gid[g]]] } })
  const o = await runAll()
  const broke = Object.keys(o).filter((k) => o[k] !== full[k])
  needed[g] = broke.length ? broke : 'not needed'
  await call('res.users', 'write', { ids: [minId], vals: { group_ids: [[4, gid[g]]] } })
}
s0('S0-T13d', 'leave-one-out: operations that break when one group is removed', { status: 200, json: {} }, 'recorded', needed)
{
  const exact = ['base.group_user', 'base.group_partner_manager', 'product.group_product_manager']
  await call('res.users', 'write', { ids: [minId], vals: { group_ids: [[6, 0, exact.map((g) => gid[g])]] } })
  const o = await runAll()
  const gp = await call('res.users', 'read', { ids: [minId], fields: ['group_ids'] })
  s0('S0-T13h', 'exact set base.group_user + base.group_partner_manager + product.group_product_manager: status per operation', { status: 200, json: {} }, Object.values(o).every((x) => x === 200) ? 'verified (all pass)' : 'partial', { ...o, effectiveGroupCount: gp.json?.[0]?.group_ids?.length })
  const forb = await M('ir.config_parameter', 'search_read', { fields: ['key'], limit: 1 })
  s0('S0-T1c', 'valid key, model forbidden: status and body', forb, forb.status === 403 ? 'verified (403)' : `status ${forb.status}`, { name: forb.json?.name, message: String(forb.json?.message || '').slice(0, 60) })
  await call('res.users', 'write', { ids: [minId], vals: { group_ids: [[6, 0, present.map((g) => gid[g])]] } })
}
{
  const stamp = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 19).replace('T', ' ')
  const gen = (exp) => M('res.users.apikeys', 'generate', { key: minKey, scope: 'rpc', name: 's0-gen', expiration_date: exp })
  const gen0 = await gen(stamp(capDays * 0.5))
  await call('ir.config_parameter', 'set_bool', { key: 'base.enable_programmatic_api_keys', value: true })
  const [gFar, gNull, gNear] = [await gen(stamp(capDays * 4)), await gen(null), await gen(stamp(capDays * 0.5))]
  const body = (g) => (g.status === 200 ? 'key' : { name: g.json?.name, message: String(g.json?.message || '').slice(0, 160) })
  s0('S0-T13e', 'minimal user key expiry cap (4x cap / null / 0.5x cap)', { status: 200, json: {} }, 'recorded', { capDays, paramOffDefault: { status: gen0.status, body: body(gen0) }, far4x: { status: gFar.status, body: body(gFar) }, nullExpiry: { status: gNull.status, body: body(gNull) }, nearHalf: { status: gNear.status, body: body(gNear) } })
  if (gNear.status === 200) {
    const rv = await M('res.users.apikeys', 'revoke', { key: gNear.json })
    const afterRv = await call('res.partner', 'search_read', { fields: ['id'], limit: 1 }, { key: gNear.json })
    s0('S0-T13f', 'revoked key error body', afterRv, afterRv.status === 401 ? 'verified (401)' : `wrong (${afterRv.status})`, { revoke: rv.status, name: afterRv.json?.name, message: String(afterRv.json?.message || '').slice(0, 80) })
  }
  for (const g of [gFar, gNull]) if (g.status === 200) await M('res.users.apikeys', 'revoke', { key: g.json })
  await call('ir.config_parameter', 'set_bool', { key: 'base.enable_programmatic_api_keys', value: false })
  const out = dockerRun(`import datetime
u = self.env['res.users'].browse(${minId})
k = self.env['res.users.apikeys'].with_user(u)._generate('rpc', 's0-exp', datetime.datetime.now() + datetime.timedelta(hours=1))
self.env.cr.execute("update res_users_apikeys set expiration_date = now() at time zone 'utc' - interval '1 day' where name = 's0-exp'")
print('KEY=' + str(k))
self.env.cr.commit()
`)
  const expKey = (out.match(/^KEY=(.+)$/m) || [])[1] || ''
  const ex = await call('res.partner', 'search_read', { fields: ['id'], limit: 1 }, { key: expKey })
  s0('S0-T13g', 'expired key error body', ex, ex.status === 401 ? 'verified (401)' : `check (${ex.status})`, { name: ex.json?.name, message: String(ex.json?.message || '').slice(0, 80) })
}

// T2 (V3)
{
  const r = await M('res.company', 'search_read', { fields: ['id', 'name', 'currency_id'], limit: 50 })
  s0('S0-T2', 'res.company search_read as minimal user', r, r.status === 200 && Array.isArray(r.json) ? 'verified' : `wrong (${r.status})`, { rowShape: shape(r.json?.[0]), count: r.json?.length })
}
// T3 (V4)
{
  const r1 = await M('ir.module.module', 'search_read', { fields: ['name'], limit: 1 })
  s0('S0-T3a', 'ir.module.module read as minimal user (expect 403)', r1, r1.status === 403 ? 'verified (403)' : `wrong (internal user can read ir.module.module: ${r1.status})`, { name: r1.json?.name })
  const r2 = await M('res.partner', 'fields_get', { attributes: ['type'] })
  s0('S0-T3b', 'res.partner/fields_get {attributes:[type]} as minimal user', r2, r2.status === 200 ? 'verified' : `wrong (${r2.status})`, { fieldCount: Object.keys(r2.json || {}).length })
  const ha = await M('res.partner', 'has_access', { operation: 'create' })
  const car = await M('res.partner', 'check_access_rights', { operation: 'create', raise_exception: false })
  s0('S0-T3c', 'access-check method in 20 (has_access vs check_access_rights)', ha, 'recorded', { has_access: { status: ha.status, value: ha.json?.name ? ha.json.name : ha.json }, check_access_rights: { status: car.status, name: car.json?.name } })
}
// T4 (V5)
{
  const f = await fieldsOf('product.product')
  const want = ['default_code', 'purchase_ok', 'sale_ok', 'is_storable', 'type', 'uom_id', 'active']
  s0('S0-T4a', 'product.product fields', f, want.every((k) => k in (f.json || {})) ? 'verified' : 'wrong', Object.fromEntries(want.map((k) => [k, f.json?.[k]?.type || 'MISSING'])))
  const uom = (await call('uom.uom', 'search_read', { fields: ['id'], limit: 1 })).json?.[0]?.id
  const c = await M('product.product', 'create', { vals_list: [{ default_code: 'S0-T4', name: 'S0 T4 item', uom_id: uom, purchase_ok: true }] })
  if (c.json?.[0]) cleanup.push(() => call('product.product', 'unlink', { ids: c.json }))
  const rd = c.json?.[0] ? await call('product.product', 'read', { ids: c.json, fields: ['default_code', 'type', 'is_storable', 'uom_id', 'purchase_ok', 'sale_ok'] }) : null
  s0('S0-T4b', 'product.product create with default_code,name,uom_id,purchase_ok', c, c.status === 200 && Array.isArray(c.json) ? 'verified' : `wrong (${c.status}: ${c.json?.message?.slice?.(0, 100)})`, { readBack: shape(rd?.json?.[0]), type: rd?.json?.[0]?.type, is_storable: rd?.json?.[0]?.is_storable, sale_ok: rd?.json?.[0]?.sale_ok })
}
// T5 (V6)
{
  const f = await fieldsOf('res.partner')
  const want = ['is_company', 'parent_id', 'vat', 'ref', 'active', 'supplier_rank', 'customer_rank', 'property_payment_term_id']
  s0('S0-T5a', 'res.partner fields', f, want.every((k) => k in (f.json || {})) ? 'verified' : 'wrong', Object.fromEntries(want.map((k) => [k, f.json?.[k]?.type || 'MISSING'])))
  const c = await M('res.partner', 'create', { vals_list: [{ name: 'S0 T5 partner', is_company: true, ref: 'pmo:t5' }] })
  if (c.json?.[0]) cleanup.push(() => call('res.partner', 'unlink', { ids: c.json }))
  const rd = await call('res.partner', 'read', { ids: ids1(c), fields: ['supplier_rank', 'customer_rank', 'ref', 'active'] })
  s0('S0-T5b', 'new partner ranks are 0', rd, rd.json?.[0]?.supplier_rank === 0 && rd.json?.[0]?.customer_rank === 0 ? 'verified (0/0)' : 'wrong', { supplier_rank: rd.json?.[0]?.supplier_rank, customer_rank: rd.json?.[0]?.customer_rank })
}
// T6 (V7)
{
  const r = await call('uom.uom', 'search_read', { fields: ['name', 'relative_factor', 'relative_uom_id', 'active'], limit: 5 })
  s0('S0-T6', 'uom.uom fields', r, r.status === 200 ? 'verified' : `wrong (${r.status})`, { rowShape: shape(r.json?.[0]), count: (await call('uom.uom', 'search_count', { domain: [] })).json })
}
// T7 (V8)
{
  const f = await fieldsOf('account.account', ['type', 'selection'])
  const F = f.json || {}
  s0('S0-T7', 'account.account company_ids vs company_id, account_type values, active/deprecated', f, 'recorded', { company_ids: F.company_ids?.type || 'absent', company_id: F.company_id?.type || 'absent', active: F.active?.type || 'absent', deprecated: F.deprecated?.type || 'absent', account_type: (F.account_type?.selection || []).map((x) => x[0]) })
}
// T8 (V9)
{
  const plans = await call('account.analytic.plan', 'search_read', { fields: ['name', 'parent_id'], context: { active_test: false } })
  const f = await fieldsOf('account.analytic.account')
  const want = ['plan_id', 'company_id', 'code', 'active']
  s0('S0-T8a', 'analytic plans present', plans, 'recorded', { status: plans.status, count: plans.json?.length, names: Array.isArray(plans.json) ? plans.json.map((p) => p.name) : { name: plans.json?.name, message: String(plans.json?.message).slice(0, 120) } })
  s0('S0-T8b', 'analytic account fields', f, want.every((k) => k in (f.json || {})) ? 'verified' : 'wrong', Object.fromEntries(want.map((k) => [k, f.json?.[k]?.type || 'MISSING'])))
  const a = await call('account.analytic.account', 'create', { vals_list: [{ name: 'S0 dup A', code: 'S0-DUP', plan_id: planId }] })
  const b = await call('account.analytic.account', 'create', { vals_list: [{ name: 'S0 dup B', code: 'S0-DUP', plan_id: planId }] })
  for (const x of [a, b]) if (x.json?.[0]) cleanup.push(() => call('account.analytic.account', 'unlink', { ids: x.json }))
  s0('S0-T8c', 'analytic account code is not unique-constrained', b, b.status === 200 ? 'verified (not unique)' : `unique enforced (${b.status})`, {})
  const pf = await call('project.project', 'fields_get', { attributes: ['type', 'relation'] })
  s0('S0-T8d', 'project.project analytic/plan link fields', pf, 'recorded', { account_id: pf.json?.account_id, planLike: Object.keys(pf.json || {}).filter((k) => /plan/.test(k)) })
}
// T9 (V10)
{
  const c = await call('res.partner', 'create', { vals_list: [{ name: 'S0 T9 archived', active: false }] })
  cleanup.push(() => call('res.partner', 'unlink', { ids: ids1(c) }))
  const without = await call('res.partner', 'search_read', { domain: [['id', '=', c.json[0]]], fields: ['id'] })
  const withAll = await call('res.partner', 'search_read', { domain: [['id', '=', c.json[0]]], fields: ['id'], context: { active_test: false } })
  s0('S0-T9', 'context active_test:false returns archived partners', withAll, withAll.json?.length === 1 && without.json?.length === 0 ? 'verified' : 'wrong', { without: without.json?.length, with: withAll.json?.length })
}
// T10 (V13)
{
  if (!(await call('account.tax', 'search_read', { fields: ['id'], domain: [['name', 'ilike', 'WAPU']], limit: 1 })).json?.length) {
    dockerRun(`co = self.env['res.company'].sudo().browse(1)
self.env['account.chart.template'].sudo().with_company(co).try_loading('id', co, install_demo=False)
self.env.cr.commit()
`)
  }
  const r = await call('account.tax', 'search_read', { fields: ['name', 'amount', 'type_tax_use', 'active', 'company_id'], context: { active_test: false }, limit: 500 })
  const rows = r.json || []
  const ppn = rows.filter((t) => /ppn|vat/i.test(t.name))
  const pph = rows.filter((t) => /pph|withhold/i.test(t.name))
  s0('S0-T10', 'account.tax rows on the l10n_id company (PPN/PPh)', r, 'recorded', { total: rows.length, ppnLike: ppn.length, pphLike: pph.length, byUse: rows.reduce((o, t) => ({ ...o, [t.type_tax_use]: (o[t.type_tax_use] || 0) + 1 }), {}), twelvePct: rows.filter((t) => /^12%/.test(t.name)).map((t) => `${t.name} | ${t.amount} | ${t.type_tax_use} | active=${t.active}`), elevenPct: rows.filter((t) => /^11%/.test(t.name)).map((t) => `${t.name} | ${t.amount} | ${t.type_tax_use} | active=${t.active}`), companiesCount: new Set(rows.map((t) => t.company_id?.[0])).size })
}
// T11 (V14) keyset paging over 2500 partners (500 per create call = 500 rows with the same write_date, so ties cross page boundaries)
{
  const ids = []
  for (let i = 0; i < 5; i++) {
    const c = await call('res.partner', 'create', { vals_list: Array.from({ length: 500 }, (_, j) => ({ name: `S0 bulk ${i}-${j}` })) })
    ids.push(...ids1(c))
  }
  cleanup.push(async () => { for (let i = 0; i < ids.length; i += 500) await call('res.partner', 'unlink', { ids: ids.slice(i, i + 500) }) })
  const want = new Set(ids)
  const page = async (limit) => {
    const seen = []
    let start = { w: '1970-01-01 00:00:00', id: 0 }
    for (let n = 0; n < 500; n++) {
      const r = await call('res.partner', 'search_read', { domain: ['|', ['write_date', '>', start.w], '&', ['write_date', '=', start.w], ['id', '>', start.id]], fields: ['id', 'write_date'], order: 'write_date asc, id asc', limit, context: { active_test: false } })
      if (!r.json?.length) break
      seen.push(...r.json.map((x) => x.id)); const last = r.json.at(-1); start = { w: last.write_date, id: last.id }
    }
    const set = new Set(seen)
    return { rowsSeen: seen.length, repeats: seen.length - set.size, seededMissing: [...want].filter((i) => !set.has(i)).length }
  }
  const r200 = await page(200), r1000 = await page(1000)
  const ok = (x) => x.repeats === 0 && x.seededMissing === 0
  s0('S0-T11', 'keyset paging, 2500 seeded partners, limit 200 and 1000', { status: 200, json: {} }, ok(r200) && ok(r1000) ? 'verified (no gaps, no repeats)' : 'wrong', { seeded: ids.length, limit200: r200, limit1000: r1000 })
}
// T12 (V12)
{
  const p1 = await M('res.partner', 'create', { vals_list: [{ name: 'S0 T12 a', ref: 'pmo:dup' }, { name: 'S0 T12 b', ref: 'pmo:dup' }] })
  if (p1.json?.length) cleanup.push(() => call('res.partner', 'unlink', { ids: p1.json }))
  const sr = await M('res.partner', 'search_read', { domain: [['ref', '=', 'pmo:dup']], fields: ['id'] })
  s0('S0-T12a', 'partner ref writable + searchable as minimal user, not unique', sr, sr.json?.length === 2 ? 'verified (2 rows share a ref)' : `check (create ${p1.status}, rows ${sr.json?.length})`, {})
  const a = await M('account.analytic.account', 'create', { vals_list: [{ name: 'S0 T12 c', code: 'S0-T12', plan_id: planId }, { name: 'S0 T12 d', code: 'S0-T12', plan_id: planId }] })
  if (a.json?.length) cleanup.push(() => call('account.analytic.account', 'unlink', { ids: a.json }))
  const sc = await M('account.analytic.account', 'search_read', { domain: [['code', '=', 'S0-T12']], fields: ['id'] })
  s0('S0-T12b', 'analytic code writable + searchable as minimal user, not unique', sc, a.status === 200 && sc.json?.length === 2 ? 'verified (not unique)' : `check (create ${a.status}, rows ${sc.json?.length})`, {})
}
// T15 (V-CREATE)
{
  const co = (await call('res.company', 'search_read', { fields: ['id'], limit: 1 })).json?.[0]?.id
  const c = await call('account.analytic.account', 'create', { vals_list: [{ name: 'S0 T15', code: 'S0-T15', plan_id: planId, company_id: co }] })
  if (c.json?.[0]) cleanup.push(() => call('account.analytic.account', 'unlink', { ids: c.json }))
  s0('S0-T15a', 'analytic account create {name,code,plan_id,company_id} -> [id]', c, c.status === 200 && typeof c.json?.[0] === 'number' ? 'verified' : `wrong (${c.status})`, {})
  const p = await call('res.partner', 'create', { vals_list: [{ name: 'S0 T15 p', ref: 'pmo:t15' }] })
  if (p.json?.[0]) cleanup.push(() => call('res.partner', 'unlink', { ids: p.json }))
  s0('S0-T15b', 'partner create with ref -> [id]', p, p.status === 200 && typeof p.json?.[0] === 'number' ? 'verified' : `wrong (${p.status})`, {})
}
// T16 (V-COUNT)
{
  const arch = await call('res.partner', 'create', { vals_list: [{ name: 'S0 T16 archived', active: false }] })
  cleanup.push(() => call('res.partner', 'unlink', { ids: ids1(arch) }))
  const dom = [['name', '=', 'S0 T16 archived']]
  const a = await call('res.partner', 'search_count', { domain: dom })
  const b = await call('res.partner', 'search_count', { domain: dom, context: { active_test: false } })
  const pc = await call('product.product', 'search_count', { domain: [] })
  const pcAll = await call('product.product', 'search_count', { domain: [], context: { active_test: false } })
  s0('S0-T16', 'search_count exists and honours active_test:false', a, a.json === 0 && b.json === 1 ? 'verified' : 'check', { partnerActiveOnly: a.json, partnerAll: b.json, productStatus: pc.status, productActive: pc.json, productAll: pcAll.json })
}

// S0 cleanup
for (const f of cleanup.reverse()) { try { await f() } catch {} }

for (const x of results) console.log(JSON.stringify(x))
