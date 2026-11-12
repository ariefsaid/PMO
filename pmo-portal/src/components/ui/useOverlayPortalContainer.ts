import { useLayoutEffect, useState, type RefObject } from 'react';

/** Keep a Base UI portal inside its owning modal so the dialog's inert siblings do not hide it. */
export function useOverlayPortalContainer<T extends HTMLElement>(rootRef: RefObject<T | null>) {
  const [container, setContainer] = useState<HTMLElement>();

  useLayoutEffect(() => {
    const dialog = rootRef.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    if (dialog) setContainer(dialog);
  }, [rootRef]);

  return container;
}
