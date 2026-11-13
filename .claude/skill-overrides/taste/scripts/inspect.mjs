#!/usr/bin/env node
// OVERRIDE of the vendored taste skill (upstream rev e96625ecb815b93bf596b968ddb1162c9275d98e): adds
// --storage-state so a signed-in app screen is measured as written. Diff against
// .claude/skill-original/taste/scripts/inspect.mjs after a re-vendor; everything else is upstream.
// tasteskill / inspect — render the page in a real browser, measure it, and photograph it.
//
//   node inspect.mjs <url | path/to/file.html> [--out DIR] [--widths 1440,768,390] [--allow rule,rule] [--app] [--film] [--json] [--storage-state FILE]
//
// Every width is walked to the foot of the page, one screen at a time (up to 40 screens; a longer page is
// sampled evenly), and every screen is photographed into the page sheets and checked.
//
// --storage-state loads a Playwright storageState JSON (cookies + per-origin localStorage) into the browser
// before the first navigation, so a signed-in app screen is measured as the signed-in person sees it rather
// than the login page. Cookie values are never printed; when the run still lands on /login it is a FAIL.
//
// --film also photographs the scroll as a visitor sees it (a frame every third of a screen, real wheel
// input) into desktop-film-NN.jpg, so a scroll scene is judged by its in-between states. A direction
// that dealt scroll scenes switches it on by itself.
//
// --app judges an app screen (dashboard, admin, settings) by the rules in references/app-screens.md; a
// direction dealt with draw.mjs --app switches it on by itself.
//
// Exit code 0 = no FAIL findings. Exit code 1 = at least one FAIL (the page is not done).
// Zero dependencies: drives an installed Chrome/Edge/Chromium. Node 22+.
// Widths sharing a viewport class receive width-qualified screenshot filenames.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createReadStream, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join, relative, dirname, extname, sep } from 'node:path';
import { createServer } from 'node:http';
import { Browser, sleep } from './lib/cdp.mjs';
import { probe, frame, reach, layout, app, colourShare } from './lib/probe.mjs';
import { judge, judgeLayout, judgeApp, APP_SKIP } from './lib/rules.mjs';
import { viewportClass as name, screenshotLabel, isInspectionScreenshot } from './lib/inspection-files.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i === -1) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name) => { const i = args.indexOf('--' + name); if (i === -1) return false; args.splice(i, 1); return true; };
const outDir = resolve(flag('out', '.taste-skill/inspect'));
const widths = flag('widths', '1440,768,390').split(',').map(Number).filter(Boolean);
let allow = flag('allow', '').split(',').filter(Boolean);
const asJson = has('json');
let appMode = has('app');
let film = has('film');
const storageStatePath = flag('storage-state', '');
let dealtFonts = []; // the faces the saved sheet dealt, to catch a build that quietly fell back to a default
const target = args[0];
if (!target || target === '-h' || target.startsWith('--')) {
  console.error('usage: node inspect.mjs <url | file.html> [--out DIR] [--widths 1440,768,390] [--allow rule,rule] [--app] [--film] [--json] [--storage-state FILE]');
  process.exit(2);
}
// The signed-in state, when one is given, is loaded before anything navigates: cookies go in at browser
// level and per-origin localStorage is installed as a document-start script, because the app's Supabase
// client reads its session synchronously while the module initialises.
let storageState = null, storageStateFile = null;
if (storageStatePath) {
  storageStateFile = resolve(storageStatePath);
  if (!existsSync(storageStateFile)) {
    console.error('No such storage state: ' + storageStateFile + '\nCreate one with .claude/skill-overrides/restructure/scripts/signed-in-state.mjs (it signs a seeded role in and writes the JSON).');
    process.exit(2);
  }
  try { storageState = JSON.parse(readFileSync(storageStateFile, 'utf8')); } catch (e) {
    console.error('Unreadable storage state ' + storageStateFile + ': ' + e.message); process.exit(2);
  }
  if (!storageState || (!Array.isArray(storageState.cookies) && !Array.isArray(storageState.origins))) {
    console.error('Storage state ' + storageStateFile + ' is not a Playwright storageState (expected { cookies: [], origins: [] }).'); process.exit(2);
  }
}
// Playwright's sameSite is 'Lax'|'Strict'|'None'; CDP wants those spellings, and a missing expires means a
// session cookie. The value may only be set against a url or a domain+path pair, never both.
async function applyStorageState(page) {
  if (!storageState) return [];
  const notes = [];
  await page.send('Network.enable', {}).catch(() => {});
  const origins = (storageState.origins || []).filter((o) => o && o.origin);
  for (const c of storageState.cookies || []) {
    if (!c || !c.name) continue;
    const sameSite = c.sameSite && /^(lax|strict|none)$/i.test(c.sameSite) ? c.sameSite[0].toUpperCase() + c.sameSite.slice(1).toLowerCase() : undefined;
    const base = { name: c.name, value: c.value, httpOnly: !!c.httpOnly, secure: !!c.secure, path: c.path || '/' };
    if (sameSite) base.sameSite = sameSite;
    if (Number.isFinite(c.expires) && c.expires > 0) base.expires = c.expires;
    const where = c.domain ? { domain: c.domain, path: base.path } : origins[0] ? { url: origins[0].origin } : null;
    if (!where) { notes.push('cookie ' + c.name + ' skipped: no domain and no origin to scope it'); continue; }
    const r = await page.send('Network.setCookie', { ...base, ...where }).catch((e) => ({ success: false, error: e.message }));
    if (!r || r.success === false) notes.push('cookie ' + c.name + ' not accepted' + (r && r.error ? ': ' + r.error : ''));
  }
  const items = {};
  for (const o of origins) {
    if (!Array.isArray(o.localStorage)) continue;
    items[o.origin] = o.localStorage.filter((it) => it && typeof it.name === 'string').map((it) => ({ name: it.name, value: it.value }));
  }
  if (Object.keys(items).length) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { try { const s = ${JSON.stringify(items)}; const items = s[location.origin]; if (items) for (const it of items) localStorage.setItem(it.name, it.value); } catch {} })()`,
    }).catch((e) => notes.push('localStorage seed not installed: ' + e.message));
  }
  return notes;
}
const storageStateNote = storageState ? { file: storageStateFile, cookies: (storageState.cookies || []).length, origins: (storageState.origins || []).map((o) => o.origin) } : null;
// Allowances granted by the drawn direction (written by draw.mjs) apply automatically.
for (const p of ['.taste-skill/direction.json', join(outDir, '..', 'direction.json')]) {
  if (existsSync(p)) { try { const d = JSON.parse(readFileSync(p, 'utf8')); allow = [...new Set([...allow, ...(d.allow || [])])]; if (d.kind === 'app') appMode = true; if (Array.isArray(d.scenes) && d.scenes.length) film = true; dealtFonts = (d.input?.keep || []).includes('type') ? [] : d.kind === 'app' ? [d.style?.tokens?.font?.family].filter(Boolean) : [d.type?.display?.family, d.type?.text?.family].filter(Boolean); } catch { /* an unreadable direction file grants no allowances */ } break; }
}
// A local file is served over http from a throwaway server on 127.0.0.1, so the browser never has to
// open a file path (some sandboxes show Node and the browser different views of the disk) and relative
// assets, fetch() and module scripts behave as they will when the page is hosted.
let url = target; let server = null;
if (!/^https?:\/\//.test(target)) {
  const file = resolve(target);
  if (!existsSync(file)) { console.error('No such file: ' + file); process.exit(2); }
  const cwd = resolve('.');
  const root = file.startsWith(cwd + sep) ? cwd : dirname(file);
  const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };
  server = createServer((req, res) => {
    try {
      let f = resolve(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
      if (f !== root && !f.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
      if (statSync(f).isDirectory()) f = join(f, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(f).toLowerCase()] || 'application/octet-stream', 'content-length': statSync(f).size, 'cache-control': 'no-store' });
      createReadStream(f).pipe(res);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/${relative(root, file).split(sep).map(encodeURIComponent).join('/')}`;
}
const HEIGHT = { 1440: 900, 1280: 800, 1024: 768, 768: 1024, 390: 844, 375: 812 };

mkdirSync(outDir, { recursive: true });
// Screenshots from an earlier run would sit beside the new ones when the page got shorter.
for (const f of readdirSync(outDir)) if (isInspectionScreenshot(f)) unlinkSync(join(outDir, f));
const browser = await Browser.launch();
const helper = await browser.newPage({ width: 1600, height: 1000 });
const report = { url: server ? target : url, at: new Date().toISOString(), allow, auth: storageStateNote, viewports: [], findings: [], images: [] };

const MOTION_MIN = 8, MOTION_GOOD = 16; // distinct moving elements over load + one scroll through the page
const MAX_SCREENS = 40; // screens photographed and checked at each width; a longer page is sampled evenly
// Runs in the page before any of its own scripts: counts the distinct elements that actually move while
// the page loads and is scrolled (CSS animations, CSS transitions, Web Animations, and script-driven
// transform/opacity changes such as GSAP), so a page that never moves can be told from one that does.
const MOTION_RECORDER = `(() => {
  const seen = new WeakSet(); const c = { elements: 0, css: 0, transitions: 0, scripted: 0 };
  const note = (t, k) => { if (!(t instanceof Element) || seen.has(t)) return; seen.add(t); c.elements++; c[k]++; };
  addEventListener('animationstart', (e) => note(e.target, 'css'), true);
  addEventListener('transitionrun', (e) => note(e.target, 'transitions'), true);
  const watch = () => new MutationObserver((list) => { for (const m of list) { const s = m.target.getAttribute && m.target.getAttribute('style') || ''; if (/transform|translate|opacity|scale|rotate|clip-path/.test(s)) note(m.target, 'scripted'); } })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['style'], subtree: true });
  if (document.documentElement) watch(); else addEventListener('DOMContentLoaded', watch);
  window.__motionSample = () => { for (const a of document.getAnimations ? document.getAnimations() : []) { const t = a.effect && a.effect.target; if (t) note(t, a.constructor && a.constructor.name === 'CSSTransition' ? 'transitions' : 'css'); } };
  window.__motion = () => { window.__motionSample(); const v = [...document.querySelectorAll('video')]; return { ...c, videos: v.length, playingVideos: v.filter((x) => x.autoplay || !x.paused).length }; };
})();`;

// Is the page's title on screen and readable: in the viewport, not faded, not masked away?
const TITLE_SEEN = `(() => {
  const h = document.querySelector('h1'); if (!h) return { found: false };
  const r = h.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return { found: true, visible: false, why: 'it has no size yet' };
  if (r.bottom < 0 || r.top > innerHeight) return { found: false }; // a title below the first screen is the no-title check's business
  let o = 1; for (let p = h; p && p !== document.documentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.visibility === 'hidden' || cs.display === 'none') return { found: true, visible: false, why: 'it is hidden' }; o *= +cs.opacity; }
  if (o < 0.5) return { found: true, visible: false, why: 'it is at ' + Math.round(o * 100) + '% opacity' };
  // text moved out of its own masked line, or a cover lying over it, shows up as nothing at its centre
  const range = document.createRange(); range.selectNodeContents(h); const rr = range.getBoundingClientRect();
  const x = Math.min(innerWidth - 1, Math.max(0, rr.left + rr.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, rr.top + Math.min(rr.height, 80) / 2));
  const hit = document.elementFromPoint(x, y);
  if (hit && !h.contains(hit) && !hit.contains(h)) { const cs = getComputedStyle(hit); if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || /^(IMG|VIDEO|CANVAS)$/.test(hit.tagName)) return { found: true, visible: false, why: 'something lies over it' }; }
  return { found: true, visible: true };
})()`;

async function sheet(frames, cols, cellW, cellH, path) {
  const rows = Math.ceil(frames.length / cols);
  await helper.setViewport({ width: cols * cellW, height: rows * cellH, dsf: 1 });
  await helper.eval((a) => {
    document.body.style.cssText = `margin:0;background:#888;display:grid;grid-template-columns:repeat(${a.cols},${a.cellW}px)`;
    document.body.innerHTML = a.frames.map((s) => `<img src="data:image/jpeg;base64,${s}" style="width:${a.cellW}px;height:${a.cellH}px;display:block;outline:1px solid #888">`).join('');
    return Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  }, { frames, cols, cellW, cellH });
  await helper.screenshot({ path, quality: 76 });
}

try {
  for (const w of widths) {
    const h = HEIGHT[w] || Math.round(w * 0.625);
    const label = name(w);
    const imageLabel = screenshotLabel(w, widths);
    const page = await browser.newPage({ width: w, height: h, dsf: 1, mobile: w < 600 });
    const authNotes = await applyStorageState(page);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MOTION_RECORDER }).catch(() => {});
    const how = await page.goto(url, { timeoutMs: 30000, settleMs: 600 });
    const landedOn = storageState ? await page.eval('location.pathname + location.search').catch(() => null) : null;
    await sleep(600); // about 1.2s after the load event: is the title there to read yet?
    const early = await page.eval(TITLE_SEEN).catch(() => null);
    // a dev server is not what ships: bundlers and minifiers change the CSS a visitor receives
    const devServer = await page.eval(`(() => { const s = [...document.scripts].map((x) => x.src || '').join(' '); if (/@vite\\/client|webpack-dev-server|\\/_next\\/static\\/development\\/|react-refresh|webpack-hmr/.test(s)) return true; try { return !!(window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId === 'development'); } catch { return false; } })()`).catch(() => false);
    await page.eval('document.fonts.ready.then(() => true)').catch(() => {});
    await sleep(800); // let the load choreography finish before judging the first screen
    const fold = join(outDir, `${imageLabel}-fold.jpg`);
    await page.screenshot({ path: fold, quality: 82 });
    const metrics = await page.eval(probe);

    // walk the whole page one screen at a time so scroll reveals fire, photographing and checking each screen.
    // A page longer than MAX_SCREENS is walked in even strides, so its last screen is always seen.
    const total = Math.max(1, Math.ceil((metrics.page.height || h) / h));
    const stride = Math.max(1, Math.ceil(total / MAX_SCREENS));
    const frames = [readFileSync(fold).toString('base64')];
    const frameErrors = []; // a check that throws loses its screen; the report keeps why
    const check = (opts) => page.eval(frame, opts).catch((e) => { if (frameErrors.length < 5) frameErrors.push(String(e.message).slice(0, 200)); return null; });
    const frameChecks = [await check()];
    const reached = [await page.eval(reach, metrics.reach).catch(() => null)];
    let upReach = null, atFoot = total <= 1;
    const where = () => page.eval('({ y: Math.round(scrollY || document.scrollingElement.scrollTop || 0), max: Math.round(document.scrollingElement.scrollHeight - innerHeight) })').catch(() => null);
    for (let i = 1, lastY = 0; i <= MAX_SCREENS + 8; i++) {
      const to = `window.scrollTo({ top: ${i * stride * h}, behavior: 'instant' })`;
      await page.eval(to).catch(() => {});
      await page.wheel(2);
      await sleep(650);
      let pos = await where();
      // a smooth-scroll library still easing toward an earlier target can take the jump back: settle it and retry once
      if (pos && pos.y <= lastY + 2 && pos.y < pos.max - 2) { await page.wheel(Math.round(h / 2)); await sleep(1000); await page.eval(to).catch(() => {}); await page.wheel(2); await sleep(650); pos = await where(); }
      if (!pos || pos.y <= lastY + 2) { atFoot = !!pos && pos.y >= pos.max - 2; break; } // the screen before was the end of the page
      lastY = pos.y;
      frames.push(await page.screenshot({ quality: 78 }));
      frameChecks.push(await check());
      reached.push(await page.eval(reach, metrics.reach).catch(() => null));
      await page.eval('window.__motionSample && window.__motionSample()').catch(() => {});
      // once, about two thirds down a long page: back up half a screen, where a bar that hides on the way down returns
      if (upReach === null && total > 6 && pos.y >= pos.max * 0.6) {
        await page.wheel(-Math.round(h / 2), { step: 120, pauseMs: 30 });
        await sleep(900);
        upReach = await page.eval(reach, metrics.reach).catch(() => ({ found: false }));
        await page.wheel(Math.round(h / 2), { step: 120, pauseMs: 30 }); // back down, so a smooth scroller's target is ahead again
        await sleep(1000);
      }
      if (pos.y >= pos.max - 2) { atFoot = true; break; }
    }
    const motion = await page.eval('window.__motion ? window.__motion() : null').catch(() => null);
    // re-measure after everything has revealed (catches content that only exists post-reveal)
    await page.eval(`window.scrollTo({ top: 0, behavior: 'instant' })`).catch(() => {});
    await sleep(350);
    const after = await page.eval(probe).catch(() => metrics);
    const m = after.headings.length >= metrics.headings.length ? after : metrics;
    const lay = await page.eval(layout).catch(() => null);
    const appM = appMode ? await page.eval(app).catch(() => null) : null;
    if (appM) appM.colourShare = await helper.eval(colourShare, 'data:image/jpeg;base64,' + frames[0]).catch(() => null);

    // scroll scenes (assets/scenes): each must have started, run live on desktop, and leave the page room
    const sceneState = w >= 1100 && !appMode ? await page.eval(`[...document.querySelectorAll('section.scene, .scene[data-scene]')].map((s) => ({ id: s.dataset.scene || s.id || 'scene', live: s.classList.contains('is-live'), rest: s.classList.contains('is-rest'), h: Math.round(s.getBoundingClientRect().height) }))`).catch(() => []) : [];
    const sceneFindings = [];
    if (sceneState.length) {
      const idle = sceneState.filter((s) => !s.live && !s.rest);
      if (idle.length && !allow.includes('scene-not-started')) sceneFindings.push({ level: 'FAIL', id: 'scene-not-started', width: w, message: `${idle.length} scene(s) never started: ${idle.map((s) => s.id).join(', ')}.`, fix: 'Load assets/scenes/stage.js and the scene file for each data-scene, then call Stage.smooth(); Stage.init(); at the end of <body> (references/scenes.md, "Putting a scene on a page").' });
      const atRest = sceneState.filter((s) => s.rest);
      if (atRest.length && !allow.includes('scene-not-live')) sceneFindings.push({ level: 'FAIL', id: 'scene-not-live', width: w, message: `${atRest.length} scene(s) show their finished composition on desktop instead of running: ${atRest.map((s) => s.id).join(', ')}.`, fix: 'GSAP or ScrollTrigger did not load (check the pinned CDN lines and the console), or the scene threw while building. The scene must run where motion is allowed.' });
      if (sceneState.length > 4 && !allow.includes('many-scenes')) sceneFindings.push({ level: 'WARN', id: 'many-scenes', width: w, message: `${sceneState.length} scroll scenes on one page.`, fix: 'Two or three scenes, with quiet sections between them, so each one lands. Cut the weakest.' });
      // held screens against the page (a share alone rewards padding the rest of it), against an absolute budget,
      // and the long set pieces (five screens or more), of which a page carries one
      const held = sceneState.reduce((a, s) => a + Math.max(0, s.h - h), 0);
      const longSets = sceneState.filter((s) => s.h - h >= h * 4.5);
      const heavy = [held > (metrics.page.height || 1) * 0.6 && `they are ${Math.round((held / (metrics.page.height || 1)) * 100)}% of the page`, held > h * 7 && 'more than about 6.5 screens of hold in all', longSets.length > 1 && `${longSets.length} of them hold five screens or more (${longSets.map((s) => `${s.id} ${Math.round((s.h - h) / h)}`).join(', ')})`].filter(Boolean);
      if (heavy.length && !allow.includes('scene-heavy')) sceneFindings.push({ level: 'WARN', id: 'scene-heavy', width: w, message: `Scenes hold ${Math.round(held / h)} of the page's ${Math.round((metrics.page.height || 0) / h)} screens: ${heavy.join('; ')}.`, fix: 'Shorten the holds (one screen per beat, and a hold with nothing new to show is cut), keep one long set piece at most, or cut a scene; the reading sections need room between them (references/scenes.md §7).' });
    }

    // --film: the scroll as a visitor sees it. Real wheel input and a frame every third of a screen, so a
    // scroll scene shows its in-between states, not only where each screen lands.
    // Each step is also checked twice while it moves (about 120 and 280ms after the wheel) for texts drawn over
    // each other and for which blocks of text can be read at all.
    const filmSheets = [], filmChecks = [];
    if (film && w >= 1100) {
      await page.eval(`window.scrollTo({ top: 0, behavior: 'instant' })`).catch(() => {});
      await sleep(700);
      const shots = []; let lastY = -1, still = 0;
      for (let i = 0; i < Math.min(150, Math.ceil(total / stride) * 3 + 6); i++) {
        shots.push(await page.screenshot({ quality: 70 }));
        await page.wheel(Math.round(h / 3) * stride, { step: 100, pauseMs: 16 });
        for (const ms of [120, 160]) { await sleep(ms); filmChecks.push(await check({ film: true })); }
        await sleep(140);
        const y = await page.eval('Math.round(scrollY || document.scrollingElement.scrollTop || 0)').catch(() => -1);
        if (y === lastY) { if (++still >= 2) break; } else still = 0;
        lastY = y;
      }
      for (let i = 0; i < shots.length; i += 24) {
        const p = join(outDir, `${imageLabel}-film-${String(i / 24 + 1).padStart(2, '0')}.jpg`);
        await sheet(shots.slice(i, i + 24), 6, 320, 200, p);
        filmSheets.push(p);
      }
    }

    const cols = w >= 1100 ? 2 : w >= 600 ? 3 : 4;
    const cellW = w >= 1100 ? 800 : w >= 600 ? 512 : 390;
    const cellH = Math.round((cellW * h) / w);
    const perSheet = w >= 1100 ? 4 : w >= 600 ? 6 : 8;
    const sheets = [];
    for (let i = 0; i < frames.length; i += perSheet) {
      const p = join(outDir, `${imageLabel}-page-${String(i / perSheet + 1).padStart(2, '0')}.jpg`);
      await sheet(frames.slice(i, i + perSheet), cols, cellW, cellH, p);
      sheets.push(p);
    }
    let findings = [...judge(m, { width: w, allow }), ...sceneFindings];
    // A signed-in state that still lands on the login page measured the login screen, not the requested
    // one. That is a FAIL, not a pass with a quiet note: the report would otherwise certify a page nobody
    // asked about (#gates.md "Verify the rendered route and role in every capture").
    if (storageState && landedOn && /^\/(login|signin|sign-in)(?:[/?#]|$)/.test(landedOn)) {
      findings.push({ level: 'FAIL', id: 'auth-expired', width: w, message: `The signed-in state landed on ${landedOn}: this capture measures the login page, not ${target}.`, fix: 'Re-create the state file against this origin with .claude/skill-overrides/restructure/scripts/signed-in-state.mjs; the seeded session is missing, expired, or scoped to another port.' });
    }
    for (const note of authNotes) findings.push({ level: 'WARN', id: 'auth-state', width: w, message: 'Storage state not fully loaded: ' + note + '.', fix: 'Check the state file is a Playwright storageState captured from this same origin; a partial load can measure a signed-out or role-less screen.' });
    if (devServer && !allow.includes('dev-server')) findings.push({ level: 'WARN', id: 'dev-server', width: w, message: 'This page is served by a development server (Vite, webpack or Next in dev mode).', fix: 'Run the last gate on the production build too (vite build && vite preview, next build && next start, or the built index.html): minifiers and bundlers change the CSS a visitor receives.' });
    if (dealtFonts.length && w >= 1100 && !allow.includes('font-not-dealt')) {
      const norm = (f) => String(f).toLowerCase().replace(/["']/g, '').replace(/\s+variable$/, '').trim();
      const used = m.type.families.filter((f) => f.share >= 0.1).map((f) => norm(f.family));
      const missing = dealtFonts.filter((f) => !used.some((u) => u === norm(f) || u.startsWith(norm(f))));
      if (missing.length === dealtFonts.length) findings.push({ level: appMode ? 'FAIL' : 'WARN', id: 'font-not-dealt', width: w, message: `The sheet dealt ${dealtFonts.join(' and ')}, but the page renders ${m.type.families.slice(0, 2).map((f) => f.family).join(', ')}.`, fix: 'Load the dealt face (the link on the sheet) and put it first in font-family. A build that falls back to a default face lands on the default look.' });
    }
    // a third of the studied award pages were still unreadable 4.5s after load; the house sequence is over by 1.2s
    if (!appMode && early && early.found && !early.visible && !allow.includes('late-title')) findings.push({ level: 'FAIL', id: 'late-title', width: w, message: `The title is not readable 1.2s after the page loaded (${early.why}).`, fix: 'Put the headline in the HTML, painted on the first frame; the load sequence only adds arrival and is settled by 1.2s (references/motion.md, "Load sequence in 1.2 seconds"). No preloader, no gate, no waiting for the load event.' });
    if (lay) findings.push(...judgeLayout(lay, { width: w, allow }));
    if (appMode) {
      findings = findings.filter((f) => !APP_SKIP.has(f.id) && f.id !== 'no-title' && f.id !== 'small-title');
      if (appM) findings.push(...judgeApp(appM, m, { width: w, allow }));
    }
    // what only shows up while scrolling: text hidden under something, and screens with almost nothing on them
    const screenOf = (f, i) => (f && f.y != null ? Math.round(f.y / h) + 1 : i * stride + 1);
    const coveredText = [...new Map(frameChecks.filter(Boolean).flatMap((f, i) => f.covered.map((c) => [c.text, { ...c, screen: screenOf(f, i) }]))).values()];
    if (coveredText.length && !allow.includes('covered-text')) findings.push({ level: 'FAIL', id: 'covered-text', width: w, message: `Large text lies under another element at some scroll position: ` + coveredText.slice(0, 4).map((c) => `"${c.text}" (screen ${c.screen}, ${Math.round(c.share * 100)}% hidden)`).join('; '), fix: 'Nothing may sit on top of a headline or statement. Move the picture, shorten the pinned run, or raise the text above it (z-index) and give it a ground.' });
    const clippedText = [...new Map(frameChecks.filter(Boolean).flatMap((f, i) => (f.clipped || []).map((c) => [c.text, { ...c, screen: screenOf(f, i) }]))).values()];
    if (clippedText.length && !allow.includes('clipped-text')) findings.push({ level: 'FAIL', id: 'clipped-text', width: w, message: 'Large text is cut off along its top by the box that holds it: ' + clippedText.slice(0, 3).map((c) => `"${c.text}" (screen ${c.screen})`).join('; '), fix: 'Jurors read a wordmark sliced at the top as broken. Give the box room for the ascenders (line-height and padding), or crop at the bottom or a side edge on purpose.' });
    const overPictures = [...new Map(frameChecks.filter(Boolean).flatMap((f, i) => (f.pinnedOver || []).map((c) => [c.text, { ...c, screen: screenOf(f, i) }]))).values()];
    if (overPictures.length && !allow.includes('pinned-over-picture')) findings.push({ level: 'WARN', id: 'pinned-over-picture', width: w, message: 'Pinned large text slides across pictures while the page scrolls: ' + overPictures.slice(0, 3).map((c) => `"${c.text}" (screen ${c.screen}, ${Math.round(c.share * 100)}% over a picture)`).join('; '), fix: 'Jurors read a pinned title crossing drawings or photographs as a collision. Keep the pictures in the column the title does not occupy, or unpin it.' });
    // two texts drawn over each other at some scroll position (walk and film frames)
    const checks = [...frameChecks, ...filmChecks].filter(Boolean);
    const overText = [...new Map(checks.flatMap((f) => (f.overText || []).map((o) => [o.a + '|' + o.b, { ...o, y: f.y }]))).values()];
    if (overText.length && !allow.includes('text-over-text')) findings.push({ level: 'FAIL', id: 'text-over-text', width: w, message: 'Two texts are drawn on top of each other while the page scrolls: ' + overText.slice(0, 3).map((o) => `"${o.a}" over "${o.b}" (at ${o.y}px)`).join('; '), fix: 'Two text states never share pixels. A swap is out, then in (the incoming line starts when the outgoing one has gone), or a masked wipe; a card or caption that travels never crosses a line of text that is still on screen.' });
    // a block of text that was in view and covered every time: a caption the visitor never gets to read
    const sightings = new Map();
    for (const f of checks) for (const [t, ok] of f.seen || []) { const s = sightings.get(t) || { n: 0, ok: 0, at: [] }; s.n++; s.ok += ok; if (s.at.length < 6) s.at.push(f.y); sightings.set(t, s); }
    const unread = [...sightings.entries()].filter(([, s]) => s.n >= 2 && !s.ok).map(([t, s]) => ({ text: t, n: s.n, at: s.at }));
    if (unread.length && !allow.includes('never-readable')) findings.push({ level: 'FAIL', id: 'never-readable', width: w, message: `${unread.length} block(s) of text are covered at every scroll position they were seen at: ` + unread.slice(0, 4).map((u) => `"${u.text.slice(0, 44)}" (${u.n} frames)`).join('; '), fix: 'Something lies on these words whenever they are in view (the next picture of a sequence, a pinned layer, a card). Give each its held moment on top: a longer slot before the next picture arrives, the caption above the layer that covers it, or the caption beside the picture instead of on it.' });
    // loops that play for more than five seconds with nothing on the page to stop them (WCAG 2.2.2)
    const playingVideos = [...new Set(checks.flatMap((f) => f.playing || []))];
    if (playingVideos.length && !m.page.pauseControl && !allow.includes('no-pause')) findings.push({ level: 'WARN', id: 'no-pause', width: w, message: `${playingVideos.length} video loop(s) play with no control to pause them: ${playingVideos.slice(0, 3).join(', ')}.`, fix: 'Give moving pictures that run past five seconds a visible pause: one "Pause films" button in the navigation is enough for a page of loops, or a small pause on the clip itself. Loops still stop under reduced motion and off screen.' });
    // small text set on a large picture: more than one short line, or captions and labels, belong beside or under it
    const onMedia = new Map();
    for (const f of frameChecks.filter(Boolean)) for (const o of f.onMedia || []) { const v = onMedia.get(o.media) || new Set(); for (const t of o.texts) v.add(t); onMedia.set(o.media, v); }
    const captioned = [...onMedia.entries()].map(([media, set]) => ({ media, texts: [...set], words: [...set].join(' ').split(/\s+/).filter(Boolean).length })).filter((o) => o.texts.length >= 2 || o.words > 12);
    if (captioned.length && !allow.includes('caption-on-media')) findings.push({ level: 'WARN', id: 'caption-on-media', width: w, message: `Small text is set on ${captioned.length} large picture(s): ` + captioned.slice(0, 3).map((o) => `${o.media} under ${o.texts.slice(0, 3).map((t) => `"${t.slice(0, 32)}"`).join(', ')}`).join('; '), fix: 'On a picture put only display text, one short line and one action (references/imagery.md, "Text over pictures"). A caption, a label or a description goes in the gutter beside or under the picture, or in a corner it leaves empty; never in a band across a piece of work.' });
    // a picture's edge through a paragraph: half of it on the paper, half on the picture
    const straddled = [...new Map(checks.flatMap((f, i) => (f.straddle || []).map((s) => [s.text, { ...s, screen: screenOf(f, i) }]))).values()];
    if (straddled.length && !allow.includes('text-straddles-edge')) findings.push({ level: 'WARN', id: 'text-straddles-edge', width: w, message: 'A picture\'s edge runs through a paragraph, so part of it sits on the picture and part on the ground: ' + straddled.slice(0, 3).map((s) => `"${s.text}" (screen ${s.screen}, ${Math.round(s.share * 100)}% on the picture)`).join('; '), fix: 'Set the text wholly inside a calm part of the picture (4.5:1 there) or wholly outside it. When text interlocks with a picture, the overlap is whole lines and the edge falls in a line gap, never through a line.' });
    // nav-lost: on a page over about 6 screens, a stretch of more than 3 screens with no way back to the navigation's
    // anchors or the action. It fails over 10 screens; between 6 and 10 it warns (the v2.1 test pages ran 7-8
    // screens without a bar and the judges did not miss one). A phone or tablet page runs longer for the same content.
    const pageScreens = Math.round(((m.page.height || 0) / h) * 10) / 10;
    const lengthScale = w >= 1100 ? 1 : w >= 600 ? 1.2 : 1.6;
    if (!appMode && (metrics.reach?.dest?.length || metrics.reach?.labels?.length) && pageScreens > 6 * lengthScale && !(upReach && upReach.found) && !allow.includes('nav-lost')) {
      let run = 0, worst = 0, from = 0, span = null;
      reached.forEach((r, i) => { if (i === 0) return; if (r && r.found) { run = 0; return; } if (!run) from = i; run += stride; if (run > worst) { worst = run; span = [from * stride + 1, i * stride + 1]; } });
      if (worst > 3) findings.push({ level: pageScreens > 10 * lengthScale ? 'FAIL' : 'WARN', id: 'nav-lost', width: w, message: `On this ${pageScreens}-screen page nothing leads back to the navigation or the main action from screen ${span[0]} to ${span[1]}: no bar stays or returns on scroll-up, and no link to its anchors is in view.`, fix: 'Keep one way back in reach after the first screen: a compact bar (the wordmark, a few links, the action) that is sticky, or hides on the way down and returns on scroll-up, on a solid ground where it passes pictures; on a phone the menu button and the action stay in that bar (references/layout.md §7).' });
    }
    const empty = frameChecks.map((f, i) => ({ f, i })).filter(({ f }) => f && f.filled < 0.2);
    // the same large statement on screen for three screens or more in a row
    const runs = new Map();
    frameChecks.forEach((f, i) => { for (const t of f?.big || []) { const r = runs.get(t) || { start: i, last: i - 1, best: 0 }; if (r.last === i - 1) r.last = i; else { r.start = i; r.last = i; } r.best = Math.max(r.best, r.last - r.start + 1); runs.set(t, r); } });
    const longPins = [...runs.entries()].filter(([, r]) => r.best >= 3);
    if (w >= 1100 && longPins.length && !allow.includes('long-pin')) findings.push({ level: 'WARN', id: 'long-pin', width: w, message: `The same large text stays on screen for ${Math.max(...longPins.map(([, r]) => r.best))} screens in a row: ` + longPins.slice(0, 2).map(([t]) => `"${t}"`).join('; '), fix: 'A pinned element earns two screens, and something must change at each. Shorten the run or give every screen its own content.' });
    // a page that barely moves: counted from what really animated while it loaded and was scrolled
    if (w >= 1100 && motion && !allow.includes('still-page')) {
      const moving = motion.elements + motion.playingVideos * 4;
      if (moving < MOTION_MIN) findings.push({ level: 'FAIL', id: 'still-page', width: w, message: `Only ${motion.elements} element(s) moved while the page loaded and scrolled${motion.playingVideos ? ` (plus ${motion.playingVideos} playing video)` : ''}.`, fix: 'Build the motion layer (SKILL.md step 9, references/motion.md): the signature move, an entrance for the parts of every section, feedback on every control, and one moving picture. Transform and opacity only, with a reduced-motion fallback.' });
      else if (moving < MOTION_GOOD) findings.push({ level: 'WARN', id: 'still-page', width: w, message: `Little motion: ${motion.elements} element(s) moved while the page loaded and scrolled.`, fix: 'Give every section an entrance for its parts (not one fade of the whole block) and add one moving picture: a looping clip or a slow move on a photograph.' });
    }
    if (w >= 1100 && empty.length >= 2 && !allow.includes('empty-screens')) findings.push({ level: 'FAIL', id: 'empty-screens', width: w, message: `${empty.length} of ${frameChecks.length} desktop screens are almost empty ground (under 20% of the screen holds text, a picture or a colour field): screens ${empty.map(({ f, i }) => screenOf(f, i)).join(', ')}.`, fix: 'An empty screen is a rest only once per page. Elsewhere it means the section is underbuilt: set its content larger, give it the full information, put it on a colour field, or cut it.' });
    report.viewports.push({ width: w, height: h, load: how, landedOn, screens: frames.length, pageScreens, stride, reached: reached.map((r) => (r ? r.found : null)), upReach: upReach ? upReach.found : null, unread, overText, frameErrors, filled: frameChecks.map((f) => f?.filled ?? null), motion, metrics: m, layout: lay, app: appM, consoleErrors: page.consoleErrors.slice(0, 5) });
    report.findings.push(...(appMode ? findings.filter((f) => !APP_SKIP.has(f.id)) : findings));
    report.images.push({ viewport: label, width: w, fold, pages: sheets, film: filmSheets, walked: frames.length, stride, pageScreens, atFoot });
    await page.close();
  }
  // Under prefers-reduced-motion the page is the finished page: nothing may stay hidden waiting for an
  // animation that will not run. Two in three studied award pages had no reduced-motion rules at all.
  if (!appMode && widths.some((x) => x >= 1100) && !allow.includes('reduced-hidden')) {
    const rp = await browser.newPage({ width: 1440, height: 900, dsf: 1, reducedMotion: true });
    try {
      await applyStorageState(rp);
      await rp.goto(url, { timeoutMs: 30000, settleMs: 1500 });
      const hidden = await rp.eval(`(() => {
        const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const rg = document.createRange();
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const t = n.nodeValue.trim(); const el = n.parentElement; if (t.length < 3 || !el || el.closest('script, style, noscript, [aria-hidden="true"]')) continue;
          rg.selectNodeContents(n); const r = rg.getBoundingClientRect(); if (r.width < 2 || r.top > innerHeight || r.bottom < 0) continue;
          let o = 1, gone = false; for (let p = el; p && p !== document.documentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.visibility === 'hidden') { gone = true; break; } o *= +cs.opacity; }
          if (gone || o < 0.1) out.push(t.slice(0, 40));
        }
        return out;
      })()`).catch(() => []);
      if (hidden.length >= 2) report.findings.push({ level: 'FAIL', id: 'reduced-hidden', width: 1440, message: `With reduced motion requested, ${hidden.length} text block(s) on the first screen stay invisible: ` + hidden.slice(0, 4).map((t) => `"${t}"`).join(', '), fix: 'Put every hidden starting state inside @media (prefers-reduced-motion: no-preference); the reduced page is the finished page (references/motion.md §8).' });
    } finally { await rp.close(); }
  }
} finally {
  await browser.close();
  if (server) server.close();
}

// de-duplicate findings that repeat across viewports (keep the widest occurrence, note the others)
const merged = [];
for (const f of report.findings) {
  const same = merged.find((x) => x.id === f.id && x.level === f.level);
  if (same && f.id !== 'headline-lines' && f.id !== 'overflow') { same.alsoAt = [...(same.alsoAt || []), f.width]; continue; }
  merged.push(f);
}
report.findings = merged;
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1));

if (asJson) { console.log(JSON.stringify(report, null, 1)); process.exit(merged.some((f) => f.level === 'FAIL') ? 1 : 0); }

const d = report.viewports[0].metrics;
const line = (s = '') => console.log(s);
line(`TASTESKILL · INSPECT   ${report.url}`);
line('');
if (report.auth) {
  line(`SIGNED IN       ${report.auth.file}`);
  line(`                ${report.auth.cookies} cookie(s)${report.auth.origins.length ? ' · localStorage for ' + report.auth.origins.join(', ') : ''}`);
  line(`                landed on ${report.viewports.map((v) => `${v.width}px ${v.landedOn || '(unknown)'}`).join(' · ')}`);
  line('');
}
line('MEASURED (first viewport listed)');
if (d.hero) line(`  hero headline   "${d.hero.text.slice(0, 70)}"  ${d.hero.words} words · ${d.hero.lines} line(s) · ${d.hero.size}px (${d.hero.vw}vw) · ${d.hero.font} ${d.hero.weight} · tracking ${d.hero.tracking}em · leading ${d.hero.leading}`);
for (const v of report.viewports.slice(1)) if (v.metrics.hero) line(`  @${v.width}px          ${v.metrics.hero.lines} line(s) · ${v.metrics.hero.size}px`);
line(`  typefaces       ${d.type.families.filter((f) => f.share >= 0.02).map((f) => `${f.family} ${Math.round(f.share * 100)}%`).join(', ')}`);
line(`  sizes in use    ${d.type.sizes.join(' / ')} px${d.type.body ? `   body ${d.type.body.size}px / ${d.type.body.leading}` : ''}`);
line(`  colour          page ${d.color.bodyBg}${d.color.sectionBgs.length ? ' · sections ' + d.color.sectionBgs.map((s) => s.color).slice(0, 6).join(' ') : ''}${d.color.button ? ' · button ' + d.color.button.bg : ''}`);
line(`  page            ${d.page.screens} screens · ${d.page.words} words (${Math.round(d.page.words / Math.max(0.1, d.page.screens))} a screen) · ${d.page.img} images · hero media ${d.heroMedia[0] ? Math.round(d.heroMedia[0].ratio * 100) + '% ' + d.heroMedia[0].type : 'none'}`);
line(`  headings        ${d.headingSummary.count} · longest ${d.headingSummary.maxLines} line(s) · median ${d.headingSummary.medianWords ?? '-'} words`);
line('');
const fails = merged.filter((f) => f.level === 'FAIL'), warns = merged.filter((f) => f.level === 'WARN');
if (!fails.length && !warns.length) line('FINDINGS  none. Measurements are clean — now judge the pictures.');
for (const [title, list] of [['FAIL — fix every one of these', fails], ['WARN — fix, or be able to defend', warns]]) {
  if (!list.length) continue;
  line(title);
  for (const f of list) {
    line(`  [${f.id}] @${f.width}px${f.alsoAt ? ' (+' + f.alsoAt.join(', ') + ')' : ''}  ${f.message}`);
    line(`      → ${f.fix}`);
  }
  line('');
}
line('LOOK AT THE RENDER — open these with your image viewer / Read tool before saying anything about quality:');
const rel = (p) => relative(process.cwd(), p).split('\\').join('/');
for (const im of report.images) {
  line(`  ${(im.viewport + ' ' + im.width + 'px').padEnd(15)} ${rel(im.fold)}   (${im.walked} screens photographed and checked${im.stride > 1 ? `, one in every ${im.stride}` : ''}; ${im.atFoot ? 'the walk reached the foot of the page' : `the walk stopped before the foot of a ${im.pageScreens}-screen page`})`);
  for (const p of im.pages) line(`  ${''.padEnd(15)} ${rel(p)}`);
  for (const p of im.film || []) line(`  ${'scroll film'.padEnd(15)} ${rel(p)}  (6 frames a row, a third of a screen apart)`);
}
line('');
line(`report: ${rel(join(outDir, 'report.json'))}`);
line(fails.length ? `RESULT: ${fails.length} FAIL, ${warns.length} WARN — not done.` : `RESULT: 0 FAIL, ${warns.length} WARN — measurements pass. Passing the meter is the floor, not the grade: score the screenshots with references/critique.md.`);
process.exit(fails.length ? 1 : 0);
