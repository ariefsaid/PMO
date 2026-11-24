import { lazyWithPreload } from '@/src/lib/lazyWithPreload';

const MyHome = lazyWithPreload(() => import('@/pages/MyHome'));
const TransferDetail = lazyWithPreload(() => import('@/pages/stock/StockTransferDetail'));
const ProfileSettings = lazyWithPreload(() => import('@/pages/ProfileSettings'));

/** The pages a light account can open. `LightShell.routes.test.tsx` renders each one inside the real shell. */
export const LIGHT_PAGES = { '/my': MyHome, '/stock/transfers/:transferId': TransferDetail, '/settings/profile': ProfileSettings } as const;
export const LIGHT_ROUTE_PATHS = Object.keys(LIGHT_PAGES);

