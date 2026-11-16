import { readFileSync } from 'node:fs';
import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Crossfade } from '../Crossfade';
import { useExitPresence } from '../useExitPresence';
import { buttonClasses } from '../buttonClasses';

const css = readFileSync('index.css', 'utf8');

describe('#1970 motion', () => {
  it('buttons press to 0.97 and skip it under reduced motion', () => {
    const c = buttonClasses();
    expect(c).toContain('active:scale-[0.97]');
    expect(c).toContain('motion-reduce:active:scale-100');
  });

  it('every new animation is switched off under prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('Every #1970 animation is off'));
    for (const cls of ['.menu-pop-anim', '.save-pulse::after', '.icon-swap-in', '.icon-swap-out', '.confirm-anim[data-ending-style]']) {
      // The drawer is a Base UI transition now; the global reduced-motion rule zeroes it.
      expect(block).toContain(cls);
    }
  });

  it('#2122 keyboard-opened menus and the command palette do not animate', () => {
    // A keyboard action appears instantly. Menus keep their pointer pop; the palette — opened from
    // ⌘K / Ctrl+K many times a day — has no entrance animation at all.
    expect(css).toContain('.menu-pop-anim[data-instant] { animation: none; }');
    // Built by composition: the retired class name must not reappear anywhere under src/
    // (the removal check greps for it), yet the stylesheet must still not carry it.
    expect(css).not.toContain(['cmdk', 'anim'].join('-'));
    expect(css).not.toContain('@keyframes cmdkin');
  });

  it('the global reduced-motion rule stops infinite loops (no 0.001ms jitter), #2126', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('animation-iteration-count: 1 !important;');
  });

  it('exit tokens are about 20% shorter than their entrances', () => {
    const ms = (n: string) => Number(new RegExp(`--motion-${n}:\\s*(\\d+)ms`).exec(css)?.[1]);
    // Toast motion moved to the library (Sonner owns entrance/exit and reduced-motion).
    for (const k of ['dialog', 'sheet', 'drawer']) {
      const ratio = ms(`${k}-out`) / ms(`${k}-in`);
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(0.85);
    }
  });

  it('#2124 vendored popups use the shared transition, not dead tw-animate classes', () => {
    const popups = [
      'src/components/shadcn/popover.tsx', 'src/components/shadcn/dropdown-menu.tsx',
      'src/components/shadcn/context-menu.tsx', 'src/components/shadcn/tooltip.tsx',
      'src/components/reui/cascader/cascader.tsx', 'src/components/reui/cascader/cascader-footer.tsx',
      'src/components/reui/event-calendar/event-calendar-ui.tsx',
    ];
    for (const f of popups) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/animate-(in|out)/);
      expect(src, f).toMatch(/popup-anim|tooltip-anim/);
    }
    expect(readFileSync('src/components/shadcn/button.tsx', 'utf8')).not.toContain('transition-all');
    expect(css).toContain('.popup-anim[data-starting-style]');
    expect(css).toMatch(/--motion-menu-out:\s*96ms/);
    // Reduced motion: the global rule zeroes every transition, and .popup-anim has no override that beats it.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n    *, *::before'));
    expect(reduced).toContain('transition-duration: 0.001ms !important;');
    expect(css).not.toMatch(/\.popup-anim[^{]*\{[^}]*!important/);
    // Keyboard-opened popups (data-instant) skip the transition.
    expect(css).toContain('.popup-anim[data-instant] { transition-duration: 0ms; }');
  });

  it('#2128 no exit eases in; Tailwind defaults and keyframes use the house tokens', () => {
    expect(css).not.toMatch(/ease-in forwards/);
    expect(css).not.toMatch(/\b(?:ease-out|ease-in)\s*;/);
    expect(css).toContain('--default-transition-timing-function: var(--ease-out)');
    expect(css).toContain('--default-transition-duration: var(--motion-hover)');
    expect(css).toMatch(/--motion-hover:\s*120ms/);
    expect(css).not.toContain('transition: transform 120ms cubic-bezier');
  });

  it('#2128 the assistant working cue animates only when reduced motion is not requested', () => {
    // The thinking dots were replaced by the pixel-grid cue; the goal holds: reduced motion freezes every loop.
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .loading-cell'));
    expect(reduce).toMatch(/\.loading-cell\s*\{\s*animation:\s*none/);
    expect(reduce).toMatch(/\.loading-label\s*\{\s*animation:\s*none/);
    expect(reduce).toMatch(/\.stream-caret\s*\{\s*animation:\s*none/);
  });

  it('#2128 Crossfade holds the old child for the --motion-icon-swap token, not a literal', () => {
    document.documentElement.style.setProperty('--motion-icon-swap', '400ms');
    vi.useFakeTimers();
    const { rerender } = render(<Crossfade swapKey="a"><i>old</i></Crossfade>);
    rerender(<Crossfade swapKey="b"><i>new</i></Crossfade>);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText('old')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('old')).toBeNull();
    vi.useRealTimers();
    document.documentElement.style.removeProperty('--motion-icon-swap');
  });

  it('Crossfade keeps the old child while the new one fades in, then drops it', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Crossfade swapKey="a"><i>old</i></Crossfade>);
    rerender(<Crossfade swapKey="b"><i>new</i></Crossfade>);
    expect(screen.getByText('old')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByText('old')).toBeNull();
    vi.useRealTimers();
  });

  it('useExitPresence stays mounted for the exit, then unmounts', () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty('--motion-test-out', '100ms');
    const Probe = ({ open }: { open: boolean }) => {
      const { mounted, closing } = useExitPresence(open, '--motion-test-out');
      return mounted ? <p>{closing ? 'closing' : 'open'}</p> : null;
    };
    const { rerender } = render(<Probe open />);
    rerender(<Probe open={false} />);
    expect(screen.getByText('closing')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(120); });
    expect(screen.queryByText('closing')).toBeNull();
    vi.useRealTimers();
  });
});
