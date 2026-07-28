import React, { useReducer } from 'react';
import { Checkbox } from '@/src/components/ui/Checkbox';
import { analyticsOptIn, analyticsOptOut, getAnalyticsConfig, getConsentState } from '@/src/lib/analytics';

const LABEL_ID = 'analytics-opt-out-label';

/** The full sentence used both as the visible copy AND (via aria-labelledby) the
 * control's accessible name — one source of truth, so a screen reader never hears
 * the name and then the same words again as separate page prose (the bug this
 * replaces: a duplicated `aria-label` sitting next to an unassociated sibling span). */
const ACTIVE_COPY =
  "Don't send my usage analytics. This stops all product-analytics collection from this browser, " +
  'including error diagnostics. Your choice is remembered on this device.';

const DNT_COPY =
  "Not sending usage analytics — your browser's Do Not Track setting is on, so this browser is " +
  'already not tracked. This overrides the toggle below; there is nothing more to opt out of here.';

const DISABLED_COPY =
  "Not sending usage analytics — product analytics isn't enabled on this deployment, so there's " +
  'nothing to opt out of.';

/**
 * FR-CON-002/003 — the in-app analytics opt-out. Lives on /privacy, next to the disclosure it
 * relates to; /privacy is reachable from the login footer (LoginPage.tsx:334) and the in-app
 * account menu (ContextBar.tsx:275), so this satisfies "in-app" without a new settings surface.
 * No banner (OD-OBS-2). Uses the DESIGN.md `Checkbox` primitive (§Checkbox) rather than a raw
 * `<input>` — it carries the documented tokens (4px radius, `.touch-target` for the ≥44px mobile
 * tap target) that a hand-rolled 16px box on a public page would otherwise lose.
 *
 * AC-CON-010 — the visible sentence IS the label (and the click target), via `aria-labelledby`
 * (Checkbox's `labelledBy` prop): clicking anywhere in the row — the box or the prose — toggles
 * exactly once (the row swallows the click; the checkbox's own click is left to reach it, and the
 * row ignores clicks that originate on the checkbox itself to avoid a double-toggle).
 *
 * AC-CON-011 — three-state (+active), not boolean: `getConsentState` (client.ts) resolves the
 * ACTUAL reason analytics is or isn't running (deployment-disabled / browser DNT / explicit
 * opt-out / genuinely active) in the same priority order the SDK-init guard itself uses, so this
 * control can never show a state the guard disagrees with. 'disabled' and 'dnt' are non-interactive
 * — toggling would be a no-op against what's actually happening, so pretending otherwise would be
 * the same false-affordance class of bug this component already had.
 */
export const AnalyticsOptOutToggle: React.FC = () => {
  // Pure/ambient reads (env + navigator + localStorage) — never change within this component's
  // lifetime except the localStorage-derived part, which `forceRender` re-reads after a toggle.
  const [config] = React.useState(() => getAnalyticsConfig());
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const state = getConsentState(config);

  const checked = state !== 'active';
  const interactive = state === 'active' || state === 'opted-out';

  const toggle = () => {
    if (!interactive) return;
    if (state === 'active') analyticsOptOut();
    else analyticsOptIn();
    forceRender();
  };

  const onRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    // The checkbox box already handles its own click (Checkbox.tsx's onClick={toggle}); don't
    // double-toggle when the click originated there and bubbled up to this row.
    if ((event.target as HTMLElement).closest('[role="checkbox"]')) return;
    toggle();
  };

  const copy = state === 'dnt' ? DNT_COPY : state === 'disabled' ? DISABLED_COPY : ACTIVE_COPY;

  return (
    <div
      className={`flex items-start gap-3 text-muted-foreground ${interactive ? 'cursor-pointer' : ''}`}
      onClick={onRowClick}
    >
      <Checkbox
        checked={checked}
        onChange={toggle}
        disabled={!interactive}
        label="Don't send my usage analytics"
        labelledBy={LABEL_ID}
        className="mt-1"
      />
      <span id={LABEL_ID}>{copy}</span>
    </div>
  );
};
