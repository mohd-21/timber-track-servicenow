# Data model

Custom objects the scripts expect. Out-of-box tables are extended with `u_` fields.

## Extended out-of-box tables

| Table | Field | Type | Purpose |
|---|---|---|---|
| `sc_task` | `u_type` | Choice | `pick_pack`, `delivery`, `procurement`, `warehouse_receipt`, `return_item` |
| `sc_task` | `u_stage` | Choice | Procurement progress: `new`, `rfq_sent`, `quotes_in`, `finance_pending`, `po_sent` |
| `sc_task` | `u_mode` | Choice | `threshold` (restock) or `customer` (fulfil an order) |
| `sc_task` | `u_quantity` | Integer | Quantity to buy |
| `sc_task` | `u_item` | Reference → `u_material_inventory` | Item to buy |
| `sc_task` | `u_ritms` | String | Request item(s) a delivery task covers |
| `sc_task` | `u_parent_task` | Reference → `sc_task` | Warehouse receipt → its procurement task |
| `sc_task` | `u_selected_quotation` | Reference → `u_vendor_quotation` | Chosen quote |
| `sc_req_item` | `u_return_of` | Reference → `sc_req_item` | Set on a return item |
| `sc_req_item` | `u_fulfilment` | Choice | Stock or procurement path |

## Custom tables

| Table | Fields |
|---|---|
| `u_material_inventory` | item, `stock_quantity`, threshold |
| `u_payment` | `u_request`, `u_ritm`, `u_amount`, `u_status` (`pending`, `paid`, `expired`, `refund_pending`, `refund_paid`, `refund_rejected`), `u_link_expires` |
| `u_vendor_quotation` | `u_task`, `u_vendor`, amount, `u_delivery_date`, `u_state` (`requested`, `submitted`, `selected`, `rejected`) |
| `u_approval_request` | `u_purpose` (`procurement_head`, `finance_po`, `delivery_quality`, `finance_refund`), `u_ref`, `u_group`, `state` (`requested`, `approved`, `rejected`) |

`u_approval_request` is a custom table because the OOB approver field references a
user, and these gates approve by group.

## Groups

Timber Warehouse, Timber Delivery, Timber Procurement, Timber Procurement Head,
Timber Finance Head, Timber Finance Team.

## System properties

| Property | Default | Meaning |
|---|---|---|
| `x_timber.reorder_qty` | `100` | Fixed restock quantity for threshold replenishment |
| `x_timber.vendor_form_url` | empty | Vendor quotation form link used in RFQ emails |
