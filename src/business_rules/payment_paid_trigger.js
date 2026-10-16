/**
 * Business Rule: Timber Track - payment paid starts the inventory check
 * Table: Payment [u_payment]    When: after    Update: true
 * Condition: current.u_status.changesTo('paid')
 */
(function executeRule(current, previous /*null when async*/) {
    new TimberTrackRouter().onPaymentUpdate(current, previous);
})(current, previous);
