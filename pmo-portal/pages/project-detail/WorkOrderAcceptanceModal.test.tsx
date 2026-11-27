import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";
import WorkOrderAcceptanceModal from "./WorkOrderAcceptanceModal";

it.each(['final', 'date'])("warns before discarding a %s-only acceptance edit", async (field) => {
 render(<WorkOrderAcceptanceModal workOrder={{id: "wo", title: "Order", wo_number: null, status: "Issued"}} boqItems={[]} allocations={[]} acceptances={[]} documents={[]} today="2026-11-01" draft={null} onClose={vi.fn()} onSave={vi.fn()} onError={vi.fn()} />);
 if (field === 'final') await userEvent.click(screen.getByLabelText("This is the final BAST"));
 else {
   await userEvent.clear(screen.getByLabelText(/BAST date/));
   await userEvent.type(screen.getByLabelText(/BAST date/), '2026-10-30');
 }
 await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
 expect(await screen.findByText(/Discard your changes/i)).toBeInTheDocument();
});

it('closes an unchanged prefilled acceptance without a discard warning', async () => {
 const onClose = vi.fn();
 const draft = { acceptance_date: '2026-11-01', is_final: true, document_id: null, note: 'Recorded', lines: [] } as unknown as NonNullable<React.ComponentProps<typeof WorkOrderAcceptanceModal>['draft']>;
 render(<WorkOrderAcceptanceModal workOrder={{id: 'wo', title: 'Order', wo_number: null, status: 'Issued'}} boqItems={[]} allocations={[]} acceptances={[]} documents={[]} today="2026-11-01" draft={draft} onClose={onClose} onSave={vi.fn()} onError={vi.fn()} />);
 await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
 expect(onClose).toHaveBeenCalled();
 expect(screen.queryByText(/Discard your changes/i)).not.toBeInTheDocument();
});
