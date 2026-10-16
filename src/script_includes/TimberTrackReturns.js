/**
 * Script Include: TimberTrackReturns
 * A customer returns a delivered item.
 *   return request -> refund-pending payment -> delivery team quality check
 *     rejected: item goes back to the customer, no refund
 *     approved: return task -> item restocked -> finance approves refund -> refund paid -> email
 */
var TimberTrackReturns = Class.create();
TimberTrackReturns.prototype = {
    initialize: function () {
        this.tasks = new TimberTrackTasks();
        this.approvals = new TimberTrackApprovals();
        this.inventory = new TimberTrackInventory();
    },

    /**
     * Customer asks to return a delivered item.
     * @returns {{ok: boolean, reason?: string, ritm?: string}}
     */
    requestReturn: function (originalRitmId) {
        var original = new GlideRecord('sc_req_item');
        if (!original.get(originalRitmId)) {
            return { ok: false, reason: 'not_found' };
        }
        if (original.getValue('u_return_of')) {
            return { ok: false, reason: 'cannot_return_a_return' };
        }
        if (original.getValue('state') !== TimberTrackConfig.STATE.CLOSED_COMPLETE) {
            return { ok: false, reason: 'not_delivered' }; // returns only open after delivery is closed
        }
        if (this.hasActiveReturn(originalRitmId)) {
            return { ok: false, reason: 'already_requested' };
        }

        var qty = TimberTrackConfig.toInt(original.getValue('quantity'), 1);
        var ret = new GlideRecord('sc_req_item');
        ret.initialize();
        ret.setValue('request', original.getValue('request'));
        ret.setValue('cat_item', original.getValue('cat_item'));
        ret.setValue('quantity', qty);
        ret.setValue('requested_for', original.getValue('requested_for'));
        ret.setValue('u_return_of', originalRitmId);
        ret.setValue('state', TimberTrackConfig.STATE.OPEN);
        ret.setValue('active', true);
        ret.setValue('u_fulfilment', 'return_requested');
        var returnId = ret.insert();

        var payment = new GlideRecord('u_payment');
        payment.initialize();
        payment.setValue('u_request', original.getValue('request'));
        payment.setValue('u_ritm', returnId);
        payment.setValue('u_amount', parseFloat(original.getValue('price') || '0') * qty);
        payment.setValue('u_status', TimberTrackConfig.PAYMENT.REFUND_PENDING);
        payment.insert();

        this.approvals.request(
            TimberTrackConfig.APPROVAL.DELIVERY_QUALITY,
            TimberTrackConfig.GROUPS.DELIVERY,
            returnId
        );
        return { ok: true, ritm: returnId };
    },

    hasActiveReturn: function (originalRitmId) {
        var gr = new GlideRecord('sc_req_item');
        gr.addQuery('u_return_of', originalRitmId);
        gr.addQuery('state', '!=', TimberTrackConfig.STATE.CLOSED_INCOMPLETE);
        gr.setLimit(1);
        gr.query();
        return gr.next();
    },

    /** Gate 1: delivery team quality check. */
    onQualityDecision: function (approval) {
        var ret = new GlideRecord('sc_req_item');
        if (!ret.get(approval.getValue('u_ref'))) {
            return;
        }
        if (approval.getValue('state') === TimberTrackConfig.APPROVAL.APPROVED) {
            this.tasks.create({
                type: TimberTrackConfig.TASK_TYPE.RETURN_ITEM,
                group: TimberTrackConfig.GROUPS.DELIVERY,
                ritm: ret.getUniqueValue(),
                summary: 'Process returned item ' + ret.getValue('number'),
                fields: { u_quantity: ret.getValue('quantity') }
            });
            ret.setValue('u_fulfilment', 'return_in_progress');
            ret.update();
            return;
        }
        ret.setValue('state', TimberTrackConfig.STATE.CLOSED_INCOMPLETE);
        ret.setValue('active', false);
        ret.setValue('u_fulfilment', 'return_rejected');
        ret.update();
        this.setPaymentStatus(ret.getUniqueValue(), TimberTrackConfig.PAYMENT.REFUND_REJECTED);
        gs.eventQueue(TimberTrackConfig.EVENTS.RETURN_REJECTED, ret, ret.getValue('requested_for'), '');
    },

    /** The delivery team member finished processing the returned item: restock it, then ask finance. */
    onReturnTaskClosed: function (taskId) {
        var task = new GlideRecord('sc_task');
        var ret = new GlideRecord('sc_req_item');
        if (!task.get(taskId) || !ret.get(task.getValue('request_item'))) {
            return;
        }
        var inventory = this.inventory.findInventory(ret.getValue('cat_item'));
        if (inventory) {
            this.inventory.adjustStock(inventory.getUniqueValue(), TimberTrackConfig.toInt(ret.getValue('quantity'), 1));
        }
        ret.setValue('u_fulfilment', 'awaiting_refund_approval');
        ret.update();
        this.approvals.request(
            TimberTrackConfig.APPROVAL.FINANCE_REFUND,
            TimberTrackConfig.GROUPS.FINANCE_TEAM,
            ret.getUniqueValue()
        );
    },

    /** Gate 2: finance authorises the refund. */
    onRefundDecision: function (approval) {
        var ret = new GlideRecord('sc_req_item');
        if (!ret.get(approval.getValue('u_ref'))) {
            return;
        }
        if (approval.getValue('state') === TimberTrackConfig.APPROVAL.APPROVED) {
            this.setPaymentStatus(ret.getUniqueValue(), TimberTrackConfig.PAYMENT.REFUND_PAID);
            ret.setValue('state', TimberTrackConfig.STATE.CLOSED_COMPLETE);
            ret.setValue('active', false);
            ret.setValue('u_fulfilment', 'refunded');
            ret.update();
            gs.eventQueue(TimberTrackConfig.EVENTS.REFUND_CONFIRMATION, ret, ret.getValue('requested_for'), '');
            return;
        }
        this.setPaymentStatus(ret.getUniqueValue(), TimberTrackConfig.PAYMENT.REFUND_REJECTED);
        gs.eventQueue(TimberTrackConfig.EVENTS.REFUND_REJECTED, ret, ret.getValue('requested_for'), '');
    },

    setPaymentStatus: function (returnRitmId, status) {
        var payment = new GlideRecord('u_payment');
        payment.addQuery('u_ritm', returnRitmId);
        payment.setLimit(1);
        payment.query();
        if (payment.next()) {
            payment.setValue('u_status', status);
            payment.update();
        }
    },

    type: 'TimberTrackReturns'
};
