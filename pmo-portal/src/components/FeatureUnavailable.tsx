import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/icons';
import { FEATURE_LABELS, type EntitleableKey } from '@/src/lib/features';

/**
 * FeatureUnavailable — the state a switched-off route renders (AC-PLN-008, FR-PLN-014-adjacent).
 *
 * Two distinct states, deliberately not merged:
 *   - `off`: the database resolved the key OFF. The route says so, names the module and points
 *     home. Nothing is deleted (FR-PLN-007): the same URL shows the page again once the switch is
 *     back on.
 *   - `error`: the resolved set could not be read. It must NEVER tell a user their plan lacks the
 *     module when the answer is unknown — it offers a retry instead and holds the route.
 */
export interface FeatureUnavailableProps {
  variant: 'off' | 'error';
  feature?: EntitleableKey;
  onRetry?: () => void;
}

export const FeatureUnavailable: React.FC<FeatureUnavailableProps> = ({
  variant,
  feature,
  onRetry,
}) => {
  const { t } = useTranslation('plans');
  const label = feature ? FEATURE_LABELS[feature] : undefined;
  const isOff = variant === 'off';
  return (
    <div
      data-testid={isOff ? 'feature-unavailable' : 'feature-unavailable-error'}
      role={isOff ? undefined : 'alert'}
      className="mx-auto flex max-w-[60ch] flex-col items-start gap-3 rounded-lg border border-border bg-card px-5 py-6"
    >
      <span className="grid size-9 place-items-center rounded-full bg-secondary text-muted-foreground">
        <Icon name={isOff ? 'lock' : 'alert'} />
      </span>
      <h1 className="text-[20px] font-semibold tracking-[-0.01em]">
        {isOff
          ? t('featureUnavailable.title', "This part of PMO isn't on your plan")
          : t('featureUnavailable.errorTitle', "We couldn't check what's on your plan")}
      </h1>
      <p className="text-[13.5px] text-muted-foreground">
        {isOff
          ? t(
              'featureUnavailable.body',
              'Your organisation’s plan does not include {{feature}}. Nothing has been deleted — an administrator can switch it back on.',
              { feature: label ?? t('featureUnavailable.thisModule', 'this module') },
            )
          : t(
              'featureUnavailable.errorBody',
              'The plan and switch settings did not load. Try again; if it keeps failing, ask your administrator.',
            )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {isOff ? (
          <Link
            to="/"
            className="touch-target inline-flex min-h-11 items-center rounded-md border border-border px-3 text-[13px] font-medium hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:min-h-0"
          >
            {t('featureUnavailable.home', 'Go to the dashboard')}
          </Link>
        ) : (
          <Button variant="outline" onClick={onRetry} disabled={!onRetry}>
            {t('featureUnavailable.retry', 'Try again')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default FeatureUnavailable;
