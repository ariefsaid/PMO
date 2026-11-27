import { createContext, useContext } from 'react';

/** Bare renders (tests, light shell) have no gate: reads start at once, as before. */
export const AfterFirstDataContext = createContext(true);

/** True once the opening screen's own data has settled (sticky: later navigations never re-gate). Provided by the shell. */
export const useAfterFirstData = (): boolean => useContext(AfterFirstDataContext);
