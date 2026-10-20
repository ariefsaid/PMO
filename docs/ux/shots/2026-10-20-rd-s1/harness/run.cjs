const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const req = createRequire('/Users/ariefsaid/Coding/PMO-wt-v024-rd-s1/pmo-portal/package.json');
const { chromium } = req('playwright');
const fx = require('./fixture.cjs');
if (process.env.EXEC_OVERRIDE) Object.assign(fx.executive, JSON.parse(process.env.EXEC_OVERRIDE));
const BASE = 'http://localhost:5191';
const OUT = process.env.OUT || '/Users/ariefsaid/Coding/PMO-wt-v024-rd-s1/docs/ux/shots/2026-10-20-rd-s1';
const STATE = path.join(__dirname, 'state');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(STATE, { recursive: true });
const PW = 'Passw0rd!dev';
const MONEY_KEYS = new Set(['net', 'recovery', 'outstanding', 'outstanding_amount', 'grand_total', 'base_grand_total', 'amount', 'contract_net', 'contract_value', 'invoiced', 'total_amount', 'open_ar', 'net_total', 'total', 'subtotal', 'paid_amount', 'invoice_amount', 'vendor_invoice_amount']);
function scale(node, key) {
  if (Array.isArray(node)) return node.map((x) => scale(x, key));
  if (node && typeof node === 'object') { const o = {}; for (const [k, v] of Object.entries(node)) o[k] = scale(v, k); return o; }
  if (key && /currency$/.test(key) && node === 'USD') return 'IDR';
  if (key && MONEY_KEYS.has(key)) {
    if (typeof node === 'number') return Math.round(node * 15000);
    if (typeof node === 'string' && /^-?\d+(\.\d+)?$/.test(node)) return (Math.round(Number(node) * 15000)).toFixed(2);
  }
  return node;
}
async function install(page, { bahasa }) {
  const j = (obj) => (route) => route.fulfill({ json: obj });
  await page.route('**/rest/v1/rpc/get_executive_dashboard*', j(fx.executive));
  await page.route('**/rest/v1/rpc/get_win_rate*', j(fx.winRate));
  await page.route('**/rest/v1/rpc/get_sales_pipeline*', j(fx.pipeline));
  await page.route('**/rest/v1/rpc/get_pm_dashboard_projects*', j(fx.pmProjects));
  await page.route('**/rest/v1/rpc/get_finance_budget_review*', j([]));
  await page.route('**/rest/v1/organizations?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/default_currency/.test(url)) return route.fallback();
    const res = await route.fetch(); let body = await res.json();
    if (Array.isArray(body)) body = body.map((r) => ({ ...r, default_currency: 'IDR' }));
    else if (body && typeof body === 'object') body = { ...body, default_currency: 'IDR' };
    return route.fulfill({ response: res, json: body });
  });
  for (const pat of ['**/rest/v1/sales_invoice_work_billed?*', '**/rest/v1/sales_invoices?*', '**/rest/v1/rpc/get_management_pack*', '**/rest/v1/procurements?*']) {
    await page.route(pat, async (route) => {
      if (route.request().method() !== 'GET' && !/rpc/.test(route.request().url())) return route.fallback();
      const res = await route.fetch(); let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
      return route.fulfill({ response: res, json: scale(body) });
    });
  }
  if (bahasa) {
    await page.route('**/rest/v1/profiles?*', async (route) => {
      const url = route.request().url();
      if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
      const res = await route.fetch(); let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
      if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) body = { ...body, locale: 'id', number_locale: 'id-ID' };
      return route.fulfill({ response: res, json: body });
    });
  }
}
async function ensureState(browser, email) {
  const p = path.join(STATE, `${email}.json`);
  if (fs.existsSync(p)) return p;
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/, { timeout: 30000 });
  await ctx.storageState({ path: p }); await ctx.close(); return p;
}
async function measure(page) {
  return page.evaluate(() => {
    const out = { violations: [], tiles: [], tabular: [] };
    const scrollerOwns = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const ox = getComputedStyle(n).overflowX; if (ox === 'auto' || ox === 'scroll') return true; } return false; };
    for (const el of document.querySelectorAll('.tabular')) {
      const box = el.getBoundingClientRect(); if (!box.width || !box.height) continue;
      const inTable = !!el.closest('table,[role="table"],[role="grid"]');
      const text = (el.textContent || '').trim().slice(0, 60);
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 0.5) out.violations.push({ text, inTable, reason: `clipped ${el.scrollWidth}>${el.clientWidth}` });
      if (!scrollerOwns(el)) {
        const card = el.parentElement && el.parentElement.closest('[class*="rounded-lg"][class*="border"],[class*="rounded-md"][class*="border"]');
        if (card) { const c = card.getBoundingClientRect(); if (box.right > c.right + 0.5 || box.left < c.left - 0.5) out.violations.push({ text, inTable, reason: `crosses card ${Math.round(box.left)}-${Math.round(box.right)} vs ${Math.round(c.left)}-${Math.round(c.right)}` }); }
      }
    }
    for (const t of document.querySelectorAll('[data-testid^="kpi-"], [data-testid^="mobile-"], [data-testid="dashboard-at-risk"]')) {
      const fig = t.querySelector('[title]') || t.querySelector('.tabular');
      const fs = fig ? getComputedStyle(fig).fontSize : null;
      const lh = fig ? parseFloat(getComputedStyle(fig).lineHeight) || parseFloat(fs) : null;
      out.tiles.push({ id: t.getAttribute('data-testid'), text: (t.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
        figTitle: fig ? fig.getAttribute('title') : null, figText: fig ? fig.innerText.trim() : null, figFont: fs,
        figLines: fig && lh ? Math.round(fig.getBoundingClientRect().height / lh) : null, figW: fig ? Math.round(fig.getBoundingClientRect().width) : null,
        srOnly: Array.from(t.querySelectorAll('.sr-only')).map((s) => s.textContent.trim()).filter(Boolean), h: Math.round(t.getBoundingClientRect().height) });
    }
    out.doc = { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, height: document.documentElement.scrollHeight };
    return out;
  });
}
const MATRIX = JSON.parse(process.env.MATRIX);
(async () => {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const m of MATRIX) {
      const statePath = await ensureState(browser, m.user);
      for (const w of m.widths) {
        const h = w === 390 ? 844 : 900;
        const ctx = await browser.newContext({ storageState: statePath, viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
        await install(page, { bahasa: m.lang === 'id' });
        await page.goto(BASE + m.path);
        try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
        await page.waitForTimeout(1500);
        await page.evaluate(() => document.fonts.ready);
        const name = `${m.name}-${m.lang}-${w}`;
        await page.screenshot({ path: path.join(OUT, `${name}-fold.png`) });
        const meas = await measure(page);
        const html = await page.evaluate(() => { const d = document.documentElement.cloneNode(true); d.querySelectorAll('script').forEach((s) => s.remove()); return '<!doctype html>' + d.outerHTML; });
        fs.writeFileSync(path.join(__dirname, 'snaps', `${name}.html`), html.replace('<head>', '<head><base href="http://localhost:5191/">'));
        const extra = await page.evaluate(() => { let best = 0; for (const el of document.querySelectorAll('*')) { const d = el.scrollHeight - el.clientHeight; const oy = getComputedStyle(el).overflowY; if (d > best && (oy === 'auto' || oy === 'scroll')) best = d; } return best; });
        if (extra > 0) { await page.setViewportSize({ width: w, height: h + extra }); await page.waitForTimeout(500); }
        await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
        let aria = null;
        if (m.aria) { try { aria = await page.locator(m.aria).first().ariaSnapshot({ timeout: 3000 }); } catch (e) { aria = 'ERR ' + e.message.slice(0, 80); } }
        results.push({ name, url: page.url(), errors, ...meas, aria });
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(__dirname, `results-${process.env.TAG || 'run'}.json`), JSON.stringify(results, null, 2));
  for (const r of results) console.log(r.name, 'viol', r.violations.length, 'doc', r.doc.scroll + '/' + r.doc.client, 'tiles', r.tiles.length, 'err', r.errors.length);
})();
