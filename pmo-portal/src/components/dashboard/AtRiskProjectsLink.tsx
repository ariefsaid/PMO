import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

/** One canonical doorway to the existing risk-filtered project list; zero risks have no false action. */
export const AtRiskProjectsLink: React.FC<{ count: number; className?: string; checkable?: boolean }> = ({
  count,
  className = '',
  checkable = true,
}) => {
  const { t } = useTranslation('dashboard');
  if (count <= 0) {
    if (checkable) return null;
    return <p className="text-sm text-muted-foreground" data-testid="dashboard-at-risk-unavailable">{t('dashboard:risk.uncheckedNote', "Risk can't be checked yet — no active budget.")}</p>;
  }

  const label = count === 1
    ? t('dashboard.atRisk.reviewSingle', 'Review {{count}} at-risk project', { count })
    : t('dashboard.atRisk.reviewMany', 'Review {{count}} at-risk projects', { count });

  return (
    <Link
      to="/projects?filter=at-risk"
      className={className}
      aria-label={label}
      data-testid="dashboard-at-risk-link"
    >
      {label}
    </Link>
  );
};
