# Odoo 20 Community: Native Stock Protocol and Valuation Verification

Discovery against the local stock Odoo 20 Community dev bed (`odoo:20.0`, server `20.0-20261015`) for Task 1 of plan #1508 (`docs/plans/2026-11-14-odoo-stock-posting.md`, spec `docs/specs/odoo-stock-posting.spec.md`).

All calls were executed via JSON-2 RPC (`POST /json/2/{model}/{method}`) using the standard `bindCall` client. Responses below record actual observed behaviors, shapes, and HTTP status codes with zero private data or credentials.

---

## 1. Environment and Modules

### Installed Modules Verified on Bed
- `stock` (installed, module ID 554)
- `stock_account` (installed, module ID 555)
- `project_stock_account` (installed, module ID 484)
- `analytic` (installed, module ID 156)
- `project` (installed, module ID 471)

### Operation Types (`stock.picking.type`)
- Active out-of-the-box operation types:
  - `Receipts` (`id: 1`, `code: 'incoming'`, `company_id: 1`, `analytic_costs: false`)
  - `Delivery Orders` (`id: 2`, `code: 'outgoing'`, `company_id: 1`, `analytic_costs: false`)
- Inactive by default in Community (`active: false`):
  - `Internal Transfers` (`id: 7`, `code: 'internal'`, `company_id: 1`)
- The `analytic_costs` boolean flag is defined by `project_stock_account` directly on `stock.picking.type`.

---

## 2. Model & Field Signatures (Reality vs Doc)

### `product.product`
- Storable flag: `is_storable: true` (in Odoo 20, storable goods have `is_storable: true`, while `type` is `'consu'`).
- Cost field: `standard_price: number` (e.g. `75.50`).
- UoM: `uom_id: [id, name]` (defaults to `[1, 'Units']`).

### `project.project`
- Project creation automatically provisions an analytic account: `account_id: [id, name]`.
- Mappings in `project_stock_account` look up `picking.project_id._get_analytic_distribution()` or `project.account_id`.

### `stock.move`
- **Gotcha / Breaking API Change:** In Odoo 20, `stock.move` has **no `name` field**. Attempting to pass `name` returns HTTP 500: `ValueError: Invalid field 'name' in 'stock.move'`.
- Required fields on `create`:
  - `product_id`: integer product ID
  - `product_uom_qty`: demand quantity (number)
  - `location_id`: integer source location ID
  - `location_dest_id`: integer destination location ID
  - `company_id`: integer company ID
  - `picking_id`: integer picking ID
- Done quantity field: `quantity: number` with `picked: boolean`. (Legacy `quantity_done` is obsolete in Odoo 20). Setting `{ quantity: N, picked: true }` marks lines ready for validation.

---

## 3. Protocol: Stock Transfer Lifecycle (AC-OSP-002)

### Sequence
1. **Create Picking (`stock.picking/create`)**
   - Call: `POST /json/2/stock.picking/create`
   - Body:
     ```json
     {
       "vals_list": [
         {
           "picking_type_id": 2,
           "location_id": 6,
           "location_dest_id": 2,
           "company_id": 1
         }
       ]
     }
     ```
   - Response: `200 [ <picking_id: int> ]`

2. **Create Move (`stock.move/create`)**
   - Call: `POST /json/2/stock.move/create`
   - Body:
     ```json
     {
       "vals_list": [
         {
           "picking_id": <picking_id>,
           "product_id": <product_id>,
           "product_uom_qty": 8,
           "location_id": 6,
           "location_dest_id": 2,
           "company_id": 1
         }
       ]
     }
     ```
   - Response: `200 [ <move_id: int> ]`

3. **Confirm Picking (`stock.picking/action_confirm`)**
   - Call: `POST /json/2/stock.picking/action_confirm`
   - Body: `{ "ids": [ <picking_id> ] }`
   - Response: `200 true`
   - Observed state: Picking state transitions from `'draft'` to `'confirmed'`.

4. **Record Quantity Done (`stock.move/write`)**
   - Call: `POST /json/2/stock.move/write`
   - Body:
     ```json
     {
       "ids": [ <move_id> ],
       "vals": { "quantity": 8, "picked": true }
     }
     ```
   - Response: `200 true`
   - Observed state: Move state transitions to `'assigned'`.

5. **Validate Movement (`stock.picking/button_validate`)**
   - Call: `POST /json/2/stock.picking/button_validate`
   - Body: `{ "ids": [ <picking_id> ] }`
   - Response: `200 true`
   - Observed state:
     - `stock.picking`: `state` becomes `'done'`.
     - `stock.move`: `state` becomes `'done'`, `quantity` is 8.
     - `stock.quant`: Quants update at source (`-8`) and destination (`+8`).

---

## 4. Protocol: Project Issue & Analytic Costing (AC-OSP-003)

### Mechanism
In Odoo 20 Community with `project_stock_account` installed:
- `stock.picking` carries a `project_id` field.
- `stock.picking.type` carries the `analytic_costs: boolean` flag.
- During `stock.picking/button_validate`, `stock.move._create_analytic_move()` inspects `move.picking_type_id.analytic_costs`.
- If `analytic_costs == true` and `picking.project_id` is present, Odoo automatically generates an `account.analytic.line` attributed to the project's analytic account.

### Observed Behaviors on Dev Bed
- **When `analytic_costs == false`:**
  - `stock.picking/button_validate` returns `200 true`.
  - Search `account.analytic.line` for the project's `account_id` returns `[]` (0 lines created). No project cost is generated.
- **When `analytic_costs == true`:**
  - `stock.picking/button_validate` returns `200 true`.
  - Exactly one `account.analytic.line` is generated on the project's analytic account with:
    - `name`: `<picking.name>` (e.g. `'WH/OUT/00004'`)
    - `category`: `'picking_entry'`
    - `unit_amount`: `<completed_quantity>` (e.g. `2`)
    - `amount`: `-1 * completed_quantity * standard_price` (e.g. `-240.00` for 2 units @ 120.00)
    - `product_id`: `[ <product_id>, "<Product Name>" ]`
    - `account_id`: `[ <analytic_account_id>, "<Project Name>" ]`

---

## 5. Validation Wizards & Failure Modes (AC-OSP-002, AC-OSP-003)

### 1. Empty Transfer
- Condition: `stock.picking` has no `stock.move` lines.
- Call: `POST /json/2/stock.picking/button_validate { "ids": [ <picking_id> ] }`
- Response: `422 Unprocessable Entity`
- Observed Error Body:
  ```json
  {
    "name": "odoo.exceptions.UserError",
    "message": "You can’t validate an empty transfer. Please add some products to move before proceeding.",
    "arguments": ["You can’t validate an empty transfer. Please add some products to move before proceeding."]
  }
  ```

### 2. Zero Quantity Transfer (Unpicked Goods)
- Condition: `stock.picking` confirmed with demand > 0, but no quantity is picked (`quantity: 0`).
- Call: `POST /json/2/stock.picking/button_validate { "ids": [ <picking_id> ] }`
- Response: `422 Unprocessable Entity`
- Observed Error Body:
  ```json
  {
    "name": "odoo.exceptions.UserError",
    "message": "Transfer trouble alert! Validating a zero quantity transfer? You're not moving invisible goods around are you?\nSet some quantities and let's get moving!",
    "arguments": ["Transfer trouble alert! Validating a zero quantity transfer? You're not moving invisible goods around are you?\nSet some quantities and let's get moving!"]
  }
  ```

### 3. Partial Transfer (Backorder Confirmation Wizard)
- Condition: Demand `product_uom_qty: 10`, but done `quantity: 6` is picked.
- Call: `POST /json/2/stock.picking/button_validate { "ids": [ <picking_id> ] }`
- Response: `200 OK` returning an `ir.actions.act_window` wizard descriptor:
  ```json
  {
    "name": "Create Backorder?",
    "type": "ir.actions.act_window",
    "view_mode": "form",
    "res_model": "stock.backorder.confirmation",
    "view_id": 1274,
    "target": "new",
    "context": {
      "button_validate_picking_ids": [ <picking_id> ],
      "default_show_transfers": false,
      "default_pick_ids": [ [ 4, <picking_id> ] ]
    }
  }
  ```
- **Option A: Create Backorder (`process`)**
  1. Create wizard: `POST /json/2/stock.backorder.confirmation/create` with `{ vals_list: [{}], context: <wizard_context> }` → returns `[ <wiz_id> ]`.
  2. Execute: `POST /json/2/stock.backorder.confirmation/process` with `{ ids: [ <wiz_id> ], context: <wizard_context> }` → returns `200 true`.
  3. Result:
     - Original picking: `state: 'done'`, completed move quantity is 6.
     - A new backorder picking is generated: `state: 'confirmed'`, `backorder_id: [ <picking_id>, "<name>" ]`.
     - Backorder move has `product_uom_qty: 4` (the remaining balance).
- **Option B: Cancel Backorder (`process_cancel_backorder`)**
  1. Create wizard: `POST /json/2/stock.backorder.confirmation/create` with `{ vals_list: [{}], context: <wizard_context> }` → returns `[ <wiz_id> ]`.
  2. Execute: `POST /json/2/stock.backorder.confirmation/process_cancel_backorder` with `{ ids: [ <wiz_id> ], context: <wizard_context> }` → returns `200 true`.
  3. Result:
     - Original picking: `state: 'done'`, completed move quantity is 4.
     - No backorder picking is created (`backorder_id` search returns 0 rows).

---

## 6. Findings for Task 2 (Recovery Identity)
1. **Crash Window during `button_validate`:**
   - When validating a full transfer, `button_validate` returns `true` and commits in a single transaction. If a connection reset occurs, a probe reading `stock.picking/read` for `state` will observe `'done'`.
   - When validating a partial transfer, `button_validate` returns a transient action dictionary without completing the picking (state remains `'assigned'`). Completing the movement requires executing `stock.backorder.confirmation/process` or `process_cancel_backorder`.
2. **Anchor Stability:**
   - In Odoo 20, external identifiers on `ir.model.data` (`model: 'stock.picking'`, `module: 'pmo_stock'`, `name: <unique_anchor>`) can anchor `stock.picking` at create time.
   - For recovery, reading `ir.model.data` by `(module, name)` uniquely adopts the created picking without risk of creating duplicates on retries.
