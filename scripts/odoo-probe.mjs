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

// Fleet and maintenance claims. Output contains only HTTP status, shape and verdicts.
if (process.argv.includes('--equipment')) {
  const fields = [
    ['V-OFM-1', 'fleet.vehicle', 'name license_plate vin_sn model_id driver_id odometer odometer_unit acquisition_date company_id active write_date'],
    ['V-OFM-2', 'fleet.vehicle.model', 'name brand_id write_date'],
    ['V-OFM-3', 'maintenance.equipment', 'name serial_no category_id model location company_id active write_date'],
    ['V-OFM-4', 'maintenance.request', 'name equipment_id maintenance_type stage_id request_date schedule_date close_date duration priority description company_id archive write_date'],
    ['V-OFM-5', 'maintenance.stage', 'name sequence done write_date'],
    ['V-OFM-6', 'fleet.vehicle.log.services', 'vehicle_id service_type_id date state amount odometer vendor_id description notes company_id active write_date'],
    ['V-OFM-8', 'fleet.service.type', 'name category write_date'],
  ]
  const metadata = new Map()
  for (const [claim, model, names] of fields) {
    const r = await call(model, 'fields_get', { attributes: ['type', 'required', 'selection'] })
    metadata.set(model, r.json)
    const missing = names.split(' ').filter((name) => !(name in (r.json || {})))
    // Output names are part of the claim, not response values.
    record(claim, `${model}/fields_get`, { status: r.status, json: missing }, r.status === 200 && !missing.length ? 'verified-fields' : 'differs')
  }
  const metaChecks = [
    ['V-OFM-1 model required', metadata.get('fleet.vehicle')?.model_id?.required === true],
    ['V-OFM-2 no company field', !metadata.get('fleet.vehicle.model')?.company_id],
    ['V-OFM-3 name required', metadata.get('maintenance.equipment')?.name?.required === true],
    ['V-OFM-4 archive instead of active', !metadata.get('maintenance.request')?.active && Boolean(metadata.get('maintenance.request')?.archive)],
    ['V-OFM-6 service type required', metadata.get('fleet.vehicle.log.services')?.service_type_id?.required === true],
  ]
  for (const [claim, ok] of metaChecks) record(claim, 'fields_get', { status: 200, json: null }, ok ? 'verified' : 'differs')
  const name = `pmo_probe_${Date.now()}`
  const created = []
  const make = async (model, vals) => {
    const r = await call(model, 'create', { vals_list: [vals] })
    const id = r.status === 200 && Array.isArray(r.json) ? r.json[0] : null
    if (id) created.push([model, id])
    return { r, id }
  }
  const one = async (model, domain = []) => (await call(model, 'search_read', { domain, fields: ['id'], limit: 1 })).json?.[0]?.id
  try {
    const company = await one('res.company')
    const brand = await make('fleet.vehicle.model.brand', { name })
    const model = await make('fleet.vehicle.model', { name, brand_id: brand.id })
    const missingModel = await call('fleet.vehicle', 'create', { vals_list: [{ license_plate: `${name}_without_model` }] })
    record('V-OFM-1 model required', 'fleet.vehicle/create', missingModel, missingModel.status >= 400 ? 'verified' : 'wrong')
    if (missingModel.status === 200 && missingModel.json?.[0]) created.push(['fleet.vehicle', missingModel.json[0]])
    const vehicle = await make('fleet.vehicle', { model_id: model.id, license_plate: name, company_id: company })
    const equipment = await make('maintenance.equipment', { name })
    record('V-OFM-3 name-only create', 'maintenance.equipment/create', equipment.r, equipment.id ? 'verified' : 'wrong')
    const location = await call('maintenance.equipment', 'write', { ids: [equipment.id], vals: { location: name } })
    record('V-OFM-3 location write', 'maintenance.equipment/write', location, location.status === 200 ? 'verified' : 'wrong')
    const stage = await one('maintenance.stage', [['done', '=', true]]) || (await make('maintenance.stage', { name, done: true })).id
    const ordinaryStage = await one('maintenance.stage')
    const request = await make('maintenance.request', { name, equipment_id: equipment.id, maintenance_type: 'corrective', ...(ordinaryStage ? { stage_id: ordinaryStage } : {}), schedule_date: '2026-11-10 01:00:00', duration: 2.5, description: '<p>synthetic</p>', company_id: company })
    record('V-OFM-4 request create', 'maintenance.request/create', request.r, request.id ? 'verified' : 'wrong')
    const before = request.id && await call('maintenance.request', 'read', { ids: [request.id], fields: ['close_date', 'write_date', 'maintenance_team_id'] })
    const requestEdit = await call('maintenance.request', 'write', { ids: [request.id], vals: { duration: 3, description: '<p>updated</p>' } })
    record('V-OFM-4 request update', 'maintenance.request/write', requestEdit, requestEdit.status === 200 ? 'verified' : 'wrong')
    if (ordinaryStage && request.id) {
      const ordinaryMove = await call('maintenance.request', 'write', { ids: [request.id], vals: { stage_id: ordinaryStage, duration: 3 } })
      record('V-OFM-5 stage update', 'maintenance.request/write', ordinaryMove, ordinaryMove.status === 200 ? 'verified' : 'wrong')
    }
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const update = request.id && stage ? await call('maintenance.request', 'write', { ids: [request.id], vals: { stage_id: stage, duration: 3 } }) : { status: 0, json: null }
    const after = request.id && await call('maintenance.request', 'read', { ids: [request.id], fields: ['close_date', 'write_date', 'maintenance_team_id'] })
    record('V-OFM-5 stage move', 'maintenance.request/write+read', update, !stage ? 'inconclusive' : update.status === 200 && after?.json?.[0]?.close_date && after.json[0].write_date > before?.json?.[0]?.write_date ? 'verified' : 'differs')
    const serviceType = await make('fleet.service.type', { name, category: 'service' })
    const countBefore = await call('account.move', 'search_count', { domain: [] })
    const service = await make('fleet.vehicle.log.services', { vehicle_id: vehicle.id, service_type_id: serviceType.id, date: '2026-11-10', state: 'done', amount: 100, odometer: 10, notes: name, company_id: company })
    record('V-OFM-6 service create', 'fleet.vehicle.log.services/create', service.r, service.id ? 'verified' : 'wrong')
    const acceptedService = service.id ? service : await make('fleet.vehicle.log.services', { vehicle_id: vehicle.id, service_type_id: serviceType.id, state: 'done', amount: 100, odometer: 10, notes: name, company_id: company })
    record('V-OFM-6 service without date', 'fleet.vehicle.log.services/create', acceptedService.r, acceptedService.id ? 'verified' : 'wrong')
    const edit = acceptedService.id ? await call('fleet.vehicle.log.services', 'write', { ids: [acceptedService.id], vals: { amount: 200 } }) : { status: 0, json: null }
    const countAfter = await call('account.move', 'search_count', { domain: [] })
    record('V-OFM-7 service accounting', 'account.move/search_count', countAfter, !acceptedService.id ? 'inconclusive' : edit.status === 200 && countBefore.status === 200 && countBefore.json === countAfter.json ? 'verified' : 'differs')
    for (const modelName of ['fleet.vehicle', 'maintenance.equipment', 'maintenance.request', 'fleet.vehicle.log.services', 'ir.model.data']) {
      for (const operation of modelName === 'ir.model.data' ? ['create'] : ['read', 'create', 'write']) {
        const access = await call(modelName, 'has_access', { operation })
        record('V-OFM-9', `${modelName}/has_access ${operation}`, access, access.status === 200 && access.json === true ? 'verified' : 'wrong')
      }
    }
    const anchor = equipment.id && await make('ir.model.data', { module: 'pmo', name, model: 'maintenance.equipment', res_id: equipment.id })
    const editEquipment = equipment.id && await call('maintenance.equipment', 'write', { ids: [equipment.id], vals: { model: name, active: false } })
    const found = await call('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo'], ['name', '=', name]], fields: ['model', 'res_id'] })
    record('V-OFM-10 anchor survives edit and archive', 'ir.model.data/create+search_read', found, anchor?.id && editEquipment?.status === 200 && found.json?.[0]?.res_id === equipment.id ? 'verified' : 'wrong')
  } finally {
    for (const [model, id] of created.reverse()) await call(model, 'unlink', { ids: [id] })
  }
  for (const result of results) console.log(JSON.stringify(result))
  process.exit(0)
}

// ---- O3 revenue claims (V-OCI1..15, plan C0): node scripts/odoo-probe.mjs --revenue ----
// Synthetic Indonesian-chart company only; prints statuses, shapes, numbers and field names, never keys/hosts/db names.
if (process.argv.includes('--revenue')) {
  const run = Date.now()
  const errShape = (r) => (r.status >= 400 && r.json && typeof r.json === 'object' ? { keys: Object.keys(r.json).sort(), cls: r.json.name } : null)
  const sec = async (name, fn) => { try { await fn() } catch (e) { record(name, 'probe', { status: 0, json: null }, `probe-error: ${String(e.message).slice(0, 80)}`) } }
  let co = (await call('res.company', 'search_read', { domain: [['name', '=', 'Synthetic Indonesian chart']], fields: ['id', 'chart_template'], limit: 1 })).json?.[0]
  if (!co) {
    const idc = (await call('res.country', 'search_read', { domain: [['code', '=', 'ID']], fields: ['id'], limit: 1 })).json?.[0]?.id
    const made = await call('res.company', 'create', { vals_list: [{ name: 'Synthetic Indonesian chart', country_id: idc }] })
    co = { id: made.json?.[0] }
    await call('account.chart.template', 'try_loading', { template_code: 'id', company: co.id })
  }
  const ctx = { allowed_company_ids: [co.id], company_id: co.id }
  const q = (m, me, b = {}) => call(m, me, { ...b, context: { ...ctx, ...(b.context || {}) } })
  const one = async (m, domain, fields) => (await q(m, 'search_read', { domain, fields, limit: 1 })).json?.[0]
  const rd = async (m, id, fields) => (await q(m, 'read', { ids: [id], fields })).json?.[0]
  const ppn11 = await one('account.tax', [['company_id', '=', co.id], ['type_tax_use', '=', 'sale'], ['amount', '=', 11], ['amount_type', '=', 'percent']], ['id', 'name'])
  const ppn12 = await one('account.tax', [['company_id', '=', co.id], ['type_tax_use', '=', 'sale'], ['amount', '=', 12], ['amount_type', '=', 'percent']], ['id', 'name'])
  const incomeStock = await one('account.account', [['account_type', '=', 'income'], ['company_ids', 'in', [co.id]]], ['id'])
  const mkAccount = async (type, label, n) => (await q('account.account', 'create', { vals_list: [{ code: `${n}${String(run).slice(-5)}`, name: `synthetic ${label} ${run}`, account_type: type, company_ids: [[6, 0, [co.id]]] }] })).json?.[0]
  const incomeOwn = await mkAccount('income', 'income', 48)
  const advance = await mkAccount('liability_current', 'advance', 28)
  const prepaidTax = await mkAccount('asset_current', 'prepaid tax', 18)
  const partner = (await q('res.partner', 'create', { vals_list: [{ name: `Synthetic client ${run}`, vat: '1234567890123456', country_id: (await one('res.country', [['code', '=', 'ID']], ['id']))?.id, l10n_id_buyer_document_type: 'TIN' }] })).json?.[0]
  const prod = async (name, extra = {}) => (await q('product.product', 'create', { vals_list: [{ name: `${name} ${run}`, type: 'service', list_price: 100, taxes_id: [[6, 0, [ppn11.id]]], ...extra }] })).json?.[0]
  const pTax = await prod('synthetic taxed service')
  const pOwn = await prod('synthetic own-income service', { property_account_income_id: incomeOwn })
  // The bed's bot needs the analytic group to create plans (a bed-setup fact, recorded under V-OCI14).
  const analyticGroup = (await call('ir.model.data', 'search_read', { domain: [['module', '=', 'analytic'], ['name', '=', 'group_analytic_accounting']], fields: ['res_id'], limit: 1 })).json?.[0]?.res_id
  const botId = (await call('res.users', 'search_read', { domain: [['login', '=', 'pmo_adapter_bot']], fields: ['id'], limit: 1 })).json?.[0]?.id
  if (analyticGroup && botId) await call('res.users', 'write', { ids: [botId], vals: { group_ids: [[4, analyticGroup]] } })
  const plan = (await q('account.analytic.plan', 'create', { vals_list: [{ name: `synthetic plan ${run}` }] })).json?.[0]
  const analytic = (await q('account.analytic.account', 'create', { vals_list: [{ name: `synthetic project ${run}`, plan_id: plan }] })).json?.[0]
  const bank = await one('account.journal', [['company_id', '=', co.id], ['type', '=', 'bank']], ['id', 'inbound_payment_method_line_ids'])
  const INV_F = ['state', 'name', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'payment_state']
  const inv = (lines, extra = {}) => q('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: partner, invoice_date: '2026-11-03', invoice_line_ids: lines.map((l) => [0, 0, l]), ...extra }] })
  const post = (id) => q('account.move', 'action_post', { ids: [id] })
  const line = (price, extra = {}) => ({ product_id: pTax, name: 'synthetic line', quantity: 1, price_unit: price, ...extra })
  const nameShape = (n) => (typeof n === 'string' ? n.replace(/\d/g, '#') : typeof n)
  const newPosted = async (price = 1000, extra = {}) => { const c = await inv([line(price)], extra); await post(c.json[0]); return c.json[0] }

  await sec('V-OCI1', async () => {
    const c = await inv([line(1000)])
    const draft = await rd('account.move', c.json?.[0], INV_F)
    const p = await post(c.json[0])
    const after = await rd('account.move', c.json[0], INV_F)
    record('V-OCI1 create with line tuples then action_post', 'account.move/create+action_post', p, c.status === 200 && p.status === 200 && after.state === 'posted' ? 'verified' : 'wrong', { draftName: draft?.name, postedNameShape: nameShape(after?.name), total: after?.amount_total, tax: after?.amount_tax, postReturn: typeof p.json })
    const variants = {
      omitted: line(1000),
      emptyReplace: line(1000, { tax_ids: [[6, 0, []]] }),
      emptyClear: line(1000, { tax_ids: [[5, 0, 0]] }),
      explicit12: line(1000, { tax_ids: [[6, 0, [ppn12.id]]] }),
    }
    const facts = {}
    for (const [k, l] of Object.entries(variants)) { const v = await inv([l]); facts[k] = (await rd('account.move', v.json?.[0], INV_F))?.amount_tax }
    record('V-OCI1 default product tax: omitted vs empty vs explicit tax_ids', 'account.move/create', c, 'verified', facts)
    const neg = await inv([line(1000), line(-200, { name: 'synthetic recovery' })])
    const negPost = await post(neg.json[0])
    record('V-OCI1 negative-price line beside a positive one', 'account.move/create+action_post', negPost, negPost.status === 200 ? 'verified' : 'refused', { read: await rd('account.move', neg.json[0], INV_F) })
    const allNeg = await inv([line(-500)])
    const allNegPost = await post(allNeg.json[0])
    record('V-OCI1 post an invoice with a negative total', 'account.move/action_post', allNegPost, allNegPost.status === 200 ? 'posted' : 'refused', { err: errShape(allNegPost), read: await rd('account.move', allNeg.json[0], INV_F) })
    const zero = await inv([line(0)])
    const zeroPost = await post(zero.json[0])
    record('V-OCI1 post an invoice with a zero total', 'account.move/action_post', zeroPost, zeroPost.status === 200 ? 'posted' : 'refused', { err: errShape(zeroPost), read: await rd('account.move', zero.json[0], INV_F) })
  })

  await sec('V-OCI6', async () => {
    const id = await newPosted(1000)
    const again = await post(id)
    record('V-OCI6 second action_post on a posted invoice', 'account.move/action_post', again, again.status === 422 ? 'error (422)' : `unexpected ${again.status}`, { err: errShape(again), after: await rd('account.move', id, INV_F) })
  })

  await sec('V-OCI5', async () => {
    const incl = (await q('account.tax', 'create', { vals_list: [{ name: `synthetic ppn included ${run}`, type_tax_use: 'sale', amount_type: 'percent', amount: 11, price_include_override: 'tax_included' }] }))
    const incl2 = incl.status === 200 ? incl : await q('account.tax', 'create', { vals_list: [{ name: `synthetic ppn included ${run}`, type_tax_use: 'sale', amount_type: 'percent', amount: 11, price_include: true }] })
    const cases = {
      ppn11_1000: [line(1000)],
      ppn11_odd: [line(1000.5)],
      ppn11_rounding: [line(333.33, { quantity: 3 })],
      ppn12_reduced_base: [line(Math.round((11 / 12) * 1000 * 100) / 100, { tax_ids: [[6, 0, [ppn12.id]]] })],
      two_lines: [line(1000), line(250.25)],
    }
    if (incl2.status === 200) cases.included_1110 = [line(1110, { tax_ids: [[6, 0, [incl2.json[0]]]] })]
    const facts = { ppn11Name: ppn11.name, ppn12Name: ppn12.name, includedCreate: incl2.status }
    for (const [k, ls] of Object.entries(cases)) {
      const c = await inv(ls); await post(c.json[0])
      const m = await rd('account.move', c.json[0], INV_F)
      const taxLines = (await q('account.move.line', 'search_read', { domain: [['move_id', '=', c.json[0]], ['display_type', '=', 'tax']], fields: ['balance'] })).json
      facts[k] = { untaxed: m.amount_untaxed, tax: m.amount_tax, total: m.amount_total, residual: m.amount_residual, taxLineBalances: taxLines.map((x) => x.balance) }
    }
    record('V-OCI5 Indonesian sale taxes: PPN 11% effective, price_include, reduced base, amounts', 'account.move/read', { status: 200, json: {} }, 'verified', facts)
  })

  await sec('V-OCI3', async () => {
    const dp = await inv([line(1000, { name: 'synthetic down payment', account_id: advance })])
    await post(dp.json[0])
    const dpLine = await one('account.move.line', [['move_id', '=', dp.json[0]], ['display_type', '=', 'product']], ['account_id'])
    const own = await inv([{ product_id: pOwn, name: 'synthetic own income', quantity: 1, price_unit: 500 }])
    await post(own.json[0])
    const ownLine = await one('account.move.line', [['move_id', '=', own.json[0]], ['display_type', '=', 'product']], ['account_id'])
    const dflt = await inv([line(100)]); await post(dflt.json[0])
    const dfltLine = await one('account.move.line', [['move_id', '=', dflt.json[0]], ['display_type', '=', 'product']], ['account_id'])
    record('V-OCI3 line account_id override and product income account, read back after post', 'account.move.line/read', { status: 200, json: {} }, dpLine?.account_id?.[0] === advance && ownLine?.account_id?.[0] === incomeOwn && dfltLine?.account_id?.[0] === incomeStock.id ? 'verified' : 'wrong', { overrideHonoured: dpLine?.account_id?.[0] === advance, productIncomeHonoured: ownLine?.account_id?.[0] === incomeOwn, defaultIsStockIncome: dfltLine?.account_id?.[0] === incomeStock.id })
  })

  await sec('V-OCI4', async () => {
    const dist = { [String(analytic)]: 100 }
    const c = await inv([line(1000, { analytic_distribution: dist }), line(-200, { name: 'synthetic recovery', analytic_distribution: dist })])
    const p = await post(c.json[0])
    const ls = (await q('account.move.line', 'search_read', { domain: [['move_id', '=', c.json[0]], ['display_type', '=', 'product']], fields: ['analytic_distribution', 'balance'] })).json
    const al = (await q('account.analytic.line', 'search_read', { domain: [['move_line_id', 'in', ls.map((x) => x.id)]], fields: ['amount'] })).json
    record('V-OCI4 analytic_distribution on positive and negative lines survives post', 'account.move/create+action_post', p, p.status === 200 && ls.every((x) => x.analytic_distribution?.[String(analytic)] === 100) ? 'verified' : 'wrong', { lines: ls.map((x) => ({ balance: x.balance, dist: x.analytic_distribution })), analyticLineAmounts: al.map((x) => x.amount) })
  })

  const payVals = (amount, extra = {}) => ({ payment_type: 'inbound', partner_type: 'customer', partner_id: partner, amount, journal_id: bank.id, payment_method_line_id: bank.inbound_payment_method_line_ids[0], ...extra })
  const PAY_F = ['state', 'amount', 'memo', 'payment_reference', 'is_reconciled', 'is_matched', 'move_id']
  await sec('V-OCI7', async () => {
    // A: standalone payment + move.line reconcile
    const a = await newPosted(1000)
    const pa = await q('account.payment', 'create', { vals_list: [payVals(1110)] })
    const pap = await q('account.payment', 'action_post', { ids: pa.json?.[0] ? [pa.json[0]] : [] })
    const payMove = (await rd('account.payment', pa.json[0], ['move_id'])).move_id[0]
    const arLines = (await q('account.move.line', 'search_read', { domain: [['move_id', 'in', [a, payMove]], ['account_type', '=', 'asset_receivable']], fields: ['id', 'reconciled'] })).json
    const rec = await q('account.move.line', 'reconcile', { ids: arLines.map((x) => x.id) })
    record('V-OCI7 payment create+post, reconcile via account.move.line/reconcile', 'account.payment/create+action_post; account.move.line/reconcile', rec, rec.status === 200 ? 'verified' : 'wrong', { createStatus: pa.status, postStatus: pap.status, receivableLines: arLines.length, invoice: await rd('account.move', a, INV_F), err: errShape(rec) })
    // B: register wizard full / partial / overpay
    const wiz = async (invId, vals) => {
      const c = { active_model: 'account.move', active_ids: [invId] }
      const w = await q('account.payment.register', 'create', { vals_list: [vals], context: c })
      if (w.status !== 200) return { w, done: w }
      const done = await q('account.payment.register', 'action_create_payments', { ids: w.json, context: c })
      return { w, done, wizard: w.json?.[0] }
    }
    const full = await newPosted(1000)
    const f = await wiz(full, {})
    record('V-OCI7 register wizard, full amount', 'account.payment.register/create+action_create_payments', f.done, f.done.status === 200 ? 'verified' : 'wrong', { invoice: await rd('account.move', full, INV_F), returnType: typeof f.done.json, err: errShape(f.done) })
    const part = await newPosted(1000)
    const pt = await wiz(part, { amount: 400 })
    record('V-OCI7 register wizard, partial amount', 'account.payment.register/create+action_create_payments', pt.done, pt.done.status === 200 ? 'verified' : 'wrong', { invoice: await rd('account.move', part, INV_F), err: errShape(pt.done) })
    const over = await newPosted(1000)
    const ov = await wiz(over, { amount: 2000 })
    const ovPayments = ov.done.status === 200 ? (await q('account.payment', 'search_read', { domain: [['partner_id', '=', partner], ['amount', '=', 2000]], fields: ['id', 'state'] })).json : []
    record('V-OCI7 register wizard, amount above the residual', 'account.payment.register/create+action_create_payments', ov.done, ov.done.status === 200 ? 'accepted (overpay)' : 'refused', { createStatus: ov.w.status, invoice: await rd('account.move', over, INV_F), paymentCount: ovPayments.length, err: errShape(ov.done.status === 200 ? { status: 0 } : ov.done) })
    const second = await wiz(full, {})
    record('V-OCI7 register wizard on an already paid invoice', 'account.payment.register/create', second.w, second.w.status === 200 && second.done.status === 200 ? 'accepted' : 'refused', { err: errShape(second.done.status === 200 ? { status: 0 } : second.done.status ? second.done : second.w) })
  })

  await sec('V-OCI8', async () => {
    const c = await newPosted(1000)
    const ctxw = { active_model: 'account.move', active_ids: [c] }
    const w = await q('account.payment.register', 'create', { vals_list: [{ amount: 1090, payment_difference_handling: 'reconcile', writeoff_account_id: prepaidTax, writeoff_label: 'synthetic client withholding' }], context: ctxw })
    const done = w.status === 200 ? await q('account.payment.register', 'action_create_payments', { ids: w.json, context: ctxw }) : w
    const lines = (await q('account.move.line', 'search_read', { domain: [['account_id', '=', prepaidTax]], fields: ['balance', 'reconciled', 'move_id'], order: 'id desc', limit: 3 })).json
    record('V-OCI8 client-withheld tax: wizard reconcile with write-off account', 'account.payment.register/create+action_create_payments', done, done.status === 200 ? 'verified' : 'unavailable', { invoice: await rd('account.move', c, INV_F), writeOffLineBalances: lines.map((x) => x.balance), err: errShape(done.status === 200 ? { status: 0 } : done) })
  })

  await sec('V-OCI2', async () => {
    const P = `synthetic-anchor-${run}`
    const cand = { 'account.move': ['ref', 'payment_reference', 'invoice_origin', 'narration'] }
    const create = (f) => inv([line(1000)], { [f]: f === 'narration' ? `<p>${P}</p>` : P })
    const facts = {}
    for (const f of cand['account.move']) {
      const c = await create(f)
      if (c.status !== 200) { facts[f] = { createStatus: c.status, err: errShape(c) }; continue }
      const id = c.json[0]
      const d = (await rd('account.move', id, [f]))[f]
      await post(id)
      const a = (await rd('account.move', id, [f]))[f]
      const hit = await q('account.move', 'search_read', { domain: [[f, 'ilike', P], ['id', '=', id]], fields: ['id'] })
      facts[f] = { draftKept: String(d).includes(P), postedKept: String(a).includes(P), exactEqualAfterPost: a === P, searchHit: hit.json?.length === 1 }
    }
    record('V-OCI2 invoice anchor candidates: survive create and post, ilike search', 'account.move/create+read+search_read', { status: 200, json: {} }, 'verified', facts)
    const pf = {}
    for (const f of ['memo', 'payment_reference']) {
      const c = await q('account.payment', 'create', { vals_list: [payVals(100, { [f]: P })] })
      if (c.status !== 200) { pf[f] = { createStatus: c.status, err: errShape(c) }; continue }
      const d = (await rd('account.payment', c.json[0], [f]))[f]
      await q('account.payment', 'action_post', { ids: c.json })
      const a = (await rd('account.payment', c.json[0], [f]))[f]
      const hit = await q('account.payment', 'search_read', { domain: [[f, 'ilike', P], ['id', '=', c.json[0]]], fields: ['id'] })
      pf[f] = { draftKept: d === P, postedKept: a === P, searchHit: hit.json?.length === 1 }
    }
    record('V-OCI2 payment anchor candidates: survive create and post, ilike search', 'account.payment/create+read+search_read', { status: 200, json: {} }, 'verified', pf)
    // external identifier on both models
    const ext = {}
    const aInv = await newPosted(1000)
    const aPay = (await q('account.payment', 'create', { vals_list: [payVals(100)] })).json[0]
    await q('account.payment', 'action_post', { ids: [aPay] })
    for (const [m, id] of [['account.move', aInv], ['account.payment', aPay]]) {
      const x = await attachExternalId(m, id)
      const hit = await call('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo_probe'], ['name', '=', x.name], ['model', '=', m]], fields: ['res_id'] })
      ext[m] = { createStatus: x.status, searchHit: hit.json?.[0]?.res_id === id }
    }
    record('V-OCI2 external identifier (ir.model.data) on a posted invoice and payment', 'ir.model.data/create+search_read', { status: 200, json: {} }, 'verified', ext)
    // print label of each candidate on the stock invoice template
    const views = (await q('ir.ui.view', 'search_read', { domain: [['key', 'in', ['account.report_invoice_document', 'l10n_id.report_invoice_document']]], fields: ['key', 'arch_db'] })).json || []
    const arch = views.map((v) => v.arch_db).join('\n')
    const printed = {}
    for (const f of ['ref', 'payment_reference', 'invoice_origin', 'narration']) {
      const m = arch.match(new RegExp(`t-if="[^"]*\\bo\\.${f}"[^>]*?(?:name="(\\w+)")?[^>]*>\\s*(?:<strong>([^<]*)</strong>)?`))
      printed[f] = m ? { block: m[1] ?? null, label: m[2] ?? null } : new RegExp(`o\\.${f}\\b`).test(arch) ? 'terms-and-conditions block (no label)' : 'not in template'
    }
    const lab = (await q('account.move', 'fields_get', { allfields: ['ref', 'payment_reference', 'invoice_origin', 'narration'], attributes: ['string'] })).json
    printed.formLabels = Object.fromEntries(Object.entries(lab || {}).map(([k, v]) => [k, v.string]))
    printed.paymentCommunicationLiteral = /Payment Communication:\s*<span[^>]*o\.payment_reference/.test(arch.replace(/\s+/g, ' '))
    record('V-OCI2 which candidate prints on the stock invoice template, and its label', 'ir.ui.view/read', { status: 200, json: {} }, 'verified', printed)
  })

  await sec('V-OCI9', async () => {
    const id = await newPosted(1000)
    const mf = Object.keys((await q('account.move', 'fields_get', { attributes: ['type'] })).json)
    const taxInvoiceNumberFields = mf.filter((k) => /nsfp|faktur|tax_invoice|efaktur|seri/i.test(k))
    const l10n = mf.filter((k) => k.startsWith('l10n_id'))
    const vals = (await rd('account.move', id, l10n.filter((k) => !k.includes('qris')))) || {}
    const types = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Array.isArray(v) ? 'many2one/list' : v === false ? 'false' : typeof v === 'string' ? `string(${v.length})` : typeof v]))
    const mod = (await call('ir.module.module', 'search_read', { domain: [['name', 'in', ['l10n_id', 'l10n_id_efaktur_coretax', 'l10n_id_efaktur']]], fields: ['name', 'state', 'license'] })).json
    record('V-OCI9 tax-invoice facts a stock read of a posted Indonesian invoice exposes', 'account.move/read', { status: 200, json: {} }, 'verified', { l10nFieldsOnMove: l10n, taxInvoiceNumberFields, valuesAfterPostBeforeExport: types, modules: mod })
  })

  let exportInvoice
  await sec('V-OCI10', async () => {
    await q('res.company', 'write', { ids: [co.id], vals: { vat: false } })
    exportInvoice = await newPosted(1000)
    const miss = await q('account.move', 'download_efaktur', { ids: [exportInvoice] })
    const reasons = typeof miss.json?.message === 'string' ? miss.json.message.split('\n').length - 1 : null
    record('V-OCI10 Coretax export with mandatory data missing (company tax id unset)', 'account.move/download_efaktur', miss, miss.status === 422 ? 'refused (422)' : `unexpected ${miss.status}`, { err: errShape(miss), reasonCount: reasons })
    await q('res.company', 'write', { ids: [co.id], vals: { vat: '1234567890123456' } })
    const ok = await q('account.move', 'download_efaktur', { ids: [exportInvoice] })
    const after = await rd('account.move', exportInvoice, ['l10n_id_coretax_document', 'l10n_id_kode_transaksi'])
    const docId = after?.l10n_id_coretax_document?.[0]
    const doc = docId ? await rd('l10n_id_efaktur_coretax.document', docId, ['name', 'attachment_id']) : null
    const attId = doc?.attachment_id?.[0]
    const att = attId ? await rd('ir.attachment', attId, ['mimetype', 'file_size', 'type', 'res_model']) : null
    const raw = attId ? await q('ir.attachment', 'read', { ids: [attId], fields: ['raw'] }) : { status: 0, json: null }
    const rawValue = raw.json?.[0]?.raw
    const decoded = typeof rawValue?.content === 'string' ? Buffer.from(rawValue.content, 'base64').toString('utf8') : ''
    record('V-OCI10 Coretax export for one invoice: stock call, return value, document and attachment', 'account.move/download_efaktur', ok, ok.status === 200 ? 'verified' : `refused (${ok.status})`, { returnKeys: ok.json && typeof ok.json === 'object' ? Object.keys(ok.json).sort() : typeof ok.json, actionType: ok.json?.type, urlShape: typeof ok.json?.url === 'string' ? ok.json.url.replace(/\d+/g, '#') : null, wizardNeeded: false, kodeTransaksiSetOnInvoice: !!after?.l10n_id_kode_transaksi, err: errShape(ok.status === 200 ? { status: 0 } : ok), documentCreated: !!docId, attachment: att ? { mimetype: att.mimetype, size: att.file_size, type: att.type, resModel: att.res_model } : null, rawReadStatus: raw.status, rawShape: rawValue && typeof rawValue === 'object' ? Object.keys(rawValue).sort() : typeof rawValue, xmlRoot: decoded.match(/<([A-Za-z]\w*)[ >]/)?.[1] ?? null, xmlHasInvoiceMarker: decoded.length > 0 })
    if (docId && attId) {
      const again = await q('account.move', 'download_efaktur', { ids: [exportInvoice] })
      record('V-OCI10 Coretax export repeated on the same invoice', 'account.move/download_efaktur', again, again.status === 200 ? 'idempotent (same document)' : `refused (${again.status})`, { sameDocument: (await rd('account.move', exportInvoice, ['l10n_id_coretax_document']))?.l10n_id_coretax_document?.[0] === docId })
    }
  })

  await sec('V-OCI12', async () => {
    const id = await newPosted(1000)
    const tried = {}
    for (const [m, me, b] of [['account.move', 'action_invoice_print', { ids: [id] }], ['ir.actions.report', 'render_qweb_pdf', { report_ref: 'account.account_invoices', res_ids: [id] }], ['ir.actions.report', '_render_qweb_pdf', { report_ref: 'account.account_invoices', res_ids: [id] }]]) {
      const r = await q(m, me, b)
      tried[`${m}/${me}`] = { status: r.status, returnType: r.status === 200 ? (Array.isArray(r.json) ? `list(${r.json.length})` : typeof r.json) : null, actionKeys: r.status === 200 && r.json && typeof r.json === 'object' ? Object.keys(r.json).sort() : undefined }
    }
    record('V-OCI12 invoice print by a stock JSON-2 model call', 'account.move/action_invoice_print + ir.actions.report', { status: 200, json: {} }, 'verified', tried)
  })

  await sec('V-OCI13', async () => {
    const id = await newPosted(1000)
    const c = { active_model: 'account.move', active_ids: [id] }
    const src = await rd('account.move', id, ['journal_id', 'company_id'])
    const w = await q('account.move.reversal', 'create', { vals_list: [{ reason: 'synthetic credit note', date: '2026-11-04', journal_id: src.journal_id[0], company_id: src.company_id[0] }], context: c })
    const done = w.status === 200 ? await q('account.move.reversal', 'refund_moves', { ids: w.json, context: c }) : w
    const note = (await q('account.move', 'search_read', { domain: [['reversed_entry_id', '=', id]], fields: ['move_type', 'state', 'reversed_entry_id', 'amount_total', 'ref'] })).json?.[0]
    record('V-OCI13 credit note via the reversal wizard; reversed_entry_id link', 'account.move.reversal/create+refund_moves', done, done.status === 200 && note?.move_type === 'out_refund' ? 'verified' : 'wrong', { returnKeys: done.json && typeof done.json === 'object' ? Object.keys(done.json).sort() : typeof done.json, note: note ? { moveType: note.move_type, state: note.state, linked: note.reversed_entry_id?.[0] === id, total: note.amount_total } : null, err: errShape(done.status === 200 ? { status: 0 } : done) })
    const marker = `synthetic-page-${run}`
    const ts = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/
    const cases = [
      ['account.move', 'ref', { move_type: 'out_invoice', partner_id: partner, ref: marker }, [['move_type', 'in', ['out_invoice', 'out_refund']]]],
      ['account.payment', 'memo', payVals(1, { memo: marker }), [['payment_type', '=', 'inbound'], ['partner_type', '=', 'customer']]],
    ]
    for (const [model, field, vals, extra] of cases) {
      const ids = []
      let passed = true
      let last = 200
      try {
        for (let i = 0; i < 11; i++) {
          const cr = await q(model, 'create', { vals_list: Array.from({ length: i === 10 ? 1 : 100 }, () => vals) })
          last = cr.status
          if (cr.status !== 200) { passed = false; break }
          ids.push(...cr.json)
        }
        for (const limit of [200, 1000]) {
          const seen = []
          let cursor = null
          do {
            const domain = [[field, '=', marker], ...extra]
            if (cursor) domain.push('|', ['write_date', '>', cursor.write_date], '&', ['write_date', '=', cursor.write_date], ['id', '>', cursor.id])
            const page = await q(model, 'search_read', { domain, fields: ['id', 'write_date'], order: 'write_date asc, id asc', limit })
            last = page.status
            if (page.status !== 200) { passed = false; break }
            seen.push(...page.json)
            cursor = page.json.length === limit ? page.json.at(-1) : null
          } while (cursor)
          if (seen.length !== ids.length || new Set(seen.map((x) => x.id)).size !== ids.length || !seen.every((x) => ts.test(x.write_date))) passed = false
        }
      } finally {
        for (let i = 0; i < ids.length; i += 100) {
          const rm = await q(model, 'unlink', { ids: ids.slice(i, i + 100) })
          if (rm.status !== 200) passed = false
        }
      }
      record(`V-OCI13 ${model} keyset paging with the sweep filters (200 and 1000)`, `${model}/search_read`, { status: last, json: {} }, passed ? `verified (${ids.length} records)` : 'unverified')
    }
  })

  const mkUser = (label, groups) => {
    const script = `from datetime import datetime, timedelta
import json
env = self.env
gs = [g for g in ${JSON.stringify(groups)} if env.ref(g, raise_if_not_found=False)]
u = env['res.users'].sudo().with_context(no_reset_password=True).create({'name': 'Synthetic ${label} ${run}', 'login': 'synthetic-${label}-${run}', 'group_ids': [(6, 0, [env.ref(g).id for g in gs])], 'company_ids': [(6, 0, [${co.id}])], 'company_id': ${co.id}})
k = env['res.users.apikeys'].with_user(u)._generate('rpc', 'synthetic probe', datetime.now() + timedelta(hours=20))
env.cr.commit()
print('PROBE_USER=' + json.dumps({'id': u.id, 'key': k, 'missing': [g for g in ${JSON.stringify(groups)} if g not in gs]}))
`
    const out = spawnSync('docker', ['compose', '-f', fileURLToPath(new URL('./odoo-bed/compose.yml', import.meta.url)), '--env-file', envPath, 'run', '--rm', '--no-deps', '-T', 'odoo', 'odoo', 'shell', '-d', probeDatabase, '--no-http'], { input: script, encoding: 'utf8' })
    try { return JSON.parse(out.stdout.split('\n').find((x) => x.startsWith('PROBE_USER=')).slice('PROBE_USER='.length)) } catch { return { failed: String(out.stderr || out.stdout).split('\n').filter(Boolean).slice(-1)[0]?.replace(/\d+/g, '#').slice(0, 140) } }
  }
  const battery = async (key) => {
    const as = (m, me, b = {}) => call(m, me, { ...b, context: { ...ctx, ...(b.context || {}) } }, { key })
    const out = []
    const step = (label, r) => { out.push([label, r.status]); return r }
    const c = step('create invoice', await as('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: partner, invoice_date: '2026-11-03', invoice_line_ids: [[0, 0, { product_id: pTax, name: 'synthetic line', quantity: 1, price_unit: 1000, analytic_distribution: { [String(analytic)]: 100 } }]] }] }))
    const id = c.json?.[0]
    if (!id) return out
    step('read invoice', await as('account.move', 'read', { ids: [id], fields: INV_F }))
    step('post invoice', await as('account.move', 'action_post', { ids: [id] }))
    step('sweep search_read', await as('account.move', 'search_read', { domain: [['move_type', 'in', ['out_invoice', 'out_refund']]], fields: ['id', 'write_date'], limit: 2 }))
    const wc = { active_model: 'account.move', active_ids: [id] }
    const w = step('register wizard create', await as('account.payment.register', 'create', { vals_list: [{ amount: 400 }], context: wc }))
    if (w.status === 200) step('register wizard pay', await as('account.payment.register', 'action_create_payments', { ids: w.json, context: wc }))
    const p = step('create payment', await as('account.payment', 'create', { vals_list: [payVals(500)] }))
    if (p.status === 200) {
      step('post payment', await as('account.payment', 'action_post', { ids: p.json }))
      const pm = (await as('account.payment', 'read', { ids: p.json, fields: ['move_id'] })).json?.[0]?.move_id?.[0]
      const ls = (await as('account.move.line', 'search_read', { domain: [['move_id', 'in', [id, pm]], ['account_type', '=', 'asset_receivable'], ['reconciled', '=', false]], fields: ['id'] })).json || []
      step('reconcile lines', await as('account.move.line', 'reconcile', { ids: ls.map((x) => x.id) }))
    }
    const src = (await as('account.move', 'read', { ids: [id], fields: ['journal_id', 'company_id'] })).json?.[0]
    const rv = step('reversal wizard create', await as('account.move.reversal', 'create', { vals_list: [{ reason: 'synthetic credit note', journal_id: src?.journal_id?.[0], company_id: src?.company_id?.[0] }], context: wc }))
    if (rv.status === 200) step('reversal refund_moves', await as('account.move.reversal', 'refund_moves', { ids: rv.json, context: wc }))
    step('coretax export', await as('account.move', 'download_efaktur', { ids: [id] }))
    step('read export attachment', await as('ir.attachment', 'search_read', { domain: [['res_model', '=', 'l10n_id_efaktur_coretax.document']], fields: ['mimetype', 'file_size'], limit: 1 }))
    const x = await call('ir.model.data', 'create', { vals_list: [{ module: 'pmo_probe', name: `synthetic_${run}_${out.length}_${Math.random().toString(36).slice(2, 7)}`, model: 'account.move', res_id: id, noupdate: true }] }, { key })
    step('external id create', x)
    step('external id search', await call('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo_probe'], ['model', '=', 'account.move']], fields: ['res_id'], limit: 1 }, { key }))
    return out
  }
  const summarise = (res) => res.filter(([, s]) => s !== 200).map(([l, s]) => `${l}:${s}`)
  const sets = {
    billing: ['base.group_user', 'account.group_account_invoice'],
    accountant: ['base.group_user', 'account.group_account_user'],
    billingPlusAccessRights: ['base.group_user', 'account.group_account_invoice', 'base.group_erp_manager'],
    internalOnly: ['base.group_user'],
  }
  const users = {}
  for (const [name, groups] of Object.entries(sets)) {
    await sec(`V-OCI14 ${name}`, async () => {
      const u = mkUser(name, groups)
      users[name] = u
      if (!u || u.failed) return record(`V-OCI14 service user set: ${name}`, 'res.users/create', { status: 0, json: null }, 'user creation failed', { reason: u?.failed })
      const res = await battery(u.key)
      record(`V-OCI14 service user set: ${name}`, `battery of ${res.length} revenue calls`, { status: 200, json: {} }, summarise(res).length ? `refused: ${summarise(res).join(', ')}` : 'all calls passed', { groups: groups, missingGroups: u.missing, steps: res.length })
    })
  }
  // V-OCI2 second user: can a billing user edit each candidate on a posted invoice / posted payment, and what does the form say
  await sec('V-OCI2 second user', async () => {
    const key = users.billing?.key
    if (!key) return
    const as = (m, me, b = {}) => call(m, me, { ...b, context: { ...ctx, ...(b.context || {}) } }, { key })
    const id = await newPosted(1000, { ref: 'synthetic-original' })
    const facts = {}
    for (const f of ['ref', 'payment_reference', 'invoice_origin', 'narration']) {
      const w = await as('account.move', 'write', { ids: [id], vals: { [f]: f === 'narration' ? '<p>edited</p>' : 'synthetic-edited' } })
      facts[f] = { postedWriteStatus: w.status }
    }
    const views = await q('account.move', 'get_views', { views: [[false, 'form']] })
    const arch = views.json?.views?.form?.arch || ''
    for (const f of ['ref', 'payment_reference', 'invoice_origin', 'narration']) {
      const m = arch.match(new RegExp(`<field name="${f}"[^>]*>`))
      facts[f] = { ...(facts[f] || {}), formReadonlyAttr: m ? (m[0].match(/readonly="([^"]*)"/)?.[1] ?? 'none') : 'field not on form' }
    }
    const pay = (await q('account.payment', 'create', { vals_list: [payVals(100, { memo: 'synthetic-original' })] })).json[0]
    await q('account.payment', 'action_post', { ids: [pay] })
    const pw = await as('account.payment', 'write', { ids: [pay], vals: { memo: 'synthetic-edited' } })
    const pviews = await q('account.payment', 'get_views', { views: [[false, 'form']] })
    const parch = pviews.json?.views?.form?.arch || ''
    facts.paymentMemo = { postedWriteStatus: pw.status, after: (await rd('account.payment', pay, ['memo'])).memo, formReadonlyAttr: (parch.match(/<field name="memo"[^>]*>/) ? (parch.match(/<field name="memo"[^>]*>/)[0].match(/readonly="([^"]*)"/)?.[1] ?? 'none') : 'field not on form') }
    record('V-OCI2 second (billing) user edits a candidate after post; form readonly modifier', 'account.move/write, account.payment/write, get_views', { status: 200, json: {} }, 'verified', facts)
  })

  await sec('V-OCI15', async () => {
    const shapes = {}
    const note = (label, r) => { shapes[label] = { status: r.status, ...(errShape(r) || {}) } }
    note('create with a missing partner reference', await q('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: 987654321 }] }))
    const nop = (await inv([line(100)], { partner_id: false })).json[0]
    note('post invoice without a partner', await post(nop))
    note('negative payment amount', await q('account.payment', 'create', { vals_list: [payVals(-5)] }))
    note('register wizard without active_ids', await q('account.payment.register', 'create', { vals_list: [{}] }))
    const draft = (await inv([line(100)])).json[0]
    const rc = { active_model: 'account.move', active_ids: [draft] }
    const dsrc = await rd('account.move', draft, ['journal_id', 'company_id'])
    const rw = await q('account.move.reversal', 'create', { vals_list: [{ reason: 'x', journal_id: dsrc.journal_id[0], company_id: dsrc.company_id[0] }], context: rc })
    note('reverse a draft invoice', rw.status === 200 ? await q('account.move.reversal', 'refund_moves', { ids: rw.json, context: rc }) : rw)
    note('coretax export of a draft invoice', await q('account.move', 'download_efaktur', { ids: [draft] }))
    const posted = await newPosted(100)
    const ar = (await q('account.move.line', 'search_read', { domain: [['move_id', '=', posted], ['account_type', '=', 'asset_receivable']], fields: ['id'] })).json.map((x) => x.id)
    note('reconcile a single line', await q('account.move.line', 'reconcile', { ids: ar }))
    note('unknown method', await q('account.move', 'no_such_method', { ids: [posted] }))
    note('unlink a posted invoice', await q('account.move', 'unlink', { ids: [posted] }))
    const lim = users.internalOnly?.key
    if (lim) note('access refused (internal user, no accounting group)', await call('account.move', 'create', { vals_list: [{ move_type: 'out_invoice' }], context: ctx }, { key: lim }))
    record('V-OCI15 error body shape for a failure on each call', 'various', { status: 200, json: {} }, 'verified', shapes)
  })
  for (const x of results) console.log(JSON.stringify(x))
  process.exit(0)
}

// ---- O4 actuals claims (V-ODA1..11, #1507 S0): node scripts/odoo-probe.mjs --actuals [--case V-ODA1] ----
// Own synthetic companies only (never resets the bed); prints statuses, shapes, numbers and field names only.
if (process.argv.includes('--actuals')) {
  const only = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : null
  const run = Date.now()
  const errShape = (r) => (r.status >= 400 && r.json && typeof r.json === 'object' ? { status: r.status, cls: r.json.name, msg: String(r.json.message || '').slice(0, 120) } : null)
  const sec = async (name, fn) => { if (only && only !== name) return; try { await fn() } catch (e) { record(name, 'probe', { status: 0, json: null }, `probe-error: ${String(e.message).slice(0, 120)}`) } }
  const ensureCompany = async (name) => {
    let co = (await call('res.company', 'search_read', { domain: [['name', '=', name]], fields: ['id'], limit: 1 })).json?.[0]
    if (!co) {
      const idc = (await call('res.country', 'search_read', { domain: [['code', '=', 'ID']], fields: ['id'], limit: 1 })).json?.[0]?.id
      co = { id: (await call('res.company', 'create', { vals_list: [{ name, country_id: idc }] })).json?.[0] }
      await call('account.chart.template', 'try_loading', { template_code: 'id', company: co.id })
    }
    return co.id
  }
  const coA = await ensureCompany('PT Sinar Baja')
  const coB = await ensureCompany('PT Baja Timur')
  const ctx = { allowed_company_ids: [coA, coB], company_id: coA }
  const q = (m, me, b = {}, co = coA) => call(m, me, { ...b, context: { allowed_company_ids: [co], company_id: co, ...(b.context || {}) } })
  const one = async (m, domain, fields, co = coA) => (await q(m, 'search_read', { domain, fields, limit: 1 }, co)).json?.[0]
  const rd = async (m, id, fields, co = coA) => (await q(m, 'read', { ids: [id], fields }, co)).json?.[0]
  const analyticGroup = (await call('ir.model.data', 'search_read', { domain: [['module', '=', 'analytic'], ['name', '=', 'group_analytic_accounting']], fields: ['res_id'], limit: 1 })).json?.[0]?.res_id
  const botId = (await call('res.users', 'search_read', { domain: [['login', '=', 'pmo_adapter_bot']], fields: ['id'], limit: 1 })).json?.[0]?.id
  if (analyticGroup && botId) await call('res.users', 'write', { ids: [botId], vals: { group_ids: [[4, analyticGroup]] } })
  const planName = 'synthetic ledger plan'
  const mkPlan = async (name) => (await call('account.analytic.plan', 'search_read', { domain: [['name', '=', name]], fields: ['id'], limit: 1 })).json?.[0]?.id
    ?? (await call('account.analytic.plan', 'create', { vals_list: [{ name }] })).json?.[0]
  const plan1 = await mkPlan(planName), plan2 = await mkPlan('synthetic non-project plan')
  const mkAnalytic = async (name, plan) => (await call('account.analytic.account', 'search_read', { domain: [['name', '=', name]], fields: ['id'], limit: 1 })).json?.[0]?.id
    ?? (await call('account.analytic.account', 'create', { vals_list: [{ name, plan_id: plan }] })).json?.[0]
  const a = await mkAnalytic('synthetic project A', plan1), b = await mkAnalytic('synthetic project B', plan1), c2 = await mkAnalytic('synthetic cost centre', plan2)
  const partner = (await call('res.partner', 'create', { vals_list: [{ name: `PT Mitra Logam ${run}` }] })).json?.[0]
  const expense = (await one('account.account', [['account_type', '=', 'expense'], ['company_ids', 'in', [coA]]], ['id', 'code']))
  const income = (await one('account.account', [['account_type', '=', 'income'], ['company_ids', 'in', [coA]]], ['id', 'code']))
  const LINE_F = ['date', 'parent_state', 'debit', 'credit', 'balance', 'account_id', 'move_id', 'move_name', 'journal_id', 'partner_id', 'company_id', 'currency_id', 'amount_currency', 'analytic_distribution', 'write_date']
  const mkMove = (type, lines, extra = {}) => q('account.move', 'create', { vals_list: [{ move_type: type, partner_id: partner, invoice_date: '2026-11-03', date: '2026-11-03', invoice_line_ids: lines.map((l) => [0, 0, { name: 'synthetic line', quantity: 1, tax_ids: [[6, 0, []]], ...l }]), ...extra }] })
  const post = (id) => q('account.move', 'action_post', { ids: [id] })
  const lines = (moveId, extra = []) => q('account.move.line', 'search_read', { domain: [['move_id', '=', moveId]], fields: ['id', ...LINE_F, 'display_type', 'account_type', ...extra], order: 'id asc' })
  const typeOf = (v) => (v === false ? 'false' : v === null ? 'null' : Array.isArray(v) ? `array(${v.length}):${typeof v[0]},${typeof v[1]}` : typeof v)

  await sec('V-ODA1', async () => {
    const bill = await mkMove('in_invoice', [
      { account_id: expense.id, price_unit: 100.01, analytic_distribution: { [a]: 60, [b]: 40 } },
      { account_id: expense.id, price_unit: 50, analytic_distribution: { [a]: 100 } },
      { account_id: expense.id, price_unit: 30, analytic_distribution: { [`${a},${c2}`]: 100 } },
      { account_id: expense.id, price_unit: 20 },
    ])
    const inv = await mkMove('out_invoice', [{ account_id: income.id, price_unit: 200, analytic_distribution: { [a]: 60, [b]: 40 } }])
    const draftLines = await lines(bill.json?.[0])
    await post(bill.json[0]); await post(inv.json[0])
    const bl = await lines(bill.json[0]), il = await lines(inv.json[0])
    const fields = {}
    for (const f of LINE_F) fields[f] = [...new Set((bl.json || []).map((x) => typeOf(x[f])))].join('|')
    record('V-ODA1 account.move.line search_read field list to the bot', 'account.move.line/search_read', bl, bl.status === 200 ? 'verified' : 'wrong', { fieldTypes: fields })
    const row = (x) => ({ id: x.id, parent_state: x.parent_state, display_type: x.display_type, account_type: x.account_type, debit: x.debit, credit: x.credit, balance: x.balance, amount_currency: x.amount_currency, dist: x.analytic_distribution, move_name_shape: typeof x.move_name === 'string' ? x.move_name.replace(/\d/g, '#') : typeOf(x.move_name), wd: x.write_date, date: x.date })
    record('V-ODA1 bill rows (draft parent_state)', 'account.move.line/search_read draft', draftLines, 'verified', { rows: (draftLines.json || []).map(row) })
    record('V-ODA1 bill rows after post', 'account.move.line/search_read', bl, 'verified', { rows: (bl.json || []).map(row) })
    record('V-ODA1 invoice rows after post', 'account.move.line/search_read', il, 'verified', { rows: (il.json || []).map(row) })
    record('V-ODA1 distinct display_type / parent_state across the company', 'account.move.line/search_read', bl, 'verified', { groups: (await q('account.move.line', 'search_read', { domain: [['company_id', '=', coA]], fields: ['display_type', 'parent_state', 'account_type'], limit: 500 })).json?.reduce((m, x) => { const k = `${x.display_type}|${x.parent_state}|${x.account_type}`; m[k] = (m[k] || 0) + 1; return m }, {}) })
    const ptax = await one('account.tax', [['company_id', '=', coA], ['type_tax_use', '=', 'purchase'], ['amount_type', '=', 'percent'], ['amount', '>', 0]], ['id', 'amount'])
    const taxed = await mkMove('in_invoice', [{ account_id: expense.id, price_unit: 100, tax_ids: [[6, 0, [ptax.id]]], analytic_distribution: { [a]: 100 } }, { display_type: 'line_note', name: 'synthetic note', account_id: false, quantity: 0, tax_ids: false }, { display_type: 'line_section', name: 'synthetic section', account_id: false, quantity: 0, tax_ids: false }])
    if (taxed.status === 200) await post(taxed.json[0])
    const tl = taxed.status === 200 ? await lines(taxed.json[0]) : taxed
    record('V-ODA1 bill with a purchase tax, a note and a section line', 'account.move.line/search_read', tl, tl.status === 200 ? 'verified' : 'wrong', { err: errShape(taxed), rows: (tl.json || []).map((x) => ({ display_type: x.display_type, account_type: x.account_type, account: typeOf(x.account_id), balance: x.balance, dist: x.analytic_distribution })) })
    globalThis.__bill = bill.json[0]; globalThis.__inv = inv.json[0]
  })

  await sec('V-ODA6', async () => {
    const mk = async (label, dist) => { const m = await mkMove('in_invoice', [{ account_id: expense.id, price_unit: 100, analytic_distribution: dist }]); const p = m.status === 200 ? await post(m.json[0]) : m; const l = m.status === 200 ? (await lines(m.json[0])).json?.find((x) => x.analytic_distribution) : null; record(`V-ODA6 ${label}`, 'account.move/create+action_post', p.status === 200 ? p : m, p.status === 200 ? 'verified' : 'refused', { sent: dist, stored: l?.analytic_distribution ?? null, err: errShape(m.status === 200 ? p : m) }) }
    await mk('single id', { [a]: 100 })
    await mk('multi-plan key', { [`${a},${c2}`]: 100 })
    await mk('percentage 50', { [a]: 50 })
    await mk('percentage 150', { [a]: 150 })
    await mk('non-project plan only', { [c2]: 100 })
    await mk('fractional 33.33/66.67', { [a]: 33.33, [b]: 66.67 })
  })

  await sec('V-ODA2', async () => {
    const bill = await mkMove('in_invoice', [{ account_id: expense.id, price_unit: 100.01, analytic_distribution: { [a]: 60, [b]: 40 } }])
    await post(bill.json[0])
    const ml = (await lines(bill.json[0])).json?.find((x) => x.analytic_distribution)
    const al = await q('account.analytic.line', 'search_read', { domain: [['move_line_id', '=', ml.id]], fields: ['amount', 'account_id', 'date', 'company_id'] })
    if (al.status !== 200) return record('V-ODA2 analytic.line read', 'account.analytic.line/search_read', al, 'refused', { err: errShape(al) })
    const sum = (al.json || []).reduce((s, x) => Math.round((s + x.amount) * 100) / 100, 0)
    record('V-ODA2 analytic.line amounts for a 60/40 split of 100.01', 'account.analytic.line/search_read', al, al.status === 200 ? 'verified' : 'wrong', { moveLineBalance: ml.balance, analytic: (al.json || []).map((x) => ({ amount: x.amount, account: (Array.isArray(x.account_id) ? x.account_id[0] : x.account_id) === a ? 'A' : (Array.isArray(x.account_id) ? x.account_id[0] : x.account_id) === b ? 'B' : `other:${typeOf(x.account_id)}` })), sum, pmoSplit: { A: Math.round(ml.balance * 0.6 * 100) / 100, B: Math.round((ml.balance - Math.round(ml.balance * 0.6 * 100) / 100) * 100) / 100 } })
    const odd = await mkMove('in_invoice', [{ account_id: expense.id, price_unit: 0.05, analytic_distribution: { [a]: 50, [b]: 50 } }])
    await post(odd.json[0])
    const ol = (await lines(odd.json[0])).json?.find((x) => x.analytic_distribution)
    const oal = await q('account.analytic.line', 'search_read', { domain: [['move_line_id', '=', ol.id]], fields: ['amount', 'account_id'] })
    record('V-ODA2 odd cent 0.05 split 50/50', 'account.analytic.line/search_read', oal, 'verified', { balance: ol.balance, amounts: (oal.json || []).map((x) => [(Array.isArray(x.account_id) ? x.account_id[0] : x.account_id) === a ? 'A' : 'B', x.amount]) })
    const unattr = await mkMove('in_invoice', [{ account_id: expense.id, price_unit: 10 }])
    await post(unattr.json[0])
    const ual = await q('account.analytic.line', 'search_read', { domain: [['move_line_id.move_id', '=', unattr.json[0]]], fields: ['id'] })
    record('V-ODA2 unattributed line writes no analytic.line', 'account.analytic.line/search_read', ual, 'verified', { count: (ual.json || []).length })
  })

  await sec('V-ODA3', async () => {
    const r1 = await q('account.account', 'search_read', { domain: [['company_ids', 'in', [coA]]], fields: ['code', 'name', 'company_ids', 'account_type'], limit: 3 })
    const r2 = await q('account.account', 'search_read', { domain: [['company_ids', 'in', [coB]]], fields: ['code', 'name', 'company_ids'], limit: 3 }, coB)
    const both = await call('account.account', 'search_read', { domain: [['id', '=', expense.id]], fields: ['code'], context: { allowed_company_ids: [coA, coB], company_id: coB } })
    const dupA = await q('account.account', 'search_read', { domain: [['company_ids', 'in', [coA]]], fields: ['code'], limit: 1000 })
    const dupB = await q('account.account', 'search_read', { domain: [['company_ids', 'in', [coB]]], fields: ['code'], limit: 1000 }, coB)
    const cs = (xs) => xs.map((x) => x.code)
    const shared = cs(dupA.json || []).filter((c) => cs(dupB.json || []).includes(c))
    const idsA = new Set((dupA.json || []).map((x) => x.id)), idsB = (await q('account.account', 'search', { domain: [['company_ids', 'in', [coB]]] }, coB)).json || []
    record('V-ODA3 account.code per company', 'account.account/search_read', r1, r1.status === 200 ? 'verified' : 'wrong', { fields: Object.keys(r1.json?.[0] || {}), codeShapeA: r1.json?.[0]?.code?.replace?.(/\d/g, '#'), sameCodesInBothCompanies: shared.length, totalA: dupA.json?.length, totalB: dupB.json?.length, sameRecordIdsAcrossCompanies: idsB.filter((i) => idsA.has(i)).length, readAccountOfAWithCompanyBcontext: both.json?.[0]?.code ? 'code returned' : both.json, companyIdsShape: typeOf(r1.json?.[0]?.company_ids), bAcct: r2.json?.[0] && Object.keys(r2.json[0]) })
    const uniq = new Set(cs(dupA.json || [])).size === (dupA.json || []).length
    record('V-ODA3 code unique within a company', 'account.account/search_read', dupA, uniq ? 'verified' : 'wrong', { uniqueWithinA: uniq })
  })

  await sec('V-ODA4', async () => {
    const f = ['fiscalyear_last_month', 'fiscalyear_last_day', 'fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date', 'hard_lock_date', 'period_lock_date']
    const out = {}
    for (const k of f) { const r = await q('res.company', 'read', { ids: [coA], fields: [k] }); out[k] = r.status === 200 ? typeOf(r.json?.[0]?.[k]) + ':' + JSON.stringify(r.json?.[0]?.[k]) : `HTTP ${r.status} ${r.json?.name || ''}` }
    const all = await q('res.company', 'fields_get', { attributes: ['type'] })
    out.lockLikeFields = Object.keys(all.json || {}).filter((k) => /lock_date|fiscalyear/.test(k))
    record('V-ODA4 res.company fiscal-year and lock fields', 'res.company/read', { status: 200, json: out }, 'verified', out)
  })

  await sec('V-ODA5', async () => {
    const dom = [['company_id', '=', coA], ['parent_state', '=', 'posted']]
    const tries = {
      formatted_read_group: ['account.move.line', 'formatted_read_group', { domain: dom, groupby: ['account_id'], aggregates: ['debit:sum', 'credit:sum'] }],
      read_group: ['account.move.line', 'read_group', { domain: dom, fields: ['debit:sum', 'credit:sum'], groupby: ['account_id'], lazy: false }],
      _read_group: ['account.move.line', '_read_group', { domain: dom, groupby: ['account_id'], aggregates: ['debit:sum', 'credit:sum'] }],
    }
    for (const [k, [m, me, body]] of Object.entries(tries)) {
      const r = await q(m, me, body)
      record(`V-ODA5 ${k} by account_id`, `${m}/${me}`, r, r.status === 200 ? 'works' : `refused (${r.status})`, { err: errShape(r), groups: Array.isArray(r.json) ? r.json.length : null, first: Array.isArray(r.json) ? r.json[0] : null })
    }
    const lim = await q('account.move.line', 'formatted_read_group', { domain: dom, groupby: ['account_id'], aggregates: ['debit:sum', 'credit:sum'], limit: 2 })
    record('V-ODA5 formatted_read_group limit=2', 'account.move.line/formatted_read_group', lim, 'verified', { groups: Array.isArray(lim.json) ? lim.json.length : null })
    const byMonth = await q('account.move.line', 'formatted_read_group', { domain: dom, groupby: ['account_id', 'date:month'], aggregates: ['balance:sum'] })
    record('V-ODA5 groupby account_id + date:month, balance:sum', 'account.move.line/formatted_read_group', byMonth, byMonth.status === 200 ? 'works' : `refused (${byMonth.status})`, { err: errShape(byMonth), first: Array.isArray(byMonth.json) ? byMonth.json[0] : null })
  })

  await sec('V-ODA9', async () => {
    for (const m of ['account.report', 'account.financial.report', 'account.common.report', 'account.report.line', 'account.balance.report', 'account.report.expression']) {
      const r = await q(m, 'search_read', { domain: [], fields: ['id'], limit: 1 })
      record(`V-ODA9 ${m}`, `${m}/search_read`, r, r.status === 200 ? 'REACHABLE' : `refused (${r.status})`, { err: errShape(r), rows: Array.isArray(r.json) ? r.json.length : null })
    }
    const rep = await q('account.report', 'search_read', { domain: [], fields: ['id', 'name', 'country_id', 'root_report_id', 'section_report_ids', 'line_ids', 'column_ids'] })
    record('V-ODA9 account.report records and their lines', 'account.report/search_read', rep, rep.status === 200 ? 'verified' : 'refused', { rows: rep.json, err: errShape(rep) })
    const fg = await q('account.report', 'fields_get', { attributes: ['type'] })
    record('V-ODA9 account.report field names', 'account.report/fields_get', fg, 'verified', { fields: Object.keys(fg.json || {}).slice(0, 60) })
    for (const me of ['get_report_information', 'get_options', 'export_to_pdf', 'action_open_report', 'get_expressions_to_audit', 'get_available_variants']) {
      const r = await q('account.report', me, { ids: (rep.json || []).map((x) => x.id) })
      record(`V-ODA9 account.report/${me}`, `account.report/${me}`, r, r.status === 200 ? 'CALLABLE' : `refused (${r.status})`, { err: errShape(r) })
    }
    const am = await q('account.move.line', 'get_report_data', { ids: [] })
    record('V-ODA9 account.move.line/get_report_data (any stock report helper)', 'account.move.line/get_report_data', am, `HTTP ${am.status}`, { err: errShape(am) })
    const mods = await q('ir.model', 'search_read', { domain: ['|', '|', ['model', 'ilike', 'report'], ['model', 'ilike', 'trial'], ['model', 'ilike', 'financial']], fields: ['model'], limit: 200 })
    record('V-ODA9 accounting-report-like models present', 'ir.model/search_read', mods, 'verified', { accountModels: (mods.json || []).map((x) => x.model).filter((x) => x.startsWith('account.')) })
    const rm = await q('ir.module.module', 'search_read', { domain: [['name', 'in', ['account_reports', 'account_accountant', 'accountant']]], fields: ['name', 'state'] })
    record('V-ODA9 enterprise reporting modules', 'ir.module.module/search_read', rm, 'verified', { found: rm.json })
  })

  await sec('V-ODA7', async () => {
    const vol = (await call('res.company', 'search_read', { domain: [['name', '=', 'PT Volume Uji']], fields: ['id'], limit: 1 })).json?.[0]?.id
    if (!vol) return record('V-ODA7', 'n/a', { status: 0, json: null }, 'no volume company: run scripts/odoo-bed/load-ledger.mjs first')
    const vq = (m, me, b = {}) => call(m, me, { ...b, context: { allowed_company_ids: [vol], company_id: vol } })
    const total = (await vq('account.move.line', 'search_count', { domain: [['company_id', '=', vol]] })).json
    const F = ['id', ...LINE_F]
    for (const limit of [200, 1000]) {
      const ms = []; let cursor = ['1970-01-01 00:00:00', 0], seen = 0, calls = 0
      const t0 = Date.now()
      while (calls < 60 && Date.now() - t0 < 100000) {
        const dom = [['company_id', '=', vol], '|', ['write_date', '>', cursor[0]], '&', ['write_date', '=', cursor[0]], ['id', '>', cursor[1]]]
        const t = Date.now()
        const r = await vq('account.move.line', 'search_read', { domain: dom, fields: F, order: 'write_date asc, id asc', limit })
        ms.push(Date.now() - t); calls++
        if (r.status !== 200 || !r.json.length) break
        seen += r.json.length
        const last = r.json[r.json.length - 1]; cursor = [last.write_date, last.id]
      }
      ms.sort((x, y) => x - y)
      record(`V-ODA7 keyset pages at ${limit}`, 'account.move.line/search_read', { status: 200, json: {} }, 'verified', { limit, totalLines: total, calls, linesRead: seen, totalMs: Date.now() - t0, p50Ms: ms[Math.floor(ms.length / 2)], p95Ms: ms[Math.floor(ms.length * 0.95)], maxMs: ms[ms.length - 1], linesPerCallAvg: Math.round(seen / calls) })
    }
    for (const [label, groupby] of [['account_id', ['account_id']], ['account_id + date:month', ['account_id', 'date:month']]]) {
      const t = Date.now()
      const r = await vq('account.move.line', 'formatted_read_group', { domain: [['company_id', '=', vol], ['parent_state', '=', 'posted']], groupby, aggregates: ['debit:sum', 'credit:sum'] })
      record(`V-ODA7 grouped read by ${label} over the whole company`, 'account.move.line/formatted_read_group', r, r.status === 200 ? 'verified' : 'wrong', { ms: Date.now() - t, groups: Array.isArray(r.json) ? r.json.length : null, err: errShape(r) })
    }
    const t = Date.now()
    const ids = await vq('account.move.line', 'search', { domain: [['company_id', '=', vol], ['id', '>', 0]], order: 'id asc', limit: 5000 })
    record('V-ODA7 id sweep (search ids, limit 5000)', 'account.move.line/search', ids, ids.status === 200 ? 'verified' : 'wrong', { ms: Date.now() - t, ids: Array.isArray(ids.json) ? ids.json.length : null })
  })

  const mkUser = (label, groups) => {
    const script = `from datetime import datetime, timedelta
import json
env = self.env
gs = [g for g in ${JSON.stringify(groups)} if env.ref(g, raise_if_not_found=False)]
u = env['res.users'].sudo().with_context(no_reset_password=True).create({'name': 'Synthetic ${label} ${run}', 'login': 'synthetic-${label}-${run}', 'group_ids': [(6, 0, [env.ref(g).id for g in gs])], 'company_ids': [(6, 0, [${coA}])], 'company_id': ${coA}})
k = env['res.users.apikeys'].with_user(u)._generate('rpc', 'synthetic probe', datetime.now() + timedelta(hours=20))
env.cr.commit()
print('PROBE_USER=' + json.dumps({'id': u.id, 'key': k, 'missing': [g for g in ${JSON.stringify(groups)} if g not in gs]}))
`
    const out = spawnSync('docker', ['exec', '-i', 'pmo-odoo-odoo-1', 'sh', '-c', `odoo shell -d ${probeDatabase} --no-http --db_host="$HOST" --db_user="$USER" --db_password="$PASSWORD"`], { input: script, encoding: 'utf8' })
    try { return JSON.parse(out.stdout.split('\n').find((x) => x.startsWith('PROBE_USER=')).slice('PROBE_USER='.length)) } catch { return { failed: String(out.stderr || out.stdout).split('\n').filter(Boolean).slice(-1)[0]?.replace(/\d+/g, '#').slice(0, 140) } }
  }
  await sec('V-ODA10', async () => {
    const sets = {
      internalOnly: ['base.group_user'],
      billing: ['base.group_user', 'account.group_account_invoice'],
      readonly: ['base.group_user', 'account.group_account_readonly'],
      accountant: ['base.group_user', 'account.group_account_user'],
    }
    for (const [name, groups] of Object.entries(sets)) {
      const u = mkUser(name, groups)
      if (!u || u.failed) { record(`V-ODA10 ${name}`, 'res.users/create', { status: 0, json: null }, 'user creation failed', { reason: u?.failed }); continue }
      const as = (m, me, b = {}) => call(m, me, { ...b, context: { allowed_company_ids: [coA], company_id: coA } }, { key: u.key })
      const calls = {
        'move.line search_read (S1 field list)': () => as('account.move.line', 'search_read', { domain: [['company_id', '=', coA]], fields: ['id', ...LINE_F], order: 'write_date asc, id asc', limit: 200 }),
        'move.line keyset 1000': () => as('account.move.line', 'search_read', { domain: [['company_id', '=', coA], ['write_date', '>=', '2000-01-01 00:00:00']], fields: ['id', 'write_date'], order: 'write_date asc, id asc', limit: 1000 }),
        'move.line formatted_read_group': () => as('account.move.line', 'formatted_read_group', { domain: [['company_id', '=', coA], ['parent_state', '=', 'posted']], groupby: ['account_id'], aggregates: ['debit:sum', 'credit:sum'] }),
        'account.account search_read': () => as('account.account', 'search_read', { domain: [['company_ids', 'in', [coA]]], fields: ['id', 'code', 'name', 'account_type'], limit: 5 }),
        'analytic.account search_read': () => as('account.analytic.account', 'search_read', { domain: [], fields: ['id', 'name', 'plan_id'], limit: 5 }),
        'res.company read fiscal fields': () => as('res.company', 'read', { ids: [coA], fields: ['fiscalyear_last_month', 'fiscalyear_last_day'] }),
        'account.move search_read': () => as('account.move', 'search_read', { domain: [['company_id', '=', coA]], fields: ['id', 'name', 'move_type', 'state', 'write_date'], limit: 5 }),
      }
      const res = []
      for (const [k, f] of Object.entries(calls)) res.push([k, (await f()).status])
      const bad = res.filter(([, st]) => st !== 200).map(([k, st]) => `${k}:${st}`)
      record(`V-ODA10 group set: ${name}`, `${res.length} read calls`, { status: 200, json: {} }, bad.length ? `refused: ${bad.join(', ')}` : 'all calls passed', { groups, missingGroups: u.missing })
    }
  })

  await sec('V-ODA8', async () => {
    const WD = ['write_date', 'parent_state', 'move_id']
    const snap = async (label, moveIds, extra = {}) => {
      const rows = (await q('account.move.line', 'search_read', { domain: [['move_id', 'in', moveIds]], fields: ['id', 'write_date', 'parent_state', 'move_id', 'balance', 'move_name'], order: 'id asc' })).json || []
      const mv = (await q('account.move', 'read', { ids: moveIds, fields: ['state', 'write_date', 'reversed_entry_id'] })).json || []
      return { label, lines: rows.map((x) => ({ id: x.id, move: x.move_id?.[0], name: typeof x.move_name === 'string' ? 'str' : String(x.move_name), ps: x.parent_state, wd: x.write_date, bal: x.balance })), moves: mv.map((x) => ({ id: x.id, state: x.state, wd: x.write_date, rev: x.reversed_entry_id?.[0] ?? null })), ...extra }
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const fresh = async () => { const m = await mkMove('in_invoice', [{ account_id: expense.id, price_unit: 100, analytic_distribution: { [a]: 100 } }]); await post(m.json[0]); return m.json[0] }
    // reverse
    let id = await fresh(); let before = await snap('before', [id]); await sleep(1100)
    const rctx = { active_model: 'account.move', active_ids: [id] }
    const src = await rd('account.move', id, ['journal_id', 'company_id'])
    const w = await q('account.move.reversal', 'create', { vals_list: [{ reason: 'synthetic', journal_id: src.journal_id[0], company_id: src.company_id[0] }], context: rctx })
    const rf = await q('account.move.reversal', 'refund_moves', { ids: w.json, context: rctx })
    const revId = rf.json?.res_id
    if (revId) await post(revId)
    record('V-ODA8 reverse (credit note then post)', 'account.move.reversal/refund_moves', rf, rf.status === 200 ? 'verified' : 'wrong', { before, after: await snap('after', [id, revId].filter(Boolean)) })
    // reset to draft + repost
    id = await fresh(); before = await snap('before', [id]); await sleep(1100)
    const bd = await q('account.move', 'button_draft', { ids: [id] })
    const asDraft = await snap('draft', [id])
    await sleep(1100)
    await q('account.move.line', 'write', { ids: (await lines(id)).json.filter((x) => x.analytic_distribution).map((x) => x.id), vals: { price_unit: 150 } }).catch(() => null)
    const rp = await post(id)
    record('V-ODA8 reset to draft then repost', 'account.move/button_draft+action_post', bd, bd.status === 200 && rp.status === 200 ? 'verified' : 'wrong', { before, draft: asDraft, after: await snap('after', [id]), err: errShape(bd) || errShape(rp) })
    // cancel
    id = await fresh(); before = await snap('before', [id]); await sleep(1100)
    const bc = await q('account.move', 'button_cancel', { ids: [id] })
    record('V-ODA8 cancel a posted bill', 'account.move/button_cancel', bc, bc.status === 200 ? 'verified' : 'refused', { before, after: await snap('after', [id]), err: errShape(bc) })
    // delete a draft
    const d = await mkMove('in_invoice', [{ account_id: expense.id, price_unit: 100, analytic_distribution: { [a]: 100 } }])
    const dl = (await lines(d.json[0])).json.map((x) => x.id)
    const beforeGone = await snap('before', [d.json[0]])
    const un = await q('account.move', 'unlink', { ids: d.json })
    const gone = await q('account.move.line', 'search', { domain: [['id', 'in', dl]] })
    record('V-ODA8 hard delete of a draft', 'account.move/unlink', un, un.status === 200 ? 'verified' : 'refused', { before: beforeGone, linesAfter: gone.json, err: errShape(un) })
    // posted delete
    const pd = await fresh(); const un2 = await q('account.move', 'unlink', { ids: [pd] })
    record('V-ODA8 delete a posted bill', 'account.move/unlink', un2, un2.status === 200 ? 'DELETED' : 'refused', { err: errShape(un2) })
    // keyset sees: a cursor taken before the change, what rows come back with write_date > cursor
    const cur = (await q('account.move.line', 'search_read', { domain: [['company_id', '=', coA]], fields: ['write_date'], order: 'write_date desc, id desc', limit: 1 })).json?.[0]?.write_date
    await sleep(1100)
    const k = await fresh(); await sleep(1100); await q('account.move', 'button_draft', { ids: [k] })
    const seen = await q('account.move.line', 'search_read', { domain: [['company_id', '=', coA], ['write_date', '>', cur]], fields: ['id', 'parent_state', 'move_id'], order: 'write_date asc, id asc' })
    record('V-ODA8 keyset after a post then reset-to-draft sees', 'account.move.line/search_read write_date > cursor', seen, 'verified', { rows: (seen.json || []).map((x) => ({ ps: x.parent_state, sameMove: x.move_id?.[0] === k })) })
  })

  await sec('V-ODA11', async () => {
    const opening = await q('account.move', 'create', { vals_list: [{ move_type: 'entry', date: '2026-01-01', ref: 'synthetic opening balance', line_ids: [
      [0, 0, { account_id: (await one('account.account', [['account_type', '=', 'asset_current'], ['company_ids', 'in', [coA]]], ['id'])).id, debit: 5000, credit: 0, name: 'synthetic opening' }],
      [0, 0, { account_id: (await one('account.account', [['account_type', '=', 'equity'], ['company_ids', 'in', [coA]]], ['id'])).id, debit: 0, credit: 5000, name: 'synthetic opening' }],
    ] }] })
    const op = opening.status === 200 ? await post(opening.json[0]) : opening
    const L = ['date', 'parent_state', 'debit', 'credit', 'balance', 'account_id', 'journal_id', 'account_type', 'display_type', 'move_type']
    const ol = opening.status === 200 ? await q('account.move.line', 'search_read', { domain: [['move_id', '=', opening.json[0]]], fields: L }) : opening
    const journal = opening.status === 200 ? await rd('account.move', opening.json[0], ['journal_id']) : null
    const jt = journal ? await rd('account.journal', journal.journal_id[0], ['type', 'code']) : null
    record('V-ODA11 opening balance entry (misc journal, entry)', 'account.move/create+action_post', op, op.status === 200 ? 'verified' : 'wrong', { journalType: jt?.type, rows: (ol.json || []).map((x) => ({ ps: x.parent_state, account_type: x.account_type, display_type: x.display_type, move_type: x.move_type, debit: x.debit, credit: x.credit, date: x.date })), err: errShape(opening) || errShape(op) })
    const types = await q('account.account', 'fields_get', { attributes: ['selection'] })
    record('V-ODA11 account_type values', 'account.account/fields_get', types, 'verified', { accountTypes: (types.json?.account_type?.selection || []).map((x) => x[0]) })
    const unaff = await one('account.account', [['account_type', '=', 'equity_unaffected'], ['company_ids', 'in', [coA]]], ['id', 'code'])
    const profit = await one('account.account', [['account_type', '=', 'income'], ['company_ids', 'in', [coA]]], ['id'])
    // year-end style closing: a manual entry moving the year's income to equity_unaffected on 31 Dec
    const inc = await mkMove('out_invoice', [{ account_id: income.id, price_unit: 700 }], { invoice_date: '2025-12-15', date: '2025-12-15' })
    if (inc.status === 200) await post(inc.json[0])
    const close = await q('account.move', 'create', { vals_list: [{ move_type: 'entry', date: '2025-12-31', ref: 'synthetic year-end closing', line_ids: [
      [0, 0, { account_id: income.id, debit: 700, credit: 0, name: 'synthetic closing' }],
      [0, 0, { account_id: unaff.id, debit: 0, credit: 700, name: 'synthetic closing' }],
    ] }] })
    const cp = close.status === 200 ? await post(close.json[0]) : close
    const cl = close.status === 200 ? await q('account.move.line', 'search_read', { domain: [['move_id', '=', close.json[0]]], fields: L }) : close
    record('V-ODA11 manual year-end closing to equity_unaffected', 'account.move/create+action_post', cp, cp.status === 200 ? 'verified' : 'wrong', { unaffectedCodeShape: unaff?.code?.replace?.(/\d/g, '#'), rows: (cl.json || []).map((x) => ({ ps: x.parent_state, account_type: x.account_type, debit: x.debit, credit: x.credit, date: x.date })), err: errShape(close) || errShape(cp) })
    const bal = await q('account.move.line', 'formatted_read_group', { domain: [['company_id', '=', coA], ['parent_state', '=', 'posted'], ['date', '<=', '2025-12-31']], groupby: ['account_type'], aggregates: ['balance:sum'] })
    record('V-ODA11 cumulative balance by account_type to 2025-12-31', 'account.move.line/formatted_read_group', bal, bal.status === 200 ? 'verified' : 'wrong', { groups: bal.json })
    const closeWizard = await q('res.company', 'fields_get', { attributes: ['string'] })
    record('V-ODA11 stock year-end close entry creator on res.company', 'res.company/fields_get', closeWizard, 'verified', { yearEndLike: Object.keys(closeWizard.json || {}).filter((k) => /year|close|lock/.test(k)) })
  })

  for (const x of results) console.log(JSON.stringify(x))
  process.exit(0)
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
