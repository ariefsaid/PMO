import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './icons';
import { useOptionalToast } from './Toast';

export interface RecordReferenceProps {
  /** One or more raw system identifiers. Empty values are dropped, a wholly empty list renders nothing. */
  ids: Array<string | null | undefined>;
  className?: string;
}

/**
 * plain-words C20 (ruling 3b/3c): a raw record id is reference material, never the answer a person
 * reads first. It sits behind a disclosure beside the name, on the admin surfaces that need to
 * quote it. Shared so every surface hides it the same way instead of each inventing a label.
 * The id renders as the shared `.record-id` role (DESIGN.md typography — one type family) and
 * carries a Copy button because the value must be quoted exactly, not because it looked like code.
 */
export function RecordReference({ ids, className }: RecordReferenceProps) {
  const { t } = useTranslation();
  const { toast } = (useOptionalToast() ?? { toast: undefined });
  const shown = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  if (shown.length === 0) return null;
  const value = shown.join(', ');
  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast?.(t('ui.recordReference.copied', 'Reference copied'), value, 'success');
    } catch {
      toast?.(t('ui.recordReference.copyFailed', 'Could not copy reference'), t('ui.recordReference.copyFailedHint', 'Check browser clipboard access and try again.'), 'warning');
    }
  };
  return (
    <details className={cn('min-w-0 text-control text-muted-foreground', className)} data-testid="record-reference">
      <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {t('ui.recordReference', 'Reference')}
      </summary>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <code className="break-all record-id">{value}</code>
        <button
          type="button"
          onClick={() => void copyReference()}
          aria-label={t('ui.recordReference.copy', 'Copy reference')}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Icon name="clipboard-check" className="size-4" aria-hidden="true" />
        </button>
      </span>
    </details>
  );
}
