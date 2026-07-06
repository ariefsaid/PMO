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
  'inline-flex items-center justify-center gap-[7px] rounded-lg border ' +
  'text-sm font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-100 ' +
  'active:translate-y-px ' +
  'disabled:cursor-not-allowed disabled:pointer-events-none ' +
  '[&_svg]:size-[15px] [&_svg]:shrink-0';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-primary text-primary-foreground shadow-[0_1px_2px_hsl(var(--primary)/0.25)] hover:bg-primary/90 disabled:border-border disabled:bg-secondary disabled:text-secondary-foreground disabled:shadow-none disabled:opacity-100',
  outline: 'border-input bg-background text-foreground hover:bg-accent disabled:opacity-60',
  ghost: 'border-transparent bg-transparent text-foreground hover:bg-accent disabled:opacity-60',
  destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:border-border disabled:bg-secondary disabled:text-secondary-foreground disabled:shadow-none disabled:opacity-100',
  success: 'border-transparent bg-success text-success-foreground hover:bg-success/90 disabled:border-border disabled:bg-secondary disabled:text-secondary-foreground disabled:shadow-none disabled:opacity-100',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-8 px-3',
  // C6 touch-target sweep (OD-W4-4 / WCAG 2.5.5): sm (28px) and icon (32px) both fall
  // below the 44px touch-target floor on coarse pointers. The `.touch-target` utility
  // extends the hit area via a transparent ::before overlay on coarse pointers ONLY —
  // desktop visual size is unchanged. Applied automatically so every sm/icon consumer
  // inherits it without per-callsite annotation.
  sm: 'touch-target h-7 px-[9px] text-[13px]',
  icon: 'touch-target h-8 w-8 p-0',
};

export const buttonClasses = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'default',
  className?: string
): string => cn(base, variantClasses[variant], sizeClasses[size], className);
