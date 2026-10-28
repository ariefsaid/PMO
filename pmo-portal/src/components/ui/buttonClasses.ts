import { cn } from './cn';

// -----------------------------------------------------------------------
// Button class composition — lives in its own module so <Button> (a React
// component file) stays a clean fast-refresh boundary (component-only exports).
// Factoring the class string out also lets a non-<button> element — e.g. a
// react-router <Link> — render IDENTICAL button styling WITHOUT nesting a
// <button> inside an <a> (invalid HTML; interactive-in-interactive; two tab
// stops with the same accessible name). Output is byte-identical to <Button>.
// -----------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive' | 'success';
export type ButtonSize = 'default' | 'sm' | 'icon';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md border ' +
  'text-control font-normal whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-100 ' +
  'active:translate-y-px ' +
  'disabled:cursor-not-allowed disabled:pointer-events-none ' +
  '[&_svg]:size-4 [&_svg]:shrink-0';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-primary font-semibold text-primary-foreground shadow-none hover:bg-primary-hover active:bg-primary-pressed disabled:border-border disabled:bg-secondary disabled:text-secondary-foreground disabled:shadow-none disabled:opacity-100',
  outline:
    'border-input bg-background font-semibold text-primary-text hover:bg-surface-hover active:bg-surface-pressed disabled:border-border disabled:bg-secondary disabled:text-secondary-foreground disabled:opacity-100',
  ghost:
    'border-transparent bg-transparent text-secondary-foreground hover:bg-surface-hover active:bg-surface-pressed disabled:text-muted-foreground disabled:opacity-100',
  // AC-RAM-004 (#688) regression fix: `bg-destructive-solid`, NOT `bg-destructive` — the raw
  // `--destructive` hue is shared with `text-destructive` (error text) and the status dot/bar,
  // both of which need the brighter raw hue for their own contrast. Only the solid button fill
  // uses the darker `-solid` L (index.css).
  destructive:
    'border-transparent bg-destructive-solid font-semibold text-destructive-foreground hover:bg-destructive-solid/90 active:bg-destructive-solid/80 disabled:border-border disabled:bg-secondary disabled:text-secondary-foreground disabled:shadow-none disabled:opacity-100',
  success:
    'border-transparent bg-success font-semibold text-success-foreground hover:bg-success/90 active:bg-success/80 disabled:border-border disabled:bg-secondary disabled:text-secondary-foreground disabled:shadow-none disabled:opacity-100',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'touch-target h-[var(--control-height)] px-4',
  // C6 touch-target sweep (OD-W4-4 / WCAG 2.5.5): compact controls are 30px tall.
  // The `.touch-target` utility extends their hit area to 44px on coarse pointers.
  sm: 'touch-target h-[var(--control-height-sm)] px-2 text-support',
  icon: 'touch-target size-[var(--control-height-sm)] p-0',
};

export const buttonClasses = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'default',
  className?: string
): string => cn(base, variantClasses[variant], sizeClasses[size], className);
