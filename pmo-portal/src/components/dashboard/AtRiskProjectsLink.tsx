import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

/** One canonical doorway to the existing risk-filtered project list; zero risks have no false action. */
export const AtRiskProjectsLink: React.FC<{ count: number; className?: string }> = ({
  count,
  className = '',
}) => {
  const { t } = useTranslation();
  if (count <= 0) return null;

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
