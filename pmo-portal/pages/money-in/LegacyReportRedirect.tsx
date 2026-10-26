import { Navigate, useLocation, useSearchParams } from 'react-router';

export function LegacyReportRedirect({ view }: { view: 'earned' | 'billing' }) {
  const location = useLocation();
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('section', 'project-revenue');
  next.set('view', view);
  return <Navigate to={`/financial-statements?${next.toString()}${location.hash}`} replace />;
}
