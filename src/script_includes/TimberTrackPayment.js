/**
 * Script Include: TimberTrackPayment
 * Payment record lifecycle for an order: pending -> paid (or expired).
 * markPaid() is the integration point for the payment gateway (e.g. a verified Razorpay webhook).
 */
var TimberTrackPayment = Class.create();
TimberTrackPayment.prototype = {
    initialize: function () {},

    /** Create the pending payment and send the payment link (valid for one day). */
    createForRequest: function (requestId, amount) {
        var payment = new GlideRecord('u_payment');
        payment.initialize();
        payment.setValue('u_request', requestId);
        payment.setValue('u_amount', amount);
        payment.setValue('u_status', TimberTrackConfig.PAYMENT.PENDING);
        payment.setValue('u_link_expires', TimberTrackConfig.daysFromNow(TimberTrackConfig.PAYMENT_LINK_DAYS));
        var id = payment.insert();

        payment.get(id);
        gs.eventQueue(TimberTrackConfig.EVENTS.PAYMENT_LINK, payment, payment.getValue('u_link_expires'), '');
        return id;
    },

    /**
     * Mark a payment as paid. The Business Rule on u_payment then starts the inventory check.
     * @returns {boolean} true if the payment moved to paid
     */
    markPaid: function (paymentId) {
        var payment = new GlideRecord('u_payment');
        if (!payment.get(paymentId)) {
            return false;
        }
        if (payment.getValue('u_status') !== TimberTrackConfig.PAYMENT.PENDING) {
            return false; // already paid, expired or refunded: ignore duplicate gateway calls
        }
        if (payment.getValue('u_link_expires') < TimberTrackConfig.now()) {
            payment.setValue('u_status', TimberTrackConfig.PAYMENT.EXPIRED);
            payment.update();
            return false;
        }
        payment.setValue('u_status', TimberTrackConfig.PAYMENT.PAID);
        payment.update();
        return true;
    },

    /** Scheduled job: expire pending payments whose link is older than a day. */
    expireStale: function () {
        var gr = new GlideRecord('u_payment');
        gr.addQuery('u_status', TimberTrackConfig.PAYMENT.PENDING);
        gr.addQuery('u_link_expires', '<', TimberTrackConfig.now());
        gr.query();
        var count = 0;
        while (gr.next()) {
            gr.setValue('u_status', TimberTrackConfig.PAYMENT.EXPIRED);
            gr.update();
            count++;
        }
        return count;
    },

    type: 'TimberTrackPayment'
};
