// One settle step and one layout measuring function, shared by the gate (scripts/ux-proof.mjs, including
// its --layout-only sweep) and the screen measurement (scripts/measure-screens.mjs), so a builder's local
// pass and the gate cannot disagree about when to measure or what was measured.
//
// The layout pass calls the repo's existing checkers where they already catch a defect:
//   taste app checks   panel-void (a hole inside a card), ragged-row (cards of one row end apart),
//                      unused-canvas (the content stops short of the canvas edge)
//   stageshow          layout-core (box and inset faults)
// and adds only what none of them measures: painted-content gap scale and one left edge per surface
// (`measureLayout` in ux-proof-metrics.mjs), folded into the same pass and the same fingerprint list.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LAYOUT_NUMBERS, measureLayout, layoutReport } from './ux-proof-metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASTE = path.join(ROOT, '.claude', 'skills', 'taste', 'scripts', 'lib');
const LAYOUT_CORE = path.join(ROOT, '.claude', 'skills', 'stageshow', 'scripts', 'layout-core.mjs');
const REUSED_TASTE_IDS = new Set(['panel-void', 'ragged-row', 'unused-canvas']);

/** True when the vendored taste + stageshow checkers are on disk (scripts/vendor-skills.sh). */
export const reusedChecksAvailable = () => [path.join(TASTE, 'probe.mjs'), path.join(TASTE, 'rules.mjs'), LAYOUT_CORE].every((file) => existsSync(file));

export async function loadReusedChecks() {
  if (!reusedChecksAvailable()) throw new Error('taste/stageshow checkers are missing; run scripts/vendor-skills.sh');
  const [probe, rules, core] = await Promise.all([
    import(pathToFileURL(path.join(TASTE, 'probe.mjs'))),
    import(pathToFileURL(path.join(TASTE, 'rules.mjs'))),
    import(pathToFileURL(LAYOUT_CORE)),
  ]);
  return { probe: probe.probe, app: probe.app, judgeApp: rules.judgeApp, auditLayout: core.auditLayout };
}

/** Fails every data read except the lookups the shell needs, so the screens' error states are what gets measured. */
export async function blockDataReads(page) {
  await page.route('**/rest/v1/**', (request) => /\/(profiles|organizations|user_views|notifications|external_)|rpc\/(resolved_org_features|is_operator)/.test(request.request().url()) ? request.continue() : request.abort());
}

const BUSY = 'main .skel, main [data-skeleton-shape], main [aria-busy="true"]';

/**
 * The one settle step, before every measurement in both modes: the network is quiet, `main` is there,
 * fonts are loaded, and no skeleton or busy marker is left in `main`; in the reads-failing state the
 * error alert or its retry button is on screen too (the query client retries once after about a second,
 * so network quiet alone lands on the loading silhouette). Then the pointer and focus are cleared.
 * Throws when the page never settles: measuring a skeleton would baseline the wrong screen.
 */
export async function settlePage(page, { readsFailing = false } = {}) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.locator('main').or(page.locator('h1')).first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction((busy) => document.fonts.status === 'loaded' && !document.querySelector(busy), BUSY, { timeout: 20_000 })
    .catch(() => { throw new Error('page did not settle: fonts still loading or a skeleton is still in main'); });
  if (readsFailing) {
    await page.waitForFunction(() => !!document.querySelector('main [role="alert"]') || [...document.querySelectorAll('main button')].some((b) => /retry|try again/i.test(b.textContent || '')), null, { timeout: 15_000 })
      .catch(() => {}); // a page with no error surface of its own is measured as it stands
    await page.waitForFunction((busy) => !document.querySelector(busy), BUSY, { timeout: 5_000 }).catch(() => {});
  }
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Content that lands after the network went quiet (a deferred query, a lazy block) and motion that is still
  // running (a bar growing to its width) are waited out: `main` must keep the same text, element count and
  // element boxes for three samples 300ms apart, with no finite animation or transition still running.
  const shape = () => page.evaluate(() => {
    const m = document.querySelector('main');
    if (!m) return '';
    const running = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().iterations ?? 1)).length;
    const boxes = [...m.querySelectorAll('*')].slice(0, 600).map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`; }).join(';');
    return `${running}|${m.innerText.length}|${m.scrollHeight}|${boxes}`;
  });
  let last = await shape(); let still = 0;
  for (let i = 0; i < 50 && still < 3; i++) {
    await page.waitForTimeout(300);
    const now = await shape();
    still = now === last && now.startsWith('0|') ? still + 1 : 0; last = now;
  }
  await page.mouse.move(0, 0);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
}

/** The page language, as it is part of a baseline key (text wraps differently per language). */
export const pageLanguage = (page) => page.evaluate(() => (document.documentElement.lang || 'en').toLowerCase().split('-')[0]);

/** Findings of the existing checkers, as { fp, message } pairs, from the settled page. */
export async function reusedFindings(page, tools, width) {
  const out = [];
  if (width >= 1100) {
    const appMetrics = await page.evaluate(tools.app);
    const metrics = await page.evaluate(tools.probe);
    const found = tools.judgeApp(appMetrics, metrics, { width }).filter((finding) => REUSED_TASTE_IDS.has(finding.id));
    for (const finding of found) {
      const parts = finding.id === 'panel-void' ? (appMetrics.layout.voids || []).map((v) => v.panel)
        : finding.id === 'ragged-row' ? (appMetrics.layout.ragged || []).map((r) => `y${Math.round(r.top / 40) * 40}`) : [''];
      for (const part of parts.length ? parts : ['']) out.push({ fp: `taste-${finding.id}|${part}`, message: `taste ${finding.id}: ${finding.message}` });
    }
  }
  const audit = await page.evaluate((source) => {
    const run = Function(`return (${source})`)();
    return run(document.body);
  }, tools.auditLayout.toString());
  for (const finding of audit.findings || []) out.push({ fp: `layout-core|${finding.rule}|${finding.element}`, message: `stageshow ${finding.message}` });
  return out;
}

/**
 * Measure one settled page: the in-page layout checks plus the reused checkers, as one layout object
 * that `layoutReport` turns into failures and fingerprints.
 */
export async function measureSettledLayout(page, tools, width) {
  const layout = await page.evaluate(measureLayout, LAYOUT_NUMBERS);
  layout.reused = tools ? await reusedFindings(page, tools, width) : [];
  return layout;
}

export { layoutReport };
