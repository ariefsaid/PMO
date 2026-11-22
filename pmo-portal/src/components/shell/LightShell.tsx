import React, { Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ToastProvider } from '@/src/components/ui';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { LoadingFallback } from '@/components/LoadingFallback';
import { useAuth } from '@/src/auth/useAuth';
import { lazyWithPreload } from '@/src/lib/lazyWithPreload';

const MyHome = lazyWithPreload(() => import('@/pages/MyHome'));
const ProfileSettings = lazyWithPreload(() => import('@/pages/ProfileSettings'));

/**
 * The shell of a light account (#2710, OD-SCOPE-4): no rail, no phone bottom bar, no search, no command palette, no assistant.
 * Two routes: `/my` and the person's own settings (`/settings/profile`: profile, language, text size); every other path redirects to `/my`, so a typed project or work-order link lands on the home screen.
 * Mounted instead of the full shell by `ShellGate` in App.tsx; the database stays the authority (restrictive RLS).
 */
export const LightShell: React.FC = () => {
  const { t } = useTranslation('myHome');
  const { signOut } = useAuth();
  const onSettings = useLocation().pathname === '/settings/profile';
  return (
    <ToastProvider>
      <ErrorBoundary>
        <div className="min-h-[100dvh] bg-background text-foreground">
          <header className="flex items-center justify-between border-b border-border px-4 py-2">
            {onSettings
              ? <Link to="/my" className="touch-target inline-flex min-h-11 items-center px-2 text-control font-medium hover:underline">{t('myHome:title', 'My work')}</Link>
              : <Link to="/settings/profile" className="touch-target inline-flex min-h-11 items-center px-2 text-control font-medium hover:underline">{t('myHome:settings', 'Settings')}</Link>}
            <Button variant="outline" className="min-h-11" onClick={() => void signOut()}>{t('myHome:signOut', 'Sign out')}</Button>
          </header>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/my" element={<MyHome />} />
              <Route path="/settings/profile" element={<ProfileSettings />} />
              <Route path="*" element={<Navigate to="/my" replace />} />
            </Routes>
          </Suspense>
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
};
