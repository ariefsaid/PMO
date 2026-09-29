// @e2e-isolation: read-only — reads the seeded Sales Pipeline board and measures rendered boxes; the
// Bahasa pass only rewrites the READ response of the caller's own profile row in the browser
// (page.route), so no seed profile is ever written.
/**
 * AC-SBC-001 (#696) — every Sales board card's money row stays inside the card, and no column's
 * card list scrolls sideways, in English AND Bahasa Indonesia, at 390px AND 1440px.
 *
 * ORACLE: geometry, measured in the browser. For each deal card (`[data-testid="project-card"]`
 * inside the board) every descendant element's right edge must end within the card's inner
 * (content-box) right edge, and the card's parent — the column's card list — must have
 * `scrollWidth === clientWidth` (a scrolling card list nested inside the horizontally scrolling
 * board fights touch swipes). Bahasa Indonesia is the worst case (longer number formatting, the
 * "incl./excl. PPN" label), so it is the language the issue's failing check names.
 *
 * Bahasa without a persisted profile write: `I18nProvider` resolves the language ONLY from the
 * signed-in profile (FR-L10N-003), so the pass rewrites the profile row the AuthProvider reads
 * (`select=*&id=eq.<uid>`, single object) to carry `locale: 'id'`. That keeps the spec read-only and
 * parallel-safe instead of serial-lane profile mutation.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

const INNER_EPSILON = 1; // 1px sub-pixel rendering tolerance

async function forceBahasa(page: Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      body = { ...(body as Record<string, unknown>), locale: 'id', number_locale: 'id-ID' };
    }
    return route.fulfill({ response, json: body });
  });
}

interface CardOverflow {
  card: string;
  overflowing: { el: string; right: number; innerRight: number }[];
}

async function measureBoard(page: Page) {
  return page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="project-card"]'),
    );
    const cardOverflows: { card: string; overflowing: { el: string; right: number; innerRight: number }[] }[] = [];
    const lists = new Set<HTMLElement>();
    for (const card of cards) {
      const cs = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      const innerRight = rect.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      const overflowing: { el: string; right: number; innerRight: number }[] = [];
      card.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > innerRight + 1) {
          overflowing.push({
            el: `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 24)}`,
            right: Math.round(r.right * 10) / 10,
            innerRight: Math.round(innerRight * 10) / 10,
          });
        }
      });
      cardOverflows.push({ card: card.getAttribute('aria-label') ?? '?', overflowing });
      if (card.parentElement) lists.add(card.parentElement);
    }
    const listScroll = Array.from(lists).map((l) => ({
      scrollWidth: l.scrollWidth,
      clientWidth: l.clientWidth,
    }));
    return { cardCount: cards.length, cardOverflows, listScroll };
  });
}

const LANGS = [
  { name: 'English', bahasa: false },
  { name: 'Bahasa Indonesia', bahasa: true },
] as const;
const WIDTHS = [390, 1440] as const;

test.describe('AC-SBC-001 sales board card money-row geometry (#696)', () => {
  for (const { name, bahasa } of LANGS) {
    for (const width of WIDTHS) {
      test(`AC-SBC-001: ${name} at ${width}px — every card descendant stays inside the card and no card list scrolls sideways`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        if (bahasa) await forceBahasa(page);
        await signIn(page, 'admin@acme.test');
        await page.goto('/sales?view=kanban');
        if (bahasa) await expect(page.locator('html')).toHaveAttribute('lang', 'id', { timeout: 60_000 });
        await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 60_000 });

        const { cardCount, cardOverflows, listScroll } = await measureBoard(page);
        expect(cardCount, 'expected seeded deal cards on the board').toBeGreaterThanOrEqual(5);

        const bad: CardOverflow[] = cardOverflows.filter((c) => c.overflowing.length > 0);
        expect(
          bad,
          `card descendants end past the card's inner right edge (+${INNER_EPSILON}px): ${JSON.stringify(bad.slice(0, 3))}`,
        ).toEqual([]);

        const scrolling = listScroll.filter((l) => l.scrollWidth > l.clientWidth);
        expect(
          scrolling,
          `a column card list scrolls sideways: ${JSON.stringify(scrolling.slice(0, 3))}`,
        ).toEqual([]);
      });
    }
  }
});
