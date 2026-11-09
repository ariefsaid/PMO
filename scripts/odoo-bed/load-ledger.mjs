// load-ledger.mjs — V-ODA7 volume loader for the local Odoo dev bed (#1507 S0). Synthetic only.
// Creates posted journal entries of PER lines each in its own company "PT Volume Uji" (never touches other companies).
// Usage (inside scripts/with-odoo-lock.sh): node scripts/odoo-bed/load-ledger.mjs <total-lines> [per-move=100]
// Prints one JSON line per batch of 20 moves: lines so far, ms per move. Never prints keys.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const env = Object.fromEntries(readFileSync(fileURLToPath(new URL('../../.env.odoo.local', import.meta.url)), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const call = async (model, method, body = {}) => {
  const r = await fetch(`http://127.0.0.1:${env.ODOO_PORT || 8069}/json/2/${model}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `bearer ${env.ODOO_API_KEY}`, 'X-Odoo-Database': env.ODOO_DB }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${model}/${method} ${r.status} ${j?.name}`)
  return j
}
const total = Number(process.argv[2] || 1000), per = Number(process.argv[3] || 100)
const NAME = 'PT Volume Uji'
let co = (await call('res.company', 'search_read', { domain: [['name', '=', NAME]], fields: ['id'], limit: 1 }))[0]?.id
if (!co) {
  const idc = (await call('res.country', 'search_read', { domain: [['code', '=', 'ID']], fields: ['id'], limit: 1 }))[0].id
  co = (await call('res.company', 'create', { vals_list: [{ name: NAME, country_id: idc }] }))[0]
  await call('account.chart.template', 'try_loading', { template_code: 'id', company: co })
}
const ctx = { allowed_company_ids: [co], company_id: co }
const q = (m, me, b = {}) => call(m, me, { ...b, context: ctx })
const accts = (await q('account.account', 'search_read', { domain: [['company_ids', 'in', [co]], ['account_type', 'in', ['expense', 'asset_current']]], fields: ['id', 'account_type'], limit: 40 }))
const exp = accts.filter((x) => x.account_type === 'expense').map((x) => x.id), asset = accts.filter((x) => x.account_type === 'asset_current').map((x) => x.id)
const plan = (await call('account.analytic.plan', 'search_read', { domain: [['name', '=', 'synthetic ledger plan']], fields: ['id'], limit: 1 }))[0]?.id
const an = []
for (let i = 0; i < 20; i++) {
  const nm = `synthetic volume project ${i}`
  const f = (await call('account.analytic.account', 'search_read', { domain: [['name', '=', nm]], fields: ['id'], limit: 1 }))[0]?.id
  an.push(f ?? (await call('account.analytic.account', 'create', { vals_list: [{ name: nm, plan_id: plan }] }))[0])
}
let made = 0, mv = 0, t0 = Date.now(), tb = Date.now()
while (made < total) {
  const lines = []
  for (let i = 0; i < per / 2; i++) {
    const amt = 100 + ((mv * 31 + i * 17) % 9000) / 10
    const a = an[(mv + i) % an.length], b = an[(mv + i + 7) % an.length]
    lines.push([0, 0, { account_id: exp[i % exp.length], debit: amt, credit: 0, name: 'synthetic', analytic_distribution: i % 3 === 0 ? { [a]: 60, [b]: 40 } : { [a]: 100 } }])
    lines.push([0, 0, { account_id: asset[i % asset.length], debit: 0, credit: amt, name: 'synthetic' }])
  }
  const id = (await q('account.move', 'create', { vals_list: [{ move_type: 'entry', date: `2026-${String((mv % 12) + 1).padStart(2, '0')}-15`, ref: `synthetic volume ${mv}`, line_ids: lines }] }))[0]
  await q('account.move', 'action_post', { ids: [id] })
  made += per; mv++
  if (mv % 20 === 0) { console.log(JSON.stringify({ lines: made, msPerMove: Math.round((Date.now() - tb) / 20) })); tb = Date.now() }
}
console.log(JSON.stringify({ done: true, company: NAME, lines: made, totalMs: Date.now() - t0 }))
