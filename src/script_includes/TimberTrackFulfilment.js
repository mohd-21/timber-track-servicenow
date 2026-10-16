/**
 * Script Include: TimberTrackFulfilment
 * Pick & Pack -> Delivery -> request closure, plus what happens when a vendor delivery is received.
 */
var TimberTrackFulfilment = Class.create();
TimberTrackFulfilment.prototype = {
    initialize: function () {
        this.tasks = new TimberTrackTasks();
        this.inventory = new TimberTrackInventory();
    },

    /**
     * A Pick & Pack task was closed. Once ALL of that warehouse member's Pick & Pack
     * tasks on this request are closed, create one delivery task for their batch.
     * @returns {string|null} delivery task id (null while the batch is still open)
     */
    onPickPackClosed: function (taskId) {
        var task = new GlideRecord('sc_task');
        if (!task.get(taskId)) {
            return null;
        }
        var requestId = task.getValue('request');
        var owner = task.getValue('assigned_to') || '';

        var batch = new GlideRecord('sc_task');
        batch.addQuery('u_type', TimberTrackConfig.TASK_TYPE.PICK_PACK);
        batch.addQuery('request', requestId);
        batch.addQuery('assigned_to', owner);
        batch.query();

        var ritmIds = [];
        while (batch.next()) {
            if (batch.getValue('state') !== TimberTrackConfig.STATE.CLOSED_COMPLETE) {
                return null; // someone's batch is still being packed: wait
            }
            ritmIds.push(batch.getValue('request_item'));
        }
        if (this.deliveryExists(requestId, owner)) {
            return null; // already created (e.g. the rule fired twice)
        }
        return this.createDelivery(ritmIds, requestId, owner, true);
    },

    deliveryExists: function (requestId, owner) {
        var gr = new GlideRecord('sc_task');
        gr.addQuery('u_type', TimberTrackConfig.TASK_TYPE.DELIVERY);
        gr.addQuery('request', requestId);
        gr.addQuery('u_batch_owner', owner);
        gr.setLimit(1);
        gr.query();
        return gr.next();
    },

    /** One delivery task covering the given items, least busy delivery member, 5 day SLA. */
    createDelivery: function (ritmIds, requestId, batchOwner, notifyCustomer) {
        var due = TimberTrackConfig.daysFromNow(TimberTrackConfig.DELIVERY_SLA_DAYS);
        var deliveryId = this.tasks.create({
            type: TimberTrackConfig.TASK_TYPE.DELIVERY,
            group: TimberTrackConfig.GROUPS.DELIVERY,
            ritm: ritmIds[0],
            summary: 'Deliver ' + ritmIds.length + ' item(s)',
            fields: {
                u_ritms: ritmIds.join(','),
                u_batch_owner: batchOwner || '',
                due_date: due
            }
        });
        if (notifyCustomer) {
            var ritm = new GlideRecord('sc_req_item');
            if (ritm.get(ritmIds[0])) {
                gs.eventQueue(TimberTrackConfig.EVENTS.ITEMS_PACKED, ritm, ritm.getValue('requested_for'), due);
            }
        }
        return deliveryId;
    },

    /** A delivery task was closed: close the order when everything has been delivered. */
    onDeliveryClosed: function (taskId) {
        var task = new GlideRecord('sc_task');
        if (!task.get(taskId)) {
            return false;
        }
        return this.closeRequestIfDone(task.getValue('request'));
    },

    /** The vendor delivery was received by the warehouse. */
    onWarehouseReceiptClosed: function (taskId) {
        var receipt = new GlideRecord('sc_task');
        var parent = new GlideRecord('sc_task');
        if (!receipt.get(taskId) || !parent.get(receipt.getValue('u_parent_task'))) {
            return;
        }
        var qty = TimberTrackConfig.toInt(parent.getValue('u_quantity'));

        if (parent.getValue('u_mode') === TimberTrackConfig.MODE.THRESHOLD) {
            // Restock: the goods join the material inventory.
            this.inventory.adjustStock(parent.getValue('u_item'), qty);
        } else {
            // Bought for a customer's order: it goes straight out for delivery.
            var ritmId = parent.getValue('request_item');
            var ritm = new GlideRecord('sc_req_item');
            if (ritm.get(ritmId)) {
                this.createDelivery([ritmId], ritm.getValue('request'), '', false);
            }
        }
        parent.setValue('state', TimberTrackConfig.STATE.CLOSED_COMPLETE);
        parent.setValue('active', false);
        parent.update();
    },

    // ---------- order closure ----------

    /** True when a closed delivery task covers this item. */
    isDelivered: function (ritmId, requestId) {
        var gr = new GlideRecord('sc_task');
        gr.addQuery('u_type', TimberTrackConfig.TASK_TYPE.DELIVERY);
        gr.addQuery('request', requestId);
        gr.addQuery('state', TimberTrackConfig.STATE.CLOSED_COMPLETE);
        gr.query();
        while (gr.next()) {
            var covered = (gr.getValue('u_ritms') || '').split(',');
            for (var i = 0; i < covered.length; i++) {
                if (covered[i] === ritmId) {
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * Close the request and its items once every item that can still be fulfilled has been delivered.
     * Items rejected by the procurement head do not hold the order open.
     * If nothing could be fulfilled, the request closes as incomplete.
     */
    closeRequestIfDone: function (requestId) {
        var ritm = new GlideRecord('sc_req_item');
        ritm.addQuery('request', requestId);
        ritm.addQuery('u_return_of', '');
        ritm.query();

        var toDeliver = [];
        while (ritm.next()) {
            if (ritm.getValue('state') !== TimberTrackConfig.STATE.CLOSED_INCOMPLETE) {
                toDeliver.push(ritm.getUniqueValue());
            }
        }
        var req = new GlideRecord('sc_request');
        if (!req.get(requestId)) {
            return false;
        }
        if (toDeliver.length === 0) {
            req.setValue('state', TimberTrackConfig.STATE.CLOSED_INCOMPLETE);
            req.setValue('active', false);
            req.update();
            return true;
        }
        for (var i = 0; i < toDeliver.length; i++) {
            if (!this.isDelivered(toDeliver[i], requestId)) {
                return false;
            }
        }
        for (var j = 0; j < toDeliver.length; j++) {
            var item = new GlideRecord('sc_req_item');
            item.get(toDeliver[j]);
            item.setValue('state', TimberTrackConfig.STATE.CLOSED_COMPLETE);
            item.setValue('active', false);
            item.setValue('u_fulfilment', 'delivered');
            item.update();
        }
        req.setValue('state', TimberTrackConfig.STATE.CLOSED_COMPLETE);
        req.setValue('active', false);
        req.update();
        return true;
    },

    type: 'TimberTrackFulfilment'
};
