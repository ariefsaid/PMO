import React from 'react';
import { useIsNarrow } from './useIsNarrow';
import { MobileActionBar } from './MobileActionBar';
import { Button } from './Button';
import type { ButtonVariant } from './buttonClasses';

/**
 * One decision verb, exactly as the record already offers it in flow. The caller supplies the
 * SAME handler it binds to the in-flow button, so the bar can never become a second write path:
 * the confirm dialog, the SoD gate and the server checks are whatever the record page already
 * runs.
 */
export interface MobileDecisionAction {
  key: string;
  label: string;
  onSelect: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
}

export interface MobileDecisionBarProps {
  /** The record's own decision actions, already filtered by permission/SoD by the caller. */
  actions: MobileDecisionAction[];
  /** Optional one-line record identity above the buttons (e.g. "EXP-0012 · Site fuel"). */
  context?: React.ReactNode;
  /** Accessible name for the bar region; defaults to a generic "Record decisions". */
  label?: string;
}

/**
 * #2061 — the sticky Approve/Reject bar for approval RECORDS on a phone.
 *
 * A pure placement wrapper: it renders the record's existing decision actions in a fixed bar
 * above the phone bottom navigation (safe area handled by `--phone-nav-height`), and renders
 * NOTHING when the record offers no actions — so a viewer who cannot approve (role, SoD, or
 * record state) sees no bar at all. Only on a phone (`useIsNarrow`); desktop keeps the in-flow
 * decision zone untouched.
 *
 * Uses `MobileActionBar`, which publishes its height so toasts clear the bar.
 */
export const MobileDecisionBar: React.FC<MobileDecisionBarProps> = ({ actions, context, label }) => {
  const isNarrow = useIsNarrow();
  if (!isNarrow || actions.length === 0) return null;

  return (
    <MobileActionBar
      data-testid="mobile-decision-bar"
      role="group"
      aria-label={label ?? 'Record decisions'}
      className="fixed inset-x-0 z-30 border-t border-border bg-card/95 px-3 pb-2 pt-2 backdrop-blur-sm"
      style={{ bottom: 'var(--phone-nav-height)' }}
    >
      {context && (
        <p className="mx-auto mb-1.5 max-w-3xl truncate text-center text-[12px] text-muted-foreground">
          {context}
        </p>
      )}
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.key}
            // A destructive verb is a quiet OUTLINE at rest — the solid destructive fill
            // belongs only inside the confirm dialog (DESIGN.md, two-solid-fills rule).
            variant={action.variant === 'destructive' ? 'outline' : action.variant ?? 'outline'}
            className="touch-target min-h-11 flex-1"
            disabled={action.disabled}
            loading={action.loading}
            onClick={action.onSelect}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </MobileActionBar>
  );
};

export default MobileDecisionBar;
