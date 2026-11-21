import React from 'react';

/** One section of the phone home screen: a heading and its body, one column, no chrome. */
export const MySection: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section aria-labelledby={`${id}-h`} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
    <h2 id={`${id}-h`} className="text-group font-semibold tracking-[-0.01em]">{title}</h2>
    <div className="mt-2 space-y-2">{children}</div>
  </section>
);
