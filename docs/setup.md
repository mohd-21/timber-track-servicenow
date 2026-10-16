# Setup on an instance

1. Create the tables, fields, groups and properties in [data-model.md](data-model.md).
2. Create each Script Include in `src/script_includes/` (name = file name, accessible from all scopes if unscoped).
3. Create the Business Rules (after update, one line each):
   - `sc_task_router.js` on `sc_task`
   - `approval_router.js` on `u_approval_request`
   - `payment_paid_trigger.js` on `u_payment`
4. Create the UI Action `select_lowest_quotation.js` on `sc_task` (visible when `u_type == procurement` and `u_stage == quotes_in`).
5. Create the scheduled job `expire_stale_payments.js` (daily).
6. Register every event in `TimberTrackConfig.EVENTS` and attach a Notification to each.
7. Call `TimberTrackPayment.markPaid(...)` from your payment-gateway integration (webhook / Scripted REST API).
8. Call `TimberTrackProcurement.onQuotationSubmitted(...)` from the vendor quotation form integration.
