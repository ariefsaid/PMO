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
   - In Odoo 20, external identifiers on `ir.model.data` (`model: 'stock.picking'`, `module: 'pmo'`, `name: <unique_anchor>`) anchor `stock.picking` at create time.
   - For recovery, reading `ir.model.data` by `(module, name)` uniquely adopts the created picking without risk of creating duplicates on retries.

---

## 7. Recovery Identity, Crash Windows, and Probe Behavior (AC-OSP-004)

### External Identifier Mapping
Following `pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts`:
- Module: `'pmo'`
- Name: derived from PMO outbox command key, replacing non-alphanumeric characters with `_` (e.g. `stock:123e4567-e89b-12d3-a456-426614174000` → `stock_123e4567_e89b_12d3_a456_426614174000`).
- Model: `'stock.picking'`
- Target constraint: Odoo enforces unique `(module, name)` in `ir.model.data`. Duplicate creation attempts return HTTP 422 `ValidationError`.

### Exact Recovery Probe Calls
1. **Anchor Lookup (`ir.model.data/search_read`)**
   - Call: `POST /json/2/ir.model.data/search_read`
   - Body:
     ```json
     {
       "domain": [["module", "=", "pmo"], ["name", "=", "<anchor_name>"], ["model", "=", "stock.picking"]],
       "fields": ["id", "res_id", "model"],
       "limit": 2
     }
     ```
   - Observed responses:
     - `[]` (0 rows) → anchor absent.
     - `[{ "id": <id>, "res_id": <picking_id>, "model": "stock.picking" }]` (1 row) → anchor found.
     - `[... 2 rows ...]` → corrupted/ambiguous anchor.

2. **Target State Read (`stock.picking/search_read`)**
   - Call: `POST /json/2/stock.picking/search_read`
   - Body:
     ```json
     {
       "domain": [["id", "=", <picking_id>]],
       "fields": ["id", "state", "company_id", "location_id", "location_dest_id", "move_ids"],
       "limit": 1
     }
     ```
   - Observed responses:
     - `[]` (0 rows) → anchor points to a deleted or non-existent record.
     - `[{ "id": <id>, "state": "<state>", "company_id": [<cid>, "<name>"], ... }]` (1 row) → target verified.

3. **Move Quantities Read (`stock.move/read`)**
   - Call: `POST /json/2/stock.move/read`
   - Body:
     ```json
     {
       "ids": <move_ids>,
       "fields": ["product_id", "quantity", "product_uom_qty"]
     }
     ```

### Safe Crash-Window Rules

| Crash Window | What PMO Knows | What Probe Reads | Probe Verdict | Action / Second Create |
|---|---|---|---|---|
| **Window 1: Create response lost before anchor written** | PMO outbox has command intent (company, product, qty, locations). External ref is null. | `ir.model.data` lookup for `(module: 'pmo', name: <anchor_name>)` returns `[]`. Unanchored pickings may or may not exist in Odoo. | **HOLD (`absent-anchor`)** | **Zero second create.** PMO must never adopt an unanchored picking by heuristic match (vendor/item/qty/location look-alikes exist in shared warehouses). Row remains held for operator review. |
| **Window 2: Anchored draft never validated** | PMO outbox has command intent + external ref anchor key. | `ir.model.data` returns exactly one row pointing to `picking_id`. `stock.picking` has `state: 'draft'` or `'confirmed'` matching company & locations. | **ADOPT (`draft` state)** | **Adopt identity.** Caller completes validation without re-creating `stock.picking` or moves. |
| **Window 3: Validation response lost** | PMO outbox has command intent + external ref anchor key; state is in-doubt after network drop during `button_validate`. | `ir.model.data` returns unique row. `stock.picking` has `state: 'done'`; `stock.move` has completed `quantity`. | **ADOPT (`done` state)** | **Adopt identity.** Finalize outbox row with authoritative external record ID `stock.picking:<id>` and completed quantity. Zero second movement. |
| **Window 4: Repeated probe (idempotency)** | PMO outbox has previously adopted or held status. | Reads identical `ir.model.data` and `stock.picking` rows. | **ADOPT (idempotent)** | Returns the identical result; mutates nothing on the bed. |
| **Window 5: Unrelated look-alike transfer in same company** | PMO outbox has command intent. An unrelated transfer exists with identical item, quantity, locations, and company. | `ir.model.data` returns our anchor pointing to our picking. The look-alike has no PMO anchor (or different anchor). | **ADOPT OURS ONLY** | The look-alike is completely ignored; only the proven anchored picking is adopted. If our anchor is missing, probe returns **HOLD**, never adopting the look-alike. |
| **Window 6: Corrupted / edited anchor** | PMO outbox has command intent + anchor key. | `ir.model.data` returns >1 row (`ambiguous-anchor`), points to non-existent target (`missing-target`), or points to a picking with wrong company or mismatched locations (`wrong-company`, `mismatched-intent`). | **HOLD** | Row is held with exact reason; no automatic re-creation. |

---

## 8. Atomic Creation and Anchoring via `stock.picking/load` (AC-OSP-004)

### Closing Crash Window 1
In the two-step pattern (`stock.picking/create` followed by `ir.model.data/create`), a network drop or crash after step 1 leaves an unanchored transfer in Odoo, forcing PMO recovery into a hold.

Testing on the dev bed proves that **creation and anchoring can be executed in ONE atomic call** via Odoo's native `load` entry point:
- **Endpoint:** `POST /json/2/stock.picking/load`
- **Fields Specification:**
  - `id`: XML ID formatted as `<module>.<anchor_name>` (e.g. `pmo.stock_123e4567_e89b_12d3_a456_426614174000`).
  - Relational Many2one fields specified with `/.id` suffix to resolve directly by database integer ID rather than name lookup:
    - `picking_type_id/.id`
    - `location_id/.id`
    - `location_dest_id/.id`
    - `company_id/.id`
  - Relational One2many lines specified hierarchically:
    - `move_ids/product_id/.id`
    - `move_ids/product_uom_qty`
    - `move_ids/location_id/.id`
    - `move_ids/location_dest_id/.id`
    - `move_ids/company_id/.id`

### Observed Atomic `load` Properties
1. **Single Transaction Guarantee:**
   - Both the `stock.picking` record, all nested `stock.move` records, and the `ir.model.data` external identifier row are created in a single database transaction.
2. **Idempotent Repeated Calls (No Duplicates):**
   - Repeating the identical call with the same `id` (`pmo.<anchor>`) does **NOT** create a second picking or duplicate `ir.model.data` entry.
   - Odoo resolves the existing external identifier, updates the existing picking in place, and returns the identical database ID in `ids: [<picking_id>]`.
3. **Atomic Failure Rollback:**
   - If a failure occurs inside the call (e.g. invalid location ID or constraint violation), the endpoint returns `{ ids: false, messages: [...] }`.
   - The transaction rolls back cleanly: **zero** `stock.picking` and **zero** `ir.model.data` records are left behind on the bed.

---

## 9. Whole-Ledger Oracle and Valuation Verification (AC-OSP-003, Task 3)

### Valuation Configuration on Dev Bed
- **Costing Method:** `standard` (`property_cost_method: 'standard'` on `product.category`).
- **Valuation Mode:** `periodic` (`property_valuation: 'periodic'` on all default categories: "Goods", "Expenses", "Services").
- **Currency & Precision:**
  - Active company currency: `IDR` (`id: 12`, symbol `Rp`, `rounding: 0.01`, `decimal_places: 2`, `position: 'before'`).
  - Product unit cost (`standard_price`): float rounded to 2 decimal places (e.g. `85.50`).

### The Whole-Ledger Oracle Evidence
When issuing stock to a project (`stock.picking` with `project_id`, operation type with `analytic_costs: true`):
1. **Project Cost Ledger (`account.analytic.line`):**
   - **Signed Delta:** Exactly `-1 * quantity * unit_cost` (e.g. `4 * 85.50 = -342.00`).
   - In Odoo analytic accounting, negative amounts represent project expenses/cost debits (`category: 'picking_entry'`).
   - The analytic line source name matches `picking.name`, and `unit_amount` equals the issued quantity.
   - Exactly **one** analytic line is created per native issue.
2. **Inventory Movement & Valuation (`stock.move`):**
   - `stock.move` records `value: -342.00`, representing the native inventory valuation decrease of the warehouse stock.
   - `state: 'done'` and completed `quantity: 4`.
3. **General Ledger (`account.move.line`):**
   - Under `periodic` valuation on this bed, zero automatic journal entries (`account.move` / `account.move.line`) are created upon stock moves (`delta = 0`).
   - If automated real-time valuation is enabled in enterprise or full continental setups, GL lines represent the balance-sheet inventory asset decrease vs. COGS expense. Crucially, they are the balance-sheet side of the movement, **never a second project expense**.
   - PMO must **never** post an additional manual journal entry to book project stock costs, as Odoo's `project_stock_account` already books the native project expense directly into `account.analytic.line`.
4. **Recovery Read-Back Idempotency:**
   - Re-reading the ledger or executing recovery read-backs produces zero additional lines and zero additional cost against the project.

### Dev Bed Limitations (What This Bed Cannot Show)
1. **Periodic vs. Real-Time GL Valuation:**
   - The default Community dev bed has `property_valuation: 'periodic'`. Real-time continental automated valuation (`account.move` generated immediately upon stock pickings) is not active out of the box on standard demo categories, but can be cleanly evaluated on synthetic product categories and synthetic locations without altering shared company charts.
2. **`stock.valuation.layer` Endpoint:**
   - In this Odoo 20 Community environment, `stock.valuation.layer` returns HTTP 404 `missing-model`. Native move valuation is recorded directly on `stock.move.value` and reported via `account.stock.valuation.report`.

---

## 10. Automated Real-Time Valuation and the Whole-Ledger Matrix (Task 3b)

To verify whether automated valuation posts a duplicate project cost through the general ledger, synthetic product categories and synthetic locations were created on the dev bed to evaluate `real_time` valuation across both `standard` and `average` (AVCO) costing methods.

### Whole-Ledger Matrix: Valuation × Costing × Setting

| Valuation Mode | Costing Method | Project Cost Setting (`analytic_costs`) | GL Journal Entry Created (`account.move`) | GL Analytic Distribution | Analytic Lines Created (`account.analytic.line`) | Project Cost Counted Once? |
|---|---|---|---|---|---|---|
| **`periodic`** | **`standard`** | **ON** (`true`) | None (0 lines) | N/A | **1** (`picking_entry`, amount = `-1 * qty * standard_price`) | **YES** (exactly once) |
| **`real_time`** | **`standard`** | **ON** (`true`) | **Yes** (2 lines: Dr COGS, Cr Inventory) | `false` (none) | **1** (`picking_entry`, amount = `-1 * qty * standard_price`) | **YES** (exactly once) |
| **`real_time`** | **`standard`** | **OFF** (`false`) | **Yes** (2 lines: Dr COGS, Cr Inventory) | `false` (none) | **0** (none) | **NO** (0 times — project gets nothing) |
| **`real_time`** | **`average` (AVCO)** | **ON** (`true`) | **Yes** (2 lines: Dr COGS, Cr Inventory) | `false` (none) | **1** (`picking_entry`, amount = `-1 * qty * avco_price`) | **YES** (exactly once) |
| **`real_time`** | **`average` (AVCO)** | **OFF** (`false`) | **Yes** (2 lines: Dr COGS, Cr Inventory) | `false` (none) | **0** (none) | **NO** (0 times — project gets nothing) |

### Key Architectural Discoveries from Odoo 20 Source and Bed Execution

1. **Trigger Condition for Automated Stock Moves (`_should_create_account_move`):**
   In Odoo 20 `stock_account`, a stock move generates an `account.move` if and only if:
   ```python
   self.product_id.is_storable and self.is_valued \
   and (self.location_dest_id.valuation_account_id or self.location_id.valuation_account_id) \
   and not self.uom_id.is_zero(self.quantity) \
   and self.product_id.valuation == 'real_time'
   ```
   When moving goods from internal stock to a customer or loss location whose `valuation_account_id` is set (e.g. Account 152: Cost of Goods Sold), an automated entry is created in `account.journal(14, 'Inventory Valuation')`.

2. **No Analytic Distribution on Stock Journal Entries:**
   In Odoo 20 `stock_account/models/stock_move.py` (`_get_account_move_line_vals`):
   The dictionary creating the debit and credit `account.move.line` contains only:
   `{'account_id', 'name', 'debit', 'credit', 'product_id'}`.
   It sets **no `analytic_distribution`**.
   Therefore, automated inventory journal lines **never produce secondary `account.analytic.line` entries**.

3. **Behavior With Project-Cost Setting OFF under Real-Time:**
   When `picking_type.analytic_costs` is `false`:
   - `project_stock_account` skips creating the `picking_entry` analytic line.
   - The automated GL entry still posts (Dr COGS / Cr Inventory), but has `analytic_distribution = false`.
   - Result: **The project receives NOTHING (zero analytic cost lines)**.

4. **AVCO Dynamic Revaluation:**
   - Receiving goods via purchase orders with different unit prices (e.g. 10 @ Rp 100, 10 @ Rp 200) automatically updates `product.product.standard_price` to the moving average (Rp 150.00).
   - Validating a subsequent project issue creates an analytic cost line valued at the dynamic moving average (`-1 * 5 * 150.00 = -750.00`) and a corresponding GL entry (Dr COGS 750, Cr Inventory 750).
   - Project cost is counted **exactly once**.



