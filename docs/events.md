# Events

| Event | Raised when | Recipient (parm1 / parm2) |
|---|---|---|
| `x_timber.payment_link` | Order placed | customer / link |
| `x_timber.payment_confirmed` | Payment marked paid | customer |
| `x_timber.items_packed` | Pick & pack batch closed | customer |
| `x_timber.rfq` | Procurement task moves to Work in Progress | quantity / vendor form URL (one per preferred vendor) |
| `x_timber.purchase_order` | PO is sent | vendor |
| `x_timber.finance_rejected_po` | Finance head rejects a PO | procurement member |
| `x_timber.unable_to_fulfil` | Procurement head rejects | customer |
| `x_timber.return_rejected` | Quality check fails | customer |
| `x_timber.refund_confirmation` | Finance approves a refund | customer |
| `x_timber.refund_rejected` | Finance rejects a refund | customer |
