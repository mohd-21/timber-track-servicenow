/**
 * Business Rule: Timber Track - route approval decisions
 * Table: Approval Request [u_approval_request]    When: after    Update: true
 * Condition: current.u_purpose != ''
 */
(function executeRule(current, previous /*null when async*/) {
    new TimberTrackRouter().onApprovalUpdate(current, previous);
})(current, previous);
