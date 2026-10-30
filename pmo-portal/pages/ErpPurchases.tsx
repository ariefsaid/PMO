import React from 'react';
import { Navigate } from 'react-router';

/** Keep existing links working while the ERP orphan workspace lives inside Procurement. */
const ErpPurchasesPage: React.FC = () => <Navigate to="/procurement?tab=orphans" replace />;

export default ErpPurchasesPage;
