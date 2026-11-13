import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buttonClasses } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';

/**
 * AC-W3-F7: 404 / unknown-route surface.
 *
 * Mirrors AccessDenied.tsx in style (secondary tile + icon + muted copy + a primary action) — the
 * same honest dead-end pattern. Uses react-router Link for "/" so the user can return to the
 * dashboard without a full page reload.
 *
 * C11 (DS not-found #1/#3): the copy sits on the 14px control floor (never below it) and the one
 * action is the SHARED button anatomy — `touch-target` grows its hit area to >=44px on a coarse
 * pointer — instead of the hand-styled 13px link this used to be.
 */
const NotFound: React.FC = () => {
  const { t } = useTranslation();
  return (
    <section
      role="region"
      aria-label={t('notFound.region', 'Page not found')}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-14 text-center',
      )}
    >
      <Icon name="alert" aria-hidden className="size-6 text-muted-foreground" strokeWidth={1.75} />
      <h1 className="text-page font-semibold">{t('notFound.title', 'Page not found')}</h1>
      <p className="max-w-[44ch] text-control text-muted-foreground">
        {t('notFound.body', "The page you're looking for doesn't exist or has been moved.")}
      </p>
      <Link to="/" className={cn(buttonClasses('primary'), 'mt-1 pointer-coarse:min-h-11')}>
        <Icon name="back" className="size-4" />
        {t('notFound.back', 'Back to Dashboard')}
      </Link>
    </section>
  );
};

export default NotFound;
