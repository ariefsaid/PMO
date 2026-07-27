import React, { useState } from 'react';
import { analyticsOptIn, analyticsOptOut, hasAnalyticsOptedOut } from '@/src/lib/analytics';

/**
 * FR-CON-002/003 — the in-app analytics opt-out. Lives on /privacy, next to the disclosure it
 * relates to; /privacy is reachable from the login footer (LoginPage.tsx:334) and the in-app
 * account menu (ContextBar.tsx:275), so this satisfies "in-app" without a new settings surface.
 * No banner (OD-OBS-2).
 */
export const AnalyticsOptOutToggle: React.FC = () => {
  const [optedOut, setOptedOut] = useState<boolean>(() => hasAnalyticsOptedOut());

  const onChange = (next: boolean) => {
    setOptedOut(next);
    if (next) analyticsOptOut();
    else analyticsOptIn();
  };

  return (
    <label className="flex items-start gap-3 text-muted-foreground">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-primary"
        checked={optedOut}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Don&rsquo;t send my usage analytics. This stops all product-analytics collection from this
        browser, including error diagnostics. Your choice is remembered on this device.
      </span>
    </label>
  );
};
