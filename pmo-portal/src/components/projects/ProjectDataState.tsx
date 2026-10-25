import { Link } from 'react-router';

interface ProjectDataStateProps {
  label: string;
  to: string;
  actionLabel: string;
  align?: 'start' | 'end';
}

/** A named unknown state with an in-context route to inspect or resolve its source. */
export function ProjectDataState({ label, to, actionLabel, align = 'start' }: ProjectDataStateProps) {
  const alignment = align === 'end' ? 'items-end text-right' : 'items-start text-left';

  return (
    <span className={`inline-flex min-w-0 max-w-full flex-col whitespace-normal text-xs leading-snug text-muted-foreground ${alignment}`}>
      <span className="break-words">{label}</span>
      <Link
        to={to}
        onClick={(event) => event.stopPropagation()}
        className="touch-target inline-flex min-h-11 max-w-full items-center break-words rounded-sm text-left text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {actionLabel}
      </Link>
    </span>
  );
}
