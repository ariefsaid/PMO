import React from 'react';
import { useTranslation } from 'react-i18next';
import { AccessDenied } from '@/src/components/ui';

/**
 * AC-W3-F7: 404 / unknown-route surface. The shared `AccessDenied` card in its `notFound`
 * variant: one component for "not for you" and "not found", each with one back action.
 */
const NotFound: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccessDenied
      variant="notFound"
      title={t('notFound.title', 'Page not found')}
      sub={t('notFound.body', "The page you're looking for doesn't exist or has been moved.")}
      backTo="/"
    />
  );
};

export default NotFound;
