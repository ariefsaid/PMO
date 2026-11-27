import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { it, expect, vi } from "vitest";
import { WorkOrderLineDrawer } from "./WorkOrdersDrawers";
vi.mock("@/src/auth/usePermission", () => ({ usePermission: () => () => false }));

it("shows only confirmed delivery quantities in confirmed history", () => {
 type Props = React.ComponentProps<typeof WorkOrderLineDrawer>;
 const selected = { key: "line", order: { id: "wo", title: "Order", status: "Issued" }, item: { description: "Steel", unit: "kg" }, allocation: { boqItemId: "b", quantity: 10, acceptedQuantity: 2, claimedQuantity: 0 }, rate: null } as Props["selected"];
 const records = ["Confirmed", "Draft", "Withdrawn"].map((status, index) => ({ id: status, status, acceptance_date: "2026-11-01", is_final: false, lines: [{ boq_item_id: "b", quantity: index + 2 }] })) as Props["acceptancesByWo"] extends Map<string, infer Rows> ? Rows : never;
 render(<MemoryRouter><WorkOrderLineDrawer selected={selected} contractLines={[]} orders={[]} acceptancesByWo={new Map([["wo", records]])} lineReadsPending={false} lineReadsFailed={false} canViewBilling={false} currency="IDR" projectId="p" onClose={vi.fn()} onAllocateLines={vi.fn()} /></MemoryRouter>);
 const history = screen.getByText("Quantity history").closest("section")!;
 expect(within(history).getAllByRole("listitem")).toHaveLength(1);
 expect(history).toHaveTextContent("2 kg");
});
