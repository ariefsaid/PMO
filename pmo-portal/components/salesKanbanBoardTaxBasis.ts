import { createContext } from 'react';

/** The summary condition from SalesPipeline's open-deal band, shared with desktop board cards. */
export const SalesKanbanBoardTaxBasisContext = createContext<boolean | undefined>(undefined);
