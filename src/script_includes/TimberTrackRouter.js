/**
 * Script Include: TimberTrackRouter
 * The only place that maps "a record changed" to "which step runs next".
 * Business Rules stay one line long and call these two methods.
 */
var TimberTrackRouter = Class.create();
TimberTrackRouter.prototype = {
    initialize: function () {},

    changedTo: function (current, previous, field, value) {
        return current.getValue(field) === value && previous.getValue(field) !== value;
    },

    /** After update on sc_task. */
    onTaskUpdate: function (current, previous) {
        var T = TimberTrackConfig.TASK_TYPE;
        var S = TimberTrackConfig.STATE;
        var id = current.getUniqueValue();
        var type = current.getValue('u_type');

        if (this.changedTo(current, previous, 'state', S.WORK_IN_PROGRESS) && type === T.PROCUREMENT) {
            new TimberTrackProcurement().onWorkInProgress(id);
            return;
        }
        if (!this.changedTo(current, previous, 'state', S.CLOSED_COMPLETE)) {
            return;
        }
        if (type === T.PICK_PACK) {
            new TimberTrackFulfilment().onPickPackClosed(id);
        } else if (type === T.DELIVERY) {
            new TimberTrackFulfilment().onDeliveryClosed(id);
        } else if (type === T.WAREHOUSE_RECEIPT) {
            new TimberTrackFulfilment().onWarehouseReceiptClosed(id);
        } else if (type === T.RETURN_ITEM) {
            new TimberTrackReturns().onReturnTaskClosed(id);
        }
    },

    /** After update on u_approval_request (state changed to approved or rejected). */
    onApprovalUpdate: function (current, previous) {
        var A = TimberTrackConfig.APPROVAL;
        var state = current.getValue('state');
        if (state === previous.getValue('state') || (state !== A.APPROVED && state !== A.REJECTED)) {
            return;
        }
        var purpose = current.getValue('u_purpose');
        if (purpose === A.PROCUREMENT_HEAD) {
            new TimberTrackProcurement().onHeadDecision(current);
        } else if (purpose === A.FINANCE_PO) {
            new TimberTrackProcurement().onFinanceDecision(current);
        } else if (purpose === A.DELIVERY_QUALITY) {
            new TimberTrackReturns().onQualityDecision(current);
        } else if (purpose === A.FINANCE_REFUND) {
            new TimberTrackReturns().onRefundDecision(current);
        }
    },

    /** After update on u_payment: a payment that just became paid starts the inventory check. */
    onPaymentUpdate: function (current, previous) {
        if (this.changedTo(current, previous, 'u_status', TimberTrackConfig.PAYMENT.PAID)) {
            new TimberTrackInventory().processPaidRequest(current.getValue('u_request'));
        }
    },

    type: 'TimberTrackRouter'
};
