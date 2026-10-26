import React from 'react';
import { Breadcrumb, type BreadcrumbPart } from './Breadcrumb';

export interface PageFrameProps {
  breadcrumb: BreadcrumbPart[];
  /** The record page's in-content return control replaces the trail on phones. */
  returnLabel?: string;
  children: React.ReactNode;
}

/** Content-track wayfinding shared by pages using the redesigned shell frame. */
export const PageFrame: React.FC<PageFrameProps> = ({ breadcrumb, returnLabel, children }) => (
  <div data-page-frame className="min-w-0">
    {breadcrumb.length > 1 && (
      <Breadcrumb parts={breadcrumb} className={`mb-4 ${returnLabel ? 'max-[920px]:hidden' : ''}`} />
    )}
    {children}
  </div>
);

PageFrame.displayName = 'PageFrame';
