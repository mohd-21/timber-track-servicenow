/**
 * Script Include: TimberTrackProcurement
 * Vendor RFQ, quotation selection, approvals and purchase orders.
 *
 * Two modes share the same mechanism:
 *   threshold - restock a fixed quantity, NO approvals, runs in the background
 *   customer  - buy what a customer ordered: procurement head approves first,
 *               then finance head approves the chosen quotation before the PO is sent
 */
var TimberTrackProcurement = Class.create();
TimberTrackProcurement.prototype = {
    initialize: function () {
        this.tasks = new TimberTrackTasks();
        this.approvals = new TimberTrackApprovals();
        this.inventory = new TimberTrackInventory();
    },

    // ---------- starting a procurement ----------

    /** Restock task for an item at or below threshold. Skips if one is already open. */
    startThreshold: function (inventoryId) {
        var open = new GlideRecord('sc_task');
        open.addActiveQuery();
        open.addQuery('u_type', TimberTrackConfig.TASK_TYPE.PROCUREMENT);
        open.addQuery('u_mode', TimberTrackConfig.MODE.THRESHOLD);
        open.addQuery('u_item', inventoryId);
        open.setLimit(1);
        open.query();
        if (open.next()) {
            return null;
        }
        return this.tasks.create({
            type: TimberTrackConfig.TASK_TYPE.PROCUREMENT,
            group: TimberTrackConfig.GROUPS.PROCUREMENT,
            summary: 'Threshold restock',
            fields: {
                u_mode: TimberTrackConfig.MODE.THRESHOLD,
                u_item: inventoryId,
                u_quantity: TimberTrackConfig.reorderQty(),
                u_stage: TimberTrackConfig.STAGE.NEW
            }
        });
    },

    /** Procurement task for a customer's order; quantity follows what they ordered. */
    startForCustomer: function (ritmId) {
        var ritm = new GlideRecord('sc_req_item');
        if (!ritm.get(ritmId)) {
            return null;
        }
        var inventory = this.inventory.findInventory(ritm.getValue('cat_item'));
        ritm.setValue('u_fulfilment', 'procuring');
        ritm.update();
        return this.tasks.create({
            type: TimberTrackConfig.TASK_TYPE.PROCUREMENT,
            group: TimberTrackConfig.GROUPS.PROCUREMENT,
            ritm: ritmId,
            summary: 'Procure for ' + ritm.getValue('number'),
            fields: {
                u_mode: TimberTrackConfig.MODE.CUSTOMER,
                u_item: inventory ? inventory.getUniqueValue() : '',
                u_quantity: TimberTrackConfig.toInt(ritm.getValue('quantity'), 1),
                u_stage: TimberTrackConfig.STAGE.NEW
            }
        });
    },

    // ---------- gate 1: procurement head ----------

    onHeadDecision: function (approval) {
        var ritm = new GlideRecord('sc_req_item');
        if (!ritm.get(approval.getValue('u_ref'))) {
            return;
        }
        if (approval.getValue('state') === TimberTrackConfig.APPROVAL.APPROVED) {
            this.startForCustomer(ritm.getUniqueValue());
            return;
        }
        // Rejected: tell the customer and end this item's flow.
        ritm.setValue('state', TimberTrackConfig.STATE.CLOSED_INCOMPLETE);
        ritm.setValue('active', false);
        ritm.setValue('u_fulfilment', 'rejected');
        ritm.update();
        gs.eventQueue(TimberTrackConfig.EVENTS.UNABLE_TO_FULFIL, ritm, ritm.getValue('requested_for'), '');
        new TimberTrackFulfilment().closeRequestIfDone(ritm.getValue('request'));
    },

    // ---------- vendor outreach ----------

    /**
     * The member sets the task to Work in Progress: email every preferred vendor
     * (item, quantity, quotation form link) and create one quotation record each.
     * @returns {number} vendors contacted
     */
    onWorkInProgress: function (taskId) {
        var task = new GlideRecord('sc_task');
        if (!task.get(taskId) || task.getValue('u_stage') !== TimberTrackConfig.STAGE.NEW) {
            return 0; // not a fresh procurement task: do not email vendors twice
        }
        var inventory = new GlideRecord('u_material_inventory');
        var vendorIds = [];
        if (inventory.get(task.getValue('u_item'))) {
            vendorIds = (inventory.getValue('u_preferred_vendors') || '').split(',');
        }
        var qty = task.getValue('u_quantity');
        var sent = 0;
        for (var i = 0; i < vendorIds.length; i++) {
            if (!vendorIds[i]) {
                continue;
            }
            var quote = new GlideRecord('u_vendor_quotation');
            quote.initialize();
            quote.setValue('u_task', taskId);
            quote.setValue('u_vendor', vendorIds[i]);
            quote.setValue('u_state', TimberTrackConfig.QUOTATION.REQUESTED);
            quote.insert();
            gs.eventQueue(TimberTrackConfig.EVENTS.RFQ, quote, qty, TimberTrackConfig.vendorFormUrl());
            sent++;
        }
        task.setValue('u_stage', TimberTrackConfig.STAGE.RFQ_SENT);
        task.update();
        return sent;
    },

    /** Called when a vendor submits the form (Import Set or Scripted REST). */
    onQuotationSubmitted: function (quotationId, amount, deliveryDate) {
        var quote = new GlideRecord('u_vendor_quotation');
        if (!quote.get(quotationId)) {
            return false;
        }
        quote.setValue('u_amount', amount);
        quote.setValue('u_delivery_date', deliveryDate);
        quote.setValue('u_state', TimberTrackConfig.QUOTATION.SUBMITTED);
        quote.update();

        var task = new GlideRecord('sc_task');
        if (task.get(quote.getValue('u_task')) &&
            task.getValue('u_stage') === TimberTrackConfig.STAGE.RFQ_SENT) {
            task.setValue('u_stage', TimberTrackConfig.STAGE.QUOTES_IN);
            task.update();
        }
        return true;
    },

    // ---------- choosing a vendor ----------

    /** Submitted quotation with the lowest amount, or null. Rejected ones are excluded. */
    lowestQuotation: function (taskId) {
        var gr = new GlideRecord('u_vendor_quotation');
        gr.addQuery('u_task', taskId);
        gr.addQuery('u_state', TimberTrackConfig.QUOTATION.SUBMITTED);
        gr.query();
        var bestId = null;
        var bestAmount = 0;
        while (gr.next()) {
            var amount = parseFloat(gr.getValue('u_amount'));
            if (!isNaN(amount) && (bestId === null || amount < bestAmount)) {
                bestId = gr.getUniqueValue();
                bestAmount = amount;
            }
        }
        return bestId;
    },

    /**
     * The member picks the cheapest quotation (UI Action).
     *  threshold: the PO goes out straight away, no approvals
     *  customer : the finance head must approve before the PO is sent
     * @returns {string|null} selected quotation id
     */
    selectLowest: function (taskId) {
        var task = new GlideRecord('sc_task');
        if (!task.get(taskId)) {
            return null;
        }
        var stage = task.getValue('u_stage');
        if (stage !== TimberTrackConfig.STAGE.QUOTES_IN) {
            return null; // nothing to choose from yet, or already waiting on finance
        }
        var quoteId = this.lowestQuotation(taskId);
        if (!quoteId) {
            return null;
        }
        var quote = new GlideRecord('u_vendor_quotation');
        quote.get(quoteId);
        quote.setValue('u_state', TimberTrackConfig.QUOTATION.SELECTED);
        quote.update();
        task.setValue('u_selected_quotation', quoteId);
        task.update();

        if (task.getValue('u_mode') === TimberTrackConfig.MODE.THRESHOLD) {
            this.sendPurchaseOrder(taskId, quoteId);
        } else {
            task.setValue('u_stage', TimberTrackConfig.STAGE.FINANCE_PENDING);
            task.update();
            this.approvals.request(
                TimberTrackConfig.APPROVAL.FINANCE_PO,
                TimberTrackConfig.GROUPS.FINANCE_HEAD,
                taskId
            );
        }
        return quoteId;
    },

    // ---------- gate 2: finance head (customer mode only) ----------

    onFinanceDecision: function (approval) {
        var task = new GlideRecord('sc_task');
        if (!task.get(approval.getValue('u_ref'))) {
            return;
        }
        var quoteId = task.getValue('u_selected_quotation');
        if (approval.getValue('state') === TimberTrackConfig.APPROVAL.APPROVED) {
            this.sendPurchaseOrder(task.getUniqueValue(), quoteId);
            return;
        }
        // Rejected: back to vendor selection (not to the customer). The next-cheapest quote is used.
        var quote = new GlideRecord('u_vendor_quotation');
        if (quote.get(quoteId)) {
            quote.setValue('u_state', TimberTrackConfig.QUOTATION.REJECTED);
            quote.update();
        }
        task.setValue('u_stage', TimberTrackConfig.STAGE.QUOTES_IN);
        task.update();
        gs.eventQueue(
            TimberTrackConfig.EVENTS.FINANCE_REJECTED_PO, task, task.getValue('assigned_to'), ''
        );
    },

    // ---------- purchase order ----------

    /** Send the PO to the selected vendor and create the Warehouse task that receives the delivery. */
    sendPurchaseOrder: function (taskId, quotationId) {
        var quote = new GlideRecord('u_vendor_quotation');
        if (quote.get(quotationId)) {
            gs.eventQueue(TimberTrackConfig.EVENTS.PURCHASE_ORDER, quote, quote.getValue('u_vendor'), '');
        }
        var task = new GlideRecord('sc_task');
        task.get(taskId);
        task.setValue('u_stage', TimberTrackConfig.STAGE.PO_SENT);
        task.update();

        this.tasks.create({
            type: TimberTrackConfig.TASK_TYPE.WAREHOUSE_RECEIPT,
            group: TimberTrackConfig.GROUPS.WAREHOUSE,
            ritm: task.getValue('request_item'),
            summary: 'Receive vendor delivery',
            fields: { u_parent_task: taskId }
        });
    },

    type: 'TimberTrackProcurement'
};
