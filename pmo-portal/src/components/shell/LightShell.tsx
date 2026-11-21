import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ToastProvider } from '@/src/components/ui';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { LoadingFallback } from '@/components/LoadingFallback';
import { useAuth } from '@/src/auth/useAuth';
import { lazyWithPreload } from '@/src/lib/lazyWithPreload';

const MyHome = lazyWithPreload(() => import('@/pages/MyHome'));

/**
 * The shell of a light account (#2710, OD-SCOPE-4): no rail, no phone bottom bar, no search, no command palette, no assistant.
 * One route, `/my`; every other path redirects to it, so a typed project or work-order link lands on the home screen.
 * Mounted instead of the full shell by `ShellGate` in App.tsx; the database stays the authority (restrictive RLS).
 */
export const LightShell: React.FC = () => {
  const { t } = useTranslation('myHome');
  const { signOut } = useAuth();
  return (
    <ToastProvider>
      <ErrorBoundary>
        <div className="min-h-[100dvh] bg-background text-foreground">
          <header className="flex items-center justify-between border-b border-border px-4 py-2">
            <span aria-hidden="true" />
            <Button variant="outline" className="min-h-11" onClick={() => void signOut()}>{t('myHome:signOut', 'Sign out')}</Button>
          </header>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/my" element={<MyHome />} />
              <Route path="*" element={<Navigate to="/my" replace />} />
            </Routes>
          </Suspense>
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
};
