// @e2e-isolation: read-only — signs in, scrolls and measures; no DB writes.
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

/**
 * AC-SHELL-002 — at phone width (390) the last content of a page is never painted under the fixed
 * bottom bar: with the shell's scroller at its end, no text box lies inside the bar's box.
 * Two different screens: a list (Projects) and a record page (a project's Budget tab).
 */
async function coveredText(page: Page): Promise<string[]> {
  await waitForFonts(page);
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="phone-nav"]');
    const main = document.getElementById('main');
    if (!bar || !main) return ['(no bar or main)'];
    // Every fixed bar docked to the bottom edge counts: the nav and any page action bar stacked on it.
    const bars = [bar, ...Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((e) => {
      if (e === bar || bar.contains(e) || e.contains(bar) || getComputedStyle(e).position !== 'fixed') return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 200 && r.bottom >= bar.getBoundingClientRect().top - 1 && r.top > window.innerHeight / 2;
    })];
    main.scrollTop = main.scrollHeight;
    const out: string[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement;
      if (!el || bars.some((x) => x.contains(el)) || getComputedStyle(el).visibility === 'hidden') continue;
      // Text clipped away by an ancestor (a collapsed disclosure) is not painted, so it cannot be covered.
      const clipped = (r: DOMRect) => {
        const closed = el.closest('details:not([open])');
        if (closed && !el.closest('summary')) return true;
        for (let a: HTMLElement | null = el; a && a !== main; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.display === 'none' || cs.visibility === 'hidden') return true;
          if (cs.overflowY !== 'visible') {
            const ar = a.getBoundingClientRect();
            if (r.top >= ar.bottom - 0.5 || r.bottom <= ar.top + 0.5) return true;
          }
        }
        return false;
      };
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width === 0 || r.height === 0 || clipped(r)) continue;
        const hit = bars.find((x) => {
          const b = x.getBoundingClientRect();
          return r.bottom > b.top + 0.5 && r.top < b.bottom && r.right > b.left && r.left < b.right;
        });
        if (hit) {
          out.push(`${(n.textContent ?? '').trim().slice(0, 40)} @${Math.round(r.top)}-${Math.round(r.bottom)}`);
          break;
        }
      }
    }
    return out;
  });
}

test.describe('AC-SHELL-002 phone content clears the bottom bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'admin@acme.test');
  });

  test('AC-SHELL-002 list screen (Projects): no text under the bar at the end of the page', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('phone-nav')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await coveredText(page)).toEqual([]);
  });

  test('AC-SHELL-002 record screen (project Budget tab): no text under the bar at the end of the page', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('projects-table-container').getByRole('button', { name: 'Innovate Corp HQ Fit-Out', exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const base = new URL(page.url()).pathname.replace(/\/$/, '').split('/').slice(0, 3).join('/');
    await page.goto(`${base}/budget`);
    await expect(page.getByTestId('phone-nav')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await coveredText(page)).toEqual([]);
  });

  for (const tab of ['', '/documents', '/expenses']) {
    test(`AC-SHELL-002 project ${tab || 'overview'} tab: no text under the bottom bars`, async ({ page }) => {
      await page.goto('/projects');
      await page.waitForLoadState('networkidle');
      await page.getByTestId('projects-table-container').getByRole('button', { name: 'Innovate Corp HQ Fit-Out', exact: true }).click();
      await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
      const base = new URL(page.url()).pathname.replace(/\/$/, '');
      await page.goto(`${base}${tab}`);
      await expect(page.getByTestId('phone-nav')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await coveredText(page)).toEqual([]);
    });
  }

  for (const screen of ['/finance', '/timesheets']) {
    test(`AC-SHELL-002 ${screen}: no text under the nav or its stacked action bar`, async ({ page }) => {
      await page.goto(screen);
      await expect(page.getByTestId('phone-nav')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await coveredText(page)).toEqual([]);
    });
  }

  test('AC-SHELL-002 approvals: no text under the bottom bars', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByTestId('phone-nav')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await coveredText(page)).toEqual([]);
  });

  // A device with a home-indicator makes the bar taller than its nominal 56px. The shell's inset
  // follows the bar's real rendered height, so nothing is covered however tall the bar grows.
  for (const screen of ['/projects', '/finance', '/timesheets']) {
    test(`AC-SHELL-002 ${screen}: a taller bar (34px safe area) still covers no text`, async ({ page }) => {
      await page.goto(screen);
      await page.addStyleTag({ content: '[data-testid="phone-nav"]{height:auto !important;padding-bottom:34px !important}' });
      await expect(page.getByTestId('phone-nav')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const covered = await coveredText(page);
      expect(covered).toEqual([]);
    });
  }
});
