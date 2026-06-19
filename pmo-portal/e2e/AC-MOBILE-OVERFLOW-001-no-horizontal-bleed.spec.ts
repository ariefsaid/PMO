/**
 * AC-MOBILE-OVERFLOW-001 — no horizontal bleed at phone widths.
 *
 * THE GATE that the 2× 4-lens design reviews could not be: deterministic, measured,
 * runs on every PR. It exists because mobile overflow is a *measurable fact*
 * (`element.right > viewport`), not a taste judgement — so per ADR-0030 it belongs in
 * a Layer-1 gate-test, not a vision lens.
 *
 * ORACLE (the important part): we do NOT assert `documentElement.scrollWidth <= vw`.
 * The app shell's `<main>` is `overflow-x-hidden`, so bleed is *clipped* — the page
 * never scrolls horizontally even when content runs to 817px (real defect found
 * 2026-06-16: procurement rows clipped their amounts off the right edge). The page-
 * scroll oracle is BLIND to that. Instead we walk every visible element and fail if its
 * right edge exceeds the viewport, EXCLUDING legitimate horizontal scrollers
 * (`overflow-x: auto|scroll` — e.g. the Gantt timeline, wide data tables) and their
 * descendants, which are *meant* to scroll.
 *
 * Charts are measured AFTER a settle wait so we test the steady state, not the recharts
 * ResponsiveContainer mount-flash (tracked separately).
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

// Known seed ids (stable across local + cloud — supabase/seed.sql).
const MERIDIAN = '41000000-0000-0000-0000-000000000001';
// SP2401-001 "PV Modules — Meridian 4.2 MW" — richest seeded procurement case (PR/RFQ/PO/PAY + events)
const PROC_SHOWCASE = '61000000-0000-0000-0000-000000000001';

const ROUTES: { path: string; label: string }[] = [
  { path: '/', label: 'dashboard' },
  { path: '/my-tasks', label: 'my-tasks' },
  { path: '/sales', label: 'sales-pipeline' },
  { path: '/projects', label: 'projects-list' },
  { path: `/projects/${MERIDIAN}/overview`, label: 'project-overview' },
  { path: `/projects/${MERIDIAN}/budget`, label: 'project-budget' },
  { path: `/projects/${MERIDIAN}/tasks`, label: 'project-tasks' },
  { path: '/procurement', label: 'procurement-list' },
  // AC-PR-027: the records detail page (stepper + history + inline forms) must not bleed at mobile
  { path: `/procurement/${PROC_SHOWCASE}`, label: 'procurement-detail' },
  { path: '/timesheets', label: 'timesheets' },
  { path: '/approvals', label: 'approvals' },
  { path: '/companies', label: 'companies' },
  { path: '/contacts', label: 'contacts' },
  { path: '/administration', label: 'administration' },
];

const PHONE_WIDTHS = [390, 360];

/** Returns the elements whose right edge exceeds the viewport, excluding legit
 *  horizontal scrollers and their descendants. Runs in the page. */
async function findBleeders(page: Page, vw: number) {
  return page.evaluate((vw) => {
    const tol = 2;
    const inScroller = (el: Element): boolean => {
      let p = el.parentElement;
      while (p) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === 'auto' || ov === 'scroll') return true;
        p = p.parentElement;
      }
      return false;
    };
    const out: { tag: string; cls: string; right: number; text: string }[] = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + tol && !inScroller(el)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') ?? '').slice(0, 60),
          right: Math.round(r.right),
          text: (el.textContent ?? '').trim().slice(0, 30),
        });
      }
    });
    // De-dup parents that share the same right edge (report the outermost few).
    out.sort((a, b) => b.right - a.right);
    return out.slice(0, 12);
  }, vw);
}

test.describe('AC-MOBILE-OVERFLOW-001 no horizontal bleed @mobile', () => {
  for (const width of PHONE_WIDTHS) {
    for (const route of ROUTES) {
      test(`AC-MOBILE-OVERFLOW-001 ${route.label} @${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await signIn(page, 'admin@acme.test');
        await page.goto(route.path);
        // Let async data + charts settle so we measure steady state, not the mount flash.
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1500);

        const bleeders = await findBleeders(page, width);
        expect(
          bleeders,
          `Horizontal bleed on ${route.path} @${width}px — elements past the viewport:\n` +
            bleeders.map((b) => `  ${b.right}px <${b.tag} class="${b.cls}"> "${b.text}"`).join('\n'),
        ).toEqual([]);
      });
    }
  }
});
