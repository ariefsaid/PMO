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

  it('#2129 loaders shimmer on transform only, with one keyframe, and sticky bars carry no blur', () => {
    expect(css).not.toContain('background-position');
    expect(css).not.toContain('cmdkShimmer');
    const skel = css.slice(css.indexOf('.skel::after, .cmdk-skeleton::after'));
    expect(skel.slice(0, skel.indexOf('}'))).toContain('animation: shimmer');
    expect(css).toContain('@keyframes shimmer { to { transform: translateX(100%); } }');
    const head = css.slice(css.indexOf('.kcol-head-sticky {'));
    expect(head.slice(0, head.indexOf('}'))).not.toContain('backdrop-filter');
    for (const f of ['src/components/ui/RecordActionZone.tsx', 'pages/procurement/ProcurementDecisionZone.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toContain('backdrop-blur');
    }
    // Reduced motion: the global rule ends the sweep at once and the sweep lies off-block, so the block is a flat fill.
    expect(css).toMatch(/\.skel::after[^{]*\{[^}]*transform: translateX\(-100%\)/);
  });

  it('#2129 the gantt zoom control shifts on transform (and mirrors under RTL), not on a layout property', () => {
    const src = readFileSync('src/components/reui/gantt/gantt-view.tsx', 'utf8');
    const line = src.split('\n').find((l) => l.includes('[--gantt-zoom-shift:0px]')) ?? '';
    expect(line).not.toBe('');
    expect(line).toContain('-translate-x-(--gantt-zoom-shift)');
    expect(line).toContain('rtl:translate-x-(--gantt-zoom-shift)');
    expect(line).toContain('transition-transform');
    expect(line).not.toContain('inset-inline-end');
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
