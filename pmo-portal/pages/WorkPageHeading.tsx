import React from 'react';
import { PageHeading, type PageHeadingKind } from '@/src/components/ui';

/**
 * Small route adapter that maps Work's title/scope props to the shared shell heading.
 * Keeping this mapping in one place makes future frame changes local to the Work area.
 */
const WorkPageHeading: React.FC<{ title: string; scope: string; className?: string; kind?: PageHeadingKind }> = ({
  title,
  scope,
  className = 'mb-4',
  kind = 'collection',
}) => (
  <div className={className}>
    <PageHeading kind={kind} title={title} scope={scope} />
  </div>
);

export default WorkPageHeading;
