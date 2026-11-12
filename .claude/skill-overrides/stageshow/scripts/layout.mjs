#!/usr/bin/env node
// OVERRIDE of the vendored stageshow skill (upstream rev 299140fafd08df55a9c234e610c3f64af3f45531): adds
// --storage-state (+ a network-idle settle for state runs) so a signed-in app screen is checked as written.
// Diff against .claude/skill-original/stageshow/scripts/layout.mjs after a re-vendor; the rest is upstream.
// Check actual box fit in a host page, including controls outside a Stage.
import { launch } from './browser.mjs'
import { auditLayout, layoutResult } from './layout-core.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const options = { select: 'body', width: 1280, delay: 300, report: null, screenshot: null, strict: false, storageState: null }
let url
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') { console.log('usage: node scripts/layout.mjs <url> [--select body] [--width 1280] [--delay 300] [--report layout.json] [--screenshot layout.png] [--storage-state state.json] [--strict]\nChecks visible controls and padded containers in this document at one snapshot. Iframes need a separate direct URL check. Exit 2 = incomplete; --strict exits 1 for findings. The optional screenshot captures the 1000px-high viewport. No motion approval. --storage-state loads a Playwright storageState JSON (cookies + per-origin localStorage) so a signed-in screen is checked as written; landing on /login is reported as incomplete, never as a pass.'); process.exit(0) }
    if (arg === '--strict') options.strict = true
    else if (/^--(select|width|delay|report|screenshot|storage-state)$/.test(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} requires a value`)
      const value = args[++i]
      if (arg === '--storage-state') options.storageState = value
      else options[arg.slice(2)] = value
    } else if (arg.startsWith('--') || url) throw new Error(`unexpected argument: ${arg}`)
    else url = arg
  }
  if (!url) throw new Error('a URL is required; use --help')
  for (const name of ['width', 'delay']) {
    options[name] = Number(options[name])
    if (!Number.isInteger(options[name]) || options[name] < (name === 'width' ? 1 : 0)) throw new Error(`--${name} must be ${name === 'width' ? 'a positive' : 'a nonnegative'} integer`)
  }
  // The state file is read once, here, so a missing or malformed one is a usage error (exit 2) with a
  // message naming the fix rather than an opaque launch failure later.
  if (options.storageState) {
    const file = resolve(options.storageState)
    let state
    try { state = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
      throw new Error(`--storage-state ${file}: ${error.code === 'ENOENT' ? 'no such file' : error.message}. Create one with .claude/skill-overrides/restructure/scripts/signed-in-state.mjs`, { cause: error })
    }
    if (!state || (!Array.isArray(state.cookies) && !Array.isArray(state.origins))) throw new Error(`--storage-state ${file} is not a Playwright storageState (expected { cookies: [], origins: [] })`)
    options.storageState = file
  }
} catch (error) { console.error(`layout: ${error.message}`); process.exit(2) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: options.width, height: 1000 }, ...(options.storageState ? { storageState: options.storageState } : {}) })
const errors = [], scopes = []
let landedOn = null
page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
page.on('response', (response) => { if (response.status() >= 400 && !/\/favicon\./.test(response.url())) errors.push(`resource: ${response.status()} ${response.url()}`) })
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.locator(options.select).first().waitFor({ state: 'visible', timeout: 10000 })
  // A signed-in app screen fetches its data after the document loads, so a 300ms delay photographs a
  // skeleton ("Loading…") and the box check measures chrome instead of the screen. Settle the requests
  // first, then honour --delay on top of that.
  if (options.storageState) await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(options.delay)
  for (const root of await page.locator(options.select).all()) {
    if (await root.isVisible()) scopes.push({ selector: options.select, ...await root.evaluate(auditLayout) })
  }
  if (options.screenshot) {
    const path = resolve(options.screenshot)
    mkdirSync(dirname(path), { recursive: true })
    await page.screenshot({ path })
    console.log(`layout screenshot: ${path}`)
  }
} catch (error) { errors.push(error.message) }
landedOn = page.url()
await browser.close()
// A signed-in run that lands on the login page measured the login screen. Report it as incomplete
// (exit 2), because a box check of the wrong page is not evidence about the requested screen.
if (options.storageState && landedOn) {
  const landedPath = (() => { try { return new URL(landedOn).pathname } catch { return '' } })()
  if (/^\/(login|signin|sign-in)(?:[/?#]|$)/.test(landedPath)) errors.push(`auth: the signed-in state landed on ${landedPath}, so this snapshot checks the login page, not the requested screen — re-create it with .claude/skill-overrides/restructure/scripts/signed-in-state.mjs against this origin`)
}
const result = layoutResult(scopes, errors, options.strict)
result.viewport = { width: options.width, height: 1000 }
result.url = url
result.landedOn = landedOn
if (options.storageState) result.storageState = options.storageState
if (options.storageState) console.log(`layout storage-state: ${options.storageState}`)
if (landedOn) console.log(`layout landed on: ${landedOn}`)
for (const scope of scopes) {
  console.log(`layout coverage: ${scope.checked.controls} controls, ${scope.checked.paddedContainers} padded containers`)
  for (const finding of scope.findings) console.log(finding.message)
  for (const deferred of scope.deferred) console.log(`incomplete: ${deferred}`)
  for (const manual of scope.manual) console.log(`manual: ${manual}`)
}
for (const error of result.errors) console.error(`incomplete: ${error}`)
console.log(`layout: ${result.status}; this snapshot is not visual approval`)
if (options.report) {
  const path = resolve(options.report)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n')
}
process.exitCode = result.exitCode
