import type { Locator, Page } from '@playwright/test';

/** Real pointer drag through dnd-kit's MouseSensor (6 px activation), then a stepped move onto the column. */
export async function dragCardTo(
  page: Page,
  card: Locator,
  column: Locator,
  /** Runs while the card is held over the column, before the pointer is released (mid-drag assertions). */
  whileDragging?: () => Promise<void>,
): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await column.boundingBox();
  if (!from || !to) throw new Error('dragCardTo: card or column not visible');
  const viewportHeight = page.viewportSize()?.height ?? 800;
  const x = from.x + from.width / 2;
  const y = from.y + Math.min(16, from.height / 2);
  // Aim at the card's own height, clamped inside the column's box and the viewport. The card is on
  // screen, so this point is too. The old aim (column top + 60, clamped to y = 24) put the pointer at the
  // top edge when a tall column started above the fold, outside the column, and the drop resolved to
  // the neighbouring column.
  const targetY = Math.min(Math.max(y, to.y + 8, 80), to.y + to.height - 8, viewportHeight - 24);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, targetY, { steps: 15 });
  await whileDragging?.();
  await page.mouse.up();
  // dnd-kit's drop animation runs ~250 ms; a drag started inside it is ignored, so let it settle.
  await page.waitForTimeout(500);
}
