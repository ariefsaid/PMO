import type { MouseEvent, ReactNode } from 'react';

const CONTROL_CLASS = 'block w-full rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

interface RowOpenControlProps {
  href?: string;
  label: string;
  onActivate: () => void;
  children: ReactNode;
}

/** Keeps a row's existing in-app activation while exposing its destination as a native link. */
export function RowOpenControl({ href, label, onActivate, children }: RowOpenControlProps) {
  if (href) {
    return (
      <a
        href={href}
        aria-label={label}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          event.stopPropagation();
          if (
            event.defaultPrevented
            || event.button !== 0
            || event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
          ) return;

          event.preventDefault();
          onActivate();
        }}
        className={CONTROL_CLASS}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      className={CONTROL_CLASS}
    >
      {children}
    </button>
  );
}
