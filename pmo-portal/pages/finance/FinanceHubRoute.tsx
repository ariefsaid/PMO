import React from 'react';
import { useNoAccountingSystem } from '@/src/hooks/useNoAccountingSystem';
import FinanceHub from './FinanceHub';

/** #2734: the route element. Reads whether an accounting system is connected and hands the page the answer. */
const FinanceHubRoute: React.FC = () => <FinanceHub noAccounting={useNoAccountingSystem() === true} />;

export default FinanceHubRoute;
