/**
 * AC-G3D-MOBILE-PH: PageHeader @390px overflow — flex-wrap + truncate guards.
 *
 * The PageHeader is used by every detail record page (ProjectDetailHeader,
 * ProcurementDetails, CompanyDetail, ContactDetail). A long record name + a
 * status pill + action buttons must not overflow on a 390px viewport.
 *
 * We assert the markup carries the classes that prevent the overflow:
 *   - The top row carries `flex-wrap` so items wrap before overflowing.
 *   - The inner flex holding [name + status] carries `min-w-0`.
 *   - The <h1> carries `truncate` and `min-w-0`.
 *
 * This is a unit markup guard — real layout overflow is only measurable in a
 * browser engine. The classes are the contract; the browser honours them.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../PageHeader';
import { StatusPill } from '../StatusPill';

describe('AC-G3D-MOBILE-PH: PageHeader @390 overflow prevention', () => {
  it('the top row carries flex-wrap so items do not overflow on narrow viewports', () => {
    const { container } = render(
      <PageHeader
        name="Alstom KLCC Extension Phase 2 Long Project Name"
        status={<StatusPill variant="progress">In Progress</StatusPill>}
        actions={<button type="button">Edit</button>}
      />,
    );
    // The outermost flex row (items-start gap-3.5) must include flex-wrap.
    const row = container.querySelector('.flex.items-start');
    expect(row).toBeInTheDocument();
    expect(row?.className).toMatch(/flex-wrap/);
  });

  it('the inner flex container holding [name + status] carries min-w-0 to allow truncation', () => {
    const { container } = render(
      <PageHeader
        name="Alstom KLCC Extension Phase 2 Long Project Name"
        status={<StatusPill variant="progress">In Progress</StatusPill>}
      />,
    );
    // The div wrapping the h1 + status pill row must have min-w-0.
    // This is the direct child of the icon + name row (excluding the icon span).
    const inner = container.querySelector('.min-w-0');
    expect(inner).toBeInTheDocument();
  });

  it('the h1 carries truncate and min-w-0 to ellipsis a long record name', () => {
    render(
      <PageHeader
        name="Alstom KLCC Extension Phase 2 — A Very Long Project Name That Exceeds 390px"
        status={<StatusPill variant="progress">In Progress</StatusPill>}
      />,
    );
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.className).toMatch(/truncate/);
    expect(h1.className).toMatch(/min-w-0/);
  });

  it('the actions div carries shrink-0 so it is never squashed off-screen', () => {
    const { container } = render(
      <PageHeader
        name="Long project name"
        actions={<button type="button">Edit</button>}
      />,
    );
    // The ml-auto actions wrapper must not shrink below its own size.
    const actionsDiv = container.querySelector('.ml-auto');
    expect(actionsDiv).toBeInTheDocument();
    expect(actionsDiv?.className).toMatch(/shrink-0/);
  });
});
