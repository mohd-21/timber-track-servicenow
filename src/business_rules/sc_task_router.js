/**
 * Business Rule: Timber Track - route task updates
 * Table: Catalog Task [sc_task]    When: after    Update: true
 * Condition: current.u_type != ''
 */
(function executeRule(current, previous /*null when async*/) {
    new TimberTrackRouter().onTaskUpdate(current, previous);
})(current, previous);
