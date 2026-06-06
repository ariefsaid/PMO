import React from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive' | 'success';
export type ButtonSize = 'default' | 'sm' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner, sets aria-busy, and disables the button. */
  loading?: boolean;
  /** 32px square icon button. Requires an aria-label for a11y. */
  iconOnly?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-[7px] rounded-lg border ' +
  'text-sm font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-100 ' +
  'active:translate-y-px ' +
  'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none ' +
  '[&_svg]:size-[15px] [&_svg]:shrink-0';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-primary text-primary-foreground shadow-[0_1px_2px_hsl(var(--primary)/0.25)] hover:bg-primary/90',
  outline: 'border-input bg-background text-foreground hover:bg-accent',
  ghost: 'border-transparent bg-transparent text-foreground hover:bg-accent',
  destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90',
  success: 'border-transparent bg-success text-success-foreground hover:bg-success/90',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-8 px-3',
  sm: 'h-7 px-[9px] text-[13px]',
  icon: 'h-8 w-8 p-0',
};

const Spinner: React.FC = () => (
  <svg
    data-testid="button-spinner"
    className="size-4 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size,
      loading = false,
      iconOnly = false,
      disabled,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref
  ) => {
    const resolvedSize: ButtonSize = size ?? (iconOnly ? 'icon' : 'default');

    if (iconOnly && !rest['aria-label']) {
      // a11y guardrail: an icon-only control with no accessible name is a defect.
      console.warn('Button: `iconOnly` requires an `aria-label` for accessibility.');
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(base, variantClasses[variant], sizeClasses[resolvedSize], className)}
        {...rest}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
