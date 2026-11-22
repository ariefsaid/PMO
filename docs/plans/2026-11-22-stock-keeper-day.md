# Plan: the storekeeper's day (#1122, `fix/walk-stock`)

Spec `docs/specs/stock-keeper-day.spec.md`. No migration in this slice (1590-1599 unused). Order built: 1 (data seam, home, receive guard, picker),
4 (posting confirmation), 5, 11, 10, 7, 8, 6, 2 (receive form). Each task: failing Vitest first (owner in the spec), then the change.
Files: `src/lib/db/myHome.ts`, `src/components/my/{DeliveriesSection,MyDeliveries}.tsx`, `pages/ExecutiveDashboard.tsx`, `src/components/shell/LightShell.tsx`,
`pages/stock/{StockTransferDetail,StockTransferSend,StockTransferPrint,StockMovementForm,StockOnHand,StockCount,StockReorder,StockSetup,StockTransferSettings,WorkOrderStockBalance}.tsx`,
`src/lib/{stockReceivers,db/stockMaster}.ts`, `App.tsx` (print route), `public/locales/{en,id}/{stock,myHome}.json`.
Verify: `npx vitest related --run <changed files>`, `npm run typecheck`, eslint on the changed files, `npm run check:guards`.
Deferred (needs a migration and a database to prove): reversal action, cost from purchase or later, item request to Admin.
