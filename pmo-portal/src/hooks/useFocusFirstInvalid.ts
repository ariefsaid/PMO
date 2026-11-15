import { useEffect, type RefObject } from 'react';

/**
 * #2082: after a failed submit, move focus to the first field the form marked invalid.
 * `errors` is the page's validation result; the effect runs when a new result with at least one
 * error arrives (the page sets it only on submit), so typing never steals focus.
 */
export function useFocusFirstInvalid(errors: Record<string, string>, formRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors, formRef]);
}
