#!/usr/bin/env node
// signed-in-state — one real sign-in, saved as Playwright storageState JSON for the measuring tools.
//
//   node .claude/skill-overrides/restructure/scripts/signed-in-state.mjs \
//     [--base http://localhost:5288] [--email exec@acme.test] \
//     [--out .taste-skill/auth/exec@acme.test.json] [--timeout 25000]
//
// The taste composition inspector (--storage-state) and the stageshow layout checker (--storage-state)
// both take a Playwright storageState file. A fresh browser profile reaches /login, so a gate run
// against it audits the login page and says nothing about the screen someone asked about. This script
// drives ONE real form sign-in as a seeded role and writes the cookies + localStorage that made it work.
//
// The password is read from the e2e support code (pmo-portal/e2e/helpers.ts SEED_PASSWORD), never from
// a .env file, so there is one source of truth for the seeded roles and nothing secret is echoed here.
// The output is a live session: it is refused unless git ignores its path, and it is never committed.
//
// Exit 0 = state written. Exit 2 = usage or environment problem (no server, no password, unignored path).
// Exit 1 = the sign-in did not reach the app (the state would be a signed-out session).
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const APP = join(ROOT, 'pmo-portal')

const usage = () => console.log(`usage: node .claude/skill-overrides/restructure/scripts/signed-in-state.mjs [--base http://localhost:5288] [--email exec@acme.test] [--out .taste-skill/auth/<email>.json] [--timeout 25000] [--json]
Signs a seeded role in against a running app and saves a Playwright storageState JSON for
taste's inspect.mjs --storage-state and stageshow's layout.mjs --storage-state.
Scriptable: role and output path are arguments, exit 0 = state written, 1 = sign-in failed,
2 = usage/environment problem; --json prints one object { email, base, statePath, landedOn, cookies, keys }.`)

const args = process.argv.slice(2)
const options = { base: 'http://localhost:5288', email: 'exec@acme.test', out: null, timeout: 25000, json: false }
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--help' || arg === '-h') { usage(); process.exit(0) }
  if (arg === '--json') { options.json = true; continue }
  if (!/^--(base|email|out|timeout)$/.test(arg) || !args[i + 1] || args[i + 1].startsWith('--')) {
    console.error(`signed-in-state: unexpected argument ${arg}; use --help`)
    process.exit(2)
  }
  const value = args[++i]
  if (arg === '--timeout') {
    options.timeout = Number(value)
    if (!Number.isInteger(options.timeout) || options.timeout <= 0) { console.error('signed-in-state: --timeout must be a positive integer (ms)'); process.exit(2) }
  } else options[arg.slice(2)] = value
}
options.base = options.base.replace(/\/$/, '')
const baseUrl = (() => { try { return new URL(options.base) } catch { return null } })()
if (!baseUrl || !/^https?:$/.test(baseUrl.protocol)) { console.error(`signed-in-state: --base must be an http(s) URL, got ${options.base}`); process.exit(2) }
// The app is served on a 52xx dev port (3000 is reserved for the e2e lane, 5198/5199 are someone else's).
if (!/^localhost$|^127\.0\.0\.1$|^\[::1\]$/.test(baseUrl.hostname)) { console.error(`signed-in-state: --base must be a local host, got ${baseUrl.hostname}`); process.exit(2) }

const outPath = resolve(options.out || join(ROOT, '.taste-skill', 'auth', `${options.email}.json`))
const rel = (p) => p.startsWith(ROOT + '/') ? p.slice(ROOT.length + 1) : p

// 1. The password comes from the e2e support code — one source of truth, never a .env file.
const helpersPath = join(APP, 'e2e', 'helpers.ts')
if (!existsSync(helpersPath)) { console.error(`signed-in-state: ${rel(helpersPath)} is missing; this needs the e2e auth setup`); process.exit(2) }
const helpers = readFileSync(helpersPath, 'utf8')
const password = helpers.match(/export const SEED_PASSWORD\s*=\s*'([^']+)'/)?.[1]
if (!password) { console.error(`signed-in-state: no SEED_PASSWORD in ${rel(helpersPath)}; refusing to guess a credentials source`); process.exit(2) }

// A typo'd role silently writes a state for a user who cannot see the screen under test, so name it.
const setupPath = join(APP, 'e2e', 'auth.setup.ts')
const seeded = existsSync(setupPath) ? [...readFileSync(setupPath, 'utf8').matchAll(/'([a-z0-9.-]+@[a-z0-9.-]+\.[a-z]+)'/gi)].map((m) => m[1]) : []
if (seeded.length && !seeded.includes(options.email)) {
  console.error(`signed-in-state: ${options.email} is not one of the seeded roles in ${rel(setupPath)}:\n  ${seeded.join('\n  ')}`)
  process.exit(2)
}

// 2. A live session must never land in a commit: refuse any path git does not ignore.
mkdirSync(dirname(outPath), { recursive: true })
const ignored = spawnSync('git', ['-C', ROOT, 'check-ignore', '-q', '--no-index', outPath], { stdio: 'ignore' })
if (ignored.status !== 0) {
  console.error(`signed-in-state: ${rel(outPath)} is not git-ignored, so a live session could be committed. Add its directory to .gitignore, or pass --out inside an ignored path.`)
  process.exit(2)
}

// 3. Reach the app before launching a browser, so "no server" is a clear message rather than a timeout.
try {
  const res = await fetch(`${options.base}/login`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  if (res.status >= 400 && res.status !== 304) throw new Error(`HTTP ${res.status}`)
} catch (error) {
  console.error(`signed-in-state: nothing answering at ${options.base} (${error.message}). Start the app on a 52xx port, e.g.\n  cd pmo-portal && npx vite --port 5288 --strictPort`)
  process.exit(2)
}

const requireApp = createRequire(join(APP, 'package.json'))
let chromium
try { ({ chromium } = requireApp('playwright-core')) } catch {
  console.error('signed-in-state: playwright-core is not installed in pmo-portal; run npm ci there.')
  process.exit(2)
}

let browser = null
try {
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }) }
  catch { browser = await chromium.launch({ headless: true }) }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'UTC' })
  const page = await context.newPage()
  await page.goto(`${options.base}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/email/i).fill(options.email)
  await page.getByLabel(/password/i).fill(password)
  await Promise.all([
    page.waitForURL((u) => !/\/login(?:[/?#]|$)/.test(u.pathname), { timeout: options.timeout }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ])
  await page.waitForLoadState('networkidle').catch(() => {})
  const landedOn = page.url()
  if (/\/login(?:[/?#]|$)/.test(new URL(landedOn).pathname)) {
    console.error(`signed-in-state: still on the login page at ${landedOn}; the seeded session was not created (wrong password, unseeded role, or auth backend down)`)
    process.exitCode = 1
  } else {
    await context.storageState({ path: outPath })
    const state = JSON.parse(readFileSync(outPath, 'utf8'))
    const keys = (state.origins || []).flatMap((o) => (o.localStorage || []).map((i) => i.name))
    if (options.json) {
      console.log(JSON.stringify({ email: options.email, base: options.base, statePath: outPath, landedOn, cookies: (state.cookies || []).length, keys }))
    } else {
      console.log(`signed-in-state: ${options.email} on ${options.base}`)
      console.log(`  landed on   ${landedOn}`)
      console.log(`  state       ${rel(outPath)}  (git-ignored; never commit it)`)
      console.log(`  contents    ${(state.cookies || []).length} cookie(s)` + (keys.length ? `, localStorage keys: ${keys.join(', ')}` : ', no localStorage'))
      console.log(`\nnext: node .claude/skills/taste/scripts/inspect.mjs --app ${options.base}/ --storage-state ${rel(outPath)}`)
    }
  }
  await context.close()
} catch (error) {
  console.error(`signed-in-state: ${error.message}`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
}
