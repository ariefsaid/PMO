import React, { Suspense } from 'react';
import { useSearchParams } from 'react-router';
import SalesPipeline from '../SalesPipeline';
import { useSalesModel } from './options/useSalesModel';

const A = React.lazy(() => import('./options/SalesOptionA'));
const B = React.lazy(() => import('./options/SalesOptionB'));
const C = React.lazy(() => import('./options/SalesOptionC'));
const BY = { a: A, b: B, c: C } as const;

const Option: React.FC<{ layout: keyof typeof BY }> = ({ layout }) => {
  const m = useSalesModel();
  const L = BY[layout];
  return <Suspense fallback={null}><L m={m} /></Suspense>;
};

/** `/sales?layout=a|b|c` shows a restructure option (#1426, owner click-through); no param = today's page. */
const SalesLayoutRoute: React.FC = () => {
  const [params] = useSearchParams();
  const layout = params.get('layout');
  return layout === 'a' || layout === 'b' || layout === 'c' ? <Option layout={layout} /> : <SalesPipeline />;
};
export default SalesLayoutRoute;
