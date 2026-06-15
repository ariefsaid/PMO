import React from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';
import { Badge } from './StatusPill';

export interface ViewOption<V extends string = string> {
  value: V;
  label: string;
  icon?: IconName;
  /** Optional trailing count badge (e.g. an Approvals queue size). */
  count?: number;
  /** Optional test id on the option's button (for AC-tagged assertions). */
  testId?: string;
  /**
   * Optional Tailwind classes applied to the individual option button.
   * NOTE: Because `cn` is clsx-only (no tailwind-merge), adding a display utility here
   * (e.g. `"hidden"`) will NOT override the base `inline-flex` class that ViewToggle
   * emits — both land in the class string and `inline-flex` wins. Use `wrapperClassName`
   * instead when you need to control visibility on the per-option level.
   */
  optionClassName?: string;
  /**
   * Optional Tailwind classes applied to a `<span>` wrapper rendered around the option
   * button. Because the wrapper carries no competing display utility, a class like
   * `"hidden md:block"` reliably hides the option below the breakpoint.
   * This is the correct way to hide individual options on mobile given the clsx-only cn
   * design: the wrapper has no `inline-flex` to conflict with `hidden`.
   * When omitted, the button is rendered directly without a wrapping element.
   */
  wrapperClassName?: string;
}

export interface ViewToggleProps<V extends string = string> {
  options: ViewOption<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  className?: string;
  /**
   * ARIA semantics variant.
   * - `'tabs'` (default): `role="tablist"` container + `role="tab"` + `aria-selected`. Use when
   *   there is a corresponding tabpanel for each option (e.g. project-detail tabs, Tasks view).
   * - `'toggle'`: `role="group"` container + `aria-pressed` toggle buttons (no `role="tab"`).
   *   Use for filter/scope/basis selectors that have NO associated tabpanel — e.g. WinRateCard
   *   basis/period, status filters, scope switchers. Arrow-key roving is disabled in this mode
   *   (all buttons are directly focusable at tabIndex 0).
   */
  semantics?: 'tabs' | 'toggle';
}

/**
 * Inline segmented control (DESIGN.md `seg`): 32px secondary track, 28px
 * buttons, "on" = white pill + pressed lift. ARIA tablist with roving arrow-key
 * selection. Used for view switchers and stage/queue filters.
 */
export function ViewToggle<V extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  semantics = 'tabs',
}: ViewToggleProps<V>) {
  const isToggle = semantics === 'toggle';

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Arrow-key roving only applies to the tablist semantics variant.
    if (isToggle) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = options.findIndex((o) => o.value === value);
    const next =
      e.key === 'ArrowRight'
        ? options[(idx + 1) % options.length]
        : options[(idx - 1 + options.length) % options.length];
    onChange(next.value);
  };

  return (
    <div
      role={isToggle ? 'group' : 'tablist'}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn('inline-flex h-8 items-center gap-0.5 rounded-lg bg-secondary p-0.5', className)}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        const btn = (
          <button
            key={opt.value}
            type="button"
            // tabs: role="tab" + aria-selected + roving tabIndex
            // toggle: no role override + aria-pressed + always focusable
            {...(!isToggle && { role: 'tab', 'aria-selected': on, tabIndex: on ? 0 : -1 })}
            {...(isToggle && { 'aria-pressed': on, tabIndex: 0 })}
            data-testid={opt.testId}
            onClick={() => onChange(opt.value)}
            className={cn(
              // touch-target: ≥44px hit area on coarse pointers, 28px visual (WCAG 2.5.5).
              'touch-target inline-flex h-7 items-center gap-1.5 rounded-[5px] px-[11px] text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-100',
              '[&_svg]:size-[14px]',
              on
                ? 'bg-background font-semibold text-foreground shadow-[0_1px_2px_hsl(240_6%_10%/0.1)]'
                : 'text-muted-foreground hover:text-foreground',
              opt.optionClassName,
            )}
          >
            {opt.icon && <Icon name={opt.icon} />}
            {opt.label}
            {opt.count !== undefined && opt.count > 0 && (
              <Badge active={on} className="min-w-0 px-1.5">
                {opt.count}
              </Badge>
            )}
          </button>
        );
        // wrapperClassName wraps the button in a <span> so display utilities like `hidden`
        // are not in conflict with the button's own base `inline-flex` class (clsx-only cn
        // cannot resolve utility conflicts — the wrapper has no competing display value).
        // When a wrapper is used, the span carries the React list key; the button key is
        // redundant but harmless (React ignores keys on non-list children).
        if (opt.wrapperClassName) {
          return (
            <span key={opt.value} className={opt.wrapperClassName}>
              {btn}
            </span>
          );
        }
        return btn;
      })}
    </div>
  );
}
