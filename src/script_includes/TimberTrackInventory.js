/**
 * Script Include: TimberTrackInventory
 * Runs after payment is confirmed. For every item in the order it decides:
 *   - enough stock  -> deduct, create a Pick & Pack task, and start threshold
 *                      replenishment if the remaining stock is at or below the threshold
 *   - not enough    -> ask the procurement head to approve procurement
 */
var TimberTrackInventory = Class.create();
TimberTrackInventory.prototype = {
    initialize: function () {
        this.tasks = new TimberTrackTasks();
        this.approvals = new TimberTrackApprovals();
    },

    /** Check every (non-return) item of a request. @returns {number} items processed */
    processPaidRequest: function (requestId) {
        var ritm = new GlideRecord('sc_req_item');
        ritm.addQuery('request', requestId);
        ritm.addQuery('u_return_of', '');
        ritm.query();
        var processed = 0;
        while (ritm.next()) {
            this.processItem(ritm.getUniqueValue());
            processed++;
        }
        return processed;
    },

    /** @returns {string|null} 'in_stock' or 'procurement' */
    processItem: function (ritmId) {
        var ritm = new GlideRecord('sc_req_item');
        if (!ritm.get(ritmId)) {
            return null;
        }
        var qty = TimberTrackConfig.toInt(ritm.getValue('quantity'), 1);
        var inventory = this.findInventory(ritm.getValue('cat_item'));

        if (inventory && TimberTrackConfig.toInt(inventory.getValue('stock_quantity')) >= qty) {
            this.fulfilFromStock(ritm, inventory, qty);
            return 'in_stock';
        }
        this.requestProcurementApproval(ritm);
        return 'procurement';
    },

    findInventory: function (catItemId) {
        var gr = new GlideRecord('u_material_inventory');
        gr.addQuery('u_item', catItemId);
        gr.setLimit(1);
        gr.query();
        return gr.next() ? gr : null;
    },

    fulfilFromStock: function (ritm, inventory, qty) {
        var remaining = TimberTrackConfig.toInt(inventory.getValue('stock_quantity')) - qty;
        inventory.setValue('stock_quantity', remaining);
        inventory.update();

        this.tasks.create({
            type: TimberTrackConfig.TASK_TYPE.PICK_PACK,
            group: TimberTrackConfig.GROUPS.WAREHOUSE,
            ritm: ritm.getUniqueValue(),
            summary: 'Pick & pack ' + qty + ' x ' + ritm.getValue('number'),
            fields: { u_quantity: qty }
        });
        ritm.setValue('u_fulfilment', 'picking');
        ritm.update();

        // Threshold reached after this order: restock in the background.
        if (remaining <= TimberTrackConfig.toInt(inventory.getValue('u_threshold'))) {
            new TimberTrackProcurement().startThreshold(inventory.getUniqueValue());
        }
    },

    /** Gate 1 of customer procurement: the procurement head approves per request item. */
    requestProcurementApproval: function (ritm) {
        ritm.setValue('u_fulfilment', 'awaiting_procurement_approval');
        ritm.update();
        this.approvals.request(
            TimberTrackConfig.APPROVAL.PROCUREMENT_HEAD,
            TimberTrackConfig.GROUPS.PROCUREMENT_HEAD,
            ritm.getUniqueValue()
        );
    },

    /** Add (or remove, with a negative number) stock. */
    adjustStock: function (inventoryId, delta) {
        var gr = new GlideRecord('u_material_inventory');
        if (!gr.get(inventoryId)) {
            return null;
        }
        var next = TimberTrackConfig.toInt(gr.getValue('stock_quantity')) + delta;
        gr.setValue('stock_quantity', next);
        gr.update();
        return next;
    },

    type: 'TimberTrackInventory'
};
