import React from 'react';
import { cn } from './cn';
import { FormActions, type FormActionsProps } from './FormFields';

export interface FormFooterCustomProps {
  /** Optional note rendered to the LEFT of the action cluster (e.g. what is needed before saving). */
  hint?: React.ReactNode;
  /** Custom action cluster (e.g. Save + Submit); replaces the default Cancel + primary pair. */
  children: React.ReactNode;
  /** Overrides the `form-footer` test id. */
  testId?: string;
  className?: string;
}

export type FormFooterProps = FormFooterCustomProps | (FormActionsProps & Omit<FormFooterCustomProps, 'children'>);

/**
 * Page-level form footer — the ONE place for a form's primary action (screen rule
 * "one place for the primary action"): right-aligned, the primary submit first from
 * the right, Cancel to its left, and never a second copy at the top of the form.
 *
 * Two ways to use it:
 * - default: pass `FormActions` props (`submitLabel` + `onCancel`, …) and the shared
 *   Cancel-then-primary cluster renders — modal forms (EntityFormModal) and page forms
 *   share the same order and states.
 * - custom: pass `children` when a form's action cluster differs (e.g. timesheets'
 *   Save + Submit) but must still sit in the same sticky footer layout.
 *
 * Sticky at the bottom of the viewport so long forms keep their actions reachable while
 * scrolling. The offset rides `--phone-nav-height` (0 above the phone breakpoint, the
 * phone bottom bar + device safe area below it), so it clears both with no extra
 * breakpoint work; the opaque `bg-background` surface keeps it legible over scrolled
 * fields.
 */
export const FormFooter: React.FC<FormFooterProps> = (props) => {
  const { hint, className, testId } = props as FormFooterCustomProps;
  const custom = (props as { children?: React.ReactNode }).children;
  const actionProps = props as FormActionsProps;
  return (
    <div
      data-testid={testId ?? 'form-footer'}
      className={cn(
        'sticky bottom-[var(--phone-nav-height)] z-20 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background py-3',
        className,
      )}
    >
      {hint && <div className="mr-auto text-control text-muted-foreground">{hint}</div>}
      {custom ?? <FormActions {...actionProps} />}
    </div>
  );
};

FormFooter.displayName = 'FormFooter';
