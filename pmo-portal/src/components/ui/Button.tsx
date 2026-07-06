import React from 'react';
import { buttonClasses } from './buttonClasses';
import type { ButtonVariant, ButtonSize } from './buttonClasses';

// Variant/size types + the shared `buttonClasses` composer live in ./buttonClasses so
// this file stays a clean fast-refresh boundary (component-only exports). Re-exported
// here to preserve the public `from './Button'` / ui barrel API.
export type { ButtonVariant, ButtonSize } from './buttonClasses';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner, sets aria-busy, and disables the button. */
  loading?: boolean;
  /** 32px square icon button. Requires an aria-label for a11y. */
  iconOnly?: boolean;
}

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
        className={buttonClasses(variant, resolvedSize, className)}
        {...rest}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
