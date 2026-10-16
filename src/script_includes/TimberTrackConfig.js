/**
 * Script Include: TimberTrackConfig  (classless, plain object)
 * One place for group names, states, event names and tunable numbers,
 * so no other script contains a magic string.
 */
var TimberTrackConfig = {
    GROUPS: {
        WAREHOUSE: 'Timber Warehouse',
        DELIVERY: 'Timber Delivery',
        PROCUREMENT: 'Timber Procurement',
        PROCUREMENT_HEAD: 'Timber Procurement Head',
        FINANCE_HEAD: 'Timber Finance Head',
        FINANCE_TEAM: 'Timber Finance Team'
    },

    // u_type on sc_task
    TASK_TYPE: {
        PICK_PACK: 'pick_pack',
        DELIVERY: 'delivery',
        PROCUREMENT: 'procurement',
        WAREHOUSE_RECEIPT: 'warehouse_receipt',
        RETURN_ITEM: 'return_item'
    },

    // Standard task states
    STATE: {
        OPEN: '1',
        WORK_IN_PROGRESS: '2',
        CLOSED_COMPLETE: '3',
        CLOSED_INCOMPLETE: '4'
    },

    // u_stage on a procurement sc_task
    STAGE: {
        NEW: 'new',
        RFQ_SENT: 'rfq_sent',
        QUOTES_IN: 'quotes_in',
        FINANCE_PENDING: 'finance_pending',
        PO_SENT: 'po_sent'
    },

    // u_mode on a procurement sc_task
    MODE: {
        THRESHOLD: 'threshold',   // restock, fixed quantity, no approvals
        CUSTOMER: 'customer'      // fulfil a customer order, quantity follows the order
    },

    PAYMENT: {
        PENDING: 'pending',
        PAID: 'paid',
        EXPIRED: 'expired',
        REFUND_PENDING: 'refund_pending',
        REFUND_PAID: 'refund_paid',
        REFUND_REJECTED: 'refund_rejected'
    },

    QUOTATION: {
        REQUESTED: 'requested',
        SUBMITTED: 'submitted',
        SELECTED: 'selected',
        REJECTED: 'rejected'
    },

    APPROVAL: {
        REQUESTED: 'requested',
        APPROVED: 'approved',
        REJECTED: 'rejected',
        // u_purpose on u_approval_request
        PROCUREMENT_HEAD: 'procurement_head',
        FINANCE_PO: 'finance_po',
        DELIVERY_QUALITY: 'delivery_quality',
        FINANCE_REFUND: 'finance_refund'
    },

    // Register each of these in Event Registry and attach a Notification to it.
    EVENTS: {
        PAYMENT_LINK: 'x_timber.payment_link',
        PAYMENT_CONFIRMED: 'x_timber.payment_confirmed',
        ITEMS_PACKED: 'x_timber.items_packed',
        RFQ: 'x_timber.rfq',
        PURCHASE_ORDER: 'x_timber.purchase_order',
        FINANCE_REJECTED_PO: 'x_timber.finance_rejected_po',
        UNABLE_TO_FULFIL: 'x_timber.unable_to_fulfil',
        RETURN_REJECTED: 'x_timber.return_rejected',
        REFUND_CONFIRMATION: 'x_timber.refund_confirmation',
        REFUND_REJECTED: 'x_timber.refund_rejected'
    },

    DELIVERY_SLA_DAYS: 5,
    PAYMENT_LINK_DAYS: 1,

    /** Fixed restock quantity for threshold replenishment (System Property x_timber.reorder_qty). */
    reorderQty: function () {
        return parseInt(gs.getProperty('x_timber.reorder_qty', '100'), 10) || 100;
    },

    /** Public vendor quotation form (Google Form) link used in RFQ emails. */
    vendorFormUrl: function () {
        return gs.getProperty('x_timber.vendor_form_url', '');
    },

    toInt: function (value, fallback) {
        var n = parseInt(value, 10);
        return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
    },

    /** "YYYY-MM-DD HH:MM:SS" N days from now (UTC). */
    daysFromNow: function (days) {
        var dt = new GlideDateTime();
        dt.addDaysUTC(days);
        return dt.getValue();
    },

    now: function () {
        return new GlideDateTime().getValue();
    }
};
