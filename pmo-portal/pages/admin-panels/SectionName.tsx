import React from 'react';

/** The selected section's name for assistive tech: the tab already shows it, so no second visible heading. */
export const SectionName: React.FC<{ name: string }> = ({ name }) => <h2 className="sr-only">{name}</h2>;
