/**
 * True when `el` sits inside a ~1px clipping box (Tailwind's `sr-only`: 1x1, overflow hidden): nobody
 * sees what it holds, so a layout oracle must not count it. Real visible text is never in such a box.
 * Runs in the page: hand `VISUALLY_HIDDEN_SRC` to `page.evaluate` and rebuild it there with
 * `new Function('return ' + src)()`.
 */
export function inVisuallyHiddenBox(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflow === 'visible') continue;
    const b = p.getBoundingClientRect();
    if (b.width <= 1.5 && b.height <= 1.5) return true;
  }
  return false;
}

export const VISUALLY_HIDDEN_SRC = inVisuallyHiddenBox.toString();
