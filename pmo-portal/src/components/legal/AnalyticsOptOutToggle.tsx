import React, { useState } from 'react';
import { Checkbox } from '@/src/components/ui/Checkbox';
import { analyticsOptIn, analyticsOptOut, hasAnalyticsOptedOut } from '@/src/lib/analytics';

/**
 * FR-CON-002/003 — the in-app analytics opt-out. Lives on /privacy, next to the disclosure it
 * relates to; /privacy is reachable from the login footer (LoginPage.tsx:334) and the in-app
 * account menu (ContextBar.tsx:275), so this satisfies "in-app" without a new settings surface.
 * No banner (OD-OBS-2). Uses the DESIGN.md `Checkbox` primitive (§Checkbox) rather than a raw
 * `<input>` — it carries the documented tokens (4px radius, `.touch-target` for the ≥44px mobile
 * tap target) that a hand-rolled 16px box on a public page would otherwise lose.
 */
export const AnalyticsOptOutToggle: React.FC = () => {
  const [optedOut, setOptedOut] = useState<boolean>(() => hasAnalyticsOptedOut());

  const onChange = (next: boolean) => {
    setOptedOut(next);
    if (next) analyticsOptOut();
    else analyticsOptIn();
  };

  return (
    <div className="flex items-start gap-3 text-muted-foreground">
      <Checkbox
        checked={optedOut}
        onChange={onChange}
        label="Don't send my usage analytics"
        className="mt-1"
      />
      <span>
        Don&rsquo;t send my usage analytics. This stops all product-analytics collection from this
        browser, including error diagnostics. Your choice is remembered on this device.
      </span>
    </div>
  );
};
